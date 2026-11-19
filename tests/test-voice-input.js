'use strict';

const assert = require('node:assert/strict');
const voice = require('../lib/voice-input');
const pcmConverter = require('../src/pcm-converter');
const { SuiraStore } = require('../lib/store');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const samples = Float32Array.from({ length: 9600 }, (_, i) => Math.sin(i / 23) * 0.75);
  const single = pcmConverter.create(16000);
  const singleParts = [single.process(samples, 48000), single.finish()];
  const chunked = pcmConverter.create(16000);
  const chunkedParts = [chunked.process(samples.subarray(0, 4096), 48000),
    chunked.process(samples.subarray(4096), 48000), chunked.finish()];
  const singlePcm = Int16Array.from(singleParts.flatMap(part => [...part]));
  const chunkedPcm = Int16Array.from(chunkedParts.flatMap(part => [...part]));
  assert.equal(singlePcm.length, 3200);
  assert.deepEqual(chunkedPcm, singlePcm, 'resampling stays continuous across callback boundaries');
  assert.throws(() => pcmConverter.create().process(samples, 0), /采样率无效/);
  const short = pcmConverter.create(16000);
  assert.deepEqual(short.process(Float32Array.of(1), 48000), new Int16Array(0));
  assert.deepEqual(short.finish(), Int16Array.of(32767));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'suira-voice-settings-'));
  try {
    const settingsStore = new SuiraStore(path.join(root, 'settings.json'));
    await settingsStore.updateSettings({ voiceProvider: 'openai', voiceBaseUrl: 'https://relay.example/v1',
      voiceModel: 'whisper-1', voiceApiKeyEnc: { __enc: 1, cipher: 'ciphertext' } });
    assert.equal(settingsStore.getSettings().voiceProvider, 'openai');
    assert.equal(settingsStore.getSettings().voiceBaseUrl, 'https://relay.example/v1');
    assert.equal(settingsStore.getSettings().voiceModel, 'whisper-1');
    await settingsStore.updateSettings({ voiceProvider: 'invalid', voiceApiKeyEnc: 'plain-secret' });
    assert.equal(settingsStore.getSettings().voiceProvider, 'openai', 'unknown provider cannot overwrite a valid provider');
    assert.deepEqual(settingsStore.getSettings().voiceApiKeyEnc, { __enc: 1, cipher: 'ciphertext' }, 'plaintext is rejected by persistent settings');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }

  assert.equal(voice.buildEndpoint('https://relay.example/v1').url, 'https://relay.example/v1/tools/asr');
  assert.equal(voice.buildEndpoint('https://relay.example/custom/v2/').url, 'https://relay.example/custom/v2/tools/asr');
  assert.equal(voice.buildEndpoint('https://relay.example/v1', 'openai').url, 'https://relay.example/v1/audio/transcriptions');
  assert.equal(voice.buildEndpoint('https://relay.example/api/chat/completions', 'openai').url, 'https://relay.example/api/audio/transcriptions');
  assert.equal(voice.buildEndpoint('https://relay.example', 'openai').url, 'https://relay.example/v1/audio/transcriptions');
  assert.equal(voice.buildEndpoint('https://relay.example/v1/tools/asr').url, 'https://relay.example/v1/tools/asr');
  assert.equal(voice.canReuseApiKey({ targetUrl: 'https://relay.example/v1', sourceUrl: 'https://relay.example/chat', sourceProvider: 'openai', hasSourceKey: true }), true);
  assert.equal(voice.canReuseApiKey({ targetUrl: 'https://other.example/v1', sourceUrl: 'https://relay.example/v1', sourceProvider: 'openai', hasSourceKey: true }), false);
  assert.equal(voice.canReuseApiKey({ targetUrl: 'http://relay.example/v1', sourceUrl: 'http://relay.example/chat', sourceProvider: 'openai', hasSourceKey: true }), false);
  assert.equal(voice.canReuseApiKey({ targetUrl: 'https://relay.example/v1', sourceUrl: 'https://relay.example/chat', sourceProvider: 'deepl', hasSourceKey: true }), false);
  assert.equal(voice.canReuseApiKey({ targetUrl: 'https://relay.example/v1', sourceUrl: 'https://relay.example/chat', sourceProvider: 'openai', hasSourceKey: false }), false);
  assert.equal(voice.buildEndpoint('http://relay.example/v1').ok, false);
  assert.equal(voice.buildEndpoint('http://127.0.0.1:8080/v1').ok, true);
  assert.equal(voice.validateEndpoint('https://user:pass@relay.example/v1').ok, false);
  assert.equal(voice.validateEndpoint('https://relay.example/v1?token=secret').ok, false);

  const pcm = Buffer.from([0, 0, 255, 127, 0, 128, 16, 0]);
  const wav = voice.createWav(pcm);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.deepEqual(wav.subarray(44), pcm);
  assert.throws(() => voice.createWav(Buffer.alloc(0)), /为空/);
  assert.throws(() => voice.createWav(Buffer.alloc(3)), /格式无效/);

  const audio = Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]);
  let sentUrl = '', sentKey = '', uploaded = '', sentModel = '', redirect = '';
  const result = await voice.transcribe({ pcm: audio, baseUrl: 'https://relay.example/v1', apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      sentUrl = url; sentKey = options.headers.Authorization; redirect = options.redirect;
      const fields = options.body;
      sentModel = fields.get('model') || '';
      uploaded = fields.get('file').type;
      const uploadedBuffer = Buffer.from(await fields.get('file').arrayBuffer());
      assert.equal(uploadedBuffer.toString('ascii', 0, 4), 'RIFF');
      return { ok: true, json: async () => ({ text: ' 识别结果 ', duration_ms: 15 }) };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.text, '识别结果');
  assert.equal(sentUrl, 'https://relay.example/v1/tools/asr');
  assert.equal(sentKey, 'Bearer test-key');
  assert.equal(uploaded, 'audio/wav');
  assert.equal(redirect, 'error');
  assert.equal(sentModel, '');
  assert.deepEqual(audio, Buffer.alloc(audio.length), 'PCM request data is cleared after use');

  let called = false;
  const openai = await voice.transcribe({ pcm: Buffer.from([1, 0]), baseUrl: 'https://relay.example/v1',
    format: 'openai', model: 'whisper-1', apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      called = true;
      assert.equal(url, 'https://relay.example/v1/audio/transcriptions');
      assert.equal(options.body.get('model'), 'whisper-1');
      return { ok: true, json: async () => ({ text: 'done' }) };
    }
  });
  assert.equal(openai.ok, true);
  assert.equal(called, true);
  called = false;
  assert.equal((await voice.transcribe({ pcm: Buffer.from([1, 0]), format: 'openai', apiKey: 'key', fetchImpl: async () => { called = true; } })).ok, false);
  assert.equal(called, false, 'invalid model is rejected before networking');

  const missingRoute = await voice.transcribe({ pcm: Buffer.from([1, 0]), endpoint: 'https://relay.example/v1/tools/asr', apiKey: 'secret',
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({ error: 'not found' }) })
  });
  assert.equal(missingRoute.ok, false);
  assert.match(missingRoute.error, /没有提供语音识别路由/);
  assert.doesNotMatch(missingRoute.error, /secret/);
  const uploadTimeout = await voice.transcribe({ pcm: Buffer.from([1, 0]), endpoint: 'https://relay.example/v1/tools/asr', apiKey: 'test-key',
    fetchImpl: async () => ({ ok: false, status: 408, json: async () => ({ error: 'timeout' }) })
  });
  assert.match(uploadTimeout.error, /上传超时/);
  console.log('PASS ASR endpoint validation, PCM resampling/WAV conversion, encrypted settings guard, multipart payload, 404 handling and buffer cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
