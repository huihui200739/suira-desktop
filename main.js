'use strict';

const electron = require('electron');

/*
 * 环境自检：ELECTRON_RUN_AS_NODE 会让 Electron 以纯 Node 模式启动。
 * 此时 require('electron') 返回的只是一个路径字符串，解构出来的 app 是 undefined，
 * 后面会在 app.setName() 处抛出难以理解的
 *   TypeError: Cannot read properties of undefined (reading 'setName')
 * 直接给出一句能看懂的说明，并告诉用户怎么修。
 */
if (!electron || typeof electron !== 'object' || !electron.app) {
  const reason = process.env.ELECTRON_RUN_AS_NODE
    ? '检测到环境变量 ELECTRON_RUN_AS_NODE 已设置，Electron 会以纯 Node 模式运行，无法创建窗口。'
    : '未能加载 Electron 运行时。';
  console.error([
    '',
    '随序启动失败：' + reason,
    '',
    '修复方式（在当前终端执行后重试）：',
    '  PowerShell:  Remove-Item Env:\\ELECTRON_RUN_AS_NODE',
    '  CMD:         set ELECTRON_RUN_AS_NODE=',
    '',
    '然后重新运行：npm start',
    ''
  ].join('\n'));
  process.exit(1);
}

const {
  app, BrowserWindow, ipcMain, screen, desktopCapturer, clipboard,
  nativeImage, ClipboardItem, globalShortcut, Tray, Menu, shell, dialog
} = electron;
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { SuiraStore, makeId } = require('./lib/store');
const { OcrService } = require('./lib/ocr');
const { createActionRegistry, mergeLines, cleanText } = require('./lib/actions');
const { RECIPES, getRecipe, listRecipes, runRecipe } = require('./lib/recipes');
const { searchCandidates, COMMANDS } = require('./lib/search');
const { readWithRetry, shouldExcludeCapture, summarizeLargeText } = require('./lib/clipboard-guard');
const { captureTarget, validateTarget, decideCommit, normalizeHwnd, ClipboardWriteLedger } = require('./lib/return-target');
const { AppIndex } = require('./lib/app-index');
const { ForegroundProbe } = require('./lib/foreground-probe');
const { DEFAULT_BINDINGS, DEFAULT_MOMENTARY_BINDINGS, ShortcutManager, normalizeAccelerator, validateMomentaryAccelerator, momentaryConflict } = require('./lib/shortcuts');
const { KeyVault, encryptItem, decryptItem, encryptText, decryptText } = require('./lib/crypto-store');
const { unionBounds, maxScaleFactor, tileLayout, sanitizeWindowBounds } = require('./lib/display-geometry');
const { InputInjector } = require('./lib/input-injector');
const { keyLayout, TOOLBOX_TOOLS, PANEL_ACTIONS } = require('./lib/keybindings');
const { createPanelActions } = require('./lib/panel-actions');
// 第三批：按住型唤起用常驻 PowerShell 助手拿「松开」事件；浮引岛纯模型负责暂存语义
const { KeyWatchProbe } = require('./lib/key-watch');
const islandModel = require('./lib/island-model');
// 核心框架：剪贴板捕获（文件引用/去重比较）的纯模型，便于单元测试
const clipboardCapture = require('./lib/clipboard-capture');
const { execFileSync } = require('node:child_process');

const APP_NAME = '随序 SUIRA';
const APP_ID = 'com.suira.desktop';
const MAIN_WIDTH = 1180;
const MAIN_HEIGHT = 820;
// 38 键面板需要装下 12/10/9/7 四行键位 + 搜索条 + 底部提示
const QUICK_WIDTH = 720;
const QUICK_HEIGHT = 620;
// 浮引岛：收起是一根细条，悬停展开成卡片。尺寸固定，动画交给渲染层。
const ISLAND_COLLAPSED = { width: 176, height: 44 };
const ISLAND_EXPANDED = { width: 520, height: 148 };
const ISLAND_MARGIN_TOP = 12;
const ISLAND_MAX_ITEMS = 24;
// 面板布局轮换的顺序（对应原产品 onPanelCycleLayout）
const PANEL_MODES = ['actions', 'apps', 'toolbox'];
const TEXT_HISTORY_LIMIT = 2000;
// 应用图标缓存：开始菜单路径 → data URL。图标是静态资源，随进程生命周期复用。
const appIconCache = new Map();

let store = null;
let ocr = null;
let actions = null;
let mainWindow = null;
let quickWindow = null;
let overlayWindow = null;
let tray = null;
let capturePayload = null;
let clipboardTimer = null;
let clipboardWatcherError = '';
let clipboardWatcherReady = Promise.resolve();
let lastClipboardText = '';
let lastClipboardImageHash = '';
let lastClipboardFilesKey = '';
let clipboardWriteGuard = '';
let isQuitting = false;
let quickReady = false;
let captureBusy = false;
let captureGeneration = 0;
let mainWasVisible = false;
const pinWindows = new Set();
// 浮引岛（文件中转）与按住型唤起的状态
let islandWindow = null;
let islandExpanded = false;
let momentaryProbe = null;
let momentaryOpened = false;
/** 最近一次按住型侦测启动失败的原因；成功时清空，设置页据此显示真实原因。 */
let momentaryError = '';
/** 按住型侦测的启动 Promise：自检要等它落定，否则会把「正在启动」误报成「未运行」。 */
let momentaryReady = Promise.resolve({ ok: true });
let panelModeIndex = 0;

// 放回子系统：唤起前的目标窗口，以及剪贴板自写回环账本
let returnTarget = null;
const clipboardLedger = new ClipboardWriteLedger();
const appIndex = new AppIndex();
const foregroundProbe = new ForegroundProbe({ onWarn: (...args) => console.warn(...args) });
const inputInjector = new InputInjector();
let shortcutManager = null;
let keyVault = null;

/** 置前目标窗口后等待焦点稳定的时间（毫秒）。太短按键会落到随序自己身上。 */
const RETURN_FOCUS_DELAY = 120;

/** 从设置读取当前键位，回落到出厂默认。清除绑定（空串）的项不注册。 */
function shortcutBindings() {
  const settings = store ? store.getSettings() : {};
  const map = {
    quick: settings.shortcutQuick ?? DEFAULT_BINDINGS.quick,
    capture: settings.shortcutCapture ?? DEFAULT_BINDINGS.capture,
    panelCycle: settings.shortcutPanelCycle ?? DEFAULT_BINDINGS.panelCycle,
    pinnedToggle: settings.shortcutPinnedToggle ?? DEFAULT_BINDINGS.pinnedToggle
  };
  const bindings = {};
  for (const [name, accelerator] of Object.entries(map)) {
    if (accelerator) bindings[name] = accelerator;
  }
  return bindings;
}

/** 快捷键名 → 设置字段。设置页与主进程共用同一张映射。 */
const SHORTCUT_SETTING_KEYS = {
  quick: 'shortcutQuick',
  capture: 'shortcutCapture',
  panelCycle: 'shortcutPanelCycle',
  pinnedToggle: 'shortcutPinnedToggle'
};

/** 按住型唤起当前键位（清除绑定后为空串）。 */
function momentaryAccelerator() {
  const settings = store ? store.getSettings() : {};
  if (settings.shortcutMomentary === undefined) return DEFAULT_MOMENTARY_BINDINGS.momentary;
  return String(settings.shortcutMomentary || '');
}

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

const userRoot = () => app.getPath('userData');
const dataPath = () => path.join(userRoot(), 'suira-data.json');
const keyPath = () => path.join(userRoot(), 'suira-data.key');
const legacyHistoryPath = () => path.join(userRoot(), 'clipboard-history.json');
const capturesDir = () => path.join(userRoot(), 'captures');
const clipboardImageDir = () => path.join(userRoot(), 'clipboard-images');
const tessdataCacheDir = () => path.join(userRoot(), 'tessdata-cache');
const assetPath = (...parts) => {
  if (app.isPackaged) {
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', ...parts);
    if (fs.existsSync(unpacked)) return unpacked;
  }
  return path.join(__dirname, 'assets', ...parts);
};

function hashBuffer(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

async function ensureDirs() {
  await Promise.all([
    fsp.mkdir(capturesDir(), { recursive: true }),
    fsp.mkdir(clipboardImageDir(), { recursive: true }),
    fsp.mkdir(tessdataCacheDir(), { recursive: true })
  ]);
}

function isSafeHttpUrl(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function classifyText(text) {
  const value = String(text || '').trim();
  if (/^https?:\/\//i.test(value)) return 'link';
  if (/^[A-Z]:\\|^\/(?:Users|home)\//i.test(value)) return 'files';
  return 'text';
}

function thumbnailFor(filePath) {
  try {
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) return '';
    const size = image.getSize();
    const width = Math.min(720, Math.max(220, size.width));
    return image.resize({ width, quality: 'good' }).toDataURL();
  } catch {
    return '';
  }
}

async function addImageToStore(image, source = {}, title = '', existingFilePath = '') {
  if (!image || image.isEmpty()) return null;
  const png = image.toPNG();
  const hash = hashBuffer(png);
  const duplicate = store.data.items.find((item) => item.kind === 'image' && item.meta?.hash === hash);
  if (duplicate) {
    if (existingFilePath && existingFilePath !== duplicate.filePath) await fsp.rm(existingFilePath, { force: true }).catch(() => {});
    // 同一张图再次出现（再次复制/截图）：不新增重复条目，把它置顶并更新来源
    store.touchItem(duplicate.id);
    if (source && Object.keys(source).length) duplicate.source = { ...duplicate.source, ...source };
    await store.save();
    broadcast('content:changed', { itemId: duplicate.id, deduped: true });
    return duplicate;
  }
  const id = makeId('img');
  const filePath = existingFilePath || path.join(source.type === 'screenshot' ? capturesDir() : clipboardImageDir(), `${id}.png`);
  await ensureDirs();
  if (!existingFilePath) await fsp.writeFile(filePath, png);
  const size = image.getSize();
  const thumbnail = image.resize({ width: Math.min(720, Math.max(220, size.width)), quality: 'good' }).toDataURL();
  const item = store.addItem({
    id,
    kind: 'image',
    title: title || (source.type === 'screenshot' ? '屏幕截图' : '剪贴板图片'),
    filePath,
    thumbnail,
    source,
    meta: { hash, width: size.width, height: size.height }
  });
  await store.save();
  return item;
}

/**
 * 记录剪贴板里的文字。
 *
 * 框架要点（用户要求先把剪贴板做完整）：
 * - 来源应用要记住，敏感应用（密码管理器）才拦得住；
 * - 同一段文字再次复制时置顶而不是新增重复条目（A→B→A 只保留一条 A）。
 */
async function rememberClipboardText(text, source = {}) {
  const settings = store.getSettings();
  if (!settings.recordClipboard) return null;

  // 敏感来源与敏感内容排除（开发方案 P0 / 第 8 节）
  const guard = shouldExcludeCapture({
    text,
    processName: source.appName || '',
    windowTitle: source.windowTitle || '',
    excludeSensitive: settings.pauseSensitive
  });
  if (guard.excluded) {
    console.info('跳过敏感剪贴板内容:', guard.reason);
    return null;
  }

  const { text: safeText, truncated } = summarizeLargeText(String(text || '').replace(/\u0000/g, ''));
  const value = safeText.slice(0, 200000);
  if (!value.trim()) return null;

  const candidate = { kind: classifyText(value), text: value };
  const duplicate = clipboardCapture.findRecentDuplicate(store.data.items, candidate, { limit: 300 });
  if (duplicate) {
    store.touchItem(duplicate.id);
    if (source.appName || source.windowTitle) {
      duplicate.source = { ...duplicate.source, ...source };
    }
    await store.save();
    broadcast('content:changed', { itemId: duplicate.id, deduped: true });
    return duplicate;
  }

  clipboardWriteGuard = value;
  const item = store.addItem({
    kind: candidate.kind,
    title: value.trim().slice(0, 42) || '文字',
    text: value,
    source,
    meta: truncated ? { truncated: true } : {}
  });
  await store.save();
  broadcast('content:changed', { itemId: item.id });
  return item;
}

/**
 * 记录剪贴板里的文件引用（资源管理器里复制的文件）。
 * Electron 45 把 CF_HDROP 暴露成 text/uri-list，纯解析在 lib/clipboard-capture.js。
 */
async function rememberClipboardFiles(paths, source = {}) {
  const settings = store.getSettings();
  if (!settings.recordClipboard) return null;
  const fields = clipboardCapture.filesItemFields(paths);
  if (!fields.filePath) return null;

  const guard = shouldExcludeCapture({
    processName: source.appName || '',
    windowTitle: source.windowTitle || '',
    excludeSensitive: settings.pauseSensitive
  });
  if (guard.excluded) {
    console.info('跳过敏感来源的剪贴板文件:', guard.reason);
    return null;
  }

  const candidate = { kind: 'files', text: fields.text };
  const duplicate = clipboardCapture.findRecentDuplicate(store.data.items, candidate, { limit: 300 });
  if (duplicate) {
    store.touchItem(duplicate.id);
    await store.save();
    broadcast('content:changed', { itemId: duplicate.id, deduped: true });
    return duplicate;
  }

  const item = store.addItem({
    kind: 'files',
    title: fields.title || '文件',
    text: fields.text,
    filePath: fields.filePath,
    source,
    meta: { paths: paths.slice(0, 64) }
  });
  await store.save();
  broadcast('content:changed', { itemId: item.id });
  return item;
}

/**
 * 记录这次剪贴板变化来自哪个应用。
 * 前台窗口在复制后短暂仍是被复制的应用，这里按 550ms 轮询的时机取一次，
 * 置信度如实标成 inferred（不能假装确定）。
 */
async function clipboardSourceSnapshot(method = 'clipboard-poll') {
  const base = { type: 'clipboard', acquisitionMethod: method, confidence: 'inferred' };
  try {
    const snapshot = await foregroundProbe.query();
    if (!snapshot) return base;
    const own = Number(snapshot.pid) === process.pid;
    return {
      ...base,
      appId: own ? APP_ID : String(snapshot.processName || '').toLowerCase(),
      appName: own ? APP_NAME : String(snapshot.processName || ''),
      windowTitle: String(snapshot.title || '')
    };
  } catch {
    return base;
  }
}

async function readClipboardText() {
  const result = await readWithRetry(
    async () => String(await clipboard.readText() || ''),
    (value) => !String(value || '').length
  );
  return result.value || '';
}

async function readClipboardImage() {
  const result = await readWithRetry(
    async () => {
      const items = await clipboard.read();
      const imageItem = items.find((item) => item.types?.some((type) => type.startsWith('image/')));
      if (!imageItem) return null;
      const type = imageItem.types.find((value) => value.startsWith('image/'));
      const blob = await imageItem.getType(type);
      const buffer = Buffer.from(await blob.arrayBuffer());
      const image = nativeImage.createFromBuffer(buffer);
      return image.isEmpty() ? null : image;
    },
    (value) => value == null
  );
  if (result.error) console.warn('剪贴板图片读取重试后仍失败:', result.error.message);
  return result.value || null;
}

/**
 * 一次读取剪贴板的完整快照（文字 / 文件引用 / 图片）。
 *
 * 为什么要一次读完：Electron 45 的 clipboard.read() 每次都会打开系统剪贴板，
 * 分三次读既慢又容易在锁竞争时读到不一致的状态。
 * 平台格式优先级：text/plain 可靠；复制文件时只有 text/uri-list（没有 text/plain）。
 */
async function readClipboardSnapshot() {
  const empty = { text: '', files: [], image: null };
  const result = await readWithRetry(async () => {
    const items = await clipboard.read();
    if (!Array.isArray(items) || !items.length) return empty;
    const snapshot = { text: '', files: [], image: null };

    const textItem = items.find((item) => item.types?.includes('text/plain'));
    if (textItem) {
      try {
        const blob = await textItem.getType('text/plain');
        snapshot.text = String(typeof blob === 'string' ? blob : await blob.text());
      } catch { /* 文本读取失败不影响图片/文件 */ }
    }

    const uriItem = items.find((item) => item.types?.includes('text/uri-list'));
    if (uriItem) {
      try {
        const blob = await uriItem.getType('text/uri-list');
        const uriText = String(typeof blob === 'string' ? blob : await blob.text());
        snapshot.files = clipboardCapture.parseClipboardFileUris(uriText);
      } catch { /* 文件列表格式异常时当作没有文件 */ }
    }

    const imageItem = items.find((item) => item.types?.some((type) => type.startsWith('image/')));
    if (imageItem) {
      try {
        const type = imageItem.types.find((value) => value.startsWith('image/'));
        const blob = await imageItem.getType(type);
        const buffer = Buffer.from(await blob.arrayBuffer());
        const image = nativeImage.createFromBuffer(buffer);
        if (!image.isEmpty()) snapshot.image = image;
      } catch { /* 图片解码失败时忽略这一项 */ }
    }
    return snapshot;
  }, (value) => value == null);

  return result.value || empty;
}

async function writeClipboardText(text) {
  const value = String(text || '');
  clipboardWriteGuard = value;
  await clipboard.writeText(value);
  // 记录序号与内容，供自写回环判定（第 7 节）
  clipboardLedger.record(value);
  lastClipboardText = value;
  lastClipboardImageHash = '';
  lastClipboardFilesKey = '';
  clipboardWriteGuard = '';
}

async function writeClipboardImage(image) {
  const png = image.toPNG();
  clipboardWriteGuard = await readClipboardText();
  lastClipboardImageHash = hashBuffer(png);
  await clipboard.write([new ClipboardItem({ 'image/png': png })]);
  lastClipboardText = await readClipboardText();
  lastClipboardFilesKey = '';
  clipboardLedger.record(lastClipboardText);
  clipboardWriteGuard = '';
}

async function pollClipboard() {
  try {
    const generation = ++captureGeneration;
    const snapshot = await readClipboardSnapshot();
    if (generation !== captureGeneration) return;

    const text = snapshot.text || '';
    const filesKey = snapshot.files.length ? snapshot.files.join('\n').toLowerCase() : '';
    const imageHash = snapshot.image ? hashBuffer(snapshot.image.toPNG()) : '';

    const textChanged = Boolean(text && text !== lastClipboardText);
    const filesChanged = Boolean(filesKey && filesKey !== lastClipboardFilesKey);
    const imageChanged = Boolean(imageHash && imageHash !== lastClipboardImageHash);
    // 自写回环：本次变化若仍是我们刚写入的内容，不重复入库
    const ownWrite = clipboardLedger.shouldIgnore(text);

    if (textChanged && !ownWrite && text !== clipboardWriteGuard) {
      const source = await clipboardSourceSnapshot('clipboard-poll');
      await rememberClipboardText(text, source);
    } else if (filesChanged) {
      const source = await clipboardSourceSnapshot('clipboard-file-poll');
      await rememberClipboardFiles(snapshot.files, source);
    } else if (imageChanged && !text && !filesKey) {
      const source = await clipboardSourceSnapshot('clipboard-image-poll');
      await addImageToStore(snapshot.image, source);
    }

    lastClipboardText = text;
    lastClipboardFilesKey = filesKey;
    lastClipboardImageHash = imageHash;
    if (clipboardWriteGuard && text === clipboardWriteGuard) clipboardWriteGuard = '';
  } catch (error) {
    console.warn('剪贴板读取失败:', error.message);
  }
}

async function startClipboardWatcher() {
  clearInterval(clipboardTimer);
  const initial = await readClipboardSnapshot();
  lastClipboardText = initial.text || '';
  lastClipboardFilesKey = initial.files.length ? initial.files.join('\n').toLowerCase() : '';
  lastClipboardImageHash = initial.image ? hashBuffer(initial.image.toPNG()) : '';
  clipboardTimer = setInterval(pollClipboard, 550);
  clipboardWatcherError = '';
  console.log('[clipboard] 监听已启动，间隔 550ms（文本 / 文件引用 / 图片）');
}

async function migrateLegacyHistory() {
  if (store.data.items.length) return;
  try {
    const parsed = JSON.parse(await fsp.readFile(legacyHistoryPath(), 'utf8'));
    if (!Array.isArray(parsed) || !parsed.length) return;
    for (const record of parsed.reverse()) {
      if (!record?.id) continue;
      const kind = record.type === 'image' ? 'image' : classifyText(record.text || '');
      store.addItem({
        id: record.id,
        kind,
        title: record.title || record.text?.slice(0, 42) || '历史内容',
        text: record.text || '',
        filePath: record.filePath || '',
        thumbnail: record.thumbnail || '',
        source: { type: record.source || 'clipboard', acquisitionMethod: 'legacy-migration', confidence: 'inferred' },
        createdAt: record.createdAt,
        pinned: Boolean(record.pinned),
        meta: { hash: record.hash || '', width: record.width || 0, height: record.height || 0, recordId: record.id }
      });
    }
    await store.save();
  } catch {}
}function positionQuickPanel(win) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  const width = Math.min(QUICK_WIDTH, area.width - 24);
  const height = Math.min(QUICK_HEIGHT, area.height - 24);
  win.setBounds({
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + Math.min(110, Math.max(48, (area.height - height) * 0.24))),
    width,
    height
  });
}

function createQuickWindow() {
  quickWindow = new BrowserWindow({
    width: QUICK_WIDTH,
    height: QUICK_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    title: APP_NAME,
    icon: assetPath('suira-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  quickWindow.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'win32') {
    try { quickWindow.setBackgroundMaterial('none'); } catch {}
  }
  quickWindow.loadFile(path.join(__dirname, 'src', 'quickpanel.html'));
  quickWindow.setMenuBarVisibility(false);
  quickWindow.webContents.once('did-finish-load', () => {
    quickReady = true;
    broadcast('content:changed');
  });
  quickWindow.on('blur', () => {
    if (quickWindow && !quickWindow.isDestroyed() && !quickWindow.webContents.isDevToolsOpened()) quickWindow.hide();
  });
  quickWindow.on('show', () => quickWindow.webContents.send('quick:shown'));
  quickWindow.on('closed', () => { quickWindow = null; quickReady = false; });
  quickWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeHttpUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

/**
 * 在唤起面板前记录目标窗口。
 * 对应开发方案第 7 节：唤起前记录 HWND、PID、进程启动时间。
 * 必须在面板获得焦点之前调用，否则读到的会是自己。
 */
async function rememberReturnTarget(selectionMethod = 'unknown') {
  try {
    const snapshot = await foregroundProbe.query();
    returnTarget = snapshot ? captureTarget(snapshot, { selectionMethod }) : null;
  } catch {
    returnTarget = null;
  }
  return returnTarget;
}

function showQuickPanel() {
  if (!quickWindow || quickWindow.isDestroyed()) createQuickWindow();
  // 先记录目标，再显示窗口——顺序不能反
  const pending = rememberReturnTarget('quick-panel');
  positionQuickPanel(quickWindow);
  quickWindow.show();
  quickWindow.focus();
  if (quickReady) quickWindow.webContents.send('quick:shown');
  return pending;
}

function hideQuickPanel() {
  if (quickWindow && !quickWindow.isDestroyed()) quickWindow.hide();
}

function toggleQuickPanel() {
  if (quickWindow && quickWindow.isVisible() && quickWindow.isFocused()) hideQuickPanel();
  else showQuickPanel();
}

/* ---------- 浮引岛（文件中转） ---------- */

/**
 * 浮引岛的完整状态。渲染层只拿引用与元数据，文件本体不进入渲染进程。
 * @returns {{ok:boolean, items:object[], policy:'copy'|'move', expanded:boolean, maxItems:number, visible:boolean}}
 */
function islandState() {
  const snapshot = store ? store.getIsland() : { items: [], policy: 'copy' };
  return {
    ok: true,
    items: snapshot.items,
    policy: snapshot.policy,
    expanded: islandExpanded,
    maxItems: ISLAND_MAX_ITEMS,
    visible: Boolean(islandWindow && !islandWindow.isDestroyed() && islandWindow.isVisible())
  };
}

function broadcastIsland() {
  broadcast('island:state', islandState());
}

/** 岛窗口边界：主屏顶部居中；展开时向两侧变宽。 */
function islandBounds(expanded) {
  const area = screen.getPrimaryDisplay().workArea;
  const size = expanded ? ISLAND_EXPANDED : ISLAND_COLLAPSED;
  return {
    x: Math.round(area.x + (area.width - size.width) / 2),
    y: Math.round(area.y + ISLAND_MARGIN_TOP),
    width: size.width,
    height: size.height
  };
}

function createIslandWindow() {
  if (islandWindow && !islandWindow.isDestroyed()) return islandWindow;
  islandWindow = new BrowserWindow({
    ...islandBounds(false),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    // 岛要能被点击与拖放；但不能抢走用户正在打字的窗口焦点
    focusable: true,
    title: '随序 · 浮引岛',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  islandWindow.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'win32') {
    try { islandWindow.setBackgroundMaterial('none'); } catch {}
  }
  islandWindow.loadFile(path.join(__dirname, 'src', 'island.html'));
  islandWindow.setMenuBarVisibility(false);
  islandWindow.webContents.once('did-finish-load', () => {
    islandWindow.webContents.send('island:state', islandState());
    islandWindow.webContents.send('island:expanded', islandExpanded);
  });
  // 失焦即收起：点别处不该留一张展开的卡片挡在屏幕上
  islandWindow.on('blur', () => {
    if (islandExpanded) setIslandExpanded(false);
  });
  islandWindow.on('closed', () => { islandWindow = null; });
  islandWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeHttpUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  return islandWindow;
}

function showIsland() {
  const win = createIslandWindow();
  if (!win || win.isDestroyed()) return { ok: false, error: '浮引岛窗口创建失败' };
  win.setBounds(islandBounds(islandExpanded));
  // 用 showInactive：岛是常驻入口，出现时不能打断用户当前输入
  win.showInactive();
  win.webContents.send('island:state', islandState());
  return { ok: true, visible: true };
}

function hideIsland() {
  setIslandExpanded(false);
  if (islandWindow && !islandWindow.isDestroyed()) islandWindow.hide();
  return { ok: true, visible: false };
}

function toggleIsland() {
  if (islandWindow && !islandWindow.isDestroyed() && islandWindow.isVisible()) return hideIsland();
  return showIsland();
}

function setIslandExpanded(expanded) {
  const target = Boolean(expanded);
  const win = islandWindow;
  if (islandExpanded === target) {
    if (win && !win.isDestroyed()) win.webContents.send('island:expanded', target);
    return { ok: true, expanded: target };
  }
  islandExpanded = target;
  if (!win || win.isDestroyed()) return { ok: true, expanded: target };
  win.setBounds(islandBounds(target));
  win.webContents.send('island:expanded', target);
  return { ok: true, expanded: target };
}

/** 把路径加入暂存。去重、容量上限由 lib/island-model.js 决定。 */
async function addIslandPaths(paths) {
  if (!store) return { ...islandState(), ok: false, error: '数据层尚未就绪' };
  const incoming = (Array.isArray(paths) ? paths : [paths])
    .filter((value) => typeof value === 'string')
    .filter((value) => islandModel.isShelfablePath(value));
  if (!incoming.length) return { ...islandState(), ok: false, error: '没有可暂存的文件路径' };
  const current = store.getIsland();
  // island-model 的入参是条目对象：这里把路径包装成只带 path 的条目，
  // 名称、类型、时间戳都由模型补齐（保持纯函数、便于测试）
  const result = islandModel.addShelfItems(current.items, incoming.map((filePath) => ({ path: filePath })), {
    cap: ISLAND_MAX_ITEMS
  });
  if (!result.added) return { ...islandState(), ok: true, added: 0, dropped: result.dropped };
  await store.updateIsland({ items: result.items });
  broadcastIsland();
  const win = islandWindow;
  if (win && !win.isDestroyed()) setIslandExpanded(true);
  return { ...islandState(), ok: true, added: result.added, dropped: result.dropped };
}

/** 找到暂存条目并确认文件还在。 */
function findIslandItem(id) {
  if (!store) return null;
  const item = store.getIsland().items.find((entry) => entry.id === String(id || ''));
  if (!item) return null;
  return { item, exists: fs.existsSync(item.path) };
}

/**
 * 拖出：Electron 只能由主进程发起原生拖放。
 * 图标用应用图标缩小一档，资源管理器会据此显示拖动预览。
 */
async function startIslandDrag(id) {
  const found = findIslandItem(id);
  if (!found) return false;
  if (!found.exists) {
    toastToUser('文件已被移动或删除，无法拖出', 'error');
    return false;
  }
  const win = islandWindow;
  if (!win || win.isDestroyed()) return false;
  try {
    let icon = nativeImage.createFromPath(assetPath('suira-icon.png'));
    if (icon && !icon.isEmpty()) icon = icon.resize({ width: 32, height: 32 });
    else icon = undefined;
    win.webContents.startDrag({ file: found.item.path, icon });
    return true;
  } catch (error) {
    console.warn('拖出浮引岛失败:', error && error.message ? error.message : error);
    return false;
  }
}

async function openIslandItem(id) {
  const found = findIslandItem(id);
  if (!found) return { ok: false, error: '暂存条目不存在' };
  if (!found.exists) return { ok: false, error: '文件已被移动或删除' };
  try {
    const error = await shell.openPath(found.item.path);
    if (error) return { ok: false, error };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message || '打开失败' };
  }
}

function revealIslandItem(id) {
  const found = findIslandItem(id);
  if (!found) return { ok: false, error: '暂存条目不存在' };
  shell.showItemInFolder(found.item.path);
  return { ok: true };
}

/* ---------- 面板布局轮换 / 钉图显隐 / 按住型唤起 ---------- */

function toastToUser(message, type = 'info') {
  broadcast('app:toast', { message, type });
}

/**
 * 面板布局轮换（原产品 onPanelCycleLayout）：动作 → 应用 → 工具箱 → 动作。
 * 面板没显示时先显示，并停在第一个布局，避免「按一下只换了个看不见的东西」。
 */
function cyclePanelMode() {
  if (!quickWindow || quickWindow.isDestroyed()) createQuickWindow();
  if (!quickWindow.isVisible()) {
    panelModeIndex = 0;
    showQuickPanel();
    quickWindow.webContents.send('quick:mode', PANEL_MODES[panelModeIndex]);
    return { ok: true, mode: PANEL_MODES[panelModeIndex] };
  }
  panelModeIndex = (panelModeIndex + 1) % PANEL_MODES.length;
  const mode = PANEL_MODES[panelModeIndex];
  quickWindow.webContents.send('quick:mode', mode);
  return { ok: true, mode };
}

/**
 * 钉图显隐（原产品 onPinnedImageVisibilityShortcut）：
 * 有可见的钉图就全部隐藏，全部隐藏时再按一次全部恢复。
 */
function togglePinnedVisibility() {
  const windows = [...pinWindows].filter((win) => win && !win.isDestroyed());
  if (!windows.length) {
    toastToUser('还没有钉图窗口，先按 P 钉一张', 'warn');
    return { ok: false, error: '还没有钉图窗口' };
  }
  const visibleCount = windows.filter((win) => win.isVisible()).length;
  const shouldHide = visibleCount > 0;
  for (const win of windows) {
    if (shouldHide) win.hide();
    else win.showInactive();
  }
  toastToUser(shouldHide ? `已隐藏 ${windows.length} 张钉图` : `已恢复 ${windows.length} 张钉图`, 'info');
  return { ok: true, hidden: shouldHide, count: windows.length };
}

/** 按住型唤起的下发给设置页的状态。 */
function momentaryStatus() {
  const accelerator = momentaryAccelerator();
  if (!accelerator) return { ok: true, accelerator: '', error: '', watching: false, cleared: true };
  const watching = Boolean(momentaryProbe && momentaryProbe.status === 'watching');
  return {
    ok: watching,
    accelerator,
    // 失败原因要具体：设置页直接展示这一句，不能只说「未运行」
    error: watching ? '' : (momentaryError || '按住型侦测未运行'),
    watching
  };
}

/**
 * 启动/重启按住型侦测。
 * 键位为空（用户清除绑定）时只停掉侦测，不报错。
 */
async function setupMomentaryProbe() {
  const accelerator = momentaryAccelerator();
  if (momentaryProbe) {
    try { await momentaryProbe.stop(); } catch {}
    momentaryProbe = null;
  }
  if (!accelerator) {
    momentaryOpened = false;
    momentaryError = '';
    return { ok: true, watching: false };
  }
  momentaryProbe = new KeyWatchProbe({
    accelerator,
    scriptPath: assetPath('key-watch.ps1'),
    onDown: () => {
      if (quickWindow && !quickWindow.isDestroyed() && quickWindow.isVisible()) return;
      momentaryOpened = true;
      showQuickPanel();
    },
    onUp: () => {
      if (!momentaryOpened) return;
      momentaryOpened = false;
      hideQuickPanel();
    },
    onError: (message) => console.warn('按住型唤起侦测失败:', message)
  });
  const result = await momentaryProbe.start();
  const ok = Boolean(result && result.ok);
  if (ok) {
    momentaryError = '';
  } else {
    momentaryError = (result && result.error) || '按键侦测助手没有启动';
    console.warn('按住型侦测启动失败:', momentaryError);
  }
  return {
    ok,
    watching: momentaryProbe && momentaryProbe.status === 'watching',
    error: ok ? '' : momentaryError
  };
}

/**
 * 尝试把内容放回原处。
 *
 * 严格遵循第 7 节：提交前重新校验目标；校验不通过就只复制并提示用户。
 * 本环境无法安全注入输入，因此默认走「仅复制」路径，但仍完整执行校验，
 * 让用户得到准确的原因提示。
 */
async function tryReturnToTarget(item, intent = 'return-and-paste') {
  const settings = store.getSettings();
  const current = await foregroundProbe.query().catch(() => null);
  const decision = decideCommit({
    target: returnTarget,
    current,
    intent,
    pasteAfterCopy: Boolean(settings.pasteAfterCopy)
  });

  // 无论是否能粘贴，都先完成复制——这是「已复制，切回目标后粘贴」的前提
  try {
    await writeClipboardText(item?.text || item?.filePath || '');
  } catch (error) {
    // 复制本身失败时必须是失败结果：渲染层据此显示红色错误，
    // 不能返回 ok:true 把「复制失败」当成功提示出去。
    return { ...decision, copied: false, copyFailed: true, canPaste: false, message: `复制失败：${error.message}` };
  }

  if (!decision.canPaste) {
    // 校验未通过（目标已关闭 / 用户切换了窗口 / 权限不匹配），或用户只要复制
    return { ...decision, canPaste: false, copied: true, message: decision.message };
  }

  const focused = focusWindowForReturn(returnTarget);
  if (!focused) {
    return { ...decision, canPaste: false, pasteUnsupported: true, message: '已复制，切回目标后粘贴' };
  }

  // 留出焦点切换时间，否则按键可能落到随序自己身上
  await new Promise((resolve) => setTimeout(resolve, RETURN_FOCUS_DELAY));
  const injected = await inputInjector.paste();
  if (!injected.ok) {
    return {
      ...decision,
      canPaste: false,
      pasteUnsupported: true,
      message: `已复制，请手动粘贴（${injected.error || '注入失败'}）`
    };
  }
  return { ...decision, canPaste: true, pasted: true, message: '已粘贴到原窗口' };
}

/**
 * 把之前记录的目标窗口切到前台。
 *
 * 调用前已由 validateTarget 确认 HWND 仍属于同一进程实例，
 * 这里只负责置前。失败返回 false，由调用方降级为「仅复制」。
 */
function focusWindowForReturn(target) {
  const hwnd = normalizeHwnd(target?.hwnd);
  if (!hwnd) return false;
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SuiraFocus {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    public static bool Focus(long handle) {
        IntPtr h = new IntPtr(handle);
        if (!IsWindow(h)) return false;
        ShowWindow(h, 9);
        return SetForegroundWindow(h);
    }
}
'@
$ok = [SuiraFocus]::Focus([long]${hwnd})
[Console]::Out.Write((ConvertTo-Json @{ ok = $ok } -Compress))
`;
  try {
    const output = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script
    ], { encoding: 'utf8', windowsHide: true, timeout: 4000 });
    return JSON.parse(String(output).trim()).ok === true;
  } catch {
    return false;
  }
}

function createMainWindow() {
  const displays = screen.getAllDisplays();
  const display = screen.getPrimaryDisplay();
  const fallback = {
    width: Math.min(MAIN_WIDTH, display.workAreaSize.width - 48),
    height: Math.min(MAIN_HEIGHT, display.workAreaSize.height - 48)
  };
  // 位置/尺寸记忆：显示器被拔掉或分辨率变化时，sanitizeWindowBounds 会回落到默认居中位置，
  // 不会把窗口恢复到已经不存在的屏幕上（否则窗口会「消失」）。
  const saved = store ? store.getWindowState() : null;
  const restored = saved ? sanitizeWindowBounds(saved, displays, fallback) : null;
  mainWindow = new BrowserWindow({
    ...(restored
      ? { x: restored.x, y: restored.y, width: restored.width, height: restored.height }
      : { width: fallback.width, height: fallback.height }),
    minWidth: 940,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: '#F4F6FA',
    title: APP_NAME,
    icon: assetPath('suira-icon.png'),
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    // 上次退出时是最大化状态：先恢复最大化再显示，避免先闪一下小窗口
    if (saved?.maximized) {
      try { mainWindow.maximize(); } catch {}
    }
    mainWindow.show();
    mainWindow.focus();
  });
  mainWindow.on('close', (event) => {
    rememberMainWindowState();
    if (!isQuitting) { event.preventDefault(); mainWindow.hide(); }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeHttpUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // 移动/缩放结束后记忆窗口状态（500ms 防抖，避免拖动过程中频繁写盘）
  let saveTimer = null;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => rememberMainWindowState(), 500);
    if (saveTimer.unref) saveTimer.unref();
  };
  mainWindow.on('resize', scheduleSave);
  mainWindow.on('move', scheduleSave);
  mainWindow.on('maximize', scheduleSave);
  mainWindow.on('unmaximize', scheduleSave);
}

/** 把主窗口当前位置/尺寸/最大化状态写进 store。 */
function rememberMainWindowState() {
  if (!store || !mainWindow || mainWindow.isDestroyed()) return;
  try {
    const maximized = mainWindow.isMaximized();
    const bounds = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    store.setWindowState({ ...bounds, maximized });
  } catch {
    // 窗口正在销毁时取 bounds 可能抛错，忽略即可
  }
}

function showMain(page = 'shelf') {
  const alreadyFocused = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused());
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  if (!alreadyFocused) {
    // 「粘贴回原窗口」需要目标：先记住用户打开随序之前所在的应用。
    // 若读到的目标就是随序自己（例如从面板跳过来），保留面板已经记录的目标。
    const previous = returnTarget;
    rememberReturnTarget('main-window').then((target) => {
      if (target && Number(target.pid) === process.pid) returnTarget = previous;
    }).catch(() => {});
  }
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('app:navigate', page);
}

async function beginScreenCapture(source = 'panel', options = {}) {
  if (captureBusy) return { ok: true };
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.focus();
    return { ok: true };
  }
  // 入口意图：从 38 键面板按 O 进来，框完直接进识别；按 P 进来直接钉图。
  // 意图随 payload 交给覆盖层，覆盖层据此预选工具或自动完成。
  const intent = ['ocr', 'pin', 'copy', 'save', 'shelf'].includes(options?.intent) ? options.intent : 'copy';
  captureBusy = true;
  try {
    hideQuickPanel();
    mainWasVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
    if (mainWasVisible) mainWindow.hide();
    await new Promise((resolve) => setTimeout(resolve, 40));

    // 跨屏支持：覆盖所有显示器组成的虚拟桌面。
    // 各显示器 DPI 可能不同，因此按「物理像素」合成，再用统一的虚拟桌面逻辑尺寸映射回选区。
    const displays = screen.getAllDisplays();
    const virtualBounds = unionBounds(displays) || { ...screen.getPrimaryDisplay().bounds };

    // 合成用缩放：以最大 scaleFactor 为准，保证最清晰屏幕不被降采样
    const maxScale = maxScaleFactor(displays);
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(virtualBounds.width * maxScale),
        height: Math.round(virtualBounds.height * maxScale)
      },
      fetchWindowIcons: false
    });

    const tiles = collectDesktopTiles(displays, sources, virtualBounds, maxScale);
    if (!tiles) throw new Error('无法读取屏幕画面');

    const primaryDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    capturePayload = {
      // 单屏：直接给 dataUrl；多屏：给 tiles 由 overlay 合成
      dataUrl: tiles.tiles.length === 1 ? tiles.tiles[0].dataUrl : '',
      tiles: tiles.tiles.length > 1 ? tiles.tiles : null,
      tileSize: { width: tiles.width, height: tiles.height },
      displayId: primaryDisplay.id,
      bounds: virtualBounds,
      size: virtualBounds,
      scaleFactor: maxScale,
      displays: displays.map((d) => ({
        id: d.id,
        bounds: d.bounds,
        scaleFactor: d.scaleFactor || 1
      })),
      // 入口意图：覆盖层据此处决定框选完成后直接做哪一步
      intent,
      source
    };
    overlayWindow = new BrowserWindow({
      x: virtualBounds.x,
      y: virtualBounds.y,
      width: virtualBounds.width,
      height: virtualBounds.height,
      show: false,
      frame: false,
      transparent: false,
      backgroundColor: '#0b0e13',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      fullscreen: false,
      fullscreenable: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setBounds(virtualBounds);
    overlayWindow.loadFile(path.join(__dirname, 'src', 'overlay.html'));
    overlayWindow.once('ready-to-show', () => {
      overlayWindow.show();
      overlayWindow.focus();
    });
    overlayWindow.on('closed', () => {
      overlayWindow = null;
      capturePayload = null;
      captureBusy = false;
      restoreMainAfterCapture();
    });
    return { ok: true };
  } catch (error) {
    captureBusy = false;
    restoreMainAfterCapture();
    if (mainWindow) {
      mainWindow.webContents.send('app:toast', { message: error.message || '截图失败', type: 'error' });
    }
    return { ok: false, error: error.message };
  }
}

/**
 * 收集各显示器的画面分块，交给 overlay 用 canvas 合成。
 *
 * 为什么在渲染进程合成：Electron 的 nativeImage 没有像素级合成 API，
 * 而 overlay 页面本来就有 canvas，直接在那里拼最省事也最准确。
 *
 * @returns {{tiles:Array<{dataUrl:string,x:number,y:number}>, width:number, height:number}|null}
 */
function collectDesktopTiles(displays, sources, virtualBounds, targetScale) {
  const byDisplayId = new Map();
  for (const source of sources) {
    if (source.display_id) byDisplayId.set(String(source.display_id), source);
  }

  const width = Math.max(1, Math.round(virtualBounds.width * targetScale));
  const height = Math.max(1, Math.round(virtualBounds.height * targetScale));
  const tiles = [];

  for (const tile of tileLayout(displays, virtualBounds, targetScale)) {
    const source = byDisplayId.get(String(tile.id));
    if (!source || source.thumbnail.isEmpty()) continue;
    const scaled = source.thumbnail.resize({ width: tile.width, height: tile.height, quality: 'best' });
    tiles.push({
      dataUrl: scaled.toDataURL(),
      x: tile.x,
      y: tile.y,
      width: tile.width,
      height: tile.height
    });
  }

  if (!tiles.length) return null;
  return { tiles, width, height };
}

function restoreMainAfterCapture() {
  if (!mainWasVisible) return;
  mainWasVisible = false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
}

async function saveDataUrlImage(dataUrl, prefix = 'capture') {
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) throw new Error('截图数据无效');
  await ensureDirs();
  const filePath = path.join(capturesDir(), `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
  await fsp.writeFile(filePath, image.toPNG());
  return { image, filePath };
}

async function completeCapture(dataUrl, action) {
  const { image, filePath } = await saveDataUrlImage(dataUrl);
  const item = await addImageToStore(image, { type: 'screenshot', acquisitionMethod: 'screen-capture', confidence: 'certain' }, '屏幕截图', filePath);
  if (action === 'copy') {
    await writeClipboardImage(image);
  } else if (action === 'save') {
    // 截图时主窗口通常是隐藏的：不能拿隐藏窗口当模态父窗口，否则对话框可能不出现。
    const parent = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow : null;
    const result = await dialog.showSaveDialog(parent, {
      title: '保存截图',
      defaultPath: path.join(app.getPath('pictures'), `随序截图-${Date.now()}.png`),
      filters: [{ name: 'PNG 图片', extensions: ['png'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await fsp.copyFile(filePath, result.filePath);
  } else if (action === 'pin') {
    createPinWindow(pathToFileURL(filePath).href, image.getSize());
  } else if (action === 'shelf') {
    let task = store.data.tasks.find((entry) => !entry.archived && entry.title === '临时收集');
    if (!task) task = store.createTask('临时收集');
    if (item) store.addItemToTask(task.id, item.id);
    await store.save();
    broadcast('tasks:changed');
  } else if (action === 'ocr') {
    if (!item) throw new Error('截图保存失败');
    const result = await actions.execute(item.id, 'ocr.local');
    if (!result.ok) throw new Error(result.error);
    broadcast('content:changed', { itemId: item.id, outputId: result.output?.id || '' });
    return { ok: true, filePath, item, output: result.output, ocr: true };
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy();
  broadcast('content:changed', { itemId: item?.id || '' });
  if (mainWindow && !mainWindow.isDestroyed()) {
    const messages = {
      copy: '截图已复制，并保存到内容库',
      save: '截图已保存，并保存到内容库',
      pin: '截图已钉在桌面',
      shelf: '截图已加入任务匣'
    };
    mainWindow.webContents.send('app:toast', { message: messages[action] || '截图已处理', type: 'success' });
  }
  return { ok: true, filePath, item };
}

function switchToDesktop() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  if (quickWindow && !quickWindow.isDestroyed()) quickWindow.hide();
  // 与 Win+D 等价：最小化所有顶层窗口，不需要管理员权限
  try {
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      '(New-Object -ComObject Shell.Application).ToggleDesktop()'
    ], { windowsHide: true, timeout: 3000 });
    return { ok: true, message: '已回到桌面', closePanel: true };
  } catch (error) {
    return { ok: false, error: `切换桌面失败：${error.message}`, closePanel: false };
  }
}

function lockWorkstation() {
  try {
    execFileSync('rundll32.exe', ['user32.dll,LockWorkStation'], { windowsHide: true, timeout: 3000 });
    return { ok: true, message: '正在锁屏', closePanel: true };
  } catch (error) {
    return { ok: false, error: `锁屏失败：${error.message}`, closePanel: false };
  }
}

/**
 * 应用索引里的应用对用户是否真的可启动。
 * 索引为空时（首次扫描中）不阻塞键位展示，避免面板整片空白。
 */
function appIndexReady() {
  return true;
}

/**
 * 面板动作执行层：真实逻辑在 lib/panel-actions.js（可注入依赖、可被测试覆盖），
 * 这里只负责把主进程的能力接进去。
 *
 * 惰性创建：store / actions 要到 initialize() 才赋值，模块加载时还是 null。
 * 之前在这里直接创建会把 null 永久捕获进去，第一次按键就 TypeError。
 */
let panelActions = null;
function getPanelActions() {
  if (!panelActions) {
    panelActions = createPanelActions({
      store,
      actions,
      capture: (intent) => beginScreenCapture('panel', { intent }),
      pin: (filePath, size) => createPinWindow(pathToFileURL(filePath).href, size),
      switchToDesktop,
      lockWorkstation
    });
  }
  return panelActions;
}

/**
 * 执行面板动作。这是 38 个按键唯一的执行入口：
 * 鼠标点击和键盘直达走同一条通道，保证「按键与鼠标调用同一动作」。
 */
async function runPanelAction(actionId) {
  return getPanelActions().run(actionId);
}

/**
 * 取出开始菜单快捷方式的图标并转成 data URL。
 * 结果按路径缓存：图标是静态资源，不需要每次打开面板都重新提取。
 */
async function appIconFor(filePath) {
  if (appIconCache.has(filePath)) return appIconCache.get(filePath);
  let dataUrl = '';
  try {
    const image = await app.getFileIcon(filePath, { size: 'normal' });
    if (image && !image.isEmpty()) {
      dataUrl = image.resize({ width: 64, height: 64, quality: 'best' }).toDataURL();
    }
  } catch {
    dataUrl = '';
  }
  appIconCache.set(filePath, dataUrl);
  return dataUrl;
}

function createPinWindow(dataUrl, size = {}) {
  const maxWidth = 560;
  const ratio = (size.height || 600) / Math.max(1, size.width || 800);
  const width = Math.min(maxWidth, Math.max(260, size.width || 800));
  const height = Math.max(180, Math.round(width * ratio));
  const pin = new BrowserWindow({
    width, height, frame: false, alwaysOnTop: true, resizable: true, skipTaskbar: false,
    hasShadow: true, backgroundColor: '#252b35', title: '随序 · 钉图',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, preload: path.join(__dirname, 'pin-preload.js') }
  });
  const escaped = String(dataUrl).replace(/"/g, '&quot;');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;overflow:hidden;background:#252b35;user-select:none}
    .wrap{position:relative;width:100%;height:100%;-webkit-app-region:drag}
    img{display:block;width:100%;height:100%;object-fit:contain;background:#252b35;pointer-events:none}
    .bar{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);display:flex;align-items:center;gap:2px;
      padding:5px 7px;border-radius:10px;background:rgba(37,43,53,.92);box-shadow:0 6px 20px rgba(0,0,0,.34);
      opacity:0;transition:opacity .16s;-webkit-app-region:no-drag}
    .wrap:hover .bar{opacity:1}
    button{width:26px;height:26px;border:0;border-radius:7px;background:transparent;color:#dfe5ef;
      font:15px/1 system-ui;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
    button:hover{background:rgba(183,203,234,.2)}
    .sep{width:1px;height:16px;background:rgba(223,229,239,.22);margin:0 3px}
    .val{min-width:38px;text-align:center;color:#b7cbea;font:11px/1 system-ui;letter-spacing:.02em}
  </style></head><body><div class="wrap"><img src="${escaped}">
    <div class="bar">
      <button id="zoom-out" title="缩小">−</button>
      <span class="val" id="zoom-val">100%</span>
      <button id="zoom-in" title="放大">+</button>
      <span class="sep"></span>
      <button id="opacity-down" title="更透明">◐</button>
      <span class="val" id="opacity-val">100%</span>
      <button id="opacity-up" title="更不透明">◑</button>
      <span class="sep"></span>
      <button id="collapse" title="临时收起">—</button>
      <button id="close" title="关闭">×</button>
    </div></div>
  <script>
    // 缩放、透明度、临时收起均在渲染进程内完成，不需要主进程 IPC。
    var baseW = ${width}, baseH = ${height};
    var scale = 1, opacity = 1, collapsed = false, savedBounds = null;
    var zoomVal = document.getElementById('zoom-val');
    var opacityVal = document.getElementById('opacity-val');

    function applyZoom(next) {
      scale = Math.min(3, Math.max(0.25, next));
      zoomVal.textContent = Math.round(scale * 100) + '%';
      window.pinApi.resize(Math.round(baseW * scale), Math.round(baseH * scale));
    }
    function applyOpacity(next) {
      opacity = Math.min(1, Math.max(0.25, next));
      opacityVal.textContent = Math.round(opacity * 100) + '%';
      window.pinApi.setOpacity(opacity);
    }
    document.getElementById('zoom-in').onclick = function () { applyZoom(scale + 0.1); };
    document.getElementById('zoom-out').onclick = function () { applyZoom(scale - 0.1); };
    document.getElementById('opacity-up').onclick = function () { applyOpacity(opacity + 0.1); };
    document.getElementById('opacity-down').onclick = function () { applyOpacity(opacity - 0.1); };
    document.getElementById('close').onclick = function () { window.pinApi.close(); };

    // 临时收起：缩到极窄条，再次点击恢复，避免遮挡又不用重新找图
    document.getElementById('collapse').onclick = function () {
      collapsed = !collapsed;
      if (collapsed) {
        savedBounds = window.pinApi.bounds();
        window.pinApi.collapse(true);
      } else {
        window.pinApi.collapse(false);
      }
    };
    // 滚轮缩放
    window.addEventListener('wheel', function (e) {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); applyZoom(scale + (e.deltaY < 0 ? 0.1 : -0.1)); }
    }, { passive: false });
    // 双击恢复 100%
    window.addEventListener('dblclick', function () { applyZoom(1); applyOpacity(1); });
  </script></body></html>`;
  pin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  pinWindows.add(pin);
  pin.on('closed', () => pinWindows.delete(pin));
}

function registerIpc() {
  /* ---- 钉图窗口控制 ---- */
  // 每个钉图窗口独立保存收起前的边界，便于恢复
  const pinState = new WeakMap();

  const pinFromEvent = (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win && pinWindows.has(win) ? win : null;
  };

  ipcMain.on('pin:resize', (event, payload) => {
    const win = pinFromEvent(event);
    if (!win || win.isDestroyed()) return;
    const width = Math.max(80, Math.min(4000, Math.round(Number(payload?.width) || 0)));
    const height = Math.max(60, Math.min(4000, Math.round(Number(payload?.height) || 0)));
    if (!width || !height) return;
    const bounds = win.getBounds();
    // 以左上角为锚点缩放，避免窗口跑到屏幕外
    win.setBounds({ x: bounds.x, y: bounds.y, width, height });
  });

  ipcMain.on('pin:opacity', (event, value) => {
    const win = pinFromEvent(event);
    if (!win || win.isDestroyed()) return;
    const opacity = Math.max(0.25, Math.min(1, Number(value) || 1));
    win.setOpacity(opacity);
  });

  ipcMain.on('pin:collapse', (event, collapsed) => {
    const win = pinFromEvent(event);
    if (!win || win.isDestroyed()) return;
    const state = pinState.get(win) || {};
    if (collapsed) {
      if (state.collapsed) return;
      state.savedBounds = win.getBounds();
      state.collapsed = true;
      pinState.set(win, state);
      const b = state.savedBounds;
      // 收成一条细窄条，仍可见可点回
      win.setBounds({ x: b.x, y: b.y, width: Math.max(72, Math.min(b.width, 120)), height: 26 });
      win.setOpacity(0.85);
    } else {
      if (!state.collapsed) return;
      state.collapsed = false;
      pinState.set(win, state);
      if (state.savedBounds) win.setBounds(state.savedBounds);
      win.setOpacity(1);
    }
  });

  ipcMain.on('pin:bounds', (event) => {
    const win = pinFromEvent(event);
    event.returnValue = win && !win.isDestroyed() ? win.getBounds() : null;
  });

  ipcMain.on('pin:close', (event) => {
    const win = pinFromEvent(event);
    if (win && !win.isDestroyed()) win.close();
  });

  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:maximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle('window:close', () => mainWindow?.hide());
  ipcMain.handle('window:is-maximized', () => Boolean(mainWindow?.isMaximized()));
  ipcMain.handle('window:hide', () => mainWindow?.hide());

  ipcMain.handle('quick:hide', () => hideQuickPanel());
  ipcMain.handle('quick:show', () => { showQuickPanel(); return { ok: true }; });
  ipcMain.handle('quick:toggle', () => { toggleQuickPanel(); return { ok: true }; });
  ipcMain.handle('quick:open-main', (_event, page) => { hideQuickPanel(); showMain(page || 'shelf'); return { ok: true }; });
  ipcMain.handle('quick:capture', () => beginScreenCapture('quick'));
  ipcMain.handle('quick:show-main', (_event, page) => { hideQuickPanel(); showMain(page); return { ok: true }; });

  /* ---- 浮引岛（文件中转） ---- */
  ipcMain.handle('island:get-state', () => islandState());
  ipcMain.handle('island:toggle', () => toggleIsland());
  ipcMain.handle('island:add-paths', async (_event, paths) => addIslandPaths(paths));
  ipcMain.handle('island:remove-item', async (_event, id) => {
    const current = store.getIsland();
    const next = islandModel.removeShelfItem(current.items, String(id || ''));
    if (next.length === current.items.length) return { ...islandState(), ok: false, error: '暂存条目不存在' };
    await store.updateIsland({ items: next });
    // 空岛只留细条：没有内容时展开成一张空卡片没有意义
    if (!next.length) setIslandExpanded(false);
    broadcastIsland();
    return islandState();
  });
  ipcMain.handle('island:clear', async () => {
    await store.updateIsland({ items: [] });
    setIslandExpanded(false);
    broadcastIsland();
    return islandState();
  });
  ipcMain.handle('island:set-policy', async (_event, policy) => {
    await store.updateIsland({ policy: policy === 'move' ? 'move' : 'copy' });
    broadcastIsland();
    return islandState();
  });
  ipcMain.handle('island:set-expanded', (_event, expanded) => setIslandExpanded(Boolean(expanded)));
  ipcMain.handle('island:open-item', async (_event, id) => openIslandItem(id));
  ipcMain.handle('island:reveal-item', (_event, id) => revealIslandItem(id));
  ipcMain.handle('island:start-drag', (_event, id) => startIslandDrag(id));

  ipcMain.handle('app:info', () => ({
    name: APP_NAME,
    version: app.getVersion(),
    userData: userRoot(),
    dataPath: dataPath(),
    shortcuts: { quick: 'Ctrl+Alt+Space', capture: 'Ctrl+Shift+A' },
    runtime: 'Electron prototype'
  }));
  ipcMain.handle('app:open-data-dir', () => shell.openPath(userRoot()));

  ipcMain.handle('capture:start', (_event, options) => beginScreenCapture('main', options || {}));
  ipcMain.handle('capture:get-data', () => capturePayload);
  ipcMain.handle('capture:cancel', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy();
    return { ok: true };
  });
  ipcMain.handle('capture:finish', async (_event, payload) => {
    try {
      const result = await completeCapture(payload?.dataUrl, payload?.action || 'copy');
      if (result.ok && payload?.action !== 'ocr' && overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy();
      return result;
    } catch (error) {
      return { ok: false, error: error.message || '截图处理失败' };
    }
  });

  ipcMain.handle('content:list', (_event, options) => {
    const items = store.listItems(options || {});
    // 图片条目若缺缩略图（旧数据或生成失败），按需补齐，避免列表出现空白卡
    for (const item of items) {
      if (item.kind === 'image' && !item.thumbnail && item.filePath) {
        const thumbnail = thumbnailFor(item.filePath);
        if (thumbnail) item.thumbnail = thumbnail;
      }
    }
    return items;
  });
  ipcMain.handle('content:get', (_event, id) => store.getItem(String(id || '')));
  ipcMain.handle('content:add-text', async (_event, payload) => {
    const value = String(payload?.text || '').trim();
    if (!value) return { ok: false, error: '文字为空' };
    const item = store.addItem({
      kind: classifyText(value),
      title: payload?.title || value.slice(0, 42),
      text: value,
      source: { type: payload?.source || 'user', acquisitionMethod: 'manual', confidence: 'certain' }
    });
    await store.save();
    broadcast('content:changed', { itemId: item.id });
    return { ok: true, item };
  });
  ipcMain.handle('content:remove', async (_event, id) => {
    const item = store.removeItem(String(id || ''));
    await store.save();
    broadcast('content:changed');
    return { ok: Boolean(item) };
  });
  ipcMain.handle('content:toggle-pin', async (_event, id) => {
    const item = store.getItem(String(id || ''));
    if (!item) return { ok: false };
    item.pinned = !item.pinned;
    await store.save();
    broadcast('content:changed');
    return { ok: true, pinned: item.pinned };
  });

  /**
   * 打开某条内容的来源原图。
   * 识别结果（kind=text, meta.originItemId）指向它由哪张图片生成；
   * 图片本身没有 originItemId，直接开自己。
   */
  ipcMain.handle('content:open-original', async (_event, id) => {
    const item = store.getItem(String(id || ''));
    if (!item) return { ok: false, error: '内容不存在或已被清理' };
    const sourceId = item.meta?.originItemId || '';
    const source = sourceId ? store.getItem(sourceId) : item;
    const target = source || item;
    if (!target.filePath) return { ok: false, error: '这条内容没有来源图片' };
    if (!fs.existsSync(target.filePath)) return { ok: false, error: '原图文件已被移动或删除' };
    // 优先交给系统默认看图程序；失败再退到资源管理器定位
    const error = await shell.openPath(target.filePath);
    if (error) {
      shell.showItemInFolder(target.filePath);
      return { ok: true, fallback: true, message: '无法用默认程序打开，已在资源管理器中定位' };
    }
    return { ok: true };
  });

  ipcMain.handle('actions:list', (_event, itemId) => {
    const item = store.getItem(String(itemId || ''));
    return actions.listForItem(item).map((id) => {
      const action = actions.actions.get(id) || {};
      return { id, label: action.label || id, hint: action.hint || '' };
    });
  });
  ipcMain.handle('actions:run', async (_event, payload) => actions.execute(String(payload?.itemId || ''), String(payload?.actionId || '')));

  ipcMain.handle('recipes:list', (_event, kind) => listRecipes(kind ? String(kind) : undefined));
  ipcMain.handle('recipes:run', async (_event, payload) => {
    const itemId = String(payload?.itemId || '');
    const recipeId = String(payload?.recipeId || '');
    const item = store.getItem(itemId);
    if (!item) return { ok: false, error: '内容不存在或已被清理', steps: [] };
    const recipe = getRecipe(recipeId);
    if (!recipe) return { ok: false, error: '配方不存在', steps: [] };
    if (!recipe.accepts.includes(item.kind)) {
      return { ok: false, error: `「${recipe.title}」不接受${item.kind}类型的内容`, steps: [] };
    }
    const result = await runRecipe(
      { execute: (id, actionId) => actions.execute(id, actionId) },
      itemId,
      recipeId,
      { commit: Boolean(payload?.commit) }
    );
    broadcast('content:changed');
    broadcast('executions:changed');
    return result;
  });

  ipcMain.handle('search:query', async (_event, query) => {
    const value = String(query || '').trim();
    const candidates = [];
    for (const command of COMMANDS) candidates.push(command);
    // 应用搜索：开始菜单快捷方式（开发方案 5.1，不做全盘索引）
    try {
      for (const app of await appIndex.candidates()) candidates.push(app);
    } catch {
      // 索引不可用时不影响命令与内容搜索
    }
    for (const item of store.listItems({ limit: 200 })) {
      candidates.push({
        id: item.id,
        kind: 'content',
        title: item.title,
        subtitle: item.text ? item.text.slice(0, 80) : (item.filePath || ''),
        keywords: item.source?.appName || '',
        itemId: item.id
      });
    }
    for (const task of store.listTasks({})) {
      candidates.push({ id: task.id, kind: 'task', title: task.title, subtitle: `${task.itemIds.length} 项内容`, taskId: task.id });
    }
    return searchCandidates(value, candidates, { limit: 40 });
  });

  ipcMain.handle('quick:open-app', async (_event, filePath) => {
    const target = String(filePath || '');
    // 只允许打开开始菜单里的快捷方式，避免任意路径执行
    if (!target || !/\.(lnk|url)$/i.test(target)) return { ok: false, error: '不是可启动的快捷方式' };
    try {
      const error = await shell.openPath(target);
      if (error) return { ok: false, error };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || '启动失败' };
    }
  });

  /* ---- 38 键动作面板 ---- */
  ipcMain.handle('panel:state', () => ({
    ...keyLayout(appIndexReady),
    tools: TOOLBOX_TOOLS
  }));
  ipcMain.handle('panel:run', async (_event, actionId) => {
    const id = String(actionId || '');
    if (!PANEL_ACTIONS[id]) return { ok: false, error: '未知动作' };
    if (!PANEL_ACTIONS[id].implemented) return { ok: false, error: `「${PANEL_ACTIONS[id].label}」尚未实现` };
    try {
      const result = await runPanelAction(id);
      if (result?.openPage) { hideQuickPanel(); showMain(result.openPage); }
      if (result?.closePanel) hideQuickPanel();
      return result;
    } catch (error) {
      return { ok: false, error: error.message || '动作执行失败' };
    }
  });

  /* ---- 应用面板：开始菜单应用目录 ---- */
  ipcMain.handle('apps:list', async () => {
    let shortcuts = [];
    try {
      shortcuts = await appIndex.ensure();
    } catch {
      shortcuts = [];
    }
    // 只返回名称与路径，保证首帧快；图标走 apps:icons 按需取
    return shortcuts.map((entry) => ({ name: entry.name, filePath: entry.filePath }));
  });
  ipcMain.handle('apps:icons', async (_event, filePaths) => {
    const list = Array.isArray(filePaths) ? filePaths.slice(0, 64) : [];
    const icons = {};
    await Promise.all(list.map(async (filePath) => {
      const target = String(filePath || '');
      if (!target) return;
      icons[target] = await appIconFor(target);
    }));
    return icons;
  });

  /* ---- 快捷键：全局键位 + 按住型侦测 ---- */
  ipcMain.handle('shortcuts:get', () => {
    const snapshot = shortcutManager ? shortcutManager.snapshot() : { bindings: {}, status: {} };
    const momentary = momentaryStatus();
    return {
      bindings: { ...snapshot.bindings, momentary: momentary.accelerator },
      status: { ...snapshot.status, momentary }
    };
  });

  ipcMain.handle('shortcuts:set', async (_event, payload) => {
    if (!shortcutManager) return { ok: false, error: '快捷键尚未初始化' };
    const name = String(payload?.name || '');
    const accelerator = String(payload?.accelerator || '').trim();

    // 按住型唤起不走 globalShortcut：它由常驻 PowerShell 助手侦测按下/松开
    if (name === 'momentary') {
      const validation = validateMomentaryAccelerator(accelerator);
      if (!validation.ok) return { ok: false, error: validation.error };
      const conflict = momentaryConflict(accelerator, shortcutManager.snapshot().bindings);
      if (conflict) return { ok: false, error: conflict };
      const previous = store.getSettings().shortcutMomentary;
      await store.updateSettings({ shortcutMomentary: accelerator });
      const started = await setupMomentaryProbe();
      if (!started.ok) {
        // 新键位起不来就回滚，不能让设置页显示成功但实际不工作
        await store.updateSettings({
          shortcutMomentary: previous === undefined ? DEFAULT_MOMENTARY_BINDINGS.momentary : previous
        });
        await setupMomentaryProbe();
        return { ok: false, error: `按住型侦测启动失败：${started.error || '未知原因'}` };
      }
      return { ok: true, status: momentaryStatus() };
    }

    if (!SHORTCUT_SETTING_KEYS[name]) return { ok: false, error: '未知的快捷键名称' };
    // 与按住型唤起撞组合会互相抢键：两边都是全局监听，必须提前拒绝
    const momentaryCurrent = momentaryAccelerator();
    if (momentaryCurrent && normalizeAccelerator(momentaryCurrent) === normalizeAccelerator(accelerator)) {
      return { ok: false, error: '与「按住型唤起」的快捷键重复' };
    }
    const result = shortcutManager.rebind(name, accelerator);
    if (!result.ok) return { ok: false, error: result.error, status: result.status };
    await store.updateSettings({ [SHORTCUT_SETTING_KEYS[name]]: accelerator });
    return { ok: true, status: result.status };
  });

  // 恢复出厂默认（对应原产品 KeyboardShortcutRecorderController.restoreDefault）
  ipcMain.handle('shortcuts:restore-default', async (_event, payload) => {
    if (!shortcutManager) return { ok: false, error: '快捷键尚未初始化' };
    const name = payload?.name ? String(payload.name) : '';
    if (name && name !== 'momentary' && !SHORTCUT_SETTING_KEYS[name]) {
      return { ok: false, error: '未知的快捷键名称' };
    }
    if (name === 'momentary') {
      await store.updateSettings({ shortcutMomentary: DEFAULT_MOMENTARY_BINDINGS.momentary });
      const started = await setupMomentaryProbe();
      if (!started.ok) return { ok: false, error: started.error || '按住型侦测启动失败' };
      return { ok: true, restored: ['momentary'], status: momentaryStatus() };
    }
    const result = shortcutManager.restoreDefault(name || undefined);
    if (!result.ok) return { ok: false, error: result.error, status: result.status };
    const patch = {};
    const bindings = shortcutManager.snapshot().bindings;
    for (const restored of result.restored) {
      const key = SHORTCUT_SETTING_KEYS[restored];
      if (key) patch[key] = bindings[restored];
    }
    // 无参 = 恢复全部：按住型唤起也要回到出厂键
    if (!name) patch.shortcutMomentary = DEFAULT_MOMENTARY_BINDINGS.momentary;
    if (Object.keys(patch).length) await store.updateSettings(patch);
    if (!name) {
      await setupMomentaryProbe();
      result.restored.push('momentary');
    }
    return { ok: true, status: { ...result.status, momentary: momentaryStatus() }, restored: result.restored };
  });

  // 清除绑定（对应原产品 clearShortcut）：解绑后不再响应，但保留条目
  ipcMain.handle('shortcuts:clear', async (_event, payload) => {
    if (!shortcutManager) return { ok: false, error: '快捷键尚未初始化' };
    const name = String(payload?.name || '');
    if (name === 'momentary') {
      await store.updateSettings({ shortcutMomentary: '' });
      await setupMomentaryProbe();
      return { ok: true, status: momentaryStatus() };
    }
    if (!SHORTCUT_SETTING_KEYS[name]) return { ok: false, error: '未知的快捷键名称' };
    const result = shortcutManager.clear(name);
    if (!result.ok) return { ok: false, error: result.error, status: result.status };
    await store.updateSettings({ [SHORTCUT_SETTING_KEYS[name]]: '' });
    return { ok: true, status: result.status };
  });

  ipcMain.handle('return:target', () => returnTarget);

  ipcMain.handle('return:commit', async (_event, payload) => {
    const item = store.getItem(String(payload?.itemId || ''));
    if (!item) return { ok: false, error: '内容不存在或已被清理' };
    const intent = payload?.intent === 'copy-only' ? 'copy-only' : 'return-and-paste';
    // tryReturnToTarget 内部已负责复制；这里不再重复调用 output.copy，
    // 否则会写两次剪贴板并污染回环账本。
    const decision = await tryReturnToTarget(item, intent);
    if (decision.copyFailed) {
      // 复制失败是真正的失败：给渲染层 ok:false，才能显示错误而不是成功提示
      return { ok: false, error: decision.message || '复制失败', ...decision };
    }
    return { ok: true, copied: true, ...decision };
  });

  ipcMain.handle('ocr:recognize-item', async (_event, itemId) => {
    const result = await actions.execute(String(itemId || ''), 'ocr.local');
    return result;
  });

  ipcMain.handle('tasks:list', (_event, options) => store.listTasks(options || {}));
  ipcMain.handle('tasks:create', async (_event, title) => {
    const task = store.createTask(String(title || '临时收集').trim().slice(0, 120) || '临时收集');
    await store.save();
    broadcast('tasks:changed');
    return { ok: true, task };
  });
  ipcMain.handle('tasks:rename', async (_event, payload) => {
    const task = store.updateTask(String(payload?.id || ''), { title: payload?.title });
    await store.save();
    broadcast('tasks:changed');
    return { ok: Boolean(task), task };
  });
  ipcMain.handle('tasks:delete', async (_event, id) => {
    const task = store.deleteTask(String(id || ''));
    await store.save();
    broadcast('tasks:changed');
    return { ok: Boolean(task) };
  });
  ipcMain.handle('tasks:add-item', async (_event, payload) => {
    const task = store.addItemToTask(String(payload?.taskId || ''), String(payload?.itemId || ''));
    await store.save();
    broadcast('tasks:changed');
    return { ok: Boolean(task), task };
  });
  ipcMain.handle('tasks:remove-item', async (_event, payload) => {
    const task = store.removeItemFromTask(String(payload?.taskId || ''), String(payload?.itemId || ''));
    await store.save();
    broadcast('tasks:changed');
    return { ok: Boolean(task), task };
  });
  ipcMain.handle('tasks:copy-text', async (_event, taskId) => {
    const task = store.getTask(String(taskId || ''));
    if (!task) return { ok: false, error: '任务不存在' };
    const text = task.itemIds.map((id) => store.getItem(id)).filter(Boolean).map((item) => item.text || item.filePath || item.title).join('\n\n');
    if (!text.trim()) return { ok: false, error: '任务里没有可复制的文字' };
    await writeClipboardText(text);
    return { ok: true, text };
  });
  ipcMain.handle('tasks:export', async (_event, taskId) => {
    const task = store.getTask(String(taskId || ''));
    if (!task) return { ok: false, error: '任务不存在' };
    const parent = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow : null;
    const result = await dialog.showSaveDialog(parent, {
      title: '导出任务匣',
      defaultPath: path.join(app.getPath('documents'), `随序任务-${task.title.replace(/[\\/:*?"<>|]/g, '_')}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const items = task.itemIds.map((id) => store.getItem(id)).filter(Boolean);
    const lines = [`# ${task.title}`, '', `导出时间：${new Date().toLocaleString('zh-CN')}`, ''];
    for (const item of items) {
      lines.push(`## ${item.title}`, '');
      if (item.text) lines.push(item.text, '');
      if (item.filePath) lines.push(`文件：${item.filePath}`, '');
      if (item.kind === 'image' && item.filePath) lines.push(`![${item.title}](${pathToFileURL(item.filePath).href})`, '');
    }
    await fsp.writeFile(result.filePath, lines.join('\n'), 'utf8');
    return { ok: true, filePath: result.filePath };
  });

  ipcMain.handle('executions:list', (_event, limit) => store.listExecutions(limit));

  /**
   * 处理轨迹里失败记录的重试：用同一条输入内容再执行一次原动作。
   * 只允许 failed 状态，且输入内容必须还在（被清理了就如实说，不假装重试）。
   */
  ipcMain.handle('executions:retry', async (_event, executionId) => {
    const id = String(executionId || '');
    const execution = store.data.executions.find((entry) => entry.id === id);
    if (!execution) return { ok: false, error: '记录不存在或已被清理' };
    if (execution.status !== 'failed') return { ok: false, error: '只有失败的记录可以重试' };
    const inputId = execution.inputIds[0];
    if (!inputId) return { ok: false, error: '这条记录没有可重试的输入内容' };
    if (!store.getItem(inputId)) return { ok: false, error: '输入内容已被清理，无法重试' };
    const result = await actions.execute(inputId, execution.actionId);
    broadcast('executions:changed');
    broadcast('content:changed');
    return result;
  });

  ipcMain.handle('settings:get', () => store.getSettings());
  ipcMain.handle('settings:update', async (_event, patch) => {
    const settings = await store.updateSettings(patch || {});
    // 保留期/上限变小后要立刻生效，不能等下一次复制才清理
    if (patch && (patch.retentionDays !== undefined || patch.maxItems !== undefined)) {
      store.prune();
      await store.save();
      broadcast('content:changed');
    }
    broadcast('settings:changed', settings);
    return { ok: true, settings };
  });

  // 清空剪贴板来源的内容（保留固定项与任务内引用）
  ipcMain.handle('content:clear-clipboard', async () => {
    const items = store.data.items.filter((item) => item.source?.type === 'clipboard' && !item.pinned);
    for (const item of items) {
      store.removeItem(item.id);
      if (item.kind === 'image' && item.filePath) await fsp.rm(item.filePath, { force: true }).catch(() => {});
    }
    await store.save();
    broadcast('content:changed');
    return { ok: true, removed: items.length };
  });

}

function createTray() {
  const trayImage = nativeImage.createFromPath(assetPath('suira-icon.png')).resize({ width: 32, height: 32 });
  tray = new Tray(trayImage);
  tray.setToolTip(`${APP_NAME} · 顺手接住，让工作继续。`);
  const menu = Menu.buildFromTemplate([
    { label: '随手面板  Ctrl+Alt+Space', click: showQuickPanel },
    { label: '浮引岛（显示/隐藏）', click: () => toggleIsland() },
    { type: 'separator' },
    { label: '任务匣', click: () => showMain('shelf') },
    { label: '内容库', click: () => showMain('library') },
    { label: '处理轨迹', click: () => showMain('trail') },
    { label: '设置', click: () => showMain('settings') },
    { type: 'separator' },
    { label: '开始截图  Ctrl+Shift+A', click: () => beginScreenCapture('tray') },
    { type: 'separator' },
    { label: '退出随序', click: () => { isQuitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', showQuickPanel);
}

function registerShortcuts() {
  shortcutManager = new ShortcutManager({
    globalShortcut,
    handlers: {
      quick: toggleQuickPanel,
      capture: () => beginScreenCapture('shortcut'),
      panelCycle: cyclePanelMode,
      pinnedToggle: togglePinnedVisibility,
      legacy: toggleQuickPanel
    },
    bindings: shortcutBindings(),
    onChange: (status) => {
      // 把注册结果同步给设置页，让用户看到哪个键被占用
      broadcast('shortcuts:changed', status);
    }
  });
  const status = shortcutManager.registerAll();
  for (const [name, entry] of Object.entries(status)) {
    if (!entry.ok && !entry.optional) {
      console.warn(`快捷键 ${name} (${entry.accelerator}) 注册失败：${entry.error}`);
    }
  }
  // 清除过的绑定要能在重启后保持「未绑定」：设置里存的是空串，
  // 而空串不会被注册，这里把状态补回 cleared，设置页才不会显示成空白。
  const settings = store ? store.getSettings() : {};
  for (const [name, key] of Object.entries(SHORTCUT_SETTING_KEYS)) {
    if (settings[key] === '' && !shortcutManager.bindings[name]) {
      shortcutManager.status[name] = { ok: true, accelerator: '', error: '', cleared: true };
    }
  }
  return shortcutManager.status;
}

async function initialize() {
  await ensureDirs();

  // 数据密钥：首次启动生成并用 DPAPI 保护后落盘（第 8 节）
  keyVault = new KeyVault();
  const keyResult = keyVault.loadOrCreate(keyPath());
  if (!keyResult.ok) {
    console.warn('内容加密不可用，将以明文保存：', keyResult.error);
  }

  store = new SuiraStore(dataPath(), {
    codec: keyVault.isReady() ? {
      isReady: () => keyVault.isReady(),
      encode: (item) => encryptItem(keyVault.key, item),
      decode: (item) => decryptItem(keyVault.key, item),
      // 任务只加密标题，内容关系保持明文
      encodeTask: (task) => ({ ...task, title: task.title ? encryptText(keyVault.key, task.title, `${task.id}:title`) : '' }),
      decodeTask: (task) => {
        if (task.title && typeof task.title === 'object' && task.title.__enc) {
          try { return { ...task, title: decryptText(keyVault.key, task.title, `${task.id}:title`) }; }
          catch { return { ...task, title: '' }; }
        }
        return task;
      }
    } : null
  });
  await migrateLegacyHistory();
  // 按保留策略启动清理一次：过期内容不该等到下一次复制才消失
  store.prune();
  await store.save();
  ocr = new OcrService({
    langPath: assetPath('tessdata'),
    cachePath: tessdataCacheDir(),
    logger: (message) => {
      if (message?.status === 'recognizing text') broadcast('ocr:progress', { progress: message.progress, status: message.status });
    }
  });
  actions = createActionRegistry({
    store,
    ocr,
    clipboard: {
      writeText: writeClipboardText,
      writeImage: writeClipboardImage
    },
    shell,
    nativeImage,
    openPath: (target) => shell.openPath(target),
    pinImage: (filePath, width, height) => createPinWindow(pathToFileURL(filePath).href, { width, height }),
    broadcast,
    assetPath,
    capturesDir,
    makeId
  });
  registerIpc();
  createMainWindow();
  createQuickWindow();
  createTray();
  registerShortcuts();
  // 浮引岛是常驻入口：启动即显示收起态，用 showInactive 不抢焦点。
  // 用户可在工具箱里点「浮引岛」显示/收起。
  showIsland();
  // 按住型侦测失败不阻塞启动：设置页会显示原因，普通快捷键照常可用
  momentaryReady = setupMomentaryProbe().catch((error) => {
    momentaryError = error && error.message ? error.message : String(error);
    console.warn('按住型唤起初始化失败:', momentaryError);
    return { ok: false, error: momentaryError };
  });
  // 剪贴板监听失败时不能只写日志：剪贴板历史会完全失效，用户必须知道
  clipboardWatcherReady = startClipboardWatcher().catch((error) => {
    clipboardWatcherError = error && error.message ? error.message : String(error);
    console.warn('剪贴板监听启动失败:', clipboardWatcherError);
    const message = `剪贴板监听未启动：${clipboardWatcherError || '未知错误'}`;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:toast', { message, type: 'error' });
    }
    if (tray) tray.setToolTip(`${APP_NAME} · 剪贴板监听未启动`);
  });
}

app.whenReady().then(initialize).then(async () => {
  // --diag：启动自检。把环境、窗口、快捷键、能力可用性写成一份报告，
  // 便于在没有开发者工具的情况下定位真机问题。见 docs/REAL-MACHINE-CHECKLIST.md
  if (process.argv.includes('--diag')) {
    // 剪贴板监听是异步启动的：不等它完成，报告会把「正在启动」误报成「未运行」。
    // 这类误报会直接误导排查，必须等。
    try { await clipboardWatcherReady; } catch { /* 错误已记录在 clipboardWatcherError */ }
    try { await momentaryReady; } catch { /* 错误已记录在 momentaryError */ }
    try {
      const report = await collectDiagnostics();
      const target = path.join(app.getPath('userData'), 'diag-report.txt');
      fs.writeFileSync(target, report, 'utf8');
      console.log(report);
      console.log('\n报告已写入: ' + target);
    } catch (error) {
      console.error('自检失败:', error && error.stack ? error.stack : error);
    }
  }
}).catch((error) => {
  console.error('随序启动失败:', error);
  dialog.showErrorBox('随序启动失败', error.stack || error.message || String(error));
  app.quit();
});

/**
 * 收集真机诊断信息。
 * 只读：不改设置、不动用户数据，只报告当前状态。
 */
async function collectDiagnostics() {
  const lines = [];
  const add = (label, value) => lines.push(String(label).padEnd(28) + String(value));
  const section = (title) => { lines.push(''); lines.push('== ' + title + ' =='); };

  section('环境');
  add('应用版本', app.getVersion());
  add('Electron', process.versions.electron || '-');
  add('Chrome', process.versions.chrome || '-');
  add('Node', process.versions.node || '-');
  add('平台', `${process.platform} ${process.arch}`);
  add('系统版本', `${os.release()}`);
  add('数据目录', app.getPath('userData'));
  add('数据目录可写', (() => {
    try {
      const probe = path.join(app.getPath('userData'), '.write-probe');
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      return '是';
    } catch (error) { return '否 — ' + error.message; }
  })());
  add('启动方式', process.argv.includes('--diag') ? '含 --diag' : '普通');

  section('窗口');
  const island = islandWindow && !islandWindow.isDestroyed() ? islandWindow : null;
  for (const [name, win] of [['主窗口', mainWindow], ['面板', quickWindow], ['浮引岛', island]]) {
    if (!win || win.isDestroyed()) { add(name, '未创建'); continue; }
    const [w, h] = win.getSize();
    add(`${name} 尺寸`, `${w}×${h}`);
    add(`${name} 可见`, win.isVisible() ? '是' : '否');
  }

  section('快捷键');
  const snap = shortcutManager ? shortcutManager.snapshot() : { bindings: {}, status: {} };
  for (const [name, accelerator] of Object.entries(snap.bindings)) {
    const entry = snap.status[name] || {};
    const state = !accelerator ? '未绑定' : (entry.ok ? '已注册' : '注册失败：' + (entry.error || '未知'));
    add(name, `${accelerator || '—'} ${state}`);
  }
  if (!shortcutManager) add('管理器', '未初始化');
  const momentaryInfo = momentaryStatus();
  add('按住型唤起', !momentaryInfo.accelerator
    ? '未绑定'
    : `${momentaryInfo.accelerator} ${momentaryInfo.watching ? '侦测中' : '未运行'}`);

  section('浮引岛');
  const islandInfo = islandState();
  add('可见', islandInfo.visible ? '是' : '否');
  add('暂存条目', `${islandInfo.items.length} / ${islandInfo.maxItems}`);
  add('拖入策略', islandInfo.policy === 'move' ? '移动' : '复制');

  section('能力');
  add('屏幕数量', String(screen.getAllDisplays().length));
  screen.getAllDisplays().forEach((d, i) => {
    add(`  显示器 ${i + 1}`, `${d.size.width}×${d.size.height} @${d.scaleFactor}x`);
  });
  add('OCR 引擎', ocr ? '已创建' : '未创建');
  add('剪贴板监听', clipboardTimer ? '运行中' : ('未运行' + (clipboardWatcherError ? '：' + clipboardWatcherError : '')));
  add('剪贴板采集范围', '文本 / 文件引用 / 图片');
  add('托盘', tray ? '已创建' : '未创建');
  const mainWindowState = store ? store.getWindowState() : null;
  add('窗口状态记忆', mainWindowState
    ? `${mainWindowState.width}×${mainWindowState.height}${mainWindowState.maximized ? ' · 最大化' : ''}`
    : '未记录');
  // 剪贴板读取能力单独测一次：监听没起来时，要能区分是「定时器没设」
  // 还是「根本读不到剪贴板」，否则无法定位
  try {
    const raw = await clipboard.readText();
    const text = String(raw || '');
    add('剪贴板可读', `是（当前文本长度 ${text.length}）`);
  } catch (error) {
    add('剪贴板可读', '否 — ' + error.message);
  }

  section('最近内容');
  try {
    const items = store ? store.listItems({ limit: 3 }) : [];
    add('内容条数（前 3 条）', String(items.length));
    items.forEach((item, i) => {
      add(`  #${i + 1}`, `${item.kind} / ${String(item.title || '').slice(0, 24)}`);
    });
  } catch (error) {
    add('读取失败', error.message);
  }

  section('设置');
  try {
    const settings = store ? store.getSettings() : {};
    for (const key of Object.keys(settings).sort()) {
      add(key, JSON.stringify(settings[key]));
    }
  } catch (error) {
    add('读取失败', error.message);
  }

  return lines.join('\n');
}

app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', () => {
  clearInterval(clipboardTimer);
  shortcutManager?.dispose();
  globalShortcut.unregisterAll();
  ocr?.terminate().catch(() => {});
  foregroundProbe.dispose();
  try { momentaryProbe?.stop().catch(() => {}); } catch {}
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && isQuitting) app.quit(); });

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
