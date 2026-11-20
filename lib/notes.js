'use strict';

/**
 * 速记（Quick Note）的纯模型。
 *
 * 对应《第三批差距表》第 4 项「速记」：原产品是 `FuYinNotesPanelController` +
 * `FuYinQuickNoteDesktopPinController`，能力可以确定的有三条——
 *   1. 多页笔记（`_pinnedPageIDs` / `pageID` / `controllers`）
 *   2. 桌面钉住（`FuYinQuickNotePinnedPageWindowController`）
 *   3. 位置记忆（`framePersistenceTask` / `pendingFrames`）
 * 正文编辑与富文本/Markdown 未还原，因此这里只做**纯文本**，不做富文本，
 * 也不假装支持 Markdown。
 *
 * 为什么单独成模块：窗口与主进程逻辑没法在测试里跑，
 * 而「标题怎么来、超出上限丢哪条、非法输入怎么收敛」这些语义是可测的。
 * 全部纯函数，不碰 fs、不碰 Electron。
 */

/** 速记条数上限。超出时丢最旧的未钉住条目（与剪贴板/浮引岛的容量策略一致）。 */
const NOTE_LIMIT = 200;
/** 单条正文上限。速记不是文档编辑器，超长会被截断而不是无限增长。 */
const TEXT_LIMIT = 20000;
const TITLE_LIMIT = 120;
const TITLE_FALLBACK = '未命名速记';
/** 窗口位置的合法范围：与 store 的窗口状态记忆同一量级约束。 */
const BOUNDS_MIN = { width: 200, height: 150 };
const BOUNDS_MAX = { width: 4000, height: 4000 };

function normalizeText(value, limit = TEXT_LIMIT) {
  return String(value ?? '').replace(/\u0000/g, '').slice(0, limit);
}

/**
 * 速记标题：取正文第一行非空内容。
 * 没有手动命名时，标题随正文第一行生成。
 */
function noteTitle(text, fallback = TITLE_FALLBACK) {
  const lines = normalizeText(text).split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim().replace(/\s+/g, ' ');
    if (trimmed) return trimmed.slice(0, TITLE_LIMIT);
  }
  return fallback;
}

/** 位置尺寸记忆：只接受有限数值，越界返回 null（调用方回落默认位置）。 */
function cleanBounds(input) {
  if (!input || typeof input !== 'object') return null;
  const pick = (value) => {
    const num = Number(value);
    return Number.isFinite(num) && Math.abs(num) < 100000 ? Math.round(num) : null;
  };
  const x = pick(input.x);
  const y = pick(input.y);
  const width = pick(input.width);
  const height = pick(input.height);
  if (x === null || y === null || width === null || height === null) return null;
  if (width < BOUNDS_MIN.width || height < BOUNDS_MIN.height) return null;
  return {
    x,
    y,
    width: Math.min(BOUNDS_MAX.width, width),
    height: Math.min(BOUNDS_MAX.height, height)
  };
}

function cleanNote(input, fallbackTime) {
  if (!input || typeof input !== 'object' || !input.id) return null;
  const stamp = Number.isFinite(Number(fallbackTime)) ? Number(fallbackTime) : Date.now();
  const createdAt = Number(input.createdAt) || stamp;
  return {
    id: String(input.id).slice(0, 120),
    title: String(input.title || '').replace(/\u0000/g, '').slice(0, TITLE_LIMIT),
    ...(input.customTitle ? {customTitle: normalizeText(input.customTitle, TITLE_LIMIT).trim()} : {}),
    text: normalizeText(input.text),
    createdAt,
    updatedAt: Number(input.updatedAt) || createdAt,
    // 钉在桌面上：对应原产品 desktop pin，表现为窗口置顶 + 位置被记住
    pinned: Boolean(input.pinned),
    bounds: cleanBounds(input.bounds)
  };
}

/** 按最近编辑排序，列表与「打开最近一条」共用同一顺序。 */
function sortNotes(notes) {
  return [...(Array.isArray(notes) ? notes : [])].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * 容量收敛：钉住的永远保留，其余按时间丢最旧。
 * 速记不像剪贴板那样会被保留策略自动清理，所以丢条目只能发生在超出硬上限时。
 */
function capNotes(notes, limit = NOTE_LIMIT) {
  const list = sortNotes(notes);
  if (list.length <= limit) return list;
  const pinned = list.filter((note) => note.pinned);
  const rest = list.filter((note) => !note.pinned).slice(0, Math.max(0, limit - pinned.length));
  return sortNotes([...pinned, ...rest]);
}

function summarizeNotes(notes) {
  const list = Array.isArray(notes) ? notes : [];
  return {
    count: list.length,
    pinned: list.filter((note) => note.pinned).length,
    chars: list.reduce((sum, note) => sum + (note.text ? note.text.length : 0), 0),
    limit: NOTE_LIMIT
  };
}

/**
 * 手动命名优先。清除手动标题后恢复自动命名；只改正文时保留原来的标题设置。
 */
function applyNoteText(note, text, now = Date.now(), title) {
  if (!note) return null;
  const body = normalizeText(text);
  const customTitle = typeof title === 'string' ? normalizeText(title, TITLE_LIMIT).trim() : note.customTitle;
  const next = {
    ...note,
    text: body,
    title: customTitle || (body.trim() || typeof title === 'string' ? noteTitle(body) : note.title),
    updatedAt: now
  };
  if (customTitle) next.customTitle = customTitle;
  else delete next.customTitle;
  return next;
}

function appendNoteText(note,text){
  const next=[note?.text||'',String(text||'')].filter(value=>value.trim()).join('\n\n');
  if(next.length>TEXT_LIMIT)throw Error('追加后超过速记 2 万字上限，请换一条速记');
  return next;
}

module.exports = {
  NOTE_LIMIT,
  TEXT_LIMIT,
  TITLE_LIMIT,
  TITLE_FALLBACK,
  BOUNDS_MIN,
  BOUNDS_MAX,
  normalizeText,
  noteTitle,
  cleanBounds,
  cleanNote,
  sortNotes,
  capNotes,
  summarizeNotes,
  applyNoteText,
  appendNoteText
};
