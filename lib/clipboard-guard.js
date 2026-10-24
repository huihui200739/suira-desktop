'use strict';

/**
 * 剪贴板监听与敏感内容过滤。
 *
 * 对应开发方案 P0「剪贴板历史：去重、重启恢复、超大内容、占用锁重试」
 * 与第 8 节「密码管理器等来源默认排除；标准敏感标记能识别时尊重它」。
 */

/** 有界重试：剪贴板被其他进程占用时短暂退避后重读。 */
const READ_RETRY_DELAYS = [0, 40, 90];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 带重试地读取剪贴板。
 * @param {() => Promise<any>} reader
 * @param {(value:any) => boolean} isEmpty
 * @param {{retries?:number[]}} [options]
 */
async function readWithRetry(reader, isEmpty = (value) => value == null, options = {}) {
  const delays = options.retries || READ_RETRY_DELAYS;
  let lastError = null;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt] > 0) await sleep(delays[attempt]);
    try {
      const value = await reader();
      if (!isEmpty(value)) return { value, attempts: attempt + 1, error: null };
      // 读到了但为空：可能是锁竞争导致的空读，最后一次直接返回空
      if (attempt === delays.length - 1) return { value, attempts: attempt + 1, error: null };
    } catch (error) {
      lastError = error;
    }
  }
  return { value: null, attempts: delays.length, error: lastError };
}

/**
 * 密码管理器等敏感应用的进程名（小写，不含扩展名）。
 * 命中即默认不记录，符合「密码管理器等来源默认排除」。
 */
const SENSITIVE_PROCESS_NAMES = [
  '1password', '1password7', 'bitwarden', 'keepass', 'keepassxc', 'lastpass',
  'dashlane', 'enpass', 'roboform', 'nordpass', 'keeper', 'protonpass',
  'authenticator', 'keepass2', 'password safe', 'passwordsafe'
];

/** 敏感窗口标题关键字（中文与英文）。 */
const SENSITIVE_TITLE_PATTERNS = [
  /密码/,
  /口令/,
  /密钥/,
  /验证码/,
  /password/i,
  /passwd/i,
  /secret/i,
  /private\s*key/i,
  /recovery\s*code/i,
  /one[- ]time\s*(password|code)/i,
  /2fa/i,
  /totp/i,
  /credential/i
];

/** 内容形态层面的敏感特征：私钥块、常见密钥前缀。 */
const SENSITIVE_CONTENT_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/
];

/**
 * 判断一次剪贴板捕获是否应被排除。
 *
 * @param {object} input
 * @param {string} [input.text] 剪贴板文本
 * @param {string} [input.processName] 来源进程名
 * @param {string} [input.windowTitle] 来源窗口标题
 * @param {boolean} [input.excludeSensitive=true] 用户是否开启了敏感来源排除
 * @returns {{excluded:boolean, reason:string}}
 */
function shouldExcludeCapture(input = {}) {
  if (input.excludeSensitive === false) return { excluded: false, reason: '' };

  const processName = String(input.processName || '').toLowerCase().replace(/\.exe$/, '');
  if (processName) {
    for (const name of SENSITIVE_PROCESS_NAMES) {
      if (processName === name || processName.includes(name)) {
        return { excluded: true, reason: `来源应用 ${processName} 属于密码管理器` };
      }
    }
  }

  const title = String(input.windowTitle || '');
  if (title) {
    for (const pattern of SENSITIVE_TITLE_PATTERNS) {
      if (pattern.test(title)) return { excluded: true, reason: '窗口标题含敏感关键字' };
    }
  }

  const text = String(input.text || '');
  if (text) {
    for (const pattern of SENSITIVE_CONTENT_PATTERNS) {
      if (pattern.test(text)) return { excluded: true, reason: '内容形似密钥或凭据' };
    }
  }

  return { excluded: false, reason: '' };
}

/**
 * 两次读到的图片字节是否完全相同。
 *
 * 轮询里靠它判断"图片有没有真的变过"：没变就不解码、不做 PNG 编码。
 * 长度不同直接判为不同，长度相同时才做真正的字节比较（几 MB 的 memcmp 是微秒级）。
 */
function sameBytes(previous, next) {
  if (!previous || !next) return false;
  if (previous.length !== next.length) return false;
  try { return previous.equals(next); } catch { return false; }
}

/** 超大内容判定：超过阈值只保留摘要，不整段入库。 */
const LARGE_TEXT_THRESHOLD = 200000;

function summarizeLargeText(text) {
  const value = String(text || '');
  if (value.length <= LARGE_TEXT_THRESHOLD) return { truncated: false, text: value };
  return {
    truncated: true,
    text: `${value.slice(0, LARGE_TEXT_THRESHOLD)}\n\n[内容过长，已截断：原始 ${value.length} 字符]`
  };
}

module.exports = {
  readWithRetry,
  shouldExcludeCapture,
  summarizeLargeText,
  SENSITIVE_PROCESS_NAMES,
  SENSITIVE_TITLE_PATTERNS,
  SENSITIVE_CONTENT_PATTERNS,
  LARGE_TEXT_THRESHOLD,
  sameBytes,
  READ_RETRY_DELAYS
};
