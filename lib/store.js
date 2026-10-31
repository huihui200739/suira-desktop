'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_VERSION = 1;
const KINDS = new Set(['text', 'image', 'files', 'link', 'collection']);
/** 浮引岛暂存上限：与 lib/island-model.js 的 MAX_ITEMS 保持一致。 */
const ISLAND_MAX = 24;
/** 速记条数上限：与 lib/notes.js 的 NOTE_LIMIT 保持一致。 */
const NOTE_MAX = 200;
const SHELF_KINDS = new Set(['image', 'document', 'archive', 'folder', 'file']);
const notesLib = require('./notes');
const { cleanBindingMap } = require('./panel-bindings');
const DEFAULT_SETTINGS = {
  globalShortcutsEnabled: false,
  recordClipboard: true,
  retentionDays: 30,
  maxItems: 2000,
  // 默认浅色：主窗口本就是银白底，浮层跟着系统走会在深色系统上出现
  // 「浅色主窗口 + 深色浮卡」的割裂感。要跟随系统可在设置里切回 system。
  theme: 'light',
  // 用户是否主动选过主题：false 时启动会做一次"旧默认 system → light"的迁移
  themeChosen: false,
  ocrLangs: 'chi_sim+eng',
  pauseSensitive: true,
  pasteAfterCopy: false,
  encryptContent: true,
  // 全局唤起键统一两键组合（一个修饰键 + 一个主键）；
  // 旧版三键默认值由 main.js 的 migrateShortcutDefaults 一次性迁移。
  shortcutQuick: 'Alt+S',
  shortcutCapture: 'Alt+C',
  shortcutLongCapture: 'Alt+G',
  shortcutPanelCycle: 'Alt+E',
  shortcutPinnedToggle: 'Alt+H',
  shortcutMomentary: '',
  shortcutClipboardBar: 'Alt+V',
  // 翻译（图片取词翻译 = 翻译 B 支）：默认未配置，绝不假装能翻
  translateProvider: 'none',
  translateSource: 'auto',
  translateTarget: 'zh',
  translateBaseUrl: '',
  translateModel: '',
  translateRegion: '',
  // 密钥单独用数据密钥加密后落盘，明文只在主进程内存里存在一次
  translateApiKeyEnc: null
};

function makeId(prefix = 'item') {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function now() {
  return Date.now();
}

function textValue(value, limit = 200000) {
  return String(value ?? '').replace(/\u0000/g, '').slice(0, limit);
}

function sourceValue(source) {
  if (!source || typeof source !== 'object') {
    return { type: textValue(source || 'unknown', 40), confidence: 'unknown' };
  }
  return {
    type: textValue(source.type || 'unknown', 40),
    appId: textValue(source.appId, 120),
    appName: textValue(source.appName, 120),
    windowTitle: textValue(source.windowTitle, 240),
    acquisitionMethod: textValue(source.acquisitionMethod, 60),
    confidence: ['certain', 'inferred', 'unknown'].includes(source.confidence) ? source.confidence : 'unknown'
  };
}

function cleanItem(input) {
  if (!input || !input.id) return null;
  const kind = KINDS.has(input.kind) ? input.kind : 'text';
  return {
    id: textValue(input.id, 120),
    kind,
    title: textValue(input.title || (kind === 'image' ? '图片' : kind === 'link' ? '链接' : '文字'), 160),
    text: textValue(input.text),
    filePath: textValue(input.filePath, 4096),
    thumbnail: textValue(input.thumbnail, 1500000),
    source: sourceValue(input.source),
    createdAt: Number(input.createdAt) || now(),
    updatedAt: Number(input.updatedAt) || now(),
    parentIds: Array.isArray(input.parentIds) ? input.parentIds.map((id) => textValue(id, 120)).filter(Boolean).slice(0, 32) : [],
    meta: input.meta && typeof input.meta === 'object' ? input.meta : {},
    pinned: Boolean(input.pinned),
    // 解密失败标记需要保留，界面据此提示「此内容无法解密」
    ...(input.decryptFailed ? { decryptFailed: true } : {})
  };
}

function cleanTask(input) {
  if (!input || !input.id) return null;
  return {
    id: textValue(input.id, 120),
    title: textValue(input.title || '未命名任务', 120),
    itemIds: Array.isArray(input.itemIds) ? [...new Set(input.itemIds.map((id) => textValue(id, 120)).filter(Boolean))] : [],
    recipeId: textValue(input.recipeId, 80),
    progress: textValue(input.progress || 'idle', 40),
    retentionPolicy: textValue(input.retentionPolicy || 'keep', 40),
    createdAt: Number(input.createdAt) || now(),
    updatedAt: Number(input.updatedAt) || now(),
    archived: Boolean(input.archived)
  };
}

function cleanExecution(input) {
  if (!input || !input.id) return null;
  return {
    id: textValue(input.id, 120),
    jobId: textValue(input.jobId, 120),
    actionId: textValue(input.actionId, 80),
    inputIds: Array.isArray(input.inputIds) ? input.inputIds.map((id) => textValue(id, 120)).filter(Boolean) : [],
    outputIds: Array.isArray(input.outputIds) ? input.outputIds.map((id) => textValue(id, 120)).filter(Boolean) : [],
    status: ['queued', 'running', 'done', 'failed', 'cancelled'].includes(input.status) ? input.status : 'queued',
    error: textValue(input.error, 1000),
    startedAt: Number(input.startedAt) || now(),
    finishedAt: Number(input.finishedAt) || 0,
    meta: input.meta && typeof input.meta === 'object' ? input.meta : {}
  };
}

/**
 * 主窗口位置/尺寸的记忆。
 * 只保存数值与最大化开关；是否仍在屏幕内由主进程结合显示器判断（窗口可能被拔掉副屏）。
 */
function cleanWindowState(input) {
  if (!input || typeof input !== 'object') return null;
  const x = Number(input.x);
  const y = Number(input.y);
  const width = Number(input.width);
  const height = Number(input.height);
  const valid = (value) => Number.isFinite(value) && Math.abs(value) < 100000;
  if (!valid(x) || !valid(y) || !valid(width) || !valid(height)) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(320, Math.min(20000, Math.round(width))),
    height: Math.max(240, Math.min(20000, Math.round(height))),
    maximized: Boolean(input.maximized)
  };
}

/**
 * 浮引岛（文件中转）的落盘结构。
 * 只保存引用，不复制文件本体；路径按元数据明文保存（与内容标题的处理一致）。
 */
function cleanIsland(input) {
  const rawItems = Array.isArray(input?.items) ? input.items : [];
  const items = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue;
    const filePath = textValue(raw.path, 4096);
    if (!filePath) continue;
    const fallbackName = filePath.split(/[\\/]/).filter(Boolean).pop() || '';
    items.push({
      id: textValue(raw.id, 120) || makeId('island'),
      name: textValue(raw.name || fallbackName, 160),
      path: filePath,
      kind: SHELF_KINDS.has(raw.kind) ? raw.kind : 'file',
      addedAt: Number(raw.addedAt) || now()
    });
    if (items.length >= ISLAND_MAX) break;
  }
  return { items, policy: input?.policy === 'move' ? 'move' : 'copy' };
}

/** 速记的落盘结构。正文与标题随内容加密一起落盘（与 items 同一编解码器）。 */
function cleanNote(input) {
  return notesLib.cleanNote(input, Date.now());
}

class SuiraStore {
  constructor(dataPath, options = {}) {
    this.dataPath = dataPath;
    this.data = {
      version: DATA_VERSION,
      items: [],
      tasks: [],
      executions: [],
      notes: [],
      island: cleanIsland(null),
      panelBindings: {},
      panelShortcutVersion: 1,
      windowState: null,
      settings: { ...DEFAULT_SETTINGS }
    };
    this._saveChain = Promise.resolve();
    // 可选的落盘编解码器：内存中始终明文，仅磁盘上加密。
    // 这样搜索、排序、派生关系都不需要解密，符合「解密后的内存搜索」。
    this.codec = options.codec || null;
    this.load();
  }

  /** 是否启用加密（取决于编解码器是否就绪与设置）。 */
  isEncrypting() {
    if (!this.codec || !this.codec.isReady || !this.codec.isReady()) return false;
    return this.data.settings?.encryptContent !== false;
  }

  load() {
    try {
      const raw = fs.readFileSync(this.dataPath, 'utf8');
      const parsed = JSON.parse(raw);
      // 先解密再规范化：cleanItem 会把非字符串字段强制转成字符串，
      // 若先清理，加密信封会变成 "[object Object]"。
      const decodeItem = (this.codec && typeof this.codec.decode === 'function')
        ? (raw_) => this.codec.decode(raw_)
        : (raw_) => raw_;
      const decodeTask = (this.codec && typeof this.codec.decodeTask === 'function')
        ? (raw_) => this.codec.decodeTask(raw_)
        : (raw_) => raw_;
      // 速记正文走与内容相同的加密编解码器（字段名与 item 一致：id / title / text）
      const decodeNote = (this.codec && typeof this.codec.decode === 'function')
        ? (raw_) => this.codec.decode(raw_)
        : (raw_) => raw_;
      this.data.items = Array.isArray(parsed.items) ? parsed.items.map(decodeItem).map(cleanItem).filter(Boolean) : [];
      this.data.tasks = Array.isArray(parsed.tasks) ? parsed.tasks.map(decodeTask).map(cleanTask).filter(Boolean) : [];
      this.data.notes = Array.isArray(parsed.notes)
        ? notesLib.capNotes(parsed.notes.map(decodeNote).map(cleanNote).filter(Boolean), NOTE_MAX)
        : [];
      this.data.executions = Array.isArray(parsed.executions) ? parsed.executions.map(cleanExecution).filter(Boolean).slice(-500) : [];
      this.data.island = cleanIsland(parsed.island);
      this.data.panelBindings = cleanBindingMap(parsed.panelBindings);
      this.data.panelShortcutVersion = Number(parsed.panelShortcutVersion) || 0;
      this.data.windowState = cleanWindowState(parsed.windowState);
      this.data.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {}) };
      this.data.version = DATA_VERSION;
    } catch {
      this.data = {
        version: DATA_VERSION,
        items: [],
        tasks: [],
        executions: [],
        notes: [],
        island: cleanIsland(null),
        panelBindings: {},
        windowState: null,
        settings: { ...DEFAULT_SETTINGS }
      };
    }
    return this;
  }

  save() {
    const encrypting = this.isEncrypting();
    const payload = JSON.stringify({
      ...this.data,
      items: encrypting ? this.data.items.map((item) => this.codec.encode(item)) : this.data.items,
      tasks: encrypting && this.codec.encodeTask ? this.data.tasks.map((task) => this.codec.encodeTask(task)) : this.data.tasks,
      notes: encrypting ? this.data.notes.map((note) => this.codec.encode(note)) : this.data.notes
    }, null, 2);
    this._saveChain = this._saveChain.catch(() => {}).then(async () => {
      await fsp.mkdir(path.dirname(this.dataPath), { recursive: true });
      const temp = `${this.dataPath}.${process.pid}.tmp`;
      await fsp.writeFile(temp, payload, 'utf8');
      await fsp.rename(temp, this.dataPath);
    });
    return this._saveChain;
  }

  getSettings() {
    return { ...DEFAULT_SETTINGS, ...this.data.settings };
  }

  async updateSettings(patch) {
    const allowed = {};
    if (patch && typeof patch === 'object') {
      if (typeof patch.globalShortcutsEnabled === 'boolean') allowed.globalShortcutsEnabled = patch.globalShortcutsEnabled;
      if (typeof patch.recordClipboard === 'boolean') allowed.recordClipboard = patch.recordClipboard;
      if (typeof patch.pauseSensitive === 'boolean') allowed.pauseSensitive = patch.pauseSensitive;
      if (typeof patch.pasteAfterCopy === 'boolean') allowed.pasteAfterCopy = patch.pasteAfterCopy;
      if (typeof patch.encryptContent === 'boolean') allowed.encryptContent = patch.encryptContent;
      // 快捷键：允许空字符串，表示「已清除绑定」；空值必须能落盘，
      // 否则清除在重启后会被默认值悄悄顶回来。
      for (const key of ['shortcutQuick', 'shortcutCapture', 'shortcutLongCapture', 'shortcutPanelCycle', 'shortcutPinnedToggle', 'shortcutMomentary', 'shortcutClipboardBar']) {
        if (typeof patch[key] === 'string' && patch[key].length <= 64) {
          allowed[key] = patch[key].trim().slice(0, 64);
        }
      }
      if (['system', 'light', 'dark'].includes(patch.theme)) allowed.theme = patch.theme;
      if (typeof patch.themeChosen === 'boolean') allowed.themeChosen = patch.themeChosen;
      if (['chi_sim+eng', 'chi_sim', 'eng'].includes(patch.ocrLangs)) allowed.ocrLangs = patch.ocrLangs;
      // 翻译引擎：枚举必须白名单校验，避免把未知值写进设置里
      if (['none', 'openai', 'deepl', 'microsoft'].includes(patch.translateProvider)) {
        allowed.translateProvider = patch.translateProvider;
      }
      if (['auto', 'zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru'].includes(patch.translateSource)) {
        allowed.translateSource = patch.translateSource;
      }
      if (['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'ru'].includes(patch.translateTarget)) {
        allowed.translateTarget = patch.translateTarget;
      }
      for (const key of ['translateBaseUrl', 'translateModel', 'translateRegion']) {
        if (typeof patch[key] === 'string') allowed[key] = patch[key].trim().slice(0, 200);
      }
      // 密钥只接受加密信封（{__enc:...}）或 null（清除）；明文永远不落盘
      if (patch.translateApiKeyEnc === null) allowed.translateApiKeyEnc = null;
      else if (patch.translateApiKeyEnc && typeof patch.translateApiKeyEnc === 'object'
        && typeof patch.translateApiKeyEnc.__enc === 'number') {
        allowed.translateApiKeyEnc = patch.translateApiKeyEnc;
      }
      const days = Number(patch.retentionDays);
      if (Number.isFinite(days)) allowed.retentionDays = Math.max(1, Math.min(3650, Math.round(days)));
      const maxItems = Number(patch.maxItems);
      if (Number.isFinite(maxItems)) allowed.maxItems = Math.max(50, Math.min(20000, Math.round(maxItems)));
    }
    this.data.settings = { ...this.getSettings(), ...allowed };
    await this.save();
    return this.getSettings();
  }

  addItem(input) {
    const item = cleanItem({ ...input, id: input?.id || makeId('item'), createdAt: input?.createdAt || now(), updatedAt: now() });
    if (!item) return null;
    const index = this.data.items.findIndex((entry) => entry.id === item.id);
    if (index >= 0) this.data.items[index] = { ...this.data.items[index], ...item };
    else this.data.items.unshift(item);
    this.prune();
    return index >= 0 ? this.data.items[index] : item;
  }

  getItem(id) {
    return this.data.items.find((item) => item.id === id) || null;
  }

  listItems(options = {}) {
    const limit = Math.max(1, Math.min(500, Number(options.limit) || 80));
    const query = String(options.query || '').trim().toLowerCase();
    const kinds = Array.isArray(options.kinds) ? options.kinds : [];
    return this.data.items
      .filter((item) => !kinds.length || kinds.includes(item.kind))
      .filter((item) => !query || `${item.title} ${item.text} ${item.filePath} ${item.source.appName}`.toLowerCase().includes(query))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  updateItem(id, patch) {
    const item = this.getItem(id);
    if (!item) return null;
    Object.assign(item, cleanItem({ ...item, ...patch, id, createdAt: item.createdAt, updatedAt: now() }) || {});
    item.updatedAt = now();
    return item;
  }

  removeItem(id) {
    const index = this.data.items.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const [removed] = this.data.items.splice(index, 1);
    for (const task of this.data.tasks) task.itemIds = task.itemIds.filter((itemId) => itemId !== id);
    return removed;
  }

  /**
   * 把一条已有内容「置顶」：重新复制同一段文字/同一张图时，
   * 不新增重复条目，而是刷新时间让它回到列表最前（剪贴板历史去重语义）。
   */
  touchItem(id) {
    const item = this.getItem(id);
    if (!item) return null;
    item.createdAt = now();
    item.updatedAt = now();
    return item;
  }

  /* ---------- 主窗口状态记忆 ---------- */

  getWindowState() {
    return cleanWindowState(this.data.windowState);
  }

  /** 记住主窗口的边界与最大化状态；写盘与其它 store 操作一致，异步排队。 */
  setWindowState(state) {
    const cleaned = cleanWindowState(state);
    if (!cleaned) return null;
    this.data.windowState = cleaned;
    this.save();
    return cleaned;
  }

  prune() {
    const settings = this.getSettings();
    const cutoff = now() - settings.retentionDays * 86400000;
    const taskIds = new Set(this.data.tasks.flatMap((task) => task.itemIds));
    this.data.items = this.data.items.filter((item) => item.pinned || taskIds.has(item.id) || item.createdAt >= cutoff);
    if (this.data.items.length > settings.maxItems) {
      const pinned = this.data.items.filter((item) => item.pinned || taskIds.has(item.id));
      const rest = this.data.items.filter((item) => !item.pinned && !taskIds.has(item.id)).slice(0, Math.max(0, settings.maxItems - pinned.length));
      this.data.items = [...pinned, ...rest].sort((a, b) => b.createdAt - a.createdAt);
    }
    this.data.executions = this.data.executions.slice(-500);
  }

  createTask(title = '临时收集') {
    const task = cleanTask({ id: makeId('task'), title, itemIds: [], createdAt: now(), updatedAt: now() });
    this.data.tasks.unshift(task);
    return task;
  }

  getTask(id) {
    return this.data.tasks.find((task) => task.id === id) || null;
  }

  listTasks(options = {}) {
    const query = String(options.query || '').trim().toLowerCase();
    return this.data.tasks
      .filter((task) => options.includeArchived || !task.archived)
      .filter((task) => !query || task.title.toLowerCase().includes(query))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((task) => ({ ...task, items: task.itemIds.map((id) => this.getItem(id)).filter(Boolean) }));
  }

  updateTask(id, patch = {}) {
    const task = this.getTask(id);
    if (!task) return null;
    if (typeof patch.title === 'string' && patch.title.trim()) task.title = textValue(patch.title.trim(), 120);
    if (typeof patch.recipeId === 'string') task.recipeId = textValue(patch.recipeId, 80);
    if (typeof patch.progress === 'string') task.progress = textValue(patch.progress, 40);
    if (typeof patch.archived === 'boolean') task.archived = patch.archived;
    task.updatedAt = now();
    return task;
  }

  deleteTask(id) {
    const index = this.data.tasks.findIndex((task) => task.id === id);
    if (index < 0) return null;
    return this.data.tasks.splice(index, 1)[0];
  }

  addItemToTask(taskId, itemId) {
    const task = this.getTask(taskId);
    if (!task || !this.getItem(itemId)) return null;
    if (!task.itemIds.includes(itemId)) task.itemIds.push(itemId);
    task.updatedAt = now();
    return task;
  }

  removeItemFromTask(taskId, itemId) {
    const task = this.getTask(taskId);
    if (!task) return null;
    task.itemIds = task.itemIds.filter((id) => id !== itemId);
    task.updatedAt = now();
    return task;
  }

  recordExecution(execution) {
    const record = cleanExecution({ ...execution, id: execution?.id || makeId('exec'), startedAt: execution?.startedAt || now() });
    if (!record) return null;
    this.data.executions.push(record);
    this.data.executions = this.data.executions.slice(-500);
    return record;
  }

  listExecutions(limit = 100) {
    return this.data.executions.slice(-Math.max(1, Math.min(500, Number(limit) || 100))).reverse();
  }

  /* ---------- 浮引岛（文件中转） ---------- */

  /** 当前暂存状态（返回副本，避免调用方直接改内部数据）。 */
  getIsland() {
    const island = cleanIsland(this.data.island);
    return { items: island.items.map((item) => ({ ...item })), policy: island.policy };
  }

  /* ---------- 38 键面板的自定义键位绑定 ---------- */

  /** 当前覆盖表（返回副本）。 */
  getPanelBindings() {
    return { ...this.data.panelBindings };
  }

  /** 整表写入（覆盖表已由 panel-bindings 清洗过）；绑定变化要立刻落盘。 */
  async setPanelBindings(map) {
    return this.setPanelConfiguration(map);
  }

  /** 键位表、全局组合键与迁移版本一起保存，失败时一起回滚。 */
  async setPanelConfiguration(map, shortcutPatch = {}, version = this.data.panelShortcutVersion) {
    const previous = this.data.panelBindings, settings = this.data.settings, previousVersion = this.data.panelShortcutVersion;
    const next = cleanBindingMap(map);
    this.data.panelBindings = next;
    const allowed = Object.fromEntries(Object.entries(shortcutPatch).filter(([key, value]) => key.startsWith('shortcut') && Object.hasOwn(DEFAULT_SETTINGS, key) && typeof value === 'string'));
    const nextSettings = { ...settings, ...allowed };
    this.data.settings = nextSettings;
    this.data.panelShortcutVersion = version;
    try { await this.save(); }
    catch (error) {
      if (this.data.panelBindings === next) this.data.panelBindings = previous;
      if (this.data.settings === nextSettings) this.data.settings = settings;
      this.data.panelShortcutVersion = previousVersion;
      throw error;
    }
    return this.getPanelBindings();
  }

  /**
   * 更新暂存状态。items 缺省则保留当前列表；policy 缺省则保留当前策略。
   * @param {{items?: object[], policy?: 'copy'|'move'}} patch
   */
  async updateIsland(patch = {}) {
    const current = this.getIsland();
    const items = Array.isArray(patch.items) ? patch.items : current.items;
    let policy = current.policy;
    if (patch.policy === 'move' || patch.policy === 'copy') policy = patch.policy;
    this.data.island = cleanIsland({ items, policy });
    await this.save();
    return this.getIsland();
  }

  findItemByRecordId(recordId) {
    return this.data.items.find((item) => item.meta?.recordId === recordId) || null;
  }

  /* ---------- 速记（Quick Note） ---------- */

  /** 速记列表（按最近编辑排序，返回副本）。 */
  listNotes() {
    return this.data.notes.map((note) => ({ ...note, bounds: note.bounds ? { ...note.bounds } : null }));
  }

  getNote(id) {
    const note = this.data.notes.find((entry) => entry.id === id);
    return note ? { ...note, bounds: note.bounds ? { ...note.bounds } : null } : null;
  }

  /** 最近编辑过的一条速记：面板 N 键直接接着上次的写，不每次都新建。 */
  latestNote() {
    return this.listNotes().sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
  }

  createNote(input = {}) {
    const stamp = now();
    const note = cleanNote({
      id: input.id || makeId('note'),
      text: input.text || '',
      createdAt: input.createdAt || stamp,
      updatedAt: input.updatedAt || stamp,
      pinned: Boolean(input.pinned),
      bounds: input.bounds
    });
    if (!note) return null;
    note.title = note.text.trim() ? notesLib.noteTitle(note.text) : notesLib.TITLE_FALLBACK;
    this.data.notes.unshift(note);
    this.data.notes = notesLib.capNotes(this.data.notes, NOTE_MAX);
    return this.getNote(note.id);
  }

  /** 改正文。标题由正文推导；位置与钉住状态不在 patch 里改（各有专门方法）。 */
  updateNoteText(id, text) {
    const index = this.data.notes.findIndex((entry) => entry.id === id);
    if (index < 0) return null;
    const next = notesLib.applyNoteText(this.data.notes[index], text, now());
    if (!next) return null;
    this.data.notes[index] = { ...next, pinned: this.data.notes[index].pinned, bounds: this.data.notes[index].bounds };
    return this.getNote(id);
  }

  /** 记住窗口位置；非法值直接忽略，不覆盖已有记忆。 */
  setNoteBounds(id, bounds) {
    const index = this.data.notes.findIndex((entry) => entry.id === id);
    if (index < 0) return null;
    const cleaned = notesLib.cleanBounds(bounds);
    if (!cleaned) return null;
    this.data.notes[index] = { ...this.data.notes[index], bounds: cleaned };
    return this.getNote(id);
  }

  /** 桌面钉住：置顶是窗口属性，这里只记状态，主进程据此设置 alwaysOnTop。 */
  toggleNotePin(id) {
    const index = this.data.notes.findIndex((entry) => entry.id === id);
    if (index < 0) return null;
    this.data.notes[index] = { ...this.data.notes[index], pinned: !this.data.notes[index].pinned, updatedAt: now() };
    return this.getNote(id);
  }

  deleteNote(id) {
    const index = this.data.notes.findIndex((entry) => entry.id === id);
    if (index < 0) return null;
    return this.data.notes.splice(index, 1)[0];
  }
}

module.exports = { SuiraStore, makeId, DEFAULT_SETTINGS };
