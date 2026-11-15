'use strict';

const $ = selector => document.querySelector(selector);
const SAMPLE_RATE = 16000;
const MAX_SECONDS = 120;
const MAX_SAMPLES = SAMPLE_RATE * MAX_SECONDS;
const state = { stream: null, context: null, source: null, processor: null, mute: null,
  chunks: [], sampleCount: 0, resampler: null,
  startedAt: 0, elapsedTimer: null, recording: false, transcribing: false, requestRevision: 0, configured: false };

function setStatus(text) { $('#status').textContent = text; }
function showError(text) { $('#error').textContent = text; $('#error').hidden = !text; }
function formatTime(ms) { const seconds = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function updateElapsed() {
  const elapsed = state.startedAt ? Math.min(MAX_SECONDS * 1000, Date.now() - state.startedAt) : 0;
  $('#elapsed').textContent = `${formatTime(elapsed)} / 02:00`;
}

function releaseMicrophone() {
  clearInterval(state.elapsedTimer); state.elapsedTimer = null;
  if (state.processor) { state.processor.onaudioprocess = null; try { state.processor.disconnect(); } catch {} }
  try { state.source?.disconnect(); } catch {}
  try { state.mute?.disconnect(); } catch {}
  for (const track of state.stream?.getTracks?.() || []) track.stop();
  state.stream = null; state.source = null; state.processor = null; state.mute = null;
  const context = state.context; state.context = null;
  if (context && context.state !== 'closed') context.close().catch(() => {});
  state.recording = false;
  $('#record').classList.remove('is-recording');
  $('#record').setAttribute('aria-label', '开始录音');
}

function clearAudioBuffers() {
  for (const chunk of state.chunks) chunk.fill(0);
  state.chunks = []; state.sampleCount = 0;
  state.resampler = window.SuiraPcm.create(SAMPLE_RATE);
}

function appendAudio(input, inputRate) {
  const chunk = state.resampler.process(input, inputRate, MAX_SAMPLES - state.sampleCount);
  if (chunk.length) { state.chunks.push(chunk); state.sampleCount += chunk.length; }
}

async function startRecording() {
  showError('');
  if (state.transcribing) return;
  if (!state.configured) { setStatus('请先配置 ASR 服务'); return; }
  $('#record').disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: {
      channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true
    }, video: false });
    state.stream = stream;
    const context = new AudioContext();
    state.context = context;
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const mute = context.createGain(); mute.gain.value = 0;
    state.source = source; state.processor = processor; state.mute = mute;
    clearAudioBuffers();
    state.recording = true; state.startedAt = Date.now();
    processor.onaudioprocess = event => {
      if (!state.recording) return;
      appendAudio(event.inputBuffer.getChannelData(0), context.sampleRate);
      if (state.sampleCount >= MAX_SAMPLES) stopRecording();
    };
    source.connect(processor); processor.connect(mute); mute.connect(context.destination);
    $('#record').disabled = false;
    $('#record').classList.add('is-recording'); $('#record').setAttribute('aria-label', '停止录音并识别');
    setStatus('正在录音 · 点击停止并识别');
    $('#elapsed').textContent = '00:00 / 02:00';
    state.elapsedTimer = setInterval(updateElapsed, 200);
  } catch (error) {
    releaseMicrophone();
    $('#record').disabled = false;
    setStatus('无法启动录音');
    showError(error?.name === 'NotAllowedError' ? '没有麦克风权限，请在 Windows 隐私设置中允许桌面应用访问麦克风。' : '麦克风不可用，请检查设备后重试。');
  }
}

async function stopRecording() {
  if (!state.recording) return;
  releaseMicrophone();
  updateElapsed();
  $('#record').disabled = true; $('#rerecord').hidden = true;
  $('#result').disabled = true; $('#copy').disabled = true; $('#paste').disabled = true;
  if (!state.sampleCount) {
    $('#record').disabled = false; setStatus('没有录到声音'); showError('请确认麦克风已连接，然后重新录音。'); clearAudioBuffers(); return;
  }
  const tail = state.resampler.finish(MAX_SAMPLES - state.sampleCount);
  if (tail.length) { state.chunks.push(tail); state.sampleCount += tail.length; }
  const pcm = new Int16Array(state.sampleCount);
  let offset = 0;
  for (const chunk of state.chunks) { pcm.set(chunk, offset); offset += chunk.length; }
  clearAudioBuffers();
  const revision = ++state.requestRevision;
  state.transcribing = true;
  $('#cancel-recognition').hidden = false;
  $('#record').disabled = true;
  setStatus('正在上传并识别…'); showError('');
  try {
    const result = await window.suiraVoice.transcribe(pcm.buffer);
    if (revision !== state.requestRevision) return;
    state.transcribing = false; $('#cancel-recognition').hidden = true;
    if (!result?.ok) {
      setStatus(result?.cancelled ? '识别已取消' : '识别失败');
      showError(result?.error || '语音识别失败，请重试。');
      $('#record').disabled = false; $('#rerecord').hidden = false;
      return;
    }
    $('#result').value = result.text;
    $('#result').disabled = false;
    $('#copy').disabled = !result.text.trim(); $('#paste').disabled = !result.text.trim();
    $('#rerecord').hidden = false;
    $('#record').disabled = false;
    setStatus('识别完成 · 可编辑后粘贴');
  } catch (error) {
    state.transcribing = false; $('#cancel-recognition').hidden = true;
    if (revision === state.requestRevision) {
      setStatus('识别失败'); showError(error?.message || '语音识别失败，请重试。');
      $('#record').disabled = false; $('#rerecord').hidden = false;
    }
  } finally {
    pcm.fill(0);
    state.transcribing = false; $('#cancel-recognition').hidden = true;
    $('#record').disabled = !state.configured;
  }
}

async function commit(mode) {
  const text = $('#result').value;
  if (!text.trim()) return;
  $('#copy').disabled = true; $('#paste').disabled = true;
  setStatus(mode === 'copy' ? '正在复制…' : '正在粘贴到原窗口…');
  try {
    const result = await window.suiraVoice.commit(text, mode);
    if (!result?.ok) throw new Error(result?.error || '操作失败');
    setStatus(result.pasted ? '已粘贴到原窗口' : '已复制到剪贴板');
  } catch (error) {
    showError(error?.message || '操作失败');
    $('#copy').disabled = false; $('#paste').disabled = false;
  }
}

async function cancelRecognition() {
  state.requestRevision += 1;
  await window.suiraVoice.cancel().catch(() => {});
  setStatus('正在取消识别…');
}

$('#record').addEventListener('click', () => state.recording ? stopRecording() : startRecording());
$('#cancel-recognition').addEventListener('click', cancelRecognition);
$('#rerecord').addEventListener('click', () => { $('#result').value = ''; $('#result').disabled = true; $('#copy').disabled = true; $('#paste').disabled = true; $('#rerecord').hidden = true; $('#elapsed').textContent = '00:00 / 02:00'; startRecording(); });
$('#copy').addEventListener('click', () => commit('copy'));
$('#paste').addEventListener('click', () => commit('paste'));
$('#settings').addEventListener('click', () => window.suiraVoice.openSettings());
$('#close').addEventListener('click', () => { releaseMicrophone(); window.suiraVoice.close(); });
$('#result').addEventListener('input', () => { const ready = Boolean($('#result').value.trim()); $('#copy').disabled = !ready; $('#paste').disabled = !ready; });
window.addEventListener('beforeunload', () => { releaseMicrophone(); clearAudioBuffers(); });

window.suiraVoice.status().then(status => {
  state.configured = Boolean(status?.configured);
  if (state.configured) {
    setStatus(status.canReuseTranslateKey ? '语音服务已就绪 · 使用同源翻译密钥' : '语音服务已就绪');
    $('#record').disabled = false;
  } else {
    setStatus('请先配置 ASR 服务');
    $('#record').disabled = true;
    showError('当前设置尚未提供 ASR 接口和可用密钥。');
  }
}).catch(() => { setStatus('无法读取语音服务设置'); $('#record').disabled = true; });
