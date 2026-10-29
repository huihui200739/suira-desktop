'use strict';

/**
 * 翻译引擎（图片取词翻译 = 翻译 B 支）。
 *
 * 为什么单独成模块：
 * 原产品用 macOS 系统翻译能力，Windows 没有等价的内置接口，必须自己选引擎。
 * 方案 P1 的思路是「用户自带模型 API」，所以这里做的是**可插拔引擎**而不是写死一家：
 *   none       未配置（默认，明确报错，不做假翻译）
 *   openai     OpenAI 兼容的 /chat/completions（DeepSeek、通义、Ollama 都能用）
 *   deepl      DeepL 官方 API
 *   microsoft  Azure Translator
 *
 * 设计约束：
 * 1. 纯函数先行。请求怎么发、回包怎么读、错误怎么讲，全部可离线单测；
 *    真正的 fetch 通过参数注入，测试不碰网络。
 * 2. 密钥只出现在请求头里，任何错误信息都不回显密钥。
 * 3. 未配置时返回可读原因，绝不返回"翻译成功"。
 */

const PROVIDERS = ['none', 'openai', 'deepl', 'microsoft'];

const LANG_LABELS = {
  auto: '自动识别',
  zh: '中文',
  en: '英文',
  ja: '日文',
  ko: '韩文',
  fr: '法文',
  de: '德文',
  es: '西班牙文',
  ru: '俄文'
};

/** 可选的源/目标语言（auto 只能作为源语言）。 */
const SOURCE_LANGS = Object.keys(LANG_LABELS);
const TARGET_LANGS = Object.keys(LANG_LABELS).filter((code) => code !== 'auto');

/** 单次请求的字符上限：DeepL 免费版 5000，留一点余量给分块拼接。 */
const MAX_CHARS_PER_REQUEST = 4500;

const DEFAULT_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  deepl: 'https://api-free.deepl.com/v2/translate',
  microsoft: 'https://api.cognitive.microsofttranslator.com'
};

const DEFAULT_MODELS = {
  openai: 'gpt-4o-mini'
};

/* ---------- 基础归一化 ---------- */

function normalizeProvider(value) {
  const id = String(value || '').trim().toLowerCase();
  return PROVIDERS.includes(id) ? id : 'none';
}

/**
 * 语言码归一化：把 zh-CN / zh-Hans / ZH / en-US 这类写法收成药匙里的短码。
 * 认不出来的一律回落到 auto（源）——宁可让引擎自己判断，也不要赌一个错的语种。
 */
function normalizeLang(value, { allowAuto = true } = {}) {
  const raw = String(value || '').trim().toLowerCase().replace('_', '-');
  if (!raw) return allowAuto ? 'auto' : 'zh';
  if (raw === 'auto' || raw === 'detect') return allowAuto ? 'auto' : 'zh';
  const head = raw.split('-')[0];
  if (LANG_LABELS[head]) {
    if (head === 'auto') return allowAuto ? 'auto' : 'zh';
    return head;
  }
  return allowAuto ? 'auto' : 'zh';
}

function langLabel(code) {
  return LANG_LABELS[normalizeLang(code)] || String(code || '');
}

function providerLabel(provider) {
  const id = normalizeProvider(provider);
  return {
    none: '未配置',
    openai: 'OpenAI 兼容接口',
    deepl: 'DeepL',
    microsoft: '微软翻译'
  }[id];
}

/**
 * 粗略判断文本语种。只用来做两件事：
 * 1. 用户没配源语言时，给引擎一个提示；
 * 2. 源语言与目标语言相同时提前拦一句「已经是中文了」，省一次请求。
 * 判断错代价很低（引擎还有自己的检测），所以用最朴素的字符比例。
 */
function detectLang(text) {
  const source = String(text || '');
  if (!source.trim()) return 'auto';
  let han = 0;
  let kana = 0;
  let hangul = 0;
  let latin = 0;
  for (const char of source) {
    const code = char.codePointAt(0);
    if ((code >= 0x3040 && code <= 0x30ff)) kana += 1;
    else if (code >= 0x4e00 && code <= 0x9fff) han += 1;
    else if (code >= 0xac00 && code <= 0xd7af) hangul += 1;
    else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) latin += 1;
  }
  const total = han + kana + hangul + latin;
  if (!total) return 'auto';
  // 日文里汉字与假名混排，先看假名：有假名就按日文处理
  if (kana / total > 0.05) return 'ja';
  if (hangul / total > 0.2) return 'ko';
  if (han / total > 0.2) return 'zh';
  if (latin / total > 0.5) return 'en';
  return 'auto';
}

/**
 * 按段落/句子边界切块，保证每块不超过 limit，且不切断代理对。
 * 引擎对单次请求长度有限制，长文本切成多块顺序翻译再拼回去。
 */
function splitChunks(text, limit = MAX_CHARS_PER_REQUEST) {
  const source = String(text || '');
  const max = Math.max(200, Number(limit) || MAX_CHARS_PER_REQUEST);
  if (source.length <= max) return source ? [source] : [];

  const chunks = [];
  let rest = source;
  while (rest.length > max) {
    // 优先段落，其次句子，最后硬切
    let cut = rest.lastIndexOf('\n\n', max);
    if (cut < max * 0.5) cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.5) cut = Math.max(rest.lastIndexOf('. ', max), rest.lastIndexOf('。', max), rest.lastIndexOf('！', max), rest.lastIndexOf('？', max));
    if (cut < max * 0.5) cut = max;
    // 不要把代理对切成两半
    const code = rest.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, '');
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/* ---------- 各引擎的语言码 ---------- */

function providerLang(provider, lang) {
  const code = normalizeLang(lang);
  if (code === 'auto') return '';
  if (provider === 'deepl') {
    return { zh: 'ZH', en: 'EN', ja: 'JA', ko: 'KO', fr: 'FR', de: 'DE', es: 'ES', ru: 'RU' }[code] || code.toUpperCase();
  }
  if (provider === 'microsoft') {
    return { zh: 'zh-Hans', en: 'en', ja: 'ja', ko: 'ko', fr: 'fr', de: 'de', es: 'es', ru: 'ru' }[code] || code;
  }
  return code;
}

/* ---------- 配置读取与校验 ---------- */

/**
 * 把落盘的 settings 收成一份可用的引擎配置。
 * 密钥由主进程解密后传进来（明文只在这个对象里活一次），不写日志。
 */
function readConfig(settings = {}, secret = '') {
  const provider = normalizeProvider(settings.translateProvider);
  return {
    provider,
    apiKey: String(secret || '').trim(),
    baseUrl: String(settings.translateBaseUrl || '').trim() || DEFAULT_BASE_URLS[provider] || '',
    model: String(settings.translateModel || '').trim() || DEFAULT_MODELS[provider] || '',
    region: String(settings.translateRegion || '').trim(),
    source: normalizeLang(settings.translateSource, { allowAuto: true }),
    target: normalizeLang(settings.translateTarget, { allowAuto: false })
  };
}

/** 未配置时给出可操作的原因，而不是一句「翻译失败」。 */
function assertConfigured(config = {}) {
  const provider = normalizeProvider(config.provider);
  if (provider === 'none') {
    return { ok: false, error: '还没有配置翻译引擎：到设置 → 翻译里选择一个引擎并填入密钥' };
  }
  if (!config.apiKey) {
    return { ok: false, error: `「${providerLabel(provider)}」缺少密钥：到设置 → 翻译里填入后重试` };
  }
  if (provider === 'microsoft' && !config.region) {
    return { ok: false, error: '微软翻译需要填写资源区域（例如 eastasia）' };
  }
  // 地址留空就用各家的默认地址；只有用户填了才校验格式
  const baseUrl = String(config.baseUrl || '').trim();
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    return { ok: false, error: '翻译接口地址必须以 http:// 或 https:// 开头' };
  }
  return { ok: true };
}

function isConfigured(settings = {}, hasSecret = false) {
  if (!hasSecret) return false;
  return assertConfigured(readConfig(settings, 'x')).ok;
}

/* ---------- 请求构造 ---------- */

function trimUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function completionUrl(value) {
  const url = new URL(trimUrl(value || DEFAULT_BASE_URLS.openai));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('接口地址不能包含账号、查询参数或锚点');
  let route = url.pathname.replace(/\/+$/, '');
  if (!route) route = '/v1';
  if (!route.endsWith('/chat/completions')) route += '/chat/completions';
  url.pathname = route;
  return url.href;
}

/**
 * 构造一次翻译请求。返回 {ok:true, url, method, headers, body} 或 {ok:false, error}。
 * 密钥只放在 headers/body 里，并且这里不会把它带进任何错误文案。
 */
function buildRequest({ provider, text, source, target, config = {} }) {
  const id = normalizeProvider(provider);
  const value = String(text == null ? '' : text);
  if (!value.trim()) return { ok: false, error: '没有需要翻译的文字' };
  if (id === 'none') return { ok: false, error: '还没有配置翻译引擎' };

  const from = normalizeLang(source, { allowAuto: true });
  const to = normalizeLang(target, { allowAuto: false });
  const apiKey = String(config.apiKey || '').trim();
  if (!apiKey) return { ok: false, error: '缺少翻译引擎密钥' };

  if (id === 'openai') {
    let endpoint;
    try { endpoint = completionUrl(config.baseUrl); } catch { return {ok:false,error:'接口地址无效，请填写 http(s) 地址，去掉查询参数和锚点'}; }
    const model = String(config.model || DEFAULT_MODELS.openai).trim();
    const system = [
      `你是翻译引擎。把用户给的文本翻译成${LANG_LABELS[to] || to}。`,
      '只输出译文本身，不要解释、不要加引号、不要重复原文。',
      '保留原有段落与换行结构；原文中的代码、变量名、URL 不翻译。'
    ].join('');
    return {
      ok: true,
      provider: id,
      url: endpoint,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: {
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: value }
        ]
      }
    };
  }

  if (id === 'deepl') {
    const url = trimUrl(config.baseUrl || DEFAULT_BASE_URLS.deepl);
    const search = new URLSearchParams();
    search.set('text', value);
    search.set('target_lang', providerLang('deepl', to));
    const fromCode = providerLang('deepl', from);
    if (fromCode) search.set('source_lang', fromCode);
    return {
      ok: true,
      provider: id,
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `DeepL-Auth-Key ${apiKey}`
      },
      body: search.toString()
    };
  }

  if (id === 'microsoft') {
    const base = trimUrl(config.baseUrl || DEFAULT_BASE_URLS.microsoft);
    const search = new URLSearchParams();
    search.set('api-version', '3.0');
    search.set('to', providerLang('microsoft', to));
    const fromCode = providerLang('microsoft', from);
    if (fromCode) search.set('from', fromCode);
    const headers = {
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': apiKey
    };
    if (config.region) headers['Ocp-Apim-Subscription-Region'] = String(config.region).trim();
    return {
      ok: true,
      provider: id,
      url: `${base}/translate?${search.toString()}`,
      method: 'POST',
      headers,
      body: [{ Text: value }]
    };
  }

  return { ok: false, error: `不支持的翻译引擎：${id}` };
}

/* ---------- 回包解析 ---------- */

/** 从各家回包里取出译文。结构对不上时返回可读错误，不返回半截空串。 */
function parseResponse(provider, payload) {
  const id = normalizeProvider(provider);
  try {
    if (id === 'openai') {
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) return { ok: false, error: '翻译接口返回了空结果' };
      return { ok: true, text: content.trim(), detected: 'auto' };
    }
    if (id === 'deepl') {
      const entry = payload?.translations?.[0];
      if (!entry || typeof entry.text !== 'string' || !entry.text.trim()) return { ok: false, error: 'DeepL 返回了空结果' };
      return { ok: true, text: entry.text.trim(), detected: normalizeLang(entry.detected_source_language) };
    }
    if (id === 'microsoft') {
      const entry = payload?.[0];
      const text = entry?.translations?.[0]?.text;
      if (typeof text !== 'string' || !text.trim()) return { ok: false, error: '微软翻译返回了空结果' };
      return { ok: true, text: text.trim(), detected: normalizeLang(entry?.detectedLanguage?.language) };
    }
    return { ok: false, error: '不支持的翻译引擎' };
  } catch {
    return { ok: false, error: '翻译接口返回的结构无法识别' };
  }
}

/* ---------- 错误说明 ---------- */

/**
 * 把 HTTP 状态与错误体翻成用户能照着做的中文。
 * 注意：这里不拼接请求头，避免密钥出现在界面或日志里。
 */
function describeError({ provider, status, payload, cause } = {}) {
  const id = normalizeProvider(provider);
  const detail = (() => {
    if (!payload || typeof payload !== 'object') return '';
    return String(
      payload?.error?.message
      || payload?.message
      || payload?.error?.code
      || ''
    ).slice(0, 160);
  })();

  if (status === 401 || status === 403) {
    return `${providerLabel(id)}拒绝了这次请求（${status}）：密钥无效或没有权限${detail ? ' — ' + detail : ''}`;
  }
  if (status === 429) {
    return `${providerLabel(id)}限流或额度用尽（429），稍后再试或检查账户额度`;
  }
  if (status === 400) {
    return `请求被拒绝（400）：${detail || '检查模型名、语言或文本长度'}`;
  }
  if (status === 404) {
    return `接口或模型不存在（404）：Base URL 根地址会自动补 /v1，请核对服务商的 API 路径和模型名称`;
  }
  if (status >= 500) {
    return `${providerLabel(id)}服务暂时不可用（${status}）`;
  }
  if (status) return `${providerLabel(id)}返回了 ${status}${detail ? ' — ' + detail : ''}`;
  if (cause === 'timeout') return `${providerLabel(id)}请求超时，检查网络后重试`;
  if (cause === 'network') return `连不上${providerLabel(id)}，检查网络或代理设置`;
  return `翻译失败${detail ? '：' + detail : ''}`;
}

/* ---------- 真正发请求 ---------- */

/**
 * 翻译一段文本。长文本自动分块顺序翻译再拼回。
 * @param {object} options
 * @param {object} options.config readConfig() 的结果
 * @param {string} options.text
 * @param {Function} [options.fetchImpl] 注入 fetch，测试用
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ok:boolean,text?:string,error?:string,provider?:string,from?:string,to?:string,chunks?:number}>}
 */
async function translateText({ config = {}, text, fetchImpl, timeoutMs = 20000 } = {}) {
  const guard = assertConfigured(config);
  if (!guard.ok) return { ok: false, error: guard.error };

  const provider = normalizeProvider(config.provider);
  const from = normalizeLang(config.source, { allowAuto: true });
  const to = normalizeLang(config.target, { allowAuto: false });
  const source = String(text == null ? '' : text);
  if (!source.trim()) return { ok: false, error: '没有需要翻译的文字' };

  // 已经是目标语言就别浪费一次请求，直接说清楚
  const detected = from === 'auto' ? detectLang(source) : from;
  if (detected === to) {
    return { ok: false, error: `这段文字看起来已经是${LANG_LABELS[to] || to}了，换个目标语言再试` };
  }

  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return { ok: false, error: '当前运行环境不支持网络请求' };

  const chunks = splitChunks(source, MAX_CHARS_PER_REQUEST);
  const parts = [];
  for (const chunk of chunks) {
    const request = buildRequest({ provider, text: chunk, source: from, target: to, config });
    if (!request.ok) return { ok: false, error: request.error };

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let response;
    try {
      response = await doFetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: typeof request.body === 'string' ? request.body : JSON.stringify(request.body),
        signal: controller ? controller.signal : undefined
      });
    } catch (error) {
      if (timer) clearTimeout(timer);
      const aborted = error && (error.name === 'AbortError' || error.code === 'ABORT_ERR');
      return { ok: false, error: describeError({ provider, cause: aborted ? 'timeout' : 'network' }) };
    }
    if (timer) clearTimeout(timer);

    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok) {
      return { ok: false, error: describeError({ provider, status: response.status, payload }) };
    }
    const parsed = parseResponse(provider, payload);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    parts.push(parsed.text);
  }

  return {
    ok: true,
    text: parts.join('\n\n'),
    provider,
    providerLabel: providerLabel(provider),
    from: detected,
    to,
    chunks: chunks.length
  };
}

module.exports = {
  PROVIDERS,
  LANG_LABELS,
  SOURCE_LANGS,
  TARGET_LANGS,
  MAX_CHARS_PER_REQUEST,
  DEFAULT_BASE_URLS,
  DEFAULT_MODELS,
  normalizeProvider,
  normalizeLang,
  langLabel,
  providerLabel,
  detectLang,
  splitChunks,
  providerLang,
  readConfig,
  assertConfigured,
  isConfigured,
  buildRequest,
  completionUrl,
  parseResponse,
  describeError,
  translateText
};
