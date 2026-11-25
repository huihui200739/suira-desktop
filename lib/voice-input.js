'use strict';

const { serviceEndpoint } = require('./service-endpoint');

const DEEPSEEK_ASR_PATH = 'tools/asr';
const OPENAI_ASR_PATH = 'audio/transcriptions';
const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SECOND = SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE / 8;
const MAX_DURATION_SECONDS = 120;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_PCM_BYTES = Math.min(MAX_FILE_BYTES - 44, BYTES_PER_SECOND * MAX_DURATION_SECONDS);

function validateEndpoint(value) {
  const source = String(value || '').trim();
  if (!source || source.length > 2048) return { ok: false, error: '请填写语音识别接口地址' };
  try {
    return { ok: true, url: serviceEndpoint(source).href };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function buildEndpoint(baseUrl, format = 'deepseek') {
  if (!['deepseek', 'openai'].includes(format)) return { ok: false, error: '不支持的语音识别接口类型' };
  const checked = validateEndpoint(baseUrl);
  if (!checked.ok) return checked;
  try {
    const url = new URL(checked.url);
    const route = format === 'deepseek' ? DEEPSEEK_ASR_PATH : OPENAI_ASR_PATH;
    if (url.pathname.replace(/\/+$/, '').endsWith(`/${route}`)) return { ok: true, url: url.href };
    let prefix = url.pathname.replace(/\/+$/, '');
    const chatRoute = '/chat/completions';
    if (prefix.endsWith(chatRoute)) prefix = prefix.slice(0, -chatRoute.length);
    if (!prefix) prefix = '/v1';
    url.pathname = `${prefix}/${route}`.replace(/^\/\//, '/');
    return validateEndpoint(url.href);
  } catch {
    return { ok: false, error: '语音识别接口地址无效' };
  }
}

function canReuseApiKey({ targetUrl, sourceUrl, sourceProvider, hasSourceKey } = {}) {
  if (sourceProvider !== 'openai' || !hasSourceKey) return false;
  const target = validateEndpoint(targetUrl);
  const source = validateEndpoint(sourceUrl);
  if (!target.ok || !source.ok) return false;
  try { return new URL(target.url).origin === new URL(source.url).origin; }
  catch { return false; }
}

function toPcmBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new Error('录音数据无效');
}

function rejectAndClear(pcm, result) {
  try { toPcmBuffer(pcm).fill(0); } catch { /* Invalid input has no audio buffer to clear. */ }
  return result;
}

function createWav(pcmValue) {
  const pcm = toPcmBuffer(pcmValue);
  if (!pcm.length || pcm.length % 2 !== 0) throw new Error('录音数据为空或格式无效');
  if (pcm.length > MAX_PCM_BYTES) throw new Error('录音超过 DeepSeek 的 120 秒或 8 MiB 限制');
  const wav = Buffer.allocUnsafe(44 + pcm.length);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(CHANNELS, 22); wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(BYTES_PER_SECOND, 28); wav.writeUInt16LE(CHANNELS * BITS_PER_SAMPLE / 8, 32);
  wav.writeUInt16LE(BITS_PER_SAMPLE, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav;
}

async function transcribe({ pcm, endpoint, baseUrl, format = 'deepseek', model = '', apiKey, fetchImpl = fetch, signal, timeoutMs = 600000 } = {}) {
  if (!['deepseek', 'openai'].includes(format)) return rejectAndClear(pcm, { ok: false, error: '不支持的语音识别接口类型' });
  if (format === 'openai') {
    const modelName = String(model || '').trim();
    if (!modelName || modelName.length > 120 || /[\r\n]/.test(modelName)) return rejectAndClear(pcm, { ok: false, error: '请填写有效的语音识别模型名称' });
  }
  const checked = endpoint ? validateEndpoint(endpoint) : buildEndpoint(baseUrl, format);
  if (!checked.ok) return rejectAndClear(pcm, checked);
  const key = String(apiKey || '').trim();
  if (!key) return rejectAndClear(pcm, { ok: false, error: '请先在设置中填写语音识别 API 密钥' });
  if (key.length > 4096 || /[\r\n]/.test(key)) return rejectAndClear(pcm, { ok: false, error: '语音识别 API 密钥格式无效' });
  let pcmBuffer;
  let wav;
  try {
    pcmBuffer = toPcmBuffer(pcm);
    wav = createWav(pcmBuffer);
  } catch (error) {
    pcmBuffer?.fill(0);
    return { ok: false, error: error.message };
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, Math.max(1000, Number(timeoutMs) || 180000));
  try {
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
    if (format === 'openai') form.append('model', String(model).trim());
    const response = await fetchImpl(checked.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: controller.signal,
      redirect: 'error'
    });
    let payload;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok) {
      const status = Number(response.status) || 0;
      const message = status === 404
        ? '这个中转接口没有提供语音识别路由；请填写支持 ASR 的接口地址'
        : status === 408
          ? '录音上传超时，请缩短录音或检查网络后重试'
        : status === 401 || status === 403
          ? '语音识别接口拒绝了请求，请检查 API 密钥或权限'
          : status === 413
            ? '录音超过语音服务的文件大小限制'
            : status === 429
              ? '语音服务请求过多或额度不足，请稍后重试'
              : status === 503 || status === 504
                ? '语音服务暂时繁忙或超时，请稍后重试'
                : `语音服务请求失败（${status || '网络错误'}）`;
      return { ok: false, error: message };
    }
    const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
    if (!text) return { ok: false, error: '没有识别到语音，请换个环境再试' };
    if (text.length > 100000) return { ok: false, error: '识别结果过长，未载入' };
    return { ok: true, text, durationMs: Math.max(0, Number(payload?.duration_ms) || Math.round(wav.length / BYTES_PER_SECOND * 1000)) };
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, cancelled: Boolean(signal?.aborted), error: signal?.aborted ? '已取消识别' : '语音识别请求超时' };
    return { ok: false, error: '无法连接语音识别服务，请检查网络和接口地址' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    wav.fill(0);
    pcmBuffer.fill(0);
  }
}

module.exports = {
  DEEPSEEK_ASR_PATH, OPENAI_ASR_PATH, SAMPLE_RATE, BYTES_PER_SECOND,
  MAX_DURATION_SECONDS, MAX_FILE_BYTES, MAX_PCM_BYTES,
  validateEndpoint, buildEndpoint, canReuseApiKey, createWav, transcribe
};
