'use strict';

(function installPcmConverter(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SuiraPcm = api;
})(globalThis, () => {
  function create(targetRate = 16000) {
    const outputRate = Math.max(8000, Math.min(48000, Math.round(Number(targetRate) || 16000)));
    let inputSamples = 0;
    let nextOutputAt = 0;
    let previousSample = 0;
    let sourceRate = 0;
    let finished = false;

    function convert(values) {
      const pcm = new Int16Array(values.length);
      for (let i = 0; i < values.length; i += 1) {
        const value = Math.max(-1, Math.min(1, values[i]));
        pcm[i] = value < 0 ? value * 32768 : value * 32767;
      }
      return pcm;
    }

    function process(input, inputRate, maximum = Number.MAX_SAFE_INTEGER) {
      if (finished) throw new Error('PCM 转换已经结束');
      const rawRate = Number(inputRate);
      if (!Number.isFinite(rawRate) || rawRate <= 0) throw new Error('音频采样率无效');
      const rate = Math.round(rawRate);
      if (sourceRate && sourceRate !== rate) throw new Error('录音期间音频采样率发生变化');
      sourceRate = rate;
      const samples = [];
      const start = inputSamples;
      const end = start + input.length;
      const step = sourceRate / outputRate;
      const limit = Math.max(0, Math.floor(Number(maximum) || 0));
      while (nextOutputAt < end - 1 && samples.length < limit) {
        const floor = Math.floor(nextOutputAt);
        const index = floor - start;
        const fraction = nextOutputAt - floor;
        const left = index < 0 ? previousSample : input[index];
        const right = index < 0 ? input[0] : input[index + 1];
        samples.push(left + (right - left) * fraction);
        nextOutputAt += step;
      }
      inputSamples = end;
      if (input.length) previousSample = input[input.length - 1];
      return convert(samples);
    }

    function finish(maximum = Number.MAX_SAFE_INTEGER) {
      if (finished) return new Int16Array(0);
      finished = true;
      const samples = [];
      const limit = Math.max(0, Math.floor(Number(maximum) || 0));
      while (nextOutputAt < inputSamples && samples.length < limit) {
        samples.push(previousSample);
        nextOutputAt += sourceRate / outputRate;
      }
      return convert(samples);
    }

    return { process, finish };
  }

  return { create };
});
