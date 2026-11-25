'use strict';

const translate = require('./translate');

function registerTranslationIpc({ handle, translateConfig, translateStatus, runTranslation, fetchImpl }) {
  handle('translate:status', () => translateStatus());
  handle('translate:models', () => translate.listModels(translateConfig(), fetchImpl));
  handle('translate:run', async (_event, payload) => {
    const text = String(payload?.text || '');
    if (!text.trim()) return { ok: false, error: '没有需要翻译的文字' };
    const overrides = {};
    if (payload?.target) overrides.target = translate.normalizeLang(payload.target, { allowAuto: false });
    if (payload?.source) overrides.source = translate.normalizeLang(payload.source);
    return runTranslation(text, overrides);
  });
  // 设置页的「测试」：拿一句固定短句走一遍真实链路，不写任何内容
  handle('translate:test', async () => {
    const english = translateConfig().target === 'en';
    const sample = english ? '你好，这是一条翻译测试。' : 'Hello, this is a translation test.';
    const result = await runTranslation(sample, { source: english ? 'zh' : 'en' });
    if (!result.ok) return result;
    return { ...result, sample: result.text };
  });
}

module.exports = { registerTranslationIpc };
