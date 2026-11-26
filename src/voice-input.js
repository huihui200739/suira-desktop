'use strict';

const $ = selector => document.querySelector(selector);
const api = window.suiraVoice;
const SAMPLE_RATE = 16000;
const MAX_SAMPLES = SAMPLE_RATE * 120;
const SILENCE_MS = 1800;
const WAIT_FOR_SPEECH_MS = 12000;
const state = { stream: null, context: null, source: null, processor: null, mute: null,
  chunks: [], sampleCount: 0, resampler: null, phase: 'opening', closing: false };
const bars = Array.from({ length: 17 }, (_, i) => {
  const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bar.setAttribute('x', i * 6);
  bar.setAttribute('y', 2);
  bar.setAttribute('width', 3);
  bar.setAttribute('height', 24);
  bar.setAttribute('rx', 1.5);
  bar.style.transform = 'scaleY(0.14)';
  $('#wave').append(bar);
  return bar;
});
const levels = bars.map(() => 0);
let smoothed = 0;
let closeTimer;
let lastWave = 0;

function drawWave(level) {
  smoothed = level > smoothed ? smoothed * 0.35 + level * 0.65 : smoothed * 0.72 + level * 0.28;
  levels.push(smoothed);
  levels.shift();
  bars.forEach((bar, i) => {
    const envelope = 0.45 + 0.55 * Math.sin(((i + 0.5) / bars.length) * Math.PI);
    const ratio = Math.min(1, Math.max(0.14, 0.14 + levels[i] * envelope * 0.86));
    bar.style.transform = `scaleY(${ratio.toFixed(3)})`;
  });
}

function phase(name, message = '') {
  state.phase = name;
  $('.dictation').dataset.phase = name;
  $('#record').disabled = name !== 'recording';
  $('#record').hidden = Boolean(message);
  $('#notice').hidden = !message;
  $('#notice').textContent = message;
  $('#notice').disabled = name !== 'configure';
  document.title = message || '随序 · 正在录音';
}

function notice(name, message, timeout) {
  phase(name, message);
  if (timeout) closeTimer = setTimeout(close, timeout);
}

function releaseMicrophone() {
  if (state.processor) state.processor.onaudioprocess = null;
  for (const node of [state.source, state.processor, state.mute]) {
    try { node?.disconnect(); } catch {}
  }
  for (const track of state.stream?.getTracks() || []) track.stop();
  if (state.context && state.context.state !== 'closed') state.context.close().catch(() => {});
  state.stream = state.context = state.source = state.processor = state.mute = null;
}

function close() {
  state.closing = true;
  clearTimeout(closeTimer);
  releaseMicrophone();
  clearAudioBuffers();
  api.close().catch(() => {});
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
  try {
    const status = await api.status();
    if (state.closing) return;
    if (!status?.configured) return notice('configure', '点击配置语音服务');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: {
      channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true
    }, video: false });
    if (state.closing) { stream.getTracks().forEach(track => track.stop()); return; }
    state.stream = stream;
    const context = state.context = new AudioContext();
    await context.resume();
    if (state.closing) return;
    state.source = context.createMediaStreamSource(stream);
    state.processor = context.createScriptProcessor(4096, 1, 1);
    state.mute = context.createGain();
    state.mute.gain.value = 0;
    clearAudioBuffers();
    let voicedMs = 0;
    let silenceMs = 0;
    let elapsedMs = 0;
    state.processor.onaudioprocess = event => {
      if (state.phase !== 'recording') return;
      const input = event.inputBuffer.getChannelData(0);
      let power = 0;
      for (const sample of input) power += sample * sample;
      const rms = Math.sqrt(power / input.length);
      const ms = input.length * 1000 / context.sampleRate;
      elapsedMs += ms;
      if (rms >= .012) { voicedMs += ms; silenceMs = 0; }
      else silenceMs += ms;
      if (performance.now() - lastWave >= 40) {
        lastWave = performance.now();
        drawWave(Math.min(1, rms * 6));
      }
      appendAudio(input, context.sampleRate);
      if (state.sampleCount >= MAX_SAMPLES || (voicedMs >= 170 && silenceMs >= SILENCE_MS)) stopRecording();
      else if (voicedMs < 170 && elapsedMs >= WAIT_FOR_SPEECH_MS) {
        releaseMicrophone(); clearAudioBuffers(); notice('error', '没有听到声音', 3200);
      }
    };
    for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => {
      if (state.stream !== stream) return;
      if (voicedMs >= 170) stopRecording();
      else { releaseMicrophone(); clearAudioBuffers(); notice('error', '麦克风已断开', 4000); }
    });
    state.source.connect(state.processor);
    state.processor.connect(state.mute);
    state.mute.connect(context.destination);
    phase('recording');
  } catch (error) {
    releaseMicrophone();
    if (!state.closing) notice('error', error?.name === 'NotAllowedError' ? '请允许麦克风访问' : '麦克风不可用', 5000);
  }
}

async function stopRecording() {
  if (state.phase === 'opening') return close();
  if (state.phase !== 'recording') return;
  phase('transcribing', '正在识别…');
  releaseMicrophone();
  if (!state.sampleCount) return notice('error', '没有听到声音', 3200);
  const pcm = new Int16Array(state.sampleCount);
  let offset = 0;
  for (const chunk of state.chunks) { pcm.set(chunk, offset); offset += chunk.length; }
  clearAudioBuffers();
  try {
    const result = await api.transcribe(pcm.buffer);
    if (state.closing) return;
    if (result?.pasted) close();
    else if (result?.ok) notice('copied', '已复制 · Ctrl+V 粘贴', 3200);
    else {
      $('#notice').title = result?.error || '语音识别失败';
      notice('configure', '识别失败 · 点此检查设置', 6000);
    }
  } catch {
    if (!state.closing) notice('error', '语音识别失败', 5000);
  } finally {
    pcm.fill(0);
  }
}

$('#record').addEventListener('click', stopRecording);
$('#close').addEventListener('click', close);
$('#notice').addEventListener('click', () => api.openSettings());
api.onStop(stopRecording);
window.addEventListener('beforeunload', () => { state.closing = true; releaseMicrophone(); clearAudioBuffers(); });
drawWave(0);
startRecording();
