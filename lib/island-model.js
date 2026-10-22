'use strict';

/**
 * 文件中转（浮引岛）纯模型。
 *
 * 这里只做「路径 → 暂存条目」的判定、规范化、去重、容量裁剪与统计，
 * 全部是纯函数：不 require('electron')、不碰 DOM、不读写文件系统，
 * 也不修改任何入参。主进程的 store 与 IPC 层都直接引用本文件的导出，
 * 渲染层只消费 getState/addPaths 等接口返回的同一份结构：
 *
 *   { id, name, path, kind, addedAt }
 *
 * 证据边界见 docs/BATCH3-GAP-ANALYSIS.md 第 1 节：原产品的
 * shelf-state.json 字段结构未还原，这里的结构是 Windows 侧自定义的，
 * 不声称与原产品一致。
 */

const path = require('path');

/** 浮引岛暂存上限。收起/展开的界面都按这个数值展示「当前 / 上限」。 */
const MAX_ITEMS = 24;

/** 路径长度上限，与 Windows 常见工具链的保守值一致。 */
const MAX_PATH_LENGTH = 4096;

/** 展示名长度上限。 */
const MAX_NAME_LENGTH = 160;

/** id 长度上限（正常的 `island-<base36>-<hex4>` 只有 20 多位）。 */
const MAX_ID_LENGTH = 120;

/** 合法的条目类型。 */
const SHELF_KINDS = new Set(['image', 'document', 'archive', 'folder', 'file']);

const IMAGE_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.jpe', '.jfif', '.gif', '.webp', '.bmp',
  '.svg', '.ico', '.tif', '.tiff', '.avif', '.heic', '.heif'
];

const DOCUMENT_EXTENSIONS = [
  '.pdf', '.doc', '.docx', '.docm', '.rtf', '.odt', '.ott', '.pages',
  '.xls', '.xlsx', '.xlsm', '.csv', '.tsv', '.ods', '.ots', '.numbers',
  '.ppt', '.pptx', '.pptm', '.odp', '.otp', '.key',
  '.txt', '.md', '.markdown', '.mdx', '.epub', '.mobi', '.azw3',
  '.json', '.xml', '.yml', '.yaml', '.toml', '.ini', '.log',
  '.html', '.htm', '.mht', '.url'
];

const ARCHIVE_EXTENSIONS = [
  '.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.bz2', '.tbz2', '.xz',
  '.zst', '.lz', '.lzma', '.cab', '.iso', '.arj', '.jar', '.war', '.apk'
];

const KIND_BY_EXTENSION = new Map();
for (const extension of IMAGE_EXTENSIONS) KIND_BY_EXTENSION.set(extension, 'image');
for (const extension of DOCUMENT_EXTENSIONS) KIND_BY_EXTENSION.set(extension, 'document');
for (const extension of ARCHIVE_EXTENSIONS) KIND_BY_EXTENSION.set(extension, 'archive');

/* ------------------------------------------------------------------ *
 * 基础清洗
 * ------------------------------------------------------------------ */

/** 去掉控制字符（含 \0）、首尾空白；可选按「码点」截断，避免切坏 emoji。 */
function cleanText(value, limit) {
  if (typeof value !== 'string') return '';
  const stripped = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  if (!stripped) return '';
  if (!limit) return stripped;
  const chars = Array.from(stripped);
  return chars.length > limit ? chars.slice(0, limit).join('') : stripped;
}

/** 路径是否是绝对路径：盘符绝对路径、UNC 共享路径、POSIX 绝对路径。 */
function isAbsolutePath(target) {
  return /^[a-zA-Z]:[\\/]/.test(target) || target.startsWith('\\\\') || target.startsWith('/');
}

/** 路径结构校验：非空字符串、绝对路径、无 \0、长度 ≤ MAX_PATH_LENGTH。 */
function normalizeShelfPath(value) {
  if (typeof value !== 'string') return '';
  const target = value.trim();
  if (!target || target.length > MAX_PATH_LENGTH) return '';
  if (target.includes('\u0000')) return '';
  return isAbsolutePath(target) ? target : '';
}

/** 取文件名。去掉尾部斜杠后按 Windows 规则取 basename。 */
function baseNameOf(target) {
  const trimmed = String(target).replace(/[\\/]+$/, '');
  if (!trimmed) return String(target).trim();
  return path.win32.basename(trimmed) || trimmed;
}

/** 生成 `island-<base36 时间>-<4 hex>` 形式的 id。 */
function makeIslandId(now) {
  const stamp = Math.floor(Number.isFinite(now) && now > 0 ? now : Date.now()).toString(36);
  const suffix = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `island-${stamp}-${suffix}`;
}

function resolvedNow(value) {
  const time = Number(value);
  return Number.isFinite(time) && time > 0 ? Math.floor(time) : Date.now();
}

/* ------------------------------------------------------------------ *
 * 对外导出
 * ------------------------------------------------------------------ */

/**
 * 按扩展名判断类型；尾部带分隔符的路径视为文件夹。
 * 纯函数，无法访问文件系统——真实文件夹请由调用方把 `kind` 传进来，
 * 或在路径末尾保留分隔符。
 */
function classifyPath(filePath) {
  if (typeof filePath !== 'string') return 'file';
  const target = filePath.trim();
  if (!target) return 'file';
  if (/[\\/]$/.test(target)) return 'folder';
  const extension = path.win32.extname(target).toLowerCase();
  return KIND_BY_EXTENSION.get(extension) || 'file';
}

/** 路径是否可以作为暂存条目（只做结构判定，不检查文件是否存在）。 */
function isShelfablePath(target) {
  return normalizeShelfPath(target) !== '';
}

/**
 * 把外部输入规范成暂存条目；结构不合法（缺 path / 相对路径 / 含 \0 / 超长）返回 null。
 *
 * @param {object} input  至少要有 path；可带 name / kind / id / addedAt
 * @param {number} now    缺省时间戳，同时用于生成缺省 addedAt 与 id
 */
function normalizeShelfItem(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;

  const filePath = normalizeShelfPath(input.path);
  if (!filePath) return null;

  const timestamp = resolvedNow(now);
  const kind = SHELF_KINDS.has(input.kind) ? input.kind : classifyPath(filePath);
  // 显式传入的 name 优先；否则取 basename。两者都空时给一个可读占位。
  const name = cleanText(input.name, MAX_NAME_LENGTH)
    || cleanText(baseNameOf(filePath), MAX_NAME_LENGTH)
    || '未命名文件';

  const rawId = cleanText(input.id, MAX_ID_LENGTH).replace(/\s+/g, '');
  const id = rawId || makeIslandId(timestamp);

  // 显式 addedAt 优先；缺省时用调用方给的时间基准，保证同一批次时间一致。
  const addedAt = Number.isFinite(Number(input.addedAt)) && Number(input.addedAt) > 0
    ? Math.floor(Number(input.addedAt))
    : timestamp;

  return { id, name, path: filePath, kind, addedAt };
}

function resolveCapacity(options) {
  const source = options && typeof options === 'object' ? options : {};
  const raw = source.cap !== undefined ? source.cap
    : source.maxItems !== undefined ? source.maxItems
      : source.limit;
  const cap = Number(raw);
  return Number.isFinite(cap) && cap >= 1 ? Math.floor(cap) : MAX_ITEMS;
}

/**
 * 合并新条目：新条目放最前，按路径大小写不敏感去重（保留先出现的原条目），
 * 超过 cap 从尾部丢弃最旧的条目。
 *
 * @returns {{items: object[], added: number, dropped: number}}
 *   added   = 最终列表里来自本次 incoming 的条目数
 *   dropped = 因超出 cap 被丢弃的条目数（含被挤出的旧条目）
 */
function addShelfItems(existing, incoming, options = {}) {
  const settings = options && typeof options === 'object' ? options : {};
  const timestamp = resolvedNow(settings.now);
  const cap = resolveCapacity(settings);

  const existingList = Array.isArray(existing) ? existing : [];
  const incomingList = Array.isArray(incoming)
    ? incoming
    : (incoming && typeof incoming === 'object' ? [incoming] : []);

  const seen = new Set();
  const kept = [];
  for (const raw of existingList) {
    const item = normalizeShelfItem(raw, timestamp);
    if (!item) continue;
    const key = item.path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(item);
  }

  const fresh = [];
  for (const raw of incomingList) {
    const item = normalizeShelfItem(raw, timestamp);
    if (!item) continue;
    const key = item.path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(item);
  }

  const merged = fresh.concat(kept);
  const items = merged.slice(0, cap);
  return {
    items,
    added: Math.min(fresh.length, items.length),
    dropped: merged.length - items.length
  };
}

/** 按 id 删除一个条目，返回新数组（不改动入参）。 */
function removeShelfItem(items, id) {
  const list = Array.isArray(items) ? items : [];
  const target = typeof id === 'string' ? id.trim() : '';
  if (!target) return list.slice();
  return list.filter((item) => !item || item.id !== target);
}

/** 清空暂存。 */
function clearShelf() {
  return [];
}

/** 统计当前暂存：总数与各类型数量。 */
function summarizeShelf(items) {
  const summary = { count: 0, images: 0, documents: 0, archives: 0, folders: 0 };
  if (!Array.isArray(items)) return summary;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    summary.count += 1;
    const kind = SHELF_KINDS.has(item.kind) ? item.kind : classifyPath(item.path);
    if (kind === 'image') summary.images += 1;
    else if (kind === 'document') summary.documents += 1;
    else if (kind === 'archive') summary.archives += 1;
    else if (kind === 'folder') summary.folders += 1;
  }
  return summary;
}

module.exports = {
  MAX_ITEMS,
  classifyPath,
  normalizeShelfItem,
  addShelfItems,
  removeShelfItem,
  clearShelf,
  isShelfablePath,
  summarizeShelf
};
