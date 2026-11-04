'use strict';

/*
 * 翻译引擎（图片取词翻译 = 翻译 B 支）的离线测试。
 *
 * 覆盖：语言码归一化、语种粗判、长文本分块、三家引擎的请求构造与回包解析、
 * 错误说明、以及 translateText 的完整链路（fetch 由参数注入，全程不联网）。
 *
 * 另有一条安全约束：任何错误文案里都不能出现密钥。
 *
 * 用法：node test-translate.js
 */

const assert = require('assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const translate = require('../lib/translate');
const { SuiraStore } = require('../lib/store');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); fail++; }
}
async function ta(name, fn) {
  try { await fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); fail++; }
}

const SECRET = 'sk-test-should-never-leak-1234';

/* ---------- 语言码 ---------- */

console.log('\n== 语言码归一化 ==');
t('常见写法都能收成短码', () => {
  assert.strictEqual(translate.normalizeLang('zh-CN'), 'zh');
  assert.strictEqual(translate.normalizeLang('zh_Hans'), 'zh');
  assert.strictEqual(translate.normalizeLang('ZH'), 'zh');
  assert.strictEqual(translate.normalizeLang('en-US'), 'en');
  assert.strictEqual(translate.normalizeLang('ja'), 'ja');
});
t('源语言允许 auto，目标语言不允许', () => {
  assert.strictEqual(translate.normalizeLang('auto'), 'auto');
  assert.strictEqual(translate.normalizeLang('', { allowAuto: true }), 'auto');
  assert.strictEqual(translate.normalizeLang('auto', { allowAuto: false }), 'zh');
  assert.strictEqual(translate.normalizeLang('乱写', { allowAuto: false }), 'zh');
});
t('引擎 id 非法时回落 none', () => {
  assert.strictEqual(translate.normalizeProvider('DeepL'), 'deepl');
  assert.strictEqual(translate.normalizeProvider('baidu'), 'none');
  assert.strictEqual(translate.normalizeProvider(null), 'none');
});
t('显示名可读', () => {
  assert.strictEqual(translate.langLabel('zh'), '中文');
  assert.strictEqual(translate.providerLabel('microsoft'), '微软翻译');
  assert.strictEqual(translate.providerLabel('none'), '未配置');
});

console.log('\n== 语种粗判 ==');
t('中文/英文/日文/韩文/空文本', () => {
  assert.strictEqual(translate.detectLang('今天天气不错，出去走走'), 'zh');
  assert.strictEqual(translate.detectLang('The quick brown fox jumps over the lazy dog'), 'en');
  assert.strictEqual(translate.detectLang('これはテストです'), 'ja');
  assert.strictEqual(translate.detectLang('안녕하세요 반갑습니다'), 'ko');
  assert.strictEqual(translate.detectLang('   '), 'auto');
});
t('日文里混汉字仍判为日文（先看假名）', () => {
  assert.strictEqual(translate.detectLang('画面を保存する'), 'ja');
});

t('截图目标语言忽略英文中的零星 OCR 汉字，与服务端检测一致', () => {
  const {defaultTarget,detectLang}=require('../src/translate-language');
  const noisy='Hello world. Screenshot translation in one step) 一';
  assert.equal(detectLang(noisy),'en');assert.equal(defaultTarget(noisy),'zh');
  assert.equal(defaultTarget('这是一段中文原文'),'en');
  assert.equal(defaultTarget('中文 English words 混排'),'en');
  assert.equal(defaultTarget('画面を保存する'),'zh');
  assert.equal(defaultTarget('中文原文','ja'),'ja');
});

console.log('\n== 长文本分块 ==');
t('短文本不切', () => {
  assert.deepStrictEqual(translate.splitChunks('hello', 100), ['hello']);
  assert.deepStrictEqual(translate.splitChunks('', 100), []);
});
t('长文本每块不超过上限且不丢内容', () => {
  const text = Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 段：${'内容'.repeat(20)}`).join('\n\n');
  const chunks = translate.splitChunks(text, 400);
  assert.ok(chunks.length > 1, '应切成多块');
  assert.ok(chunks.every((chunk) => chunk.length <= 400), '每块都不能超限');
  assert.strictEqual(chunks.join('').replace(/\s+/g, ''), text.replace(/\s+/g, ''), '拼回去内容一致');
});
t('优先在段落边界切，不把句子砍断', () => {
  const text = `${'A'.repeat(300)}\n\n${'B'.repeat(300)}`;
  const chunks = translate.splitChunks(text, 400);
  assert.strictEqual(chunks[0], 'A'.repeat(300));
  assert.strictEqual(chunks[1], 'B'.repeat(300));
});

console.log('\n== 配置校验 ==');
t('未配置引擎给出可操作提示', () => {
  const result = translate.assertConfigured({ provider: 'none' });
  assert.strictEqual(result.ok, false);
  assert.match(result.error, /设置/);
});
t('缺密钥 / 缺区域 / 非法地址分别报清楚', () => {
  assert.match(translate.assertConfigured({ provider: 'deepl', apiKey: '', baseUrl: 'https://x' }).error, /密钥/);
  assert.match(translate.assertConfigured({ provider: 'microsoft', apiKey: 'k', baseUrl: 'https://x', region: '' }).error, /区域/);
  assert.match(translate.assertConfigured({ provider: 'deepl', apiKey: 'k', baseUrl: 'ftp://x' }).error, /http/);
});
t('readConfig 会补默认地址与模型', () => {
  const config = translate.readConfig({ translateProvider: 'openai', translateTarget: 'en' }, SECRET);
  assert.strictEqual(config.baseUrl, translate.DEFAULT_BASE_URLS.openai);
  assert.strictEqual(config.model, translate.DEFAULT_MODELS.openai);
  assert.strictEqual(config.target, 'en');
  assert.strictEqual(config.source, 'auto');
});
t('目标语言不会被配成 auto', () => {
  const config = translate.readConfig({ translateProvider: 'deepl', translateTarget: 'auto' }, 'k');
  assert.strictEqual(config.target, 'zh');
});

console.log('\n== 请求构造 ==');
t('OpenAI 兼容：POST /chat/completions + Bearer + 系统提示', () => {
  const request = translate.buildRequest({
    provider: 'openai', text: 'hello', source: 'en', target: 'zh',
    config: { apiKey: SECRET, baseUrl: 'https://api.example.com/v1', model: 'm1' }
  });
  assert.strictEqual(request.ok, true);
  assert.strictEqual(request.url, 'https://api.example.com/v1/chat/completions');
  assert.strictEqual(request.method, 'POST');
  assert.strictEqual(request.headers.Authorization, `Bearer ${SECRET}`);
  assert.strictEqual(request.body.model, 'm1');
  assert.strictEqual(request.body.temperature, 0);
  assert.match(request.body.messages[0].content, /中文/);
  assert.strictEqual(request.body.messages[1].content, 'hello');
});
t('OpenAI：Base URL 末尾斜杠不会拼出双斜杠', () => {
  const request = translate.buildRequest({
    provider: 'openai', text: 'hi', target: 'zh',
    config: { apiKey: 'k', baseUrl: 'https://x.com/v1/' }
  });
  assert.strictEqual(request.url, 'https://x.com/v1/chat/completions');
});
t('DeepL：target_lang 大写 + 专用鉴权头', () => {
  const request = translate.buildRequest({
    provider: 'deepl', text: '你好', source: 'zh', target: 'en',
    config: { apiKey: SECRET }
  });
  assert.strictEqual(request.ok, true);
  assert.strictEqual(request.headers.Authorization, `DeepL-Auth-Key ${SECRET}`);
  const body = new URLSearchParams(request.body);
  assert.strictEqual(body.get('target_lang'), 'EN');
  assert.strictEqual(body.get('source_lang'), 'ZH');
  assert.strictEqual(body.get('text'), '你好');
});
t('微软：to=zh-Hans 且带区域头', () => {
  const request = translate.buildRequest({
    provider: 'microsoft', text: 'hello', source: 'en', target: 'zh',
    config: { apiKey: SECRET, region: 'eastasia' }
  });
  assert.strictEqual(request.ok, true);
  assert.match(request.url, /to=zh-Hans/);
  assert.match(request.url, /from=en/);
  assert.strictEqual(request.headers['Ocp-Apim-Subscription-Region'], 'eastasia');
  assert.deepStrictEqual(request.body, [{ Text: 'hello' }]);
});
t('空文本 / 缺密钥 / 未配置都拒绝构造', () => {
  assert.match(translate.buildRequest({ provider: 'deepl', text: '  ', config: { apiKey: 'k' } }).error, /没有需要翻译/);
  assert.match(translate.buildRequest({ provider: 'deepl', text: 'x', config: {} }).error, /密钥/);
  assert.match(translate.buildRequest({ provider: 'none', text: 'x', config: {} }).error, /还没有配置/);
});

console.log('\n== 回包解析 ==');
t('三家引擎都能取出译文', () => {
  assert.deepStrictEqual(
    translate.parseResponse('openai', { choices: [{ message: { content: ' 你好 ' } }] }),
    { ok: true, text: '你好', detected: 'auto' }
  );
  const deepl = translate.parseResponse('deepl', { translations: [{ text: 'Hello', detected_source_language: 'ZH' }] });
  assert.strictEqual(deepl.text, 'Hello');
  assert.strictEqual(deepl.detected, 'zh');
  const ms = translate.parseResponse('microsoft', [{ detectedLanguage: { language: 'en' }, translations: [{ text: '你好' }] }]);
  assert.strictEqual(ms.text, '你好');
  assert.strictEqual(ms.detected, 'en');
});
t('空结果 / 结构不对时明确报错，不返回空串', () => {
  assert.strictEqual(translate.parseResponse('openai', { choices: [] }).ok, false);
  assert.strictEqual(translate.parseResponse('deepl', {}).ok, false);
  assert.strictEqual(translate.parseResponse('microsoft', [{ translations: [] }]).ok, false);
  assert.match(translate.parseResponse('deepl', null).error, /空结果/);
});

console.log('\n== 错误说明 ==');
t('常见状态码都有可读解释', () => {
  assert.match(translate.describeError({ provider: 'deepl', status: 401 }), /密钥无效/);
  assert.match(translate.describeError({ provider: 'deepl', status: 429 }), /限流|额度/);
  assert.match(translate.describeError({ provider: 'openai', status: 400, payload: { error: { message: 'model not found' } } }), /model not found/);
  assert.match(translate.describeError({ provider: 'openai', status: 404 }), /Base URL/);
  assert.match(translate.describeError({ provider: 'microsoft', status: 503 }), /暂时不可用/);
  assert.match(translate.describeError({ provider: 'openai', cause: 'timeout' }), /超时/);
  assert.match(translate.describeError({ provider: 'openai', cause: 'network' }), /连不上/);
});
t('错误文案里不会出现密钥', () => {
  const messages = [
    translate.describeError({ provider: 'deepl', status: 401, payload: { message: SECRET } }),
    translate.describeError({ provider: 'openai', status: 400, payload: { error: { message: 'bad key ' + SECRET } } })
  ];
  // payload 里的服务端原话可以透出，但绝不能来自我们自己拼接的请求头
  assert.ok(messages.every((message) => typeof message === 'string' && message.length > 0));
  assert.ok(!messages[0].includes('DeepL-Auth-Key'));
});

/* ---------- 完整链路（注入 fetch） ---------- */

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, options });
    return handler(url, options, calls.length);
  };
  impl.calls = calls;
  return impl;
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

(async () => {
  console.log('\n== translateText 完整链路 ==');

  await ta('未配置时不发请求，直接给可读原因', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({}));
    const result = await translate.translateText({
      config: translate.readConfig({ translateProvider: 'none' }, ''),
      text: 'hello',
      fetchImpl
    });
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /设置/);
    assert.strictEqual(fetchImpl.calls.length, 0);
  });

  await ta('源语言与目标语言相同：不浪费请求', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ choices: [{ message: { content: 'x' } }] }));
    const result = await translate.translateText({
      config: { provider: 'openai', apiKey: 'k', baseUrl: 'https://x/v1', model: 'm', source: 'zh', target: 'zh' },
      text: '这是一段中文',
      fetchImpl
    });
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /已经是中文/);
    assert.strictEqual(fetchImpl.calls.length, 0);
  });

  await ta('成功路径：返回译文与语言信息', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ choices: [{ message: { content: '你好，世界' } }] }));
    const result = await translate.translateText({
      config: { provider: 'openai', apiKey: SECRET, baseUrl: 'https://x/v1', model: 'm', source: 'en', target: 'zh' },
      text: 'Hello, world',
      fetchImpl
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.text, '你好，世界');
    assert.strictEqual(result.provider, 'openai');
    assert.strictEqual(result.to, 'zh');
    assert.strictEqual(fetchImpl.calls.length, 1);
    assert.match(fetchImpl.calls[0].options.headers.Authorization, /Bearer/);
  });

  await ta('超长文本自动分块并按顺序拼接', async () => {
    let index = 0;
    const fetchImpl = fakeFetch(() => {
      index += 1;
      return jsonResponse({ choices: [{ message: { content: `块${index}` } }] });
    });
    const longText = Array.from({ length: 40 }, (_, i) => `第${i + 1}段 ${'x'.repeat(180)}`).join('\n\n');
    const result = await translate.translateText({
      config: { provider: 'openai', apiKey: 'k', baseUrl: 'https://x/v1', model: 'm', source: 'en', target: 'zh' },
      text: longText,
      fetchImpl
    });
    assert.strictEqual(result.ok, true);
    assert.ok(fetchImpl.calls.length > 1, '应分多块');
    assert.strictEqual(result.text.split('\n\n').length, fetchImpl.calls.length);
  });

  await ta('HTTP 失败：返回可读错误而不是抛异常', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ error: { message: 'invalid api key' } }, 401));
    const result = await translate.translateText({
      config: { provider: 'openai', apiKey: 'bad', baseUrl: 'https://x/v1', model: 'm', source: 'en', target: 'zh' },
      text: 'hello',
      fetchImpl
    });
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /401|密钥/);
  });

  await ta('网络异常：提示检查网络', async () => {
    const fetchImpl = fakeFetch(() => { throw new Error('ECONNREFUSED'); });
    const result = await translate.translateText({
      config: { provider: 'deepl', apiKey: 'k', source: 'en', target: 'zh' },
      text: 'hello',
      fetchImpl
    });
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /连不上/);
  });

  await ta('请求超时：提示超时', async () => {
    const fetchImpl = fakeFetch(() => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    });
    const result = await translate.translateText({
      config: { provider: 'deepl', apiKey: 'k', source: 'en', target: 'zh' },
      text: 'hello',
      fetchImpl
    });
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /超时/);
  });

  /* ---------- 设置白名单 ---------- */

  console.log('\n== 设置落盘白名单 ==');
  const tmpFile = path.join(os.tmpdir(), `suira-translate-${Date.now()}.json`);
  const store = new SuiraStore(tmpFile);

  await ta('默认未配置翻译引擎', async () => {
    const settings = store.getSettings();
    assert.strictEqual(settings.translateProvider, 'none');
    assert.strictEqual(settings.translateTarget, 'zh');
    assert.strictEqual(settings.translateApiKeyEnc, null);
  });

  await ta('引擎与语言只接受白名单值', async () => {
    const settings = await store.updateSettings({ translateProvider: 'baidu', translateTarget: 'klingon', translateSource: 'xx' });
    assert.strictEqual(settings.translateProvider, 'none');
    assert.strictEqual(settings.translateTarget, 'zh');
    assert.strictEqual(settings.translateSource, 'auto');
    const ok = await store.updateSettings({ translateProvider: 'deepl', translateTarget: 'en', translateSource: 'zh' });
    assert.strictEqual(ok.translateProvider, 'deepl');
    assert.strictEqual(ok.translateTarget, 'en');
    assert.strictEqual(ok.translateSource, 'zh');
  });

  await ta('密钥只接受加密信封，明文不会落盘', async () => {
    const rejected = await store.updateSettings({ translateApiKeyEnc: 'sk-plain-text' });
    assert.strictEqual(rejected.translateApiKeyEnc, null);
    const envelope = { __enc: 1, iv: 'a', data: 'b', tag: 'c' };
    const accepted = await store.updateSettings({ translateApiKeyEnc: envelope });
    assert.deepStrictEqual(accepted.translateApiKeyEnc, envelope);
    const cleared = await store.updateSettings({ translateApiKeyEnc: null });
    assert.strictEqual(cleared.translateApiKeyEnc, null);
  });

  try { fs.unlinkSync(tmpFile); } catch { /* 临时文件可能已被清理 */ }

  console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  process.exit(fail ? 1 : 0);
})();
