'use strict';

/**
 * 剪贴板采集的纯函数层。
 *
 * 对应剪贴板框架的三个缺口：
 * 1. Electron 45 把「资源管理器复制的文件」暴露为 text/uri-list，需要把 URI 列表还原成 Windows 路径；
 * 2. 去重不能只比对最后一条，需要按内容在最近窗口内查找并置顶；
 * 3. 来源应用信息由主进程采集后随条目一起写入（本模块只负责透传 source）。
 *
 * 约束（与 lib/clipboard-guard.js 一致，便于单测）：
 * - 不 require electron、不读写文件系统；
 * - 不修改任何入参（数组/对象都只读，输出新对象）；
 * - 比较用的归一化不改变入库原文。
 */

const MAX_TITLE_NAMES = 3;
const MAX_NAME_CHARS = 60;
const ELLIPSIS = '\u2026';
const TITLE_TEXT_CHARS = 42;
const DEFAULT_DUPLICATE_LIMIT = 200;
const COMPARABLE_KINDS = new Set(['text', 'link', 'files', 'image']);
const ZERO_WIDTH_RE = /[\u200b-\u200d\ufeff]/g;
const WHITESPACE_EXCEPT_NEWLINE_RE = /[^\S\n]+/g;
const LINE_BREAK_RE = /\r\n|\r|\n/;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

/** 百分号解码；非法编码返回 null，调用方据此跳过整行。 */
function decodeUriPart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** file:///C:/x 解析后会多出一条前导斜杠，这里只在「斜杠 + 盘符」时去掉它。 */
function stripExtraLeadingSlash(value) {
  return /^\/[A-Za-z]:[\\/]/.test(value) ? value.slice(1) : value;
}

/** 只接受绝对路径形态：盘符、UNC（// 或 \\）或 POSIX 根路径。 */
function isAbsolutePathLike(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('//') || value.startsWith('/');
}

/**
 * 把单条 file: URI 转成 Windows 风格路径；不接受时返回 ''。
 * 支持 file:///C:/x、file://C:/x、file:/C:/x、file://server/share/x（UNC）、
 * file://localhost/C:/x，以及百分号编码（空格、中文等）。
 */
function fileUriToWindowsPath(rawValue) {
  if (typeof rawValue !== 'string' || !/^file:/i.test(rawValue)) return '';
  const rest = rawValue.slice(5);
  let pathPart;

  if (rest.startsWith('//')) {
    const afterScheme = rest.slice(2);
    const slashIndex = afterScheme.indexOf('/');
    // file:// 后面没有路径（例如只有主机名或完全为空）无法还原成文件路径
    if (slashIndex < 0) return '';
    const rawAuthority = afterScheme.slice(0, slashIndex);
    const decodedAuthority = decodeUriPart(rawAuthority);
    if (decodedAuthority === null) return '';
    const decodedPath = decodeUriPart(afterScheme.slice(slashIndex));
    if (decodedPath === null) return '';

    if (!decodedAuthority) {
      // file:///C:/Users/a/b.txt
      pathPart = stripExtraLeadingSlash(decodedPath);
    } else if (/^[A-Za-z]:$/.test(decodedAuthority)) {
      // file://C:/Users/a/b.txt（缺少第三条斜杠）
      pathPart = `${decodedAuthority}${decodedPath}`;
    } else if (decodedAuthority.toLowerCase() === 'localhost') {
      // file://localhost/C:/Users/a/b.txt
      pathPart = stripExtraLeadingSlash(decodedPath);
    } else {
      // file://server/share/x.txt（UNC）
      pathPart = `//${decodedAuthority}${decodedPath}`;
    }
  } else {
    // file:/C:/x 或 file:C:/x
    const decoded = decodeUriPart(rest);
    if (decoded === null) return '';
    pathPart = stripExtraLeadingSlash(decoded);
  }

  if (!isAbsolutePathLike(pathPart)) return '';
  return pathPart.replace(/\//g, '\\');
}

/**
 * 解析 text/uri-list 原文。
 *
 * @param {string} uriList 多行 URI 列表（可能是 CRLF）
 * @returns {string[]} Windows 风格绝对路径，按原始顺序、大小写不敏感去重
 */
function parseClipboardFileUris(uriList) {
  if (typeof uriList !== 'string' || !uriList) return [];
  const paths = [];
  const seen = new Set();
  for (const rawLine of uriList.split(LINE_BREAK_RE)) {
    const line = rawLine.trim();
    if (!line) continue;
    // RFC 2483：以 # 开头的是注释行
    if (line.startsWith('#')) continue;
    const filePath = fileUriToWindowsPath(line);
    if (!filePath) continue;
    const key = filePath.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(filePath);
  }
  return paths;
}

function basenameOf(filePath) {
  const parts = String(filePath).split(/[\\/]/);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index]) return parts[index];
  }
  return '';
}

function shortenName(name) {
  return name.length > MAX_NAME_CHARS ? `${name.slice(0, MAX_NAME_CHARS)}${ELLIPSIS}` : name;
}

/**
 * 由文件路径列表生成条目字段。
 *
 * @param {string[]} paths 绝对路径列表
 * @returns {{title:string, text:string, filePath:string}}
 *   title：最多前 3 个文件名，用「、」连接，超出追加「 等 N 个」（N 为总数）；
 *   text：每行一个绝对路径（供「复制」动作直接取路径文本）；
 *   filePath：第一个路径。
 */
function filesItemFields(paths) {
  const empty = { title: '', text: '', filePath: '' };
  if (!Array.isArray(paths)) return empty;
  const cleaned = [];
  for (const entry of paths) {
    if (typeof entry !== 'string') continue;
    const value = entry.trim();
    if (value) cleaned.push(value);
  }
  if (!cleaned.length) return empty;

  const names = cleaned.map((filePath) => shortenName(basenameOf(filePath))).filter(Boolean);
  let title = names.slice(0, MAX_TITLE_NAMES).join('\u3001');
  if (names.length > MAX_TITLE_NAMES) title += ` 等 ${names.length} 个`;

  return { title, text: cleaned.join('\n'), filePath: cleaned[0] };
}

/**
 * 比较用的归一化（不改变入库原文）：
 * - CRLF / CR -> \n；
 * - 去掉零宽字符；
 * - 去首尾空白；
 * - 连续空白（换行以外的空格、Tab 等）压缩为单个空格；换行保留为分隔。
 * 非字符串输入返回空串（不匹配任何内容）。
 */
function normalizeForCompare(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/\r\n?/g, '\n')
    .replace(ZERO_WIDTH_RE, '')
    .trim()
    .replace(WHITESPACE_EXCEPT_NEWLINE_RE, ' ');
}

function createdAtOf(item) {
  const value = Number(item?.createdAt);
  return Number.isFinite(value) ? value : 0;
}

/** files 候选允许用 paths / filePath 兜底生成比较文本。 */
function candidateCompareText(candidate) {
  const direct = typeof candidate.text === 'string' ? candidate.text : '';
  if (direct.trim()) return direct;
  if (candidate.kind !== 'files') return direct;
  if (Array.isArray(candidate.paths)) {
    const lines = candidate.paths.filter((entry) => typeof entry === 'string' && entry.trim());
    if (lines.length) return lines.join('\n');
  }
  if (typeof candidate.filePath === 'string' && candidate.filePath.trim()) return candidate.filePath;
  return direct;
}

function candidateHashOf(candidate) {
  return firstNonEmptyString(candidate.hash, isObject(candidate.meta) ? candidate.meta.hash : '');
}

/**
 * 在最近条目里查找与候选内容相同的条目。
 *
 * @param {object[]} items store 的条目数组（顺序不限，内部按 createdAt 新->旧排序）
 * @param {{kind:string, text?:string, filePath?:string, hash?:string, paths?:string[]}} candidate
 * @param {{limit?:number, windowMs?:number}} [options]
 *   limit：只看最近这么多个条目（默认 200，<=0 表示不查）；
 *   windowMs：只比较距现在这么久的条目（默认 0 = 不限时间）。
 * @returns {object|null} 命中的最近一条（createdAt 最大），没有则 null
 */
function findRecentDuplicate(items, candidate, options = {}) {
  const opts = isObject(options) ? options : {};
  if (!isObject(candidate)) return null;
  const kind = candidate.kind;
  if (!COMPARABLE_KINDS.has(kind)) return null;
  if (!Array.isArray(items) || items.length === 0) return null;

  const limitRaw = Number(opts.limit);
  const limit = Number.isFinite(limitRaw) ? Math.max(0, Math.floor(limitRaw)) : DEFAULT_DUPLICATE_LIMIT;
  if (limit === 0) return null;

  let compareText = '';
  let compareHash = '';
  let rawText = '';
  if (kind === 'image') {
    compareHash = candidateHashOf(candidate);
    // 没有 hash 的图片无法可靠判重
    if (!compareHash) return null;
  } else {
    rawText = candidateCompareText(candidate);
    compareText = normalizeForCompare(rawText);
    if (!compareText) return null;
  }

  const windowRaw = Number(opts.windowMs);
  const windowMs = Number.isFinite(windowRaw) && windowRaw > 0 ? windowRaw : 0;
  const reference = Date.now();

  // items 本就按 createdAt 降序维护（addItem unshift、prune 排序）。
  // 只有外部把顺序打乱时才回退全量 sort，避免每次复制都对整库做 O(n log n) 排序。
  const comparable = items.filter((item) => isObject(item));
  let ordered = true;
  for (let index = 1; index < comparable.length; index += 1) {
    if (createdAtOf(comparable[index - 1]) < createdAtOf(comparable[index])) { ordered = false; break; }
  }
  const recent = ordered
    ? comparable.slice(0, limit)
    : comparable.slice().sort((a, b) => createdAtOf(b) - createdAtOf(a)).slice(0, limit);

  for (const item of recent) {
    if (item.kind !== kind) continue;
    if (windowMs > 0 && reference - createdAtOf(item) > windowMs) continue;

    if (kind === 'image') {
      const itemHash = isObject(item.meta) ? firstNonEmptyString(item.meta.hash) : '';
      if (itemHash && itemHash === compareHash) return item;
    } else if (item.text === rawText || normalizeForCompare(item.text) === compareText) {
      // 复制同一段文字是最常见的场景：原文相同即可命中，
      // 不用每次都对最近 300 条大文本跑四遍正则归一化。
      return item;
    }
  }
  return null;
}

function resolveCandidatePaths(candidate) {
  if (Array.isArray(candidate.paths) && candidate.paths.length) return candidate.paths;
  if (typeof candidate.filePath === 'string' && candidate.filePath.trim()) return [candidate.filePath];
  if (typeof candidate.text === 'string' && candidate.text.trim()) {
    return candidate.text.split(LINE_BREAK_RE);
  }
  return [];
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * 由候选内容生成可直接交给 store.addItem 的对象（不生成 id / createdAt）。
 *
 * @param {{kind:string, text?:string, filePath?:string, hash?:string, paths?:string[],
 *          width?:number, height?:number, title?:string, meta?:object}} candidate
 * @param {object} [source] 来源应用信息（type/appName/appId/windowTitle 等），原样透传
 * @param {{title?:string, meta?:object}} [options] 可选的标题覆盖与 meta 补充
 * @returns {{kind:string,title:string,text:string,filePath:string,source:object,meta:object}|null}
 */
function buildCaptureItem(candidate, source = {}, options = {}) {
  if (!isObject(candidate) || !candidate.kind) return null;
  const opts = isObject(options) ? options : {};
  const kind = candidate.kind;
  const sourceValue = isObject(source) ? { ...source } : {};
  const candidateMeta = isObject(candidate.meta) ? { ...candidate.meta } : {};
  const meta = { ...candidateMeta, ...(isObject(opts.meta) ? { ...opts.meta } : {}) };

  let title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
  let text = '';
  let filePath = typeof candidate.filePath === 'string' ? candidate.filePath : '';

  if (kind === 'image') {
    text = typeof candidate.text === 'string' ? candidate.text : '';
    const hash = firstNonEmptyString(candidate.hash, candidateMeta.hash);
    if (hash) meta.hash = hash;
    const width = numberOrNull(candidate.width ?? candidateMeta.width);
    const height = numberOrNull(candidate.height ?? candidateMeta.height);
    if (width !== null) meta.width = width;
    if (height !== null) meta.height = height;
    if (!title) title = '剪贴板图片';
  } else if (kind === 'files') {
    const fields = filesItemFields(resolveCandidatePaths(candidate));
    text = fields.text;
    if (fields.filePath) filePath = fields.filePath;
    if (!title) title = fields.title;
  } else {
    text = typeof candidate.text === 'string'
      ? candidate.text
      : (candidate.text == null ? '' : String(candidate.text));
    if (!title) title = text.trim().slice(0, TITLE_TEXT_CHARS);
  }

  if (typeof opts.title === 'string' && opts.title.trim()) title = opts.title.trim();

  return { kind, title, text, filePath, source: sourceValue, meta };
}

module.exports = {
  parseClipboardFileUris,
  filesItemFields,
  normalizeForCompare,
  findRecentDuplicate,
  buildCaptureItem
};
