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
  nativeImage, ClipboardItem, globalShortcut, Tray, Menu, shell, dialog, nativeTheme, systemPreferences, session
} = electron;
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const crypto = require('node:crypto');
const { createWindowMaterial, shouldEnableBlur,supportsSystemGlass } = require('./lib/window-material');
const SYSTEM_GLASS=supportsSystemGlass();
const windowMaterial = createWindowMaterial();
const {installFramelessMaximize}=require('./lib/frameless-maximize');
const {UpdateController}=require('./lib/update-controller');
let updateController;
let updateInstallPrepared=false;
function updates(){
  if(updateController)return updateController;
  updateController=new UpdateController({version:app.getVersion(),supported:()=>app.isPackaged&&process.platform==='win32'&&process.arch==='x64'&&!process.env.PORTABLE_EXECUTABLE_DIR,
    factory:()=>require('electron-updater').autoUpdater,
    beforeInstall:async()=>{
      if(captureBusy||longCapture)throw Error('请先完成截图');
      const windows=[mainWindow,...workspaceWindows.values(),...noteWindows.values()].filter(win=>win&&!win.isDestroyed());
      await Promise.all(windows.map(win=>win.webContents.executeJavaScript('Promise.resolve(window.WorkspaceUI?.flush()).then(()=>window.NoteUI?.flush())')));
      await store.save();for(const win of workspaceWindows.values())win.__allowClose=true;isQuitting=true;updateInstallPrepared=true;
    }});
  updateController.on('state',state=>{if(state.phase==='error'&&updateInstallPrepared){isQuitting=false;updateInstallPrepared=false;for(const win of workspaceWindows.values())win.__allowClose=false;}broadcast('updates:state',state);});return updateController;
}
const { pathToFileURL, fileURLToPath } = require('node:url');
const { SuiraStore, makeId } = require('./lib/store');
const { OcrService } = require('./lib/ocr');
const translateLib = require('./lib/translate');
const voiceInput = require('./lib/voice-input');
const { createActionRegistry, mergeLines, cleanText } = require('./lib/actions');
const { RECIPES, getRecipe, listRecipes, runRecipe } = require('./lib/recipes');
const { searchCandidates, searchAppCandidates, COMMANDS } = require('./lib/search');
const { readWithRetry, shouldExcludeCapture, summarizeLargeText, sameBytes } = require('./lib/clipboard-guard');
const { captureTarget, validateTarget, decideCommit, normalizeHwnd, ClipboardWriteLedger } = require('./lib/return-target');
const { AppIndex } = require('./lib/app-index');
const { createAppIconLoader, extractResourceBatch } = require('./lib/app-icons');
const { createIconDiskCache } = require('./lib/icon-disk-cache');
const { captureNative, nativeDesktopTiles } = require('./lib/native-capture');
const { ForegroundProbe } = require('./lib/foreground-probe');
const { DEFAULT_BINDINGS, DEFAULT_MOMENTARY_BINDINGS, ShortcutManager, normalizeAccelerator, validateMomentaryAccelerator, momentaryConflict } = require('./lib/shortcuts');
const { KeyVault, encryptItem, decryptItem, encryptText, decryptText } = require('./lib/crypto-store');
const { unionBounds, maxScaleFactor, tileLayout, sanitizeWindowBounds, QUICK_PANEL_SIZE, quickPanelBounds,
  clipboardShelfBounds, roundedWindowShape } = require('./lib/display-geometry');
const { InputInjector } = require('./lib/input-injector');
const {clipboardTarget,currentPasteTarget}=require('./lib/clipboard-session');
const { keyLayout, TOOLBOX_TOOLS, PANEL_ACTIONS, DEFAULT_KEY_BINDINGS, KEY_ROWS, normalizeKey, implementedPanelActions } = require('./lib/keybindings');
const { createPanelActions } = require('./lib/panel-actions');
// 38 键面板的自定义键位绑定：清洗与换位是纯模型，主进程只负责落盘与执行
const { assignPanelBinding, movePanelBinding, effectiveBinding } = require('./lib/panel-bindings');
const { PANEL_SHORTCUT_ACTIONS, actionKey, acceleratorKey, alignPanelShortcuts, shortcutPatchForPanel, clearShortcutPanelAction, migrateLegacyPanelBindings, panelGlobalBindings, panelShortcutName, panelAccelerator } = require('./lib/panel-shortcuts');
// 第三批：按住型唤起用常驻 PowerShell 助手拿「松开」事件；浮引岛纯模型负责暂存语义
const { KeyWatchProbe, ensureNativeHost } = require('./lib/key-watch');
const islandModel = require('./lib/island-model');
// 第三批第 4 项：速记的纯模型（标题推导 / 容量 / 位置校验）
const notesLib = require('./lib/notes');
const imageEditor = require('./lib/image-editor');
const {shortcutAdapter,shortcutReport}=require('./lib/shortcut-policy');
const {markdownPaths,createMarkdownFiles}=require('./lib/markdown-files');
const { EDGES: WINDOW_EDGES, resizeBounds, fitWorkArea, clipToWorkAreas } = require('./lib/window-resize');
const {LongCaptureSession,sameSource:sameLongCaptureSource}=require('./lib/long-capture-session');
const {RegionCapture}=require('./lib/region-capture');
const {longCaptureTarget,settledFirstFrame,sourceProbePoint}=require('./lib/long-capture-start');
const { contains, receiverBounds, receiverDisplay, edgeWindowShape, IslandPointerProbe } = require('./lib/island-wake');
// 核心框架：剪贴板捕获（文件引用/去重比较）的纯模型，便于单元测试
const clipboardCapture = require('./lib/clipboard-capture');
const { execFileSync, execFile } = require('node:child_process');

const APP_NAME = '随序 SUIRA';
const APP_ID = 'com.suira.desktop';
const MAIN_WIDTH = 1180;
const MAIN_HEIGHT = 820;
// 38 键面板需要装下 12/10/9/7 四行键位 + 搜索条 + 底部提示。
// 尺寸含 12px 阴影留白：卡片本体 720×620，窗口多留一圈，阴影才不会被裁掉变平。
const QUICK_WIDTH = QUICK_PANEL_SIZE.width;
const QUICK_HEIGHT = QUICK_PANEL_SIZE.height;
// 仅隐藏/贴边托盘两态。空接收区紧凑显示，有文件才展开；窗口不留阴影底板。
const ISLAND_SHEET = { width: 520, height: 148 };
const ISLAND_DROP = { width: 440, height: 108 };
const ISLAND_UI_REVISION = 'edge-shelf-20261023.2';
const ISLAND_MAX_ITEMS = 24;
// 岛在没有任何交互后回到休眠的等待时间（拖入后要让用户看清结果）
const ISLAND_REST_MS = 2600;
// 面板布局轮换的顺序（对应原产品 onPanelCycleLayout）
const PANEL_MODES = ['actions', 'apps', 'toolbox'];
const TEXT_HISTORY_LIMIT = 2000;
// 应用图标缓存：开始菜单路径 → data URL。图标是静态资源，随进程生命周期复用。
let appIconLoader = null;
let appIconHost = null;
let captureHost = null;
let captureHostError = '';
let longCapture = null;
let longCaptureStarting = false;
let longPickerWindow = null;
let longPickerPayload = null;
let longPickerEscape = false;
let longPickerRevision = 0;
let longPickerWorker = null;

let store = null;
let themeController = null;
ipcMain.on('theme:initial', event => { event.returnValue = themeController?.snapshot() || null; });
ipcMain.handle('theme:state', () => themeController?.snapshot() || null);
let ocr = null;
let actions = null;
let mainWindow = null;
let quickWindow = null;
let voiceWindow = null;
let voiceSessionTarget = null;
let voiceRequestController = null;
let voicePermissionSession = null;
let panelBindingPickerOpen = false;
let overlayWindow = null;
let tray = null;
let capturePayload = null;
let clipboardTimer = null;
let clipboardWatcherError = '';
let clipboardWatcherReady = Promise.resolve();
let lastClipboardText = '';
let lastClipboardImageHash = '';
// 上一次轮询拿到的图片原始字节：用来做"真的变了吗"的字节比较，
// 避免剪贴板里放着一张 4K 截图时每 550ms 解码一次 + PNG 编码一次
let lastClipboardImageRaw = null;
let lastClipboardImageKey = '';
let lastClipboardImageType = '';
let lastClipboardFilesKey = '';
let clipboardWriteGuard = '';
let isQuitting = false;
let quickReady = false;
let captureBusy = false;
let regionCaptureRevision = 0;
let captureGeneration = 0;
let lastClipboardSequence = null;
let mainWasVisible = false;
const pinWindows = new Set();
const editorWindows = new Map();
// 浮引岛（文件中转）与按住型唤起的状态
let islandWindow = null;
// 岛的三态：'sleep' 隐形热区 / 'rail' 胶囊 / 'sheet' 暂存卡片
let islandMode = 'sleep';
let islandRestTimer = null;
let islandDisplayId = null;
let islandPointerProbe = null;
let islandWakeError = '';
let islandWakeReady = Promise.resolve();
// 最近 10 次引用变更；只在本次运行中保留，不复制或移动原文件。
const islandUndoStack = [];
// 剪贴板历史条（屏幕底部浮层）
let clipboardBarWindow = null;
let quickShowRevision = 0;
let clipboardShowRevision = 0;
let clipboardShowPending = false;
let momentaryProbe = null;
let momentaryOpened = false;
/** 最近一次按住型侦测启动失败的原因；成功时清空，设置页据此显示真实原因。 */
let momentaryError = '';
let shortcutCaptureActive = false;
let shortcutCaptureTimer = null;
/** 按住型侦测的启动 Promise：自检要等它落定，否则会把「正在启动」误报成「未运行」。 */
let momentaryReady = Promise.resolve({ ok: true });
let panelModeIndex = 0;

// 放回子系统：唤起前的目标窗口，以及剪贴板自写回环账本
let returnTarget = null;
let quickInvocationTarget = null;
let clipboardSessionTarget = null;
const clipboardLedger = new ClipboardWriteLedger();
const appIndex = new AppIndex();
const foregroundProbe = new ForegroundProbe({ onWarn: (...args) => console.warn(...args) });
const panelNative=require('./lib/panel-native').createPanelNative();
const inputInjector = new InputInjector();
let shortcutManager = null;
let keyVault = null;

/** 前台助手闲置多久后释放（毫秒）。有人用时每次查询都会把它续期。 */
const FOREGROUND_IDLE_STOP_MS = 5 * 60 * 1000;
let foregroundIdleTimer = null;

/** 每次查询后重置闲置计时：到点就把常驻助手还回去。 */
function scheduleForegroundStop() {
  if (foregroundIdleTimer) clearTimeout(foregroundIdleTimer);
  // 原生助手只占少量内存，保持就绪，避免闲置后的首次唤起重新启动。
  if (foregroundProbe.nativeHost) return;
  foregroundIdleTimer = setTimeout(() => {
    foregroundIdleTimer = null;
    if (foregroundProbe.nativeHost) return;
    try { foregroundProbe.stop(); } catch { /* 进程可能已退出 */ }
    console.log('[助手] 前台窗口查询助手闲置 5 分钟，已释放');
  }, FOREGROUND_IDLE_STOP_MS);
  if (foregroundIdleTimer.unref) foregroundIdleTimer.unref();
}

/** 查询前台窗口（负责拉起助手 + 续期闲置计时）。 */
async function queryForeground() {
  try {
    return await foregroundProbe.query();
  } catch {
    return null;
  } finally {
    scheduleForegroundStop();
  }
}

/** 置前目标窗口后等待焦点稳定的时间（毫秒）。太短按键会落到随序自己身上。 */
const RETURN_FOCUS_DELAY = 120;

/**
 * 换肤：settings.theme 是唯一开关。
 * 主进程只写 nativeTheme.themeSource，三个浮层靠 CSS 的 prefers-color-scheme 自动跟随，
 * 渲染层不需要任何换肤 JS，也不会出现"某些窗口还停在旧主题"的中间态。
 */
/* ---------- 翻译引擎（图片取词翻译） ---------- */

const TRANSLATE_KEY_AAD = 'settings:translateApiKey';
const VOICE_KEY_AAD = 'settings:voiceApiKey';

/** 密钥明文只在主进程内存里存在，落盘一律走数据密钥加密。 */
function encryptSecret(plaintext, aad = TRANSLATE_KEY_AAD) {
  if (!keyVault || !keyVault.isReady()) return null;
  try { return encryptText(keyVault.key, String(plaintext), aad); } catch { return null; }
}

function decryptSecret(envelope, aad = TRANSLATE_KEY_AAD) {
  if (!envelope || !keyVault || !keyVault.isReady()) return '';
  try { return decryptText(keyVault.key, envelope, aad); } catch { return ''; }
}

/** 渲染层能看到的设置：密钥换成布尔标记，密文不出主进程。 */
function publicSettings() {
  const settings = store ? store.getSettings() : {};
  const { translateApiKeyEnc, voiceApiKeyEnc, ...rest } = settings;
  const voiceUrl = settings.voiceBaseUrl || settings.translateBaseUrl || '';
  const voiceCanReuseTranslateKey = voiceInput.canReuseApiKey({ targetUrl: voiceUrl, sourceUrl: settings.translateBaseUrl,
    sourceProvider: settings.translateProvider, hasSourceKey: Boolean(translateApiKeyEnc) });
  return { ...rest, translateApiKeySet: Boolean(translateApiKeyEnc), voiceApiKeySet: Boolean(voiceApiKeyEnc), voiceCanReuseTranslateKey };
}

function voiceConfig() {
  const settings = store ? store.getSettings() : {};
  const format = settings.voiceProvider === 'openai' ? 'openai' : 'deepseek';
  const baseUrl = String(settings.voiceBaseUrl || settings.translateBaseUrl || (format === 'deepseek' ? 'https://api.deepseek.com/v1' : '')).trim();
  let apiKey = decryptSecret(settings.voiceApiKeyEnc, VOICE_KEY_AAD);
  if (!apiKey && settings.translateProvider === 'openai' && settings.translateApiKeyEnc) {
    const share = voiceInput.canReuseApiKey({ targetUrl: baseUrl, sourceUrl: settings.translateBaseUrl,
      sourceProvider: settings.translateProvider, hasSourceKey: true });
    if (share) apiKey = decryptSecret(settings.translateApiKeyEnc);
  }
  return { format, baseUrl,
    model: String(settings.voiceModel || '').trim(), apiKey };
}

function voiceStatus() {
  const settings = store ? store.getSettings() : {};
  const config = voiceConfig();
  const hasVoiceKey = Boolean(settings.voiceApiKeyEnc);
  const canReuseTranslateKey = voiceInput.canReuseApiKey({ targetUrl: config.baseUrl, sourceUrl: settings.translateBaseUrl,
    sourceProvider: settings.translateProvider, hasSourceKey: Boolean(settings.translateApiKeyEnc) });
  const endpoint = voiceInput.buildEndpoint(config.baseUrl, config.format);
  return { ok: true, provider: config.format, model: config.model,
    hasVoiceKey, canReuseTranslateKey, configured: Boolean(config.apiKey && endpoint.ok && (config.format !== 'openai' || config.model)) };
}

/** 当前生效的翻译配置（含解密后的密钥）。 */
function translateConfig(overrides = {}) {
  const settings = store ? store.getSettings() : {};
  const config = translateLib.readConfig(settings, decryptSecret(settings.translateApiKeyEnc));
  return { ...config, ...overrides };
}

/** 翻译一次：给面板、动作层、设置页的「测试」共用同一条路径。 */
async function runTranslation(text, overrides = {}) {
  const config=translateConfig(overrides);
  const requestedModel=config.model;
  if(config.provider==='openai'&&/\s/.test(config.model)){
    const result=await translateLib.listModels(config,electron.net.fetch);
    if(result.ok)config.model=translateLib.matchModel(config.model,result.models);
  }
  const result=await translateLib.translateText({ config, text,fetchImpl:electron.net.fetch });
  if(result.ok&&config.model!==requestedModel&&translateConfig().model===requestedModel){await store.updateSettings({translateModel:config.model});broadcast('settings:changed',publicSettings());}
  return result;
}

/** 当前翻译能力概述：设置页与面板据此显示「未配置」而不是假装可用。 */
function translateStatus() {
  const settings = store ? store.getSettings() : {};
  const hasKey = Boolean(settings.translateApiKeyEnc);
  const config = translateConfig();
  return {
    ok: true,
    provider: config.provider,
    providerLabel: translateLib.providerLabel(config.provider),
    configured: translateLib.isConfigured(settings, hasKey),
    hasKey,
    source: config.source,
    target: config.target,
    sourceLabel: translateLib.langLabel(config.source),
    targetLabel: translateLib.langLabel(config.target),
    // 面板的目标语言下拉直接用这份目录，渲染层不重复维护语言表
    targets: translateLib.TARGET_LANGS.map((code) => ({ code, label: translateLib.langLabel(code) }))
  };
}

function applyTheme() {
  if (!nativeTheme) return 'light';
  const theme = store ? store.getSettings().theme : 'light';
  const source = ['system', 'light', 'dark'].includes(theme) ? theme : 'light';
  try { nativeTheme.themeSource = source; } catch { /* 旧版 Electron 无此能力时保持系统默认 */ }
  return source;
}

/** 从设置读取当前键位，回落到出厂默认。清除绑定（空串）的项不注册。 */
function shortcutBindings() {
  const settings = store ? store.getSettings() : {};
  const defaultVoiceKey = store ? actionKey(store.getPanelBindings(), 'voice') : 'U';
  const map = {
    quick: settings.shortcutQuick ?? DEFAULT_BINDINGS.quick,
    capture: settings.shortcutCapture ?? DEFAULT_BINDINGS.capture,
    longCapture: settings.shortcutLongCapture ?? (actionKey(store.getPanelBindings(),'long-capture') ? panelAccelerator(actionKey(store.getPanelBindings(),'long-capture')) : ''),
    panelCycle: settings.shortcutPanelCycle ?? DEFAULT_BINDINGS.panelCycle,
    pinnedToggle: settings.shortcutPinnedToggle ?? DEFAULT_BINDINGS.pinnedToggle,
    clipboardBar: settings.shortcutClipboardBar ?? DEFAULT_BINDINGS.clipboardBar
  };
  // Old profiles derived Alt+letter from the panel only when that chord was free.
  const inheritedVoice = defaultVoiceKey ? panelAccelerator(defaultVoiceKey) : '';
  const taken = [...Object.values(map), settings.shortcutMomentary].some(value => value
    && normalizeAccelerator(value) === normalizeAccelerator(inheritedVoice));
  return { ...map, voice: settings.shortcutVoice ?? (taken ? '' : inheritedVoice) };
}

/** 快捷键名 → 设置字段。设置页与主进程共用同一张映射。 */
const SHORTCUT_SETTING_KEYS = {
  quick: 'shortcutQuick',
  capture: 'shortcutCapture',
  longCapture: 'shortcutLongCapture',
  panelCycle: 'shortcutPanelCycle',
  pinnedToggle: 'shortcutPinnedToggle',
  clipboardBar: 'shortcutClipboardBar',
  voice: 'shortcutVoice'
};

// 拖动、设置页改键和恢复默认都走同一条串行事务，避免两套映射再次分叉。
let panelConfigurationQueue = Promise.resolve();
function queuePanelConfiguration(task) {
  const next = panelConfigurationQueue.catch(() => {}).then(task);
  panelConfigurationQueue = next.catch(() => {});
  return next;
}

const PINNED_TOGGLE_VOICE_ALTERNATE = 'Alt+F8';
function voicePinConflict(voice, pinnedToggle) {
  return normalizeAccelerator(voice) === 'alt+h' && normalizeAccelerator(pinnedToggle) === 'alt+h';
}

async function commitPanelConfiguration(bindings, requested = {}, options = {}) {
  const before = store.getPanelBindings();
  const snapshot = shortcutManager.snapshot();
  const dedicated = { ...snapshot.bindings, ...shortcutPatchForPanel(before, bindings, snapshot.bindings), ...requested };
  const movedPinnedToggle = dedicated.voice !== snapshot.bindings.voice && voicePinConflict(dedicated.voice, dedicated.pinnedToggle);
  if (movedPinnedToggle) dedicated.pinnedToggle = PINNED_TOGGLE_VOICE_ALTERNATE;
  const desired = panelGlobalBindings(bindings, dedicated);
  const patch=Object.fromEntries(Object.entries(desired).filter(([name,value])=>value!==(snapshot.bindings[name]||'')));
  const momentary = options.momentary ?? momentaryAccelerator();
  if (momentary && Object.values(patch).some(value => value && normalizeAccelerator(value) === normalizeAccelerator(momentary))) {
    return { ok: false, error: '与「按住型唤起」的快捷键重复' };
  }
  const result = shortcutManager.rebindMany(patch, { notify: false });
  if (!result.ok) return result;
  const settingsPatch = Object.fromEntries(Object.entries(patch).filter(([name])=>SHORTCUT_SETTING_KEYS[name]).map(([name, value]) => [SHORTCUT_SETTING_KEYS[name], value]));
  if (options.momentary !== undefined) settingsPatch.shortcutMomentary = options.momentary;
  try { await store.setPanelConfiguration(bindings, settingsPatch); }
  catch (error) {
    shortcutManager.restoreSnapshot(snapshot, { notify: false });
    publishShortcutStatus();
    return { ok: false, error: error.message || '键位保存失败，已保留原绑定' };
  }
  broadcast('panel:changed');
  publishShortcutStatus();
  return { ok: true, status: shortcutManager.snapshot().status,
    ...(movedPinnedToggle ? { message: 'Alt+H 已绑定语音输入，钉图显隐移至 Alt+F8' } : {}) };
}

function panelState() {
  const bindings = store.getPanelBindings();
  const layout = keyLayout(appIndexReady, bindings);
  const dedicatedKeys = new Map(Object.entries(PANEL_SHORTCUT_ACTIONS).map(([name, action]) => [actionKey(bindings, action), name]));
  const shortcuts = shortcutManager?.snapshot().bindings || shortcutBindings();
  for (const key of layout.keys) {
    if(key.state==='bound'||key.state==='custom') {
      const derived = panelShortcutName(key.key);
      const name = shortcuts[derived] ? derived : dedicatedKeys.get(key.key) || derived;
      key.accelerator = shortcuts[name] || '';
      const entry = shortcutManager?.status[name];
      key.shortcutStatus = entry ? shortcutStatus({ [name]: entry })[name] : null;
    }
  }
  return { ...layout, actions: implementedPanelActions(), tools: TOOLBOX_TOOLS };
}

/** 按住型唤起当前键位（清除绑定后为空串）。 */
function momentaryAccelerator() {
  const settings = store ? store.getSettings() : {};
  if (settings.shortcutMomentary === undefined) return DEFAULT_MOMENTARY_BINDINGS.momentary;
  return String(settings.shortcutMomentary || '');
}

/**
 * 旧版出厂键位 → 两键键位的一次性迁移。
 * 每个键位可以列多个旧值：三键旧默认、以及本机探测发现被占用后换掉的中间默认值，
 * 只要「仍等于其中某个旧值」就迁移到当前默认；用户自己改过键的不动。
 * 按住型唤起不再默认启用（旧默认是四键组合，与「只用两键」的约定冲突），清空处理。
 */
async function migrateShortcutDefaults() {
  const settings = store.getSettings();
  const migrations = {
    shortcutQuick: { legacy: ['CommandOrControl+Alt+Space', 'Alt+Q'], next: DEFAULT_BINDINGS.quick },
    shortcutCapture: { legacy: ['CommandOrControl+Shift+A', 'Alt+A'], next: DEFAULT_BINDINGS.capture },
    shortcutPanelCycle: { legacy: ['CommandOrControl+Alt+Q'], next: DEFAULT_BINDINGS.panelCycle },
    shortcutPinnedToggle: { legacy: ['CommandOrControl+Alt+H'], next: DEFAULT_BINDINGS.pinnedToggle },
    shortcutClipboardBar: { legacy: ['CommandOrControl+Alt+V'], next: DEFAULT_BINDINGS.clipboardBar },
    shortcutMomentary: { legacy: ['CommandOrControl+Alt+Shift+Space'], next: DEFAULT_MOMENTARY_BINDINGS.momentary }
  };
  const patch = {};
  for (const [key, { legacy, next }] of Object.entries(migrations)) {
    if (settings[key] === undefined) continue;
    const current = normalizeAccelerator(settings[key]);
    if (legacy.some((value) => normalizeAccelerator(value) === current)) {
      patch[key] = next;
    }
  }
  if (Object.keys(patch).length) await store.updateSettings(patch);
}

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

/* ---------- 后台常驻内存：Chromium 启动参数 ----------
 * 这些开关必须在 app ready 之前设置。它们不改变功能，只是不再为用不到的
 * Chromium 子系统付出常驻进程/线程成本：
 * - disable-breakpad：本机没有崩溃上报服务，Electron 仍会拉起
 *   crashpad-handler 子进程（debug.log 里一串 registration_protocol_win
 *   失败就是它），关掉省一个进程；应用级错误仍走 dialog/日志。
 * - disable-background-networking / component-update / domain-reliability：
 *   随序的所有网络请求都是用户显式触发的（翻译），不需要后台预取、组件热更
 *   与域可靠性上报，关掉能少一批后台定时器。
 * - no-pings：不做超链接 ping 上报。
 */
app.commandLine.appendSwitch('disable-breakpad');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('no-pings');

/*
 * 数据目录的回落。
 *
 * 之前 `initialize()` 第一行就是 ensureDirs()，而它直接 mkdir 不接异常：
 * 数据目录不可写时（受管控会话、AppData 被策略禁止写入等）整个应用起不来，
 * 用户只看到「程序打不开」加一段 stack。现在按候选顺序挑一个可写的目录，
 * 并把「落在非默认位置」这件事记录下来，界面与自检都能看到。
 */
let dataRoot = '';
let dataRootNotice = '';

function isWritableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-probe');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/** 挑一个可写的数据目录；默认位置不可写时依次回落。全部不可写返回 null。 */
function resolveDataRoot() {
  const candidates = [
    { dir: app.getPath('userData'), label: '' },
    { dir: path.join(app.getPath('temp'), APP_NAME), label: '系统临时目录' },
    { dir: path.join(path.dirname(app.getPath('exe')), 'data'), label: '程序同级 data 目录' }
  ];
  for (const candidate of candidates) {
    if (!candidate.dir) continue;
    if (isWritableDir(candidate.dir)) {
      dataRootNotice = candidate.label;
      return candidate.dir;
    }
  }
  return null;
}

const userRoot = () => dataRoot || app.getPath('userData');
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

/**
 * 建数据子目录。失败不再让异常冒到顶层退出，而是返回原因，
 * 由调用方决定「继续用降级目录」还是「给出一句人话后退出」。
 */
async function ensureDirs() {
  try {
    await Promise.all([
      fsp.mkdir(capturesDir(), { recursive: true }),
      fsp.mkdir(clipboardImageDir(), { recursive: true }),
      fsp.mkdir(tessdataCacheDir(), { recursive: true })
    ]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : String(error) };
  }
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

/**
 * 缩略图统一入口：列表/卡片只显示两三百像素宽，没必要把 720px 的图
 * 以 data URL 形式常驻在 store 内存里。
 *
 * 按 320px 生成 PNG（不用 JPEG：截图里可能有透明背景，JPEG 会把透明区变黑）。
 * 单条体积约降到原来的 1/4–1/5；2000 条上限时这是几十 MB 的差别。
 */
const THUMBNAIL_WIDTH = 320;
function thumbnailDataUrl(image) {
  const size = image.getSize();
  const width = Math.min(THUMBNAIL_WIDTH, Math.max(64, size.width));
  const resized = image.resize({ width, quality: 'good' });
  return `data:image/png;base64,${resized.toPNG().toString('base64')}`;
}

function thumbnailFor(filePath) {
  try {
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) return '';
    return thumbnailDataUrl(image);
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
  const thumbnail = thumbnailDataUrl(image);
  const item = store.addItem({
    id,
    kind: 'image',
    title: title || (source.type === 'screenshot' ? '屏幕截图' : '剪贴板图片'),
    filePath,
    thumbnail,
    source,
    meta: { hash, width: size.width, height: size.height, ...(!existingFilePath ? { byteSize: png.length } : {}) }
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
 *
 * 只在助手「已经在跑」时才查询：为了一条来源标注把 80MB 级别的 PowerShell
 * helper 拉起来并常驻，得不偿失（面板唤起时本来就会拉起它，那时才顺便记录来源）。
 */
async function clipboardSourceSnapshot(method = 'clipboard-poll') {
  const base = { type: 'clipboard', acquisitionMethod: method, confidence: 'inferred' };
  if (!foregroundProbe.isReady()) return base;
  try {
    const snapshot = await queryForeground();
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
/** 只读 5 个 64 字节片段做指纹：剪贴板没变时就不必把整张 4K PNG 读进 JS 堆。 */
async function imageBlobFingerprint(blob) {
  const size = blob.size;
  if (!size) return '';
  const positions = [0, Math.floor(size / 4), Math.floor(size / 2), Math.floor(size * 3 / 4), Math.max(0, size - 64)];
  const chunks = [];
  for (const start of positions) {
    chunks.push(Buffer.from(await blob.slice(start, Math.min(size, start + 64)).arrayBuffer()).toString('base64'));
  }
  return `${size}:${chunks.join('|')}`;
}

async function readClipboardSnapshot() {
  const empty = { text: '', files: [], imageBuffer: null, imageType: '', imageKey: '' };
  const result = await readWithRetry(async () => {
    const items = await clipboard.read();
    if (!Array.isArray(items) || !items.length) return empty;
    const snapshot = { text: '', files: [], imageBuffer: null, imageType: '', imageKey: '' };

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
        const imageKey = await imageBlobFingerprint(blob);
        snapshot.imageKey = imageKey;
        if (imageKey && imageKey === lastClipboardImageKey && lastClipboardImageRaw) {
          // 指纹一致：直接沿用上一次的原始字节，不再分配一整块 PNG Buffer
          snapshot.imageBuffer = lastClipboardImageRaw;
          snapshot.imageType = lastClipboardImageType;
        } else {
          const buffer = Buffer.from(await blob.arrayBuffer());
          // 这里只留原始字节，不在轮询里解码：解码 4K 截图要几十毫秒
          if (buffer.length) {
            snapshot.imageBuffer = buffer;
            snapshot.imageType = type;
          }
        }
      } catch { /* 图片读取失败时忽略这一项 */ }
    }
    // 兜底：read() 没暴露出图片项、但系统明确说有图片格式时，退回 readImage()。
    // 宁可多解一次图，也不能因为读法差异漏掉用户的截图。
    if (!snapshot.imageBuffer) {
      try {
        const hasImageFormat = clipboard.availableFormats().some((format) => String(format).startsWith('image/'));
        if (hasImageFormat) {
          const fallback = clipboard.readImage();
          if (fallback && !fallback.isEmpty()) {
            snapshot.imageBuffer = fallback.toPNG();
            snapshot.imageType = 'image/png';
          }
        }
      } catch { /* 读不到就当作没有图片 */ }
    }
    return snapshot;
  }, (value) => value == null);

  if (result.error) throw result.error;
  return result.value || empty;
}

async function writeClipboardText(text) {
  const value = String(text || '');
  clipboardWriteGuard = value;
  await clipboard.writeText(value);
  // 记录序号与内容，供自写回环判定（第 7 节）
  clipboardLedger.record(value);
  lastClipboardText = value;
  lastClipboardImageRaw = null;
  lastClipboardImageHash = '';
  lastClipboardImageKey = '';
  lastClipboardImageType = '';
  lastClipboardFilesKey = '';
  clipboardWriteGuard = '';
}

async function writeClipboardImage(image) {
  const png = image.toPNG();
  clipboardWriteGuard = await readClipboardText();
  const recording = store.getSettings().recordClipboard;
  lastClipboardImageHash = recording ? hashBuffer(png) : '';
  // 自己的写入也记进字节缓存，下一趟轮询就不会再解一次
  lastClipboardImageRaw = recording ? png : null;
  lastClipboardImageKey = ''; // 让下一趟重新取一次指纹，不与上一张图混淆
  lastClipboardImageType = recording ? 'image/png' : '';
  await clipboard.write([new ClipboardItem({ 'image/png': png })]);
  lastClipboardText = await readClipboardText();
  lastClipboardFilesKey = '';
  clipboardLedger.record(lastClipboardText);
  clipboardWriteGuard = '';
}

let clipboardPollBusy = false;
let selectionPollingPaused=false,panelSelection=null;
const selectionReader=require('./lib/selection').createSelectionReader({
  clipboard,ClipboardItem,ledger:clipboardLedger,sequence:()=>inputInjector.clipboardSequence(),sendCopy:target=>inputInjector.sendCopy(target),
  isCurrent:target=>{const current=panelNative.foreground();return Boolean(current&&String(current.hwnd)===String(target.hwnd)&&Number(current.pid)===Number(target.pid)&&Number(current.processStartedAt)===Number(target.processStartedAt));},
  pause:()=>{selectionPollingPaused=true;++captureGeneration;return ()=>{++captureGeneration;selectionPollingPaused=false;};}
});
async function pollClipboard() {
  if (!store.getSettings().recordClipboard || clipboardPollBusy || clipboardSeeding || selectionPollingPaused || clipboardLedger.transientDepth) return;
  const sequence = inputInjector.clipboardSequence();
  if (sequence !== null && sequence === lastClipboardSequence) return;
  clipboardPollBusy = true;
  try {
    const generation = ++captureGeneration;
    const snapshot = await readClipboardSnapshot();
    if (generation !== captureGeneration||selectionPollingPaused||clipboardLedger.transientDepth) return;
    if (sequence !== null && inputInjector.clipboardSequence() !== sequence) return;

    const text = snapshot.text || '';
    const filesKey = snapshot.files.length ? snapshot.files.join('\n').toLowerCase() : '';
    const rawImage = snapshot.imageBuffer;
    // 字节相同 = 图片没变：这一趟不解码、不编码、不算哈希
    // 命中指纹时复用的就是同一个 Buffer 引用，连逐字节比较都不必做
    const imageBytesChanged = Boolean(rawImage) && rawImage !== lastClipboardImageRaw && !sameBytes(lastClipboardImageRaw, rawImage);

    let image = null;
    let imageHash = lastClipboardImageHash;
    if (imageBytesChanged) {
      const decoded = nativeImage.createFromBuffer(rawImage);
      if (!decoded.isEmpty()) {
        image = decoded;
        imageHash = hashBuffer(decoded.toPNG());
      }
    }

    const textChanged = Boolean(text && text !== lastClipboardText);
    const filesChanged = Boolean(filesKey && filesKey !== lastClipboardFilesKey);
    const imageChanged = Boolean(image && imageHash !== lastClipboardImageHash);
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
      await addImageToStore(image, source);
    }

    if (generation !== captureGeneration) return;
    lastClipboardSequence = sequence;
    lastClipboardText = text;
    lastClipboardFilesKey = filesKey;
    // 图片被清空时同步清掉缓存，下次再遇到图片会重新解码
    lastClipboardImageRaw = rawImage || null;
    lastClipboardImageKey = rawImage ? (snapshot.imageKey || '') : '';
    lastClipboardImageType = rawImage ? snapshot.imageType : '';
    lastClipboardImageHash = rawImage ? imageHash : '';
    if (clipboardWriteGuard && text === clipboardWriteGuard) clipboardWriteGuard = '';
  } catch (error) {
    console.warn('剪贴板读取失败:', error.message);
  } finally { clipboardPollBusy = false; }
}

async function startClipboardWatcher() {
  clearInterval(clipboardTimer);
  try {
    if (store.getSettings().recordClipboard) await seedClipboardWatcher();
  } finally {
    clipboardTimer = setInterval(pollClipboard, 550);
  }
  clipboardWatcherError = '';
}

let clipboardSeeding = null;
async function seedClipboardWatcher() {
  const generation = ++captureGeneration;
  const sequence = inputInjector.clipboardSequence();
  const read = readClipboardSnapshot();
  clipboardSeeding = read;
  let initial;
  try { initial = await read; }
  finally { if (clipboardSeeding === read) clipboardSeeding = null; }
  if (generation !== captureGeneration) return;
  if (sequence !== null && inputInjector.clipboardSequence() !== sequence) return;
  lastClipboardSequence = sequence;
  lastClipboardText = initial.text || '';
  lastClipboardFilesKey = initial.files.length ? initial.files.join('\n').toLowerCase() : '';
  lastClipboardImageRaw = initial.imageBuffer || null;
  lastClipboardImageKey = initial.imageKey || '';
  lastClipboardImageType = initial.imageType || '';
  lastClipboardImageHash = initial.imageBuffer ? hashBuffer(nativeImage.createFromBuffer(initial.imageBuffer).toPNG()) : '';
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
}

function positionQuickPanel(win,mode=store?.getSettings().panelPresentation||'window') {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const fullscreen=mode==='fullscreen';
  win.__changingPresentation=true;
  // Electron's thickFrame:false Windows path only changes bounds; its
  // isFullScreen() remains false. Track this borderless launchpad explicitly.
  win.__launchpadFullscreen=fullscreen;
  const next=fullscreen?display.bounds:quickPanelBounds(display.workArea),previous=win.getBounds();
  if(['x','y','width','height'].some(key=>next[key]!==previous[key]))win.setBounds(next);
  win.webContents.send('quick:presentation-changed',{mode:fullscreen?'fullscreen':'window'});
  clearTimeout(win.__presentationTimer);
  win.__presentationTimer=setTimeout(()=>{
    if(win.isDestroyed())return;win.__changingPresentation=false;
    if(win.isVisible()&&!win.isFocused()&&!panelBindingPickerOpen&&!win.webContents.isDevToolsOpened())hideQuickPanel();
  },350);
  clipFloatingSurface(win);
}

function clipFloatingSurface(win) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  if(win.__systemGlass){
    updateWindowMaterial(win);
    win.__glassFrameReady=windowMaterial.prepareSystemGlass(win,{square:win.isMaximized()||win.isFullScreen()||win.__launchpadFullscreen});
    return;
  }
  const bounds=win.getBounds(),{width,height}=bounds;
  let shape=roundedWindowShape(width,height,win.isMaximized()||win.isFullScreen()||win.__launchpadFullscreen?0:(win.__surfaceRadius||24));
  if(win.__desktopWindow){
    const areas=screen.getAllDisplays().map(display=>{
      const a={...display.workArea},b=display.bounds;
      // Keep one DIP clear at reserved shell edges after physical-pixel rounding.
      if(a.x>b.x){a.x++;a.width--;}if(a.y>b.y){a.y++;a.height--;}
      if(a.x+a.width<b.x+b.width)a.width--;
      if(a.y+a.height<b.y+b.height)a.height--;
      return a;
    });
    shape=clipToWorkAreas(shape,bounds,areas);
  }
  try { win.setShape(shape); } catch {}
  if (win.__allowNativeBlur) updateWindowMaterial(win);
}

function updateWindowMaterial(win) {
  const enabled = shouldEnableBlur({ reducedTransparency:nativeTheme.prefersReducedTransparency,
    highContrast:nativeTheme.shouldUseHighContrastColors, fullscreen:win.__launchpadFullscreen,
    material:store?.getSettings().panelMaterial, radius:win.__surfaceRadius || 24,systemGlass:win.__systemGlass });
  win.__nativeBlur = windowMaterial.apply(win, enabled);
}
nativeTheme.on('updated', () => {
  for (const win of BrowserWindow.getAllWindows()) if (win.__allowNativeBlur && !win.isDestroyed()) updateWindowMaterial(win);
});

function prepareFloatingSurface(win, radius = 24, blur = false) {
  if (process.platform !== 'win32') return;
  win.__systemGlass = blur&&SYSTEM_GLASS;
  if(win.__systemGlass){win.contentView.setBackgroundColor('#00000000');for(const view of win.contentView.children){if(view.webContents===win.webContents)view.setBackgroundColor('#00000000');}}
  win.__surfaceRadius = win.__systemGlass?8:radius;
  win.__allowNativeBlur = blur;
  // Native glass uses the DWM frame and corners without setShape. Other
  // transparent tools retain their alpha mask and never receive accent blur.
  win.__surfaceMaterial = win.__systemGlass?'native-glass':'transparent';
  clipFloatingSurface(win);
  if (!win.__surfaceClippingBound) {
    win.__surfaceClippingBound = true;
    if(win.__systemGlass){
      // Windows may retain the old backdrop across Hide/Show. Refresh once
      // before the native reveal, never on focus or in a delayed visible pass.
      for(const method of ['show','showInactive']){
        const reveal=win[method].bind(win);
        win[method]=(...args)=>{windowMaterial.invalidate(win);clipFloatingSurface(win);return reveal(...args);};
      }
    }
    // The HWND does not change on focus/show. Reapplying the accent after show
    // makes DWM briefly composite a different rectangle over the first frame.
    const refresh=()=>clipFloatingSurface(win);
    win.webContents.on('did-finish-load',refresh);
    win.on('always-on-top-changed',refresh);
    for (const event of ['resize', 'restore', 'maximize', 'unmaximize']) {
      win.on(event, () => clipFloatingSurface(win));
    }
  }
}

// Keep document/workbench windows out of translucent taskbars. Wait until a
// native drag ends so moving between monitors is not trapped at the first edge.
function prepareDesktopWindow(win) {
  win.__desktopWindow=true;
  if(process.platform==='win32')installFramelessMaximize(win,screen);
  const minimum=win.getMinimumSize();let nativeMoving=false,adjusting=false,timer;
  const state=()=>{if(!win.isDestroyed())win.webContents.send('window:state',{focused:win.isFocused(),maximized:win.isMaximized()});};
  const fit=async()=>{
    if(win.isDestroyed()||adjusting||nativeMoving||win.isMinimized()||win.isFullScreen())return;
    clipFloatingSurface(win);
    const bounds=win.getBounds(),area=screen.getDisplayMatching(bounds).workArea;
    if(win.isMaximized())return;
    // Two DIP absorb Windows' outward rounding at fractional scale factors.
    const next=fitWorkArea(bounds,area,2);
    adjusting=true;
    try {
      const nextMinimum=[Math.min(minimum[0],area.width),Math.min(minimum[1],area.height)],currentMinimum=win.getMinimumSize();
      if(nextMinimum.some((value,index)=>value!==currentMinimum[index]))win.setMinimumSize(...nextMinimum);
      if(win.__restorePhysicalSize||bounds.width-next.width>1||bounds.height-next.height>1||Math.abs(next.x-bounds.x)>1||Math.abs(next.y-bounds.y)>1){
        // Electron 45 setBounds/setPosition both drift at fractional DPI. A
        // position-only Win32 move keeps the existing physical size untouched.
        if(process.platform==='win32'){
          if(!foregroundProbe.nativeHostReady&&!foregroundProbe.isReady()){schedule();return;}
          if(!foregroundProbe.isReady()&&!await foregroundProbe.start())return;
          if(win.isDestroyed()||nativeMoving)return;
          const latest=win.getBounds(),target=fitWorkArea(latest,screen.getDisplayMatching(latest).workArea,2);
          const physical=screen.dipToScreenRect(win,target);let resize=latest.width-target.width>1||latest.height-target.height>1;
          const savedSize=win.__restorePhysicalSize;
          if(savedSize){
            const display=screen.getDisplayMatching(latest),scale=display.scaleFactor||1,limit=screen.dipToScreenRect(win,display.workArea);
            physical.width=Math.max(1,Math.min(Math.round(savedSize.width*scale/savedSize.scale),limit.width-Math.ceil(4*scale)));
            physical.height=Math.max(1,Math.min(Math.round(savedSize.height*scale/savedSize.scale),limit.height-Math.ceil(4*scale)));
            resize=true;
          }
          await foregroundProbe.placeOwnWindow(win.getNativeWindowHandle().readBigUInt64LE().toString(),physical,resize);
          if(savedSize)win.__restorePhysicalSize=null;
        }else win.setBounds(next);
      }
    } finally {adjusting=false;}
  };
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>fit().catch(error=>console.warn('窗口位置调整失败:',error.message)),60);};
  win.on('will-move',event=>{if(event.defaultPrevented)return;nativeMoving=true;clearTimeout(timer);});
  win.on('moved',()=>{nativeMoving=false;schedule();});
  for(const event of ['move','resize','restore','unmaximize'])win.on(event,schedule);
  win.on('move',()=>clipFloatingSurface(win));
  win.on('show',()=>{schedule();state();});win.on('focus',state);win.on('blur',state);
  win.on('maximize',state);win.on('unmaximize',state);win.webContents.on('did-finish-load',state);
  screen.on('display-metrics-changed',schedule);screen.on('display-removed',schedule);
  win.once('closed',()=>{clearTimeout(timer);screen.removeListener('display-metrics-changed',schedule);screen.removeListener('display-removed',schedule);});
  schedule();
}

function createQuickWindow() {
  quickWindow = new BrowserWindow({
    width: QUICK_WIDTH,
    height: QUICK_HEIGHT,
    show: false,
    frame: false,
    thickFrame: SYSTEM_GLASS,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: SYSTEM_GLASS,
    resizable: SYSTEM_GLASS,
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
      // 面板不需要拼写检查：关掉可以省下一个常驻的拼写服务进程
      spellcheck: false,
      // Hidden preparation must produce a fresh compositor frame before show.
      backgroundThrottling: false
    }
  });
  quickWindow.setAlwaysOnTop(true, 'floating');
  prepareFloatingSurface(quickWindow, 24, true);
  quickWindow.__instantTransitions=panelNative.disableTransitions(quickWindow);
  quickWindow.on('will-resize',event=>event.preventDefault());
  quickWindow.__loaded=quickWindow.loadFile(path.join(__dirname, 'src', 'quickpanel.html'));
  quickWindow.__loaded.catch(error=>console.warn('面板加载失败:',error.message));
  quickWindow.setMenuBarVisibility(false);
  quickWindow.webContents.once('did-finish-load', () => {
    quickReady = true;
    broadcast('content:changed');
    primeQuickFrame(quickWindow);
  });
  quickWindow.on('blur', () => {
    if (!quickWindow || quickWindow.isDestroyed() || panelBindingPickerOpen || quickWindow.webContents.isDevToolsOpened()) return;
    const win=quickWindow;
    setImmediate(()=>{if(quickWindow===win&&!win.isDestroyed()&&!win.isFocused()&&!panelBindingPickerOpen)hideQuickPanel();});
  });
  quickWindow.on('show', () => {
    cancelIdleTeardown(quickWindow);
  });
  quickWindow.on('closed', () => { quickWindow?.__prepareShow?.cancel();quickWindow = null; quickReady = false; });
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
async function rememberReturnTarget(selectionMethod = 'unknown',knownSnapshot) {
  try {
    const snapshot = knownSnapshot !== undefined ? knownSnapshot : await queryForeground();
    // 从动作面板进入剪贴板时，延续面板打开前的输入框。
    if (snapshot && Number(snapshot.pid) !== process.pid) returnTarget = captureTarget(snapshot, { selectionMethod });
    else if (!snapshot) returnTarget = null;
  } catch {
    returnTarget = null;
  }
  return returnTarget;
}

/* ---------- 浮层生命周期：用完一段时间就还内存 ---------- */

/*
 * 隐藏窗口闲置后回收；高频热键入口保留 15 秒，之后释放渲染进程。
 * 截图隐藏时立即释放图像和画布，兼顾再次唤起速度与大图内存占用。
 */
const HOT_WINDOW_IDLE_MS = 15 * 1000;
const MAIN_WINDOW_IDLE_MS = 10 * 1000;

/** 窗口隐藏后开始计时；期间被再次唤起会取消。 */
function scheduleIdleTeardown(win, label, delay = HOT_WINDOW_IDLE_MS) {
  if (!win || win.isDestroyed()) return;
  cancelIdleTeardown(win);
  win.__teardownTimer = setTimeout(async () => {
    win.__teardownTimer = null;
    if (win.isDestroyed() || win.isVisible()) return;
    if (win === mainWindow) {
      try {
        await win.webContents.executeJavaScript('Promise.resolve(window.WorkspaceUI?.flush()).then(()=>window.NoteUI?.flush())');
      } catch (error) {
        console.warn('主窗口草稿未保存，保留窗口:', error.message);
        return;
      }
      if (win.isDestroyed() || win.isVisible() || win.__teardownTimer) return;
    }
    console.log(`[窗口] ${label} 闲置超时，释放渲染进程`);
    win.destroy();
  }, delay);
  if (win.__teardownTimer.unref) win.__teardownTimer.unref();
}

function cancelIdleTeardown(win) {
  if (!win || !win.__teardownTimer) return;
  clearTimeout(win.__teardownTimer);
  win.__teardownTimer = null;
}

let quickFrameRevision=0;
function primeQuickFrame(win){
  if(!win||win.isDestroyed())return Promise.resolve();
  const token=++quickFrameRevision;
  win.__prepareShow?.cancel();
  win.__frameReady=new Promise(resolve=>{
    const timer=setTimeout(()=>{if(win.__prepareShow?.token===token)win.__prepareShow=null;resolve();},2000);
    const finish=()=>{clearTimeout(timer);if(win.__prepareShow?.token===token)win.__prepareShow=null;resolve();};
    win.__prepareShow={token,finish,cancel:finish};
    win.webContents.send('quick:prepare',{token});
  });
  return win.__frameReady;
}
async function showQuickPanel() {
  if (!quickWindow || quickWindow.isDestroyed()) createQuickWindow();
  const win=quickWindow,revision=++quickShowRevision;win.__showRequested=true;
  try {
    cancelIdleTeardown(win);
    // Capture the exact pre-focus process identity without waiting on helper IO.
    let snapshot=panelNative.foreground({ withFocus: true });
    if(!snapshot)snapshot=await Promise.race([queryForeground(),new Promise(resolve=>setTimeout(()=>resolve(null),100))]);
    await rememberReturnTarget('panel',snapshot);quickInvocationTarget=clipboardTarget(snapshot,process.pid);if(quickInvocationTarget&&snapshot?.focusHwnd)quickInvocationTarget.focusHwnd=snapshot.focusHwnd;returnTarget=quickInvocationTarget;panelSelection=null;
    if(store?.getSettings().selectionEnabled&&snapshot&&Number(snapshot.pid)!==process.pid&&foregroundProbe.isReady()){
      const identified=await foregroundProbe.query(snapshot.hwnd);
      if(identified&&revision===quickShowRevision){
        if(store.getSettings().recordClipboard)await pollClipboard();
        panelSelection=await selectionReader.read(identified,store.getSettings());
        if(panelSelection)panelSelection.returnTarget=quickInvocationTarget;
      }
    }
    if(revision!==quickShowRevision||win.isDestroyed())return;
    await win.__loaded;
    await win.__frameReady;
    // Coalesce a hide/toggle queued in the same input turn without a timed fade.
    await new Promise(resolve=>setImmediate(resolve));
    if(revision!==quickShowRevision||win.isDestroyed())return;
    positionQuickPanel(win);win.show();win.focus();
    win.webContents.send('quick:shown');
    win.webContents.send('quick:selection',panelSelection?{...panelSelection,returnTarget:undefined}:null);
  }catch(error){if(!win.isDestroyed())console.warn('面板显示失败:',error.message);}
  finally{if(!win.isDestroyed()&&revision===quickShowRevision)win.__showRequested=false;}
}

function hideQuickPanel() {
  quickShowRevision++;
  if (quickWindow && !quickWindow.isDestroyed()) {
    quickWindow.__showRequested=false;quickWindow.__prepareShow?.cancel();
    quickWindow.hide();
    // Keep the panel warm briefly, then release its renderer with other overlays.
    primeQuickFrame(quickWindow);
    scheduleIdleTeardown(quickWindow, '动作面板', HOT_WINDOW_IDLE_MS);
  }
}

function installVoicePermissionHandlers() {
  const voiceSession = session.fromPartition('suira-voice');
  if (voicePermissionSession === voiceSession) return;
  const isVoiceFrame = (contents, permission, details) => contents === voiceWindow?.webContents
    && permission === 'media' && details.isMainFrame === true;
  voiceSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(isVoiceFrame(contents, permission, details) && details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio');
  });
  voiceSession.setPermissionCheckHandler((contents, permission, _origin, details) => {
    return isVoiceFrame(contents, permission, details) && details.mediaType === 'audio';
  });
  voicePermissionSession = voiceSession;
}

/** Keep dictation beside the active input without activating its overlay. */
async function openVoiceInput({ preview = false } = {}) {
  if (!store) return { ok: false, error: '数据未就绪' };
  if (voiceWindow && !voiceWindow.isDestroyed()) {
    if (!voiceWindow.__stopping && Date.now() - voiceWindow.__openedAt > 450) {
      voiceWindow.__stopping = true;
      voiceWindow.webContents.send('voice:stop');
    }
    return { ok: true };
  }
  const fromPanel = quickWindow?.isFocused();
  const foreground = fromPanel ? quickInvocationTarget : panelNative.foreground({ withFocus: true });
  voiceSessionTarget = preview ? null : captureTarget(foreground, { selectionMethod: 'voice' });
  voiceSessionTarget = voiceSessionTarget && { ...voiceSessionTarget, focusHwnd: foreground?.focusHwnd };
  if (quickWindow?.isVisible()) hideQuickPanel();
  installVoicePermissionHandlers();
  const win = voiceWindow = new BrowserWindow({
    width: 208, height: 48, show: false, frame: false, thickFrame: false, transparent: true,
    focusable: false, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, movable: false, hasShadow: false,
    backgroundColor: '#00000000', title: '随序 · 语音输入',
    webPreferences: {
      preload: path.join(__dirname, 'voice-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      autoplayPolicy: 'no-user-gesture-required', spellcheck: false, partition: 'suira-voice'
    }
  });
  win.__openedAt = Date.now();
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  win.setPosition(Math.round(area.x + (area.width - 208) / 2), area.y + area.height - 72);
  win.setMenuBarVisibility(false);
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => {
    if (voiceWindow === win) {
      voiceRequestController?.abort();
      voiceRequestController = null;
      voiceSessionTarget = null;
      voiceWindow = null;
    }
  });
  try {
    await win.loadFile(path.join(__dirname, 'src', 'voice-input.html'));
    if (!win.isDestroyed()) win.showInactive();
    return { ok: true };
  } catch (error) {
    if (win.isDestroyed()) return { ok: true };
    console.warn('语音窗口加载失败:', error.message);
    win.close();
    return { ok: false, error: '语音窗口加载失败，请重试' };
  }
}

function toggleQuickPanel() {
  if (quickWindow && (quickWindow.__showRequested || (quickWindow.isVisible() && quickWindow.isFocused()))) hideQuickPanel();
  else showQuickPanel();
}

/* ---------- 浮引岛（文件中转） ---------- */

/**
 * 浮引岛的完整状态。渲染层只拿引用与元数据，文件本体不进入渲染进程。
 * @returns {{ok:boolean, items:object[], policy:'copy'|'move', expanded:boolean, mode:string, maxItems:number, visible:boolean}}
 */
function islandState() {
  const snapshot = store ? store.getIsland() : { items: [], policy: 'copy' };
  return {
    ok: true,
    items: snapshot.items,
    policy: snapshot.policy,
    expanded: islandMode === 'sheet',
    mode: islandMode,
    uiRevision: ISLAND_UI_REVISION,
    windowVisible: Boolean(islandWindow && !islandWindow.isDestroyed() && islandWindow.isVisible()),
    maxItems: ISLAND_MAX_ITEMS,
    wake: { ready:islandPointerProbe?.status === 'watching', error:islandWakeError },
    canUndo: islandUndoStack.length > 0,
    // 「可见」的语义变了：休眠态窗口虽然存在，但用户看不到，所以按形态判断
    visible: islandMode !== 'sleep' && Boolean(islandWindow && !islandWindow.isDestroyed() && islandWindow.isVisible())
  };
}

function broadcastIsland() {
  syncIslandFrame();
  broadcast('island:state', islandState());
}

/**
 * 岛窗口边界：当前显示器工作区顶边，顶部平齐，底部原生裁圆角。
 */
function islandBounds(mode = islandMode) {
  const display = screen.getAllDisplays().find(entry => entry.id === islandDisplayId) || screen.getPrimaryDisplay();
  const area = display.workArea;
  if (mode === 'sleep') return receiverBounds(area);
  const size = store?.getIsland().items.length ? ISLAND_SHEET : ISLAND_DROP;
  const width = Math.min(size.width, area.width);
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    // 保留到屏幕顶边的拖放接收走廊，展开不能把指针甩到窗口外。
    y: Math.round(area.y),
    width,
    height: Math.min(size.height, area.height)
  };
}

function syncIslandFrame() {
  const win = islandWindow;
  if (!win || win.isDestroyed()) return;
  const bounds = islandBounds(islandMode);
  win.setBounds(bounds);
  if (process.platform === 'win32') {
    try {
      win.setBackgroundMaterial(islandMode === 'sleep' ? 'none' : 'acrylic');
      win.setShape(islandMode === 'sleep' ? [] : edgeWindowShape(bounds.width, bounds.height));
    } catch (error) { console.warn('[文件暂存] 使用半透明贴边外观:', error.message); }
  }
}

function createIslandWindow() {
  if (islandWindow && !islandWindow.isDestroyed()) return islandWindow;
  islandWindow = new BrowserWindow({
    ...islandBounds(islandMode),
    show: false,
    frame: false,
    thickFrame: false,
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
    // 自动出现不抢焦点；休眠时 hide + 鼠标穿透，拖动靠近后才启用接收。
    focusable: true,
    title: '随序 · 浮引岛',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      // 岛平时只有一块空热区，没必要让渲染层满速跑
      backgroundThrottling: true
    }
  });
  islandWindow.setAlwaysOnTop(true, 'floating');
  islandWindow.setIgnoreMouseEvents(true);
  if (process.platform === 'win32') {
    try { islandWindow.setBackgroundMaterial('none'); } catch {}
  }
  islandWindow.loadFile(path.join(__dirname, 'src', 'island.html'));
  islandWindow.setMenuBarVisibility(false);
  islandWindow.webContents.once('did-finish-load', () => {
    pushIslandMode();
    islandWindow.webContents.send('island:state', islandState());
  });
  // 只处理实际操作后的失焦，忽略材质/形状初始化带来的系统激活变化。
  let islandHadFocus = false;
  islandWindow.on('focus', () => { islandHadFocus = true; });
  islandWindow.on('blur', () => {
    const wasFocused = islandHadFocus;
    islandHadFocus = false;
    if (wasFocused && islandWindow?.isVisible() && islandMode !== 'sleep') setIslandMode('sleep');
  });
  islandWindow.on('closed', () => { islandWindow = null; islandMode = 'sleep'; });
  islandWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeHttpUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  return islandWindow;
}

function pushIslandMode() {
  const win = islandWindow;
  if (!win || win.isDestroyed()) return;
  win.webContents.send('island:mode', islandMode);
  win.webContents.send('island:expanded', islandMode === 'sheet');
}

/** 唤醒岛：休眠 → 胶囊 → 卡片。任何一次交互都会把「回休眠」的计时清零。 */
function setIslandMode(mode) {
  // 彻底取消常驻胶囊。旧版 rail 请求也按隐藏处理。
  const next = mode === 'sheet' ? 'sheet' : 'sleep';
  clearIslandRest();
  const win = islandWindow;
  islandMode = next;
  if (win && !win.isDestroyed()) {
    if (next === 'sleep') { win.hide(); scheduleIdleTeardown(win, '文件中转', HOT_WINDOW_IDLE_MS); }
    else cancelIdleTeardown(win);
    syncIslandFrame();
    win.setIgnoreMouseEvents(next === 'sleep');
    pushIslandMode();
    if (next !== 'sleep' && !win.isVisible()) win.showInactive();
  }
  if (next !== 'sleep') scheduleIslandRest();
  return { ok: true, mode: next, expanded: next === 'sheet' };
}

/** 安排一次「没有交互就回休眠」：拖入文件后要让用户看清结果，不能立刻消失。 */
function scheduleIslandRest(delay = ISLAND_REST_MS) {
  clearIslandRest();
  islandRestTimer = setTimeout(() => {
    islandRestTimer = null;
    if (islandMode === 'sleep') return;
    // showInactive 不产生 blur；是否仍在使用应按实际指针位置判断。
    if (islandWindow && !islandWindow.isDestroyed() && contains(islandWindow.getBounds(), screen.getCursorScreenPoint())) {
      scheduleIslandRest(delay);
      return;
    }
    setIslandMode('sleep');
  }, Math.max(600, delay));
  if (islandRestTimer.unref) islandRestTimer.unref();
}

function clearIslandRest() {
  if (!islandRestTimer) return;
  clearTimeout(islandRestTimer);
  islandRestTimer = null;
}

/** 托盘 / 工具箱入口：醒着就睡下，睡着就展开成卡片。 */
function toggleIsland() {
  if (islandMode === 'sleep') return showIsland();
  return hideIsland();
}

function showIsland() {
  const win = createIslandWindow();
  if (!win || win.isDestroyed()) return { ok: false, error: '浮引岛窗口创建失败' };
  islandDisplayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
  setIslandMode('sheet');
  win.webContents.send('island:state', islandState());
  return { ok: true, visible: true, mode: 'sheet' };
}

function hideIsland() {
  setIslandMode('sleep');
  return { ok: true, visible: false, mode: 'sleep' };
}

/** 兼容旧通道：expanded 只有「展开成卡片 / 收成胶囊」两种含义。 */
function setIslandExpanded(expanded) {
  return setIslandMode(expanded ? 'sheet' : 'sleep');
}

let quickPointerDown=false;
function handleIslandPointer(point) {
  const pressed=point.down&&!quickPointerDown;quickPointerDown=point.down;
  if(pressed&&quickWindow?.isVisible()&&!panelBindingPickerOpen&&!quickWindow.webContents.isDevToolsOpened()){
    // The pointer helper can be DPI-virtualized. Electron supplies the cursor
    // in the same DIP space as BrowserWindow bounds, including mixed-DPI screens.
    const dip=screen.getCursorScreenPoint();
    if(!contains(quickWindow.getBounds(),dip))hideQuickPanel();
  }
  const receiver = receiverDisplay(screen.getAllDisplays(), point);
  if ((!islandWindow || islandWindow.isDestroyed()) && !receiver) return;
  const win = createIslandWindow();
  if (islandMode !== 'sleep') {
    if (point.down && !contains(win.getBounds(), point)) setIslandMode('sleep');
    return;
  }
  if (!receiver) {
    win.setIgnoreMouseEvents(true);
    if (win.isVisible()) { win.hide(); scheduleIdleTeardown(win, '文件中转', HOT_WINDOW_IDLE_MS); }
    return;
  }
  cancelIdleTeardown(win);
  islandDisplayId = receiver.id;
  win.setBounds(islandBounds('sleep'));
  win.setIgnoreMouseEvents(false);
  if (!win.isVisible()) win.showInactive();
}

async function setupIslandPointer() {
  if (process.platform !== 'win32' || isQuitting) return;
  const executable = await ensureNativeHost({ sourcePath:assetPath('island-pointer-host.cs'), targetPath:path.join(userRoot(), 'island-pointer-host-v1.exe') });
  if (isQuitting) return;
  if (!executable) { islandWakeError = '拖动侦测未能启动，可从工具箱或托盘打开文件中转'; return; }
  islandPointerProbe = new IslandPointerProbe({ executable, onPointer:handleIslandPointer, onError:(message) => {
    islandWakeError = message;
    if (islandMode === 'sleep') hideIsland();
    console.warn('[文件中转] 拖动侦测不可用:', message);
  } });
  await islandPointerProbe.start();
}


/** 把路径加入暂存。去重、容量上限由 lib/island-model.js 决定。 */
async function addIslandPaths(paths) {
  if (!store) return { ...islandState(), ok: false, error: '数据层尚未就绪' };
  const incoming = (Array.isArray(paths) ? paths : [paths])
    .filter((value) => typeof value === 'string')
    .filter((value) => islandModel.isShelfablePath(value)).slice(0, 96);
  if (!incoming.length) return { ...islandState(), ok: false, error: '没有可暂存的文件路径' };
  const checked = await Promise.all(incoming.map(async (filePath) => {
    try {
      const stat = await fsp.stat(filePath);
      if (!stat.isFile() && !stat.isDirectory()) return null;
      return { path:filePath, kind:stat.isDirectory() ? 'folder' : islandModel.classifyPath(filePath) };
    } catch { return null; }
  }));
  const readable = checked.filter(Boolean);
  const skipped = incoming.length - readable.length;
  if (!readable.length) return { ...islandState(), ok:false, error:'拖入的文件已不存在或无法读取', skipped };
  const current = store.getIsland();
  // island-model 的入参是条目对象：这里把路径包装成只带 path 的条目，
  // 名称、类型、时间戳都由模型补齐（保持纯函数、便于测试）
  const result = islandModel.addShelfItems(current.items, readable, {
    cap: ISLAND_MAX_ITEMS
  });
  if (!result.added) return { ...islandState(), ok: true, added: 0, dropped: result.dropped };
  await store.updateIsland({ items: result.items });
  broadcastIsland();
  const win = islandWindow;
  if (win && !win.isDestroyed()) {
    setIslandMode('sheet');
    // 让用户看清"接住了什么"，几秒没动作再回休眠，不在屏幕上赖着
    scheduleIslandRest();
  }
  return { ...islandState(), ok: true, added: result.added, dropped: result.dropped, skipped };
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
  if (!found.exists) return { ok:false, error:'文件已被移动或删除' };
  shell.showItemInFolder(found.item.path);
  return { ok: true };
}

/* ---------- 剪贴板历史条（屏幕底部浮层） ---------- */

function clipboardBarBounds() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  return clipboardShelfBounds(display.workArea);
}

function createClipboardBarWindow() {
  if (clipboardBarWindow && !clipboardBarWindow.isDestroyed()) return clipboardBarWindow;
  clipboardBarWindow = new BrowserWindow({
    ...clipboardBarBounds(),
    show: false,
    frame: false,
    thickFrame: SYSTEM_GLASS,
    roundedCorners: true,
    hasShadow: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    focusable: true,
    title: '随序 · 剪贴板',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });
  prepareFloatingSurface(clipboardBarWindow, 24, true);
  clipboardBarWindow.setAlwaysOnTop(true, 'floating');
  clipboardBarWindow.on('will-resize',event=>event.preventDefault());
  clipboardBarWindow.__loaded = clipboardBarWindow.loadFile(path.join(__dirname, 'src', 'clipboardbar.html'));
  clipboardBarWindow.__loaded.catch(error => console.warn('剪贴板条加载失败:', error.message));
  clipboardBarWindow.setMenuBarVisibility(false);
  // 失焦即收起：底部条不该长期挡在屏幕上
  clipboardBarWindow.on('blur', () => {
    if (!clipboardBarWindow.__savingImage) hideClipboardBar();
  });
  clipboardBarWindow.on('closed', () => { clipboardBarWindow = null; });
  clipboardBarWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeHttpUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  return clipboardBarWindow;
}

/** 每次唤出历史条，都记录这一次正在使用的窗口。 */
async function showClipboardBar() {
  const revision = ++clipboardShowRevision;
  clipboardShowPending = true;
  const win = createClipboardBarWindow();
  if (!win || win.isDestroyed()) return { ok: false, error: '剪贴板历史条创建失败' };
  cancelIdleTeardown(win);
  const [current] = await Promise.all([queryForeground(), win.__loaded]);
  if (revision !== clipboardShowRevision || win.isDestroyed()) return { ok: true, visible: false };
  clipboardSessionTarget=clipboardTarget(current,process.pid,quickWindow&&!quickWindow.isDestroyed()&&quickWindow.isVisible()?quickInvocationTarget:null);
  clipboardShowPending = false;
  hideQuickPanel();
  win.setBounds(clipboardBarBounds());
  win.show();
  win.focus();
  win.webContents.send('clipboard-bar:shown');
  return { ok: true, visible: true };
}

function hideClipboardBar() {
  clipboardShowRevision++;
  clipboardShowPending = false;
  clipboardSessionTarget = null;
  if (clipboardBarWindow && !clipboardBarWindow.isDestroyed()) {
    clipboardBarWindow.hide();
    scheduleIdleTeardown(clipboardBarWindow, '剪贴板', HOT_WINDOW_IDLE_MS);
  }
  return { ok: true, visible: false };
}

function toggleClipboardBar() {
  if (clipboardShowPending || (clipboardBarWindow && !clipboardBarWindow.isDestroyed() && clipboardBarWindow.isVisible())) {
    return hideClipboardBar();
  }
  return showClipboardBar();
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
  if (shortcutCaptureActive) return { ok: true, accelerator, watching: false, recording: true, error: '' };
  if(!globalShortcutsEnabled() && accelerator) return {ok:true,accelerator,watching:false,localOnly:true,error:''};
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
  if (momentaryOpened) hideQuickPanel();
  momentaryOpened = false;
  if (!accelerator || !globalShortcutsEnabled() || shortcutCaptureActive) {
    if (!shortcutCaptureActive) momentaryError = '';
    publishShortcutStatus();
    return { ok: true, watching: false, localOnly: shortcutCaptureActive };
  }
  const validation=validateMomentaryAccelerator(accelerator);
  if(!validation.ok){momentaryError=validation.error;publishShortcutStatus();return {ok:false,error:momentaryError};}
  // 宿主选择：优先用系统自带 csc.exe 编译一次的 5KB 原生小程序
  // （常驻约 9MB、无 conhost、READY 19ms），编译不可用才回退 PowerShell
  // （约 73MB 私有 + 7.7MB conhost、READY 2.5s）。功能与协议完全一致。
  // 编译产物缓存在 userData 下，只在首次需要时编译一次。
  const nativeHost = await ensureNativeHost({
    sourcePath: assetPath('key-watch-host.cs'),
    targetPath: path.join(userRoot(), 'key-watch-host.exe')
  }).catch(() => null);
  // 用户可能在本机编译按键助手期间离开录制框；不要迟到地重新接管组合键。
  if (shortcutCaptureActive || accelerator !== momentaryAccelerator()) return { ok: true, watching: false, localOnly: true };
  momentaryProbe = new KeyWatchProbe({
    accelerator,
    scriptPath: assetPath('key-watch.ps1'),
    nativeHost: nativeHost || '',
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
  publishShortcutStatus();
  return {
    ok,
    watching: momentaryProbe && momentaryProbe.status === 'watching',
    error: ok ? '' : momentaryError
  };
}

/** 录制快捷键时临时释放全局热键，避免旧绑定先于输入框收到同一组合键。 */
async function beginShortcutCapture() {
  if (!shortcutManager) return { ok: false, error: '快捷键尚未初始化' };
  if (!shortcutCaptureActive) {
    shortcutCaptureActive = true;
    registerShortcuts();
    await setupMomentaryProbe();
  }
  clearTimeout(shortcutCaptureTimer);
  shortcutCaptureTimer = setTimeout(() => {
    queuePanelConfiguration(() => endShortcutCapture()).catch(error => console.warn('恢复快捷键失败:', error.message));
  }, 60000);
  if (shortcutCaptureTimer.unref) shortcutCaptureTimer.unref();
  return { ok: true };
}

/** 退出录制或安全超时后，按当前设置重新注册全局快捷键。 */
async function endShortcutCapture() {
  clearTimeout(shortcutCaptureTimer);
  shortcutCaptureTimer = null;
  if (!shortcutCaptureActive) return { ok: true };
  shortcutCaptureActive = false;
  registerShortcuts();
  const momentary = await setupMomentaryProbe();
  return { ok: true, momentary };
}

/**
 * 尝试把内容放回原处。
 *
 * 严格遵循第 7 节：提交前重新校验目标；校验不通过就只复制并提示用户。
 * 原生助手完成目标实例校验、焦点检查与粘贴；失败时保留已复制内容。
 */
async function tryReturnToTarget(item, intent = 'return-and-paste', options = {}) {
  const settings = store.getSettings();
  const target = Object.prototype.hasOwnProperty.call(options, 'targetOverride')
    ? options.targetOverride
    : options.clipboardBar ? options.target : returnTarget;

  // 无论是否能粘贴，都先完成复制——这是「已复制，切回目标后粘贴」的前提
  try {
    // 图片条目要复制位图本身（底部剪贴板条选历史图片时就是这条路）；
    // 之前固定 writeClipboardText，会把图片粘成文件路径文本。
    if (item?.kind === 'image') {
      if(!item.filePath||!fs.existsSync(item.filePath))throw Error('原图片不存在或已被清理');
      const image = nativeImage.createFromPath(item.filePath);
      if (image.isEmpty()) throw new Error('图片读取失败');
      await writeClipboardImage(image);
    } else {
      await writeClipboardText(item?.text || item?.filePath || '');
    }
  } catch (error) {
    // 复制本身失败时必须是失败结果：渲染层据此显示红色错误，
    // 不能返回 ok:true 把「复制失败」当成功提示出去。
    return { copied: false, copyFailed: true, canPaste: false, message: `复制失败：${error.message}` };
  }

  // 写入成功立即收起；保留系统剪贴板，后续 Ctrl+V 仍是所选历史内容。
  if (options.clipboardBar) {
    if(options.revision!==clipboardShowRevision)return {copied:true,canPaste:false,message:'已复制，请按 Ctrl+V 粘贴'};
    hideClipboardBar();
  }
  let current = await queryForeground();
  // 提交时前台通常是自己的浮层，校验原目标实例，而不是拿浮层与目标比较。
  if (current && Number(current.pid) === process.pid && target) current = await foregroundProbe.query(target.hwnd);
  const decision = decideCommit({ target, current, intent,
    pasteAfterCopy: options.clipboardBar || options.explicitPaste || Boolean(settings.pasteAfterCopy) });

  if (!decision.canPaste) {
    // 校验未通过（目标已关闭 / 用户切换了窗口 / 权限不匹配），或用户只要复制
    return { ...decision, canPaste: false, copied: true, message: options.clipboardBar&&intent!=='copy-only'?'已复制，请在当前输入框按 Ctrl+V 粘贴':decision.message };
  }

  const hideCaptureAfterPaste = () => {
    if (options.captureOverlay) { mainWasVisible = false; hideOverlayWindow({ restoreMain: false }); }
  };
  // 原生助手先验证前台仍是随序，再切回目标注入；提前隐藏会让底下的
  // 其他窗口变成前台，被正确的焦点保护拒绝。成功后才收起截图层。
  // 只有当前前台进程能把置前权限交给助手，权限限定到这一助手 PID。
  await foregroundProbe.start();
  panelNative.allowForeground(foregroundProbe.child?.pid);
  const nativePaste = await foregroundProbe.pasteTo(target);
  if (!nativePaste.unsupported) {
    if (nativePaste.ok) hideCaptureAfterPaste();
    return { ...decision, canPaste: nativePaste.ok, pasted: nativePaste.ok,
      message: nativePaste.ok ? (options.clipboardBar?'已粘贴到当前窗口':'已粘贴到原窗口') : '已复制，请按 Ctrl+V 粘贴' };
  }

  const focused = await focusWindowForReturn(target);
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
  hideCaptureAfterPaste();
  return { ...decision, canPaste: true, pasted: true, message: options.clipboardBar?'已粘贴到当前窗口':'已粘贴到原窗口' };
}

/**
 * 把之前记录的目标窗口切到前台。
 *
 * 调用前已由 validateTarget 确认 HWND 仍属于同一进程实例，
 * 这里只负责置前。失败返回 false，由调用方降级为「仅复制」。
 */
async function focusWindowForReturn(target) {
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
    const output = await new Promise((resolve, reject) => execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script
    ], { encoding: 'utf8', windowsHide: true, timeout: 4000 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
    return JSON.parse(String(output).trim()).ok === true;
  } catch {
    return false;
  }
}

let markdownFiles;
const pendingMarkdownFiles=markdownPaths(process.argv.slice(app.isPackaged?1:2));
let markdownOpenChain=Promise.resolve();
function queueMarkdownFiles(files) {
  pendingMarkdownFiles.push(...files.slice(0,32));
  if(!markdownFiles)return;
  markdownOpenChain=markdownOpenChain.then(async()=>{
    while(pendingMarkdownFiles.length){
      const file=pendingMarkdownFiles.shift();
      try {
        const result=await markdownFiles.open(file);
        const win=showWorkspaceWindow('markdown');win.__openedDoc=result.item.id;
        if (!win.webContents.isLoadingMainFrame()) {
          win.__openedDoc = '';
          win.webContents.send('workspace:file-opened', { id: result.item.id, recovered: result.recovered });
        }
        broadcast('content:changed');
      } catch(error){dialog.showErrorBox('无法打开 Markdown',error.message);}
    }
  });
}
app.on('open-file',(event,file)=>{event.preventDefault();queueMarkdownFiles([file]);});
const workspaceWindows=new Map();
const relayRequests=new Map(),activeDocuments=new Map(),calendarDrafts=new Map();
app.on('browser-window-focus',(_event,win)=>{const active=activeDocuments.get(win.webContents.id);if(active)active.at=Date.now();});
app.on('browser-window-created',(_event,win)=>{const id=win.webContents.id;win.once('closed',()=>{activeDocuments.delete(id);calendarDrafts.delete(id);});});
function requestRelay(win,payload){
  return new Promise((resolve,reject)=>{
    const token=makeId('relay'),timer=setTimeout(()=>{relayRequests.delete(token);reject(Error('目标窗口未响应，请稍后重试'));},8000);
    relayRequests.set(token,{sender:win.webContents.id,resolve,reject,timer});
    win.webContents.send('relay:request',{...payload,token});
  });
}
async function appendRelayMarkdown(text){
  const workspace=require('./lib/workspace').createWorkspace(store);
  const current=[...activeDocuments.values()].filter(entry=>!entry.win.isDestroyed()&&store.getItem(entry.id)?.meta?.workspace==='markdown').sort((a,b)=>b.at-a.at)[0];
  if(current){await requestRelay(current.win,{kind:'markdown.append',id:current.id,text});return {type:'markdown',id:current.id};}
  const day=require('./lib/date-parse').dateKey(new Date()),title='今天 · '+day;
  const previous=workspace.list('markdown').find(item=>item.title===title);
  const item=workspace.save('markdown',{id:previous?.id,title,text:[previous?.text||'',text].filter(Boolean).join('\n\n')});
  await store.save();broadcast('content:changed');broadcast('workspace:changed',{type:'markdown',id:item.id});return {type:'markdown',id:item.id};
}
function openRelayCalendar(draft){
  const win=showWorkspaceWindow('calendar');calendarDrafts.set(win.webContents.id,draft);
  win.webContents.send('workspace:calendar-draft',draft);
}
let workspaceQuitRequested=false;
function showWorkspaceWindow(type) {
  let win=workspaceWindows.get(type);
  if(win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();return win;}
  const area=screen.getPrimaryDisplay().workArea;
  win=new BrowserWindow({width:Math.min(type==='markdown'?1300:1180,area.width-40),height:Math.min(860,area.height-40),minWidth:800,minHeight:600,show:false,frame:false,thickFrame:SYSTEM_GLASS,
    title:type==='markdown'?'Markdown · 随序':'日历 · 随序',transparent:true,backgroundColor:'#00000000',hasShadow:SYSTEM_GLASS,roundedCorners:true,icon:assetPath('suira-icon.png'),
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:false,spellcheck:false}});
  prepareFloatingSurface(win, 24, true);
  prepareDesktopWindow(win);
  workspaceWindows.set(type,win);win.__tool=type;
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.loadFile(path.join(__dirname,'src/index.html'),{query:{tool:type}});
  win.once('ready-to-show',()=>{win.show();win.focus();});
  win.on('close',event=>{if(!isQuitting&&!win.__allowClose){event.preventDefault();win.webContents.send('workspace:closing');}});
  win.on('closed',()=>{workspaceWindows.delete(type);if(workspaceQuitRequested&&workspaceWindows.size===0)app.quit();});
  return win;
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
    thickFrame: SYSTEM_GLASS,
    transparent: true,
    backgroundMaterial: SYSTEM_GLASS?'acrylic':undefined,
    backgroundColor: '#00000000',
    hasShadow: SYSTEM_GLASS,
    title: APP_NAME,
    icon: assetPath('suira-icon.png'),
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 主窗口不需要拼写检查：关掉省一个常驻的拼写服务进程
      spellcheck: false
    }
  });
  prepareFloatingSurface(mainWindow,24,true);
  if(saved?.physicalWidth&&saved?.physicalHeight)mainWindow.__restorePhysicalSize={width:saved.physicalWidth,height:saved.physicalHeight,scale:saved.scaleFactor};
  prepareDesktopWindow(mainWindow);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.on('blur', () => {
    if (shortcutCaptureActive) queuePanelConfiguration(() => endShortcutCapture()).catch(error => console.warn('恢复快捷键失败:', error.message));
  });
  // ready-to-show 是首选：等首帧画完再显示，避免白屏闪一下。
  // 但它在「桌面已锁定 / 合成器异常 / GPU 未就绪」时可能永远不触发，
  // 那种情况下进程在跑、托盘在，却一个窗口都没有——所以加一个兜底显示。
  let revealed = false;
  const revealMainWindow = () => {
    if (revealed || !mainWindow || mainWindow.isDestroyed()) return;
    revealed = true;
    // 用户已经进入高频工具时，迟到的主窗口首帧不能抢走聊天/历史条焦点。
    if(longCapture||longPickerPayload||[quickWindow,clipboardBarWindow,overlayWindow].some(win=>win&&!win.isDestroyed()&&win.isVisible()))return;
    // 上次退出时是最大化状态：先恢复最大化再显示，避免先闪一下小窗口
    if (saved?.maximized) {
      try { mainWindow.maximize(); } catch {}
    }
    mainWindow.show();
    mainWindow.focus();
  };
  mainWindow.once('ready-to-show', revealMainWindow);
  const revealTimer = setTimeout(() => {
    if (!revealed) console.warn('[窗口] ready-to-show 未在 2.5s 内触发，兜底显示主窗口');
    revealMainWindow();
  }, 2500);
  if (revealTimer.unref) revealTimer.unref();
  mainWindow.on('close', (event) => {
    rememberMainWindowState();
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      scheduleIdleTeardown(mainWindow, '主窗口', MAIN_WINDOW_IDLE_MS);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeHttpUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // 渲染进程崩溃（GPU 异常 / OOM 等）后窗口会留下一块再也画不出来的白屏。
  // 必须自动重载把页面救回来，否则用户看到的就是桌面上挂着一块白砖。
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (isQuitting || !mainWindow || mainWindow.isDestroyed()) return;
    console.warn(`[窗口] 主窗口渲染进程退出（${details.reason}），自动重载恢复`);
    try { mainWindow.webContents.reload(); } catch { /* 窗口正在销毁 */ }
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
async function rememberMainWindowState() {
  if (!store || !mainWindow || mainWindow.isDestroyed()) return;
  try {
    const win=mainWindow,maximized=win.isMaximized();if(win.__restorePhysicalSize)return;
    const bounds=maximized?win.getNormalBounds():win.getBounds();
    let size=win.__stableNormalSize;
    let physical=win.__stableNormalPhysical;
    if(!win.__customMaximized&&foregroundProbe.isReady()){
      const own=await foregroundProbe.query(win.getNativeWindowHandle().readBigUInt64LE().toString());
      if(own?.pid===process.pid&&own.bounds){
        const scale=screen.getDisplayMatching(bounds).scaleFactor||1;
        const nativeSize=maximized&&own.normalSize?.width>0?own.normalSize:own.bounds;
        physical={physicalWidth:nativeSize.width,physicalHeight:nativeSize.height,scaleFactor:scale};
        size=[Math.floor(nativeSize.width/scale+1e-6),Math.floor(nativeSize.height/scale+1e-6)];
        win.__stableNormalSize=size;
        win.__stableNormalPhysical=physical;
      }
    }
    if(win!==mainWindow)return;
    store.setWindowState({ ...bounds,...(size?{width:size[0],height:size[1]}:{}),...physical,maximized });
  } catch {
    // 窗口正在销毁时取 bounds 可能抛错，忽略即可
  }
}

const textToolWindows=new Map();
let textToolRequest=0;
let textCaptureWindow = null;
let documentCapture = null;
async function openTextTools(mode='convert',input,operation='compact'){
  if(!['translate','convert'].includes(mode))return {ok:false,error:'未知文字工具'};
  const request=++textToolRequest;
  const selection=store?.getSettings().selectionEnabled&&typeof input!=='string'&&quickWindow?.isVisible()&&panelSelection&&Date.now()-panelSelection.createdAt<60000?panelSelection:null;
  if(selection)returnTarget=selection.returnTarget;else await rememberReturnTarget('text-tools');
  const text=typeof input==='string'?input.slice(0,200000):selection?.text||(await readClipboardText()).slice(0,200000);
  if(request!==textToolRequest)return {ok:true};
  let win=textToolWindows.get('text'),fresh=!win||win.isDestroyed();
  if(fresh){
    win=new BrowserWindow({width:960,height:680,minWidth:640,minHeight:440,show:false,frame:false,thickFrame:SYSTEM_GLASS,transparent:true,backgroundColor:'#00000000',title:mode==='translate'?'随序 · 翻译':'随序 · 文本转换',icon:assetPath('suira-icon.png'),webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:false,spellcheck:false}});
    textToolWindows.set('text',win);win.__textTool={mode,text,operation,selectionPaste:Boolean(selection)};
    prepareFloatingSurface(win,24,true);prepareDesktopWindow(win);panelNative.disableTransitions(win);
    win.__loaded=win.loadFile(path.join(__dirname,'src','text-tools.html'),{query:{mode}});win.on('closed',()=>{if(textToolWindows.get('text')===win)textToolWindows.delete('text');});win.setMenuBarVisibility(false);
    await win.__loaded;
  }else{await win.__loaded;if(win.isDestroyed()||request!==textToolRequest)return {ok:true};win.__textTool={mode,text,operation,selectionPaste:Boolean(selection)};win.webContents.send('text-tools:input',{...win.__textTool,switchOnly:typeof input!=='string'&&!selection});}
  if(!win.isDestroyed()&&request===textToolRequest){win.show();win.focus();}return {ok:true};
}

function showMain(page = 'shelf') {
  if(['calendar','markdown'].includes(page))return showWorkspaceWindow(page);
  const alreadyFocused = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused());
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  cancelIdleTeardown(mainWindow);
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
  const destination=mainWindow;
  const navigate=()=>{if(!destination.isDestroyed())destination.webContents.send('app:navigate',page);};
  if(destination.webContents.isLoadingMainFrame())destination.webContents.once('did-finish-load',navigate);else navigate();
}

/* ---------- 截图覆盖层：按需创建，短时间内复用 ---------- */
let overlayReady = false;
let overlayDidLoad = null;

function currentVirtualBounds() {
  return unionBounds(screen.getAllDisplays()) || { ...screen.getPrimaryDisplay().bounds };
}

function sameBounds(a, b) {
  return Boolean(a && b) && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;
  const bounds = currentVirtualBounds();
  overlayReady = false;
  overlayWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    show: false,
    frame: false,
    thickFrame: false,
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
      sandbox: false,
      // 覆盖层只画一张截图，不需要拼写服务；BACKGROUND 阶段也不要满速跑
      spellcheck: false,
      backgroundThrottling: true
    }
  });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.loadFile(path.join(__dirname, 'src', 'overlay.html'));
  overlayDidLoad = new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      overlayReady = value;
      resolve(value);
    };
    overlayWindow.webContents.once('did-finish-load', () => done(true));
    overlayWindow.webContents.once('did-fail-load', () => done(false));
    const timer = setTimeout(() => done(false), 8000);
    if (timer.unref) timer.unref();
  });
  overlayWindow.on('closed', () => {
    overlayWindow = null;
    overlayReady = false;
  });
  return overlayWindow;
}

/**
 * 显示覆盖层：按当前显示器重设边界，再通知渲染层拉取这一帧画面。
 * 渲染层收到 'capture:shown' 后自行 reset 并 loadCapture()。
 */
async function showOverlayWindow(payload, revision = regionCaptureRevision) {
  capturePayload = payload;
  const win = createOverlayWindow();
  cancelIdleTeardown(win);
  const bounds = currentVirtualBounds();
  if (!sameBounds(win.getBounds(), bounds)) win.setBounds(bounds);
  if (!overlayReady) {
    await Promise.race([
      overlayDidLoad || Promise.resolve(false),
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 4000);
        if (timer.unref) timer.unref();
      })
    ]);
  }
  if (revision !== regionCaptureRevision) return false;
  if (!overlayWindow || overlayWindow.isDestroyed()) throw new Error('截图覆盖层创建失败');
  // 先通知渲染层 reset + 取新画面，再显示窗口：
  // 反过来做会有一帧左右先露出上一轮的旧截图（预热窗口的副作用）。
  overlayWindow.webContents.send('capture:shown');
  overlayWindow.show();
  overlayWindow.focus();
  return true;
}

/**
 * 收起覆盖层：隐藏而不是立刻销毁，下次唤起才能秒开。
 *
 * 但隐藏不等于不占内存：一张 4K 屏幕画面（RGBA 约 33MB）+ 两层同尺寸 canvas
 * 会一直挂在渲染进程里。所以这里做两级回收：
 *   1. 立刻通知渲染层丢掉画面/画布后备缓冲（毫秒级，保留窗口热启动）；
 *   2. 等待短时间，闲置后释放空页面。
 */
function hideOverlayWindow(options = {}) {
  ++regionCaptureRevision;
  if(documentCapture){const pending=documentCapture;documentCapture=null;pending.resolve(options.documentResult||{ok:false,canceled:true});if(!pending.win.isDestroyed()){pending.win.show();pending.win.focus();}}
  capturePayload = null;
  captureBusy = false;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    if(options.release!==false)try { overlayWindow.webContents.send('capture:release'); } catch {}
    overlayWindow.hide();
    if (options.release !== false) scheduleIdleTeardown(overlayWindow, '截图', HOT_WINDOW_IDLE_MS);
  }
  if(options.restoreMain!==false)restoreMainAfterCapture();
  const textWindow = textCaptureWindow;
  textCaptureWindow = null;
  if (textWindow && !textWindow.isDestroyed()) {
    if (typeof options.textToolInput === 'string') {
      textWindow.__textTool = { ...textWindow.__textTool, text: options.textToolInput };
      textWindow.webContents.send('text-tools:input', textWindow.__textTool);
    }
    textWindow.show();
    textWindow.focus();
  }
}

async function beginScreenCapture(source = 'panel', options = {}) {
  if (longCapture||longCaptureStarting) return {ok:false,error:'请先完成或取消当前长截图'};
  if (captureBusy) return { ok: true };
  // 入口意图：从 38 键面板按 O 进来，框完直接进识别；按 P 进来直接钉图。
  // 意图随 payload 交给覆盖层，覆盖层据此预选工具或自动完成。
  const intent = ['ocr', 'translate', 'ocr-return', 'document-image', 'document-text', 'pin', 'copy', 'save', 'shelf','long'].includes(options?.intent) ? options.intent : 'copy';
  if(intent==='long')return beginLongPicker(source);
  const revision = ++regionCaptureRevision;
  const cancelled = { ok: false, canceled: true };
  captureBusy = true;
  try {
    if (source !== 'text-tools') await rememberReturnTarget('capture');
    if (revision !== regionCaptureRevision) return cancelled;
    // 页面加载与屏幕采集并行，缩短首次显示等待。
    createOverlayWindow();
    const hidingSurface = [quickWindow, clipboardBarWindow, mainWindow].some(win => win && !win.isDestroyed() && win.isVisible());
    hideQuickPanel();
    hideClipboardBar();
    mainWasVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
    if (mainWasVisible) mainWindow.hide();
    // 仅在需要等待自己的窗口从桌面消失时让出合成帧。
    if (hidingSurface) await new Promise((resolve) => setTimeout(resolve, 40));

    // 跨屏支持：覆盖所有显示器组成的虚拟桌面。
    // 各显示器 DPI 可能不同，因此按「物理像素」合成，再用统一的虚拟桌面逻辑尺寸映射回选区。
    const displays = screen.getAllDisplays();
    const virtualBounds = unionBounds(displays) || { ...screen.getPrimaryDisplay().bounds };

    // 合成用缩放：以最大 scaleFactor 为准，保证最清晰屏幕不被降采样
    const maxScale = maxScaleFactor(displays);
    let tiles=null, captureBackend='native';
    if(process.platform==='win32') {
      try {
        const executable=await readyCaptureHost();
        if(executable)tiles=nativeDesktopTiles(displays,await captureNative(executable),virtualBounds,maxScale);
      }catch(error){console.warn('原始像素采集回退:',error.message);}
    }
    if(!tiles) {
    captureBackend='electron';
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(virtualBounds.width * maxScale),
        height: Math.round(virtualBounds.height * maxScale)
      },
      fetchWindowIcons: false
    });

    tiles = collectDesktopTiles(displays, sources, virtualBounds, maxScale);
    }
    if (revision !== regionCaptureRevision) return cancelled;
    if (!tiles) throw new Error('无法读取屏幕画面');

    const primaryDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    capturePayload = {
      // 单屏：直接给 dataUrl；多屏：给 tiles 由 overlay 合成
      dataUrl: tiles.tiles.length === 1 ? tiles.tiles[0].dataUrl : '',
      tiles: tiles.tiles.length > 1 ? tiles.tiles : null,
      tileSize: { width: tiles.width, height: tiles.height },
      // 原始像素元数据通过索引引用已有 PNG，不在 IPC 中重复传输整张图片。
      rawTiles: tiles.rawTiles?.map((tile,tileIndex)=>({...tile,dataUrl:undefined,tileIndex})) || null,
      captureBackend,
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
    // 复用预热窗口：不再新建 BrowserWindow / loadFile
    return await showOverlayWindow(capturePayload, revision) ? { ok: true } : cancelled;
  } catch (error) {
    if (revision !== regionCaptureRevision) return cancelled;
    capturePayload = null;
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

async function completeCapture(dataUrl, action, session) {
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
    return { ok: true, filePath, item, output: result.output, ocr: true,qr:result.qr };
  }
  // 收起（而不是销毁）预热覆盖层，下次唤起才快
  if (session === capturePayload && documentCapture && session.intent === 'document-image') {
    item.pinned=true;item.meta={...item.meta,documentAttachment:true};await store.save();
    if (session === capturePayload) {
      hideOverlayWindow({ documentResult: { ok: true, itemId: item.id, url: 'suira-image://' + item.id, text: '' } });
    }
    broadcast('content:changed');
    return { ok: true, item };
  }
  if (session === capturePayload) hideOverlayWindow();
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

function createLongPickerWindow() {
  if(longPickerWindow&&!longPickerWindow.isDestroyed())return longPickerWindow;
  const win=longPickerWindow=new BrowserWindow({...currentVirtualBounds(),title:'随序 · 长截图框选',frame:false,thickFrame:false,transparent:true,backgroundColor:'#00000000',show:false,focusable:false,alwaysOnTop:true,skipTaskbar:true,resizable:false,movable:false,hasShadow:false,
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:false,spellcheck:false,backgroundThrottling:false}});
  win.setAlwaysOnTop(true,'screen-saver');
  win.__loaded=win.loadFile(path.join(__dirname,'src','long-picker.html'));
  win.__loaded.catch(error=>console.warn('长截图框选层加载失败:',error.message));
  win.on('closed',()=>{if(longPickerWindow===win){longPickerWindow=null;cancelLongPicker();}});
  return win;
}
function releaseLongPickerEscape(){if(longPickerEscape){globalShortcut.unregister('Escape');longPickerEscape=false;}}
function cancelLongPicker() {
  const pending=longCapture&&!longCapture.controller?longCapture:null;
  longPickerRevision++;longPickerPayload=null;
  longPickerWorker?.stop();longPickerWorker=null;
  const ack=longPickerWindow?.__pickerAck;if(ack){longPickerWindow.__pickerAck=null;ack.done();}
  if(longPickerWindow&&!longPickerWindow.isDestroyed()){longPickerWindow.hide();scheduleIdleTeardown(longPickerWindow,'长截图框选',HOT_WINDOW_IDLE_MS);}
  releaseLongPickerEscape();
  // 首帧还没准备好的取消：把正在准备的会话一起收掉，否则采集回来又会把
  // 框选层重新弹出来（用户已经按过取消）。
  if(pending){pending.canceled=true;teardownLongCapture(pending).catch(()=>{});return {ok:true};}
  captureBusy=false;restoreMainAfterCapture();return {ok:true};
}
async function beginLongPicker(source) {
  const revision=++longPickerRevision;captureBusy=true;
  try {
    // 在用户拖动选区时并行准备，松手后不再等待新渲染进程和组件编译。
    createLongCaptureWindow();createLongPreviewWindow();createLongOutlineWindow();
    readyCaptureHost(true).catch(()=>{});foregroundProbe.start().catch(()=>{});
    const win=createLongPickerWindow();cancelIdleTeardown(win);await win.__loaded;
    if(revision!==longPickerRevision||win.isDestroyed())return {ok:true,visible:false};
    const bounds=currentVirtualBounds();if(!sameBounds(win.getBounds(),bounds))win.setBounds(bounds);
    const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{if(win.__pickerAck?.revision===revision)win.__pickerAck=null;reject(Error('框选层未就绪，请重试'));},1200);win.__pickerAck={revision,done:()=>{clearTimeout(timer);resolve();}};});
    longPickerPayload={bounds,size:bounds,intent:'long',source,revision,longPicker:true};
    win.webContents.send('long-picker:shown',{bounds,revision});await ready;
    if(revision!==longPickerRevision||win.isDestroyed())return {ok:true,visible:false};
    mainWasVisible=Boolean(mainWindow&&!mainWindow.isDestroyed()&&mainWindow.isVisible());
    // 框选层先显示再收起面板；无需截整屏、PNG 编解码或激活任何窗口。
    win.showInactive();hideQuickPanel();hideClipboardBar();if(mainWasVisible)mainWindow.hide();
    longPickerEscape=globalShortcut.register('Escape',()=>cancelLongPicker());
    return {ok:true};
  }catch(error){if(revision===longPickerRevision)cancelLongPicker();return {ok:false,error:error.message||'长截图框选失败'};}
}

function prepareCaptureHost() {
  captureHostError='';
  return ensureNativeHost({sourcePath:assetPath('capture-host.cs'),targetPath:path.join(userRoot(),'capture-host-v3.exe'),references:['System.Drawing.dll'],onError:error=>{captureHostError=error;}});
}
async function readyCaptureHost(retry=false) {
  if(!captureHost)captureHost=prepareCaptureHost();
  let executable=await captureHost;
  // 启动预热失败可能只是首次编译时被占用；不缓存一个永久失败的 Promise。
  if(!executable&&retry){captureHost=prepareCaptureHost();executable=await captureHost;}
  return executable;
}

const LONG_HUD_WIDTH=596,LONG_HUD_HEIGHT=104,LONG_PREVIEW_WIDTH=236,LONG_PREVIEW_HEIGHT=302;
let longCaptureWindow=null;
let longPreviewWindow=null;
let longCaptureEscape=false;
let longCaptureEnter=false;
let longOutlineWindow=null;

function createLongOutlineWindow() {
  if(longOutlineWindow&&!longOutlineWindow.isDestroyed())return longOutlineWindow;
  const win=longOutlineWindow=new BrowserWindow({width:200,height:200,show:false,frame:false,thickFrame:false,transparent:true,backgroundColor:'#00000000',
    alwaysOnTop:true,focusable:false,skipTaskbar:true,hasShadow:false,resizable:false,
    title:'随序 · 采集区域',webPreferences:{preload:path.join(__dirname,'theme-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:false,backgroundThrottling:false}});
  win.setAlwaysOnTop(true,'screen-saver');win.setIgnoreMouseEvents(true);win.setContentProtection(true);
  win.__loaded=win.loadFile(path.join(__dirname,'src/long-outline.html'));
  win.__loaded.catch(()=>{});
  win.on('closed',()=>{if(longOutlineWindow===win)longOutlineWindow=null;});
  return win;
}

/**
 * 工具条落点：优先放在选区外面，实在放不下才压在选区内部。
 *
 * 悬停/隐藏都不需要：工具条启用了内容保护（WDA_EXCLUDEFROMCAPTURE），
 * GDI 采集与 DWM 采集都拍不到它，所以「压住选区」也不会污染长图。
 */
function longHudBounds(rect) {
  const area=screen.getDisplayMatching(rect).workArea,width=Math.min(LONG_HUD_WIDTH,area.width),height=LONG_HUD_HEIGHT;
  const clampX=x=>Math.max(area.x+8,Math.min(x,area.x+area.width-width-8));
  const clampY=y=>Math.max(area.y+8,Math.min(y,area.y+area.height-height-8));
  const choices=[{x:clampX(rect.x+(rect.width-width)/2),y:rect.y+rect.height+14},{x:clampX(rect.x+(rect.width-width)/2),y:rect.y-height-14},
    {x:rect.x+rect.width+14,y:clampY(rect.y+(rect.height-height)/2)},{x:rect.x-width-14,y:clampY(rect.y+(rect.height-height)/2)}];
  const point=choices.find(p=>p.x>=area.x&&p.y>=area.y&&p.x+width<=area.x+area.width&&p.y+height<=area.y+area.height);
  if(point)return {...point,width,height};
  // 选区几乎占满屏幕：贴到选区底部中央，视觉上仍属于这次操作。
  return {x:clampX(rect.x+(rect.width-width)/2),y:clampY(rect.y+rect.height-height-18),width,height};
}

/** 预览缩略图固定在选区所在屏幕的右下角，只做展示，不吃鼠标。 */
function longPreviewBounds(rect,avoid=null) {
  const area=screen.getDisplayMatching(rect).workArea;
  const width=Math.min(LONG_PREVIEW_WIDTH,area.width),height=Math.min(LONG_PREVIEW_HEIGHT,area.height);
  const overlap=box=>Boolean(avoid)&&!(box.x+box.width<=avoid.x||avoid.x+avoid.width<=box.x||box.y+box.height<=avoid.y||avoid.y+avoid.height<=box.y);
  const corner={x:area.x+area.width-width-18,y:area.y+area.height-height-18};
  if(!overlap({...corner,width,height}))return {...corner,width,height};
  // 工具条也在右下角时，预览挪到它上面，别把按钮挡住（预览不吃鼠标，但视觉上会盖住）。
  const above={x:corner.x,y:Math.max(area.y+8,avoid.y-height-12)};
  return {...(overlap({...above,width,height})?corner:above),width,height};
}

function releaseLongCaptureEscape() {
  if(longCaptureEnter){try{globalShortcut.unregister('Return');}catch{}longCaptureEnter=false;}
  if(!longCaptureEscape)return;
  try{if(globalShortcut.isRegistered('Escape'))globalShortcut.unregister('Escape');}catch{}
  longCaptureEscape=false;
}

/**
 * 等首帧绘制完成再显示窗口。
 *
 * `did-finish-load` 只代表 DOM 就绪，此时 showInactive 偶尔会先露出一个空白窗口，
 * 这正是「先闪一下」的来源之一。`ready-to-show` 才是可以安全显示的时机，超时兜底。
 */
function whenPainted(win) {
  return new Promise(resolve=>{
    let done=false;
    const finish=()=>{if(done)return;done=true;clearTimeout(timer);resolve();};
    const timer=setTimeout(finish,900);
    if(timer.unref)timer.unref();
    win.once('ready-to-show',finish);
  });
}

function createLongCaptureWindow() {
  if(longCaptureWindow&&!longCaptureWindow.isDestroyed())return longCaptureWindow;
  const win=longCaptureWindow=new BrowserWindow({
    width:LONG_HUD_WIDTH,height:LONG_HUD_HEIGHT,show:false,frame:false,thickFrame:false,transparent:true,backgroundColor:'#00000000',
    hasShadow:false,resizable:false,movable:false,minimizable:false,maximizable:false,skipTaskbar:true,
    alwaysOnTop:true,focusable:true,acceptFirstMouse:true,title:'随序 · 长截图',
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:false,spellcheck:false,backgroundThrottling:false}
  });
  prepareFloatingSurface(win, 16);
  // 看得见、拍不到：这样就不必每帧 hide/show，用户不会再看到闪烁，
  // 按钮也不会因为窗口被临时隐藏而点不动。
  try{win.setContentProtection(true);}catch(error){console.warn('长截图工具条内容保护不可用:',error.message);}
  win.setAlwaysOnTop(true,'screen-saver');
  win.__painted=whenPainted(win);
  win.__loaded=win.loadFile(path.join(__dirname,'src','long-capture.html'));
  win.__loaded.catch(error=>console.warn('长截图工具条加载失败:',error.message));
  win.on('closed',()=>{if(longCaptureWindow===win)longCaptureWindow=null;});
  return win;
}

function createLongPreviewWindow() {
  if(longPreviewWindow&&!longPreviewWindow.isDestroyed())return longPreviewWindow;
  const win=longPreviewWindow=new BrowserWindow({
    width:LONG_PREVIEW_WIDTH,height:LONG_PREVIEW_HEIGHT,show:false,frame:false,thickFrame:false,transparent:true,backgroundColor:'#00000000',
    hasShadow:false,resizable:false,movable:false,minimizable:false,maximizable:false,skipTaskbar:true,
    alwaysOnTop:true,focusable:false,title:'随序 · 长图预览',
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:false,spellcheck:false,backgroundThrottling:false}
  });
  prepareFloatingSurface(win, 14);
  try{win.setContentProtection(true);}catch{}
  win.setAlwaysOnTop(true,'screen-saver');
  // 预览只负责看：鼠标事件穿透，滚轮直接落到下面的页面。
  win.setIgnoreMouseEvents(true);
  win.__painted=whenPainted(win);
  win.__loaded=win.loadFile(path.join(__dirname,'src','long-preview.html'));
  win.__loaded.catch(error=>console.warn('长图预览加载失败:',error.message));
  win.on('closed',()=>{if(longPreviewWindow===win)longPreviewWindow=null;});
  return win;
}

/** 把当前长图的缩略图推给右下角预览窗；高频轮询下做节流，避免 IPC 与编码占满主线程。 */
function sendLongPreview(session,force=false) {
  const win=session?.preview,controller=session?.controller;
  if(!win||win.isDestroyed()||!controller)return;
  const now=Date.now();
  if(!force&&now-session.previewAt<260)return;
  session.previewAt=now;
  try {
    const model=controller.model,thumb=model.thumbnail(196,520);
    const image=nativeImage.createFromBitmap(thumb.data,{width:thumb.width,height:thumb.height,scaleFactor:1});
    if(image.isEmpty())return;
    win.webContents.send('long-capture:preview',{dataUrl:image.toDataURL(),width:model.width,height:model.height,frames:model.frames});
  }catch(error){console.warn('长图预览生成失败:',error.message);}
}

function longCaptureState() {
  const session=longCapture;
  // 采集器还没建好之前不对外报状态：渲染层用页面自带的「正在准备」占位，
  // 调用方（自动化检查、外部脚本）也不会把准备阶段误当成已开始采集。
  if(!session?.controller)return null;
  return session.controller.state();
}

/** 结束会话：先摘掉全局状态，再拆窗口，避免 closed 回调递归。 */
async function teardownLongCapture(session) {
  if(!session)return {ok:true};
  session.canceled=true;
  if(longCapture===session)longCapture=null;
  releaseLongCaptureEscape();
  try{session.controller&&await session.controller.stop();}catch{}
  try{session.worker&&session.worker.stop();}catch{}
  if(longPickerWorker===session.worker)longPickerWorker=null;
  for(const win of [session.outline,session.preview,session.win])if(win&&!win.isDestroyed())win.destroy();
  session.preview=null;session.win=null;
  if(longPickerPayload){
    longPickerPayload=null;
    if(longPickerWindow&&!longPickerWindow.isDestroyed()){longPickerWindow.hide();scheduleIdleTeardown(longPickerWindow,'长截图框选',HOT_WINDOW_IDLE_MS);}
  }
  captureBusy=false;
  restoreMainAfterCapture();
  return {ok:true};
}

async function startLongCapture(selection,fromPicker=false) {
  if(longCapture||longCaptureStarting)return {ok:false,error:'已有长截图正在进行'};
  const source=fromPicker?longPickerPayload:capturePayload;
  const originWindow=fromPicker?longPickerWindow:overlayWindow;
  if(!source||!originWindow||originWindow.isDestroyed()||(fromPicker&&selection?.revision!==source.revision))return {ok:false,error:'请先框选长截图区域'};
  const values=['x','y','width','height'];
  if(!selection||!values.every(key=>Number.isFinite(selection[key])))return {ok:false,error:'长截图区域无效'};
  const rect={x:Math.round(source.bounds.x+selection.x),y:Math.round(source.bounds.y+selection.y),width:Math.round(selection.width),height:Math.round(selection.height)};
  if(rect.width<120||rect.height<160)return {ok:false,error:'选区太小，请至少框选 120 × 160 的滚动内容'};
  const display=screen.getDisplayMatching(rect),d=display.bounds;
  if(rect.x<d.x||rect.y<d.y||rect.x+rect.width>d.x+d.width||rect.y+rect.height>d.y+d.height)return {ok:false,error:'长截图请框选同一块屏幕内的内容'};
  let worker=null,win=null,session=null,stage='准备采集组件';
  longCaptureStarting=true;
  try {
    if(process.platform!=='win32')throw Error('长截图目前支持 Windows');
    const executable=await readyCaptureHost(true);if(!executable)throw Error('原生采集组件未就绪'+(captureHostError?'：'+captureHostError:'，请重启后重试'));
    const physical=screen.dipToScreenRect(null,rect);
    worker=new RegionCapture(executable);
    if(fromPicker)longPickerWorker=worker;
    // 先把工具条准备好再收起框选层：中间不留「桌面闪一下」的空档。
    stage='显示长截图工具条';
    const hud=longHudBounds(rect);
    win=createLongCaptureWindow();
    win.setBounds(hud);
    session={win,preview:null,outline:null,worker,rect,physical,target:null,model:null,finishing:false,canceled:false,controller:null,previewAt:0};
    longCapture=session;
    win.on('closed',()=>{if(longCapture===session)cancelLongCapture();});await win.__loaded;
    await win.__painted;
    if(session.canceled)return {ok:true,canceled:true};
    win.showInactive();
    const outline=session.outline=createLongOutlineWindow();
    outline.setBounds({x:rect.x-3,y:rect.y-3,width:rect.width+6,height:rect.height+6});
    await outline.__loaded;
    if(session.canceled)return {ok:true,canceled:true};
    outline.showInactive();
    if(fromPicker)originWindow.hide();else hideOverlayWindow({restoreMain:false,release:false});
    await new Promise(resolve=>setTimeout(resolve,60));
    stage='识别选区窗口';
    // 工具条可能压在选区里，命中点要避开它，否则会把自己当成采集源。
    const hudPhysical=screen.dipToScreenRect(null,hud);
    const target=await longCaptureTarget({point:sourceProbePoint(physical,[hudPhysical]),probe:foregroundProbe,ownerPid:process.pid});
    if(session.canceled)return {ok:true,canceled:true};
    session.target=target;
    const captureFrame=async()=>{
      if(fromPicker&&source.revision!==longPickerRevision)throw Error('长截图已取消');
      if(session.canceled)throw Error('长截图已取消');
      if(worker.stopped){worker=new RegionCapture(executable);session.worker=worker;}
      const raw=await worker.capture(physical),image=nativeImage.createFromDataURL(raw.dataUrl);
      if(image.isEmpty())throw Error('区域画面无法读取');
      const size=image.getSize();if(size.width!==physical.width||size.height!==physical.height)throw Error('采集区域尺寸发生变化');
      return {width:size.width,height:size.height,data:image.toBitmap()};
    };
    stage='等待首帧';
    const first=await settledFirstFrame(captureFrame);
    if(session.canceled)return {ok:true,canceled:true};
    const actual=await foregroundProbe.query(target.hwnd);
    if(!sameLongCaptureSource(target,actual))throw Error('选中的窗口已关闭、移动或切换页面，请重新框选');
    if(fromPicker&&(source.revision!==longPickerRevision||longPickerPayload!==source))throw Error('长截图已取消');
    // 右下角预览：看得见、拍不到、不吃鼠标。
    const previewBox=longPreviewBounds(rect,hud);
    const preview=createLongPreviewWindow();
    session.preview=preview;
    preview.setBounds(previewBox);
    // 预览是锦上添花：加载失败只少一张缩略图，不能因此中断整个长截图。
    Promise.all([preview.__loaded,preview.__painted]).then(()=>{
      if(longCapture===session&&!session.canceled&&!session.finishing&&!preview.isDestroyed()){
        preview.showInactive();sendLongPreview(session,true);
      }
    }).catch(()=>{});
    // 命中点要避开自己的两个悬浮窗，否则会把「当前窗口」认成随序自己。
    const probePoint=sourceProbePoint(physical,[hud,previewBox].map(box=>screen.dipToScreenRect(null,box)));
    session.controller=new LongCaptureSession({first,target,current:()=>foregroundProbe.queryAt(probePoint),capture:captureFrame,
      onState:state=>{if(!win.isDestroyed())win.webContents.send('long-capture:state',state);},
      onPreview:()=>sendLongPreview(session)});
    session.controller.start();
    sendLongPreview(session,true);
    releaseLongPickerEscape();
    try{longCaptureEscape=globalShortcut.register('Escape',()=>cancelLongCapture());}catch(error){console.warn('长截图 Esc 注册失败:',error.message);}
    try{longCaptureEnter=globalShortcut.register('Return',()=>{finishLongCapture().catch(error=>console.warn(error.message));});}catch(error){console.warn('长截图回车注册失败:',error.message);}
    if(fromPicker){longPickerPayload=null;captureBusy=false;}
    else if(overlayWindow&&!overlayWindow.isDestroyed())overlayWindow.webContents.send('capture:release');
    return {ok:true};
  }catch(error){
    if(session?.canceled)return {ok:true,canceled:true};
    // 先摘掉会话再拆窗口：否则 destroyed 触发的 closed 会走取消流程，
    // 把框选层和 payload 一起清掉，用户点「重试」就没法继续了。
    if(longCapture===session)longCapture=null;
    try{session?.controller&&await session.controller.stop();}catch{}
    try{worker?.stop();}catch{}
    for(const target of [session?.outline,session?.preview,win])if(target&&!target.isDestroyed())target.destroy();
    if(longPickerWorker===worker)longPickerWorker=null;
    releaseLongCaptureEscape();
    // 恢复原选区，不重新发送 capture:shown，避免把具体失败盖成循环框选提示。
    if(!fromPicker||source.revision===longPickerRevision) {
      if(!fromPicker)capturePayload=source;captureBusy=true;
      if(!originWindow.isDestroyed()){if(fromPicker)originWindow.showInactive();else{originWindow.show();originWindow.focus();}}
      else restoreMainAfterCapture();
    }
    const message=`长截图${stage}失败：${error.message||'未知错误'}`;
    console.warn(message);
    return {ok:false,error:message};
  }finally{if(longPickerWorker===worker)longPickerWorker=null;longCaptureStarting=false;}
}

async function cancelLongCapture() {
  const session=longCapture;if(!session)return {ok:true};
  return teardownLongCapture(session);
}

async function finishLongCapture() {
  const session=longCapture;
  if(!session||session.finishing)return {ok:false,error:'正在准备长图'};
  if(!session.controller)return {ok:false,error:'正在准备采集，请稍候再完成'};
  session.finishing=true;
  session.controller.pause('正在生成完整长图…','finishing');
  try {
    await session.controller.stop();session.worker?.stop();
    if(session.preview&&!session.preview.isDestroyed())session.preview.hide();
    const model=session.controller.model,image=nativeImage.createFromBitmap(model.bitmap(),{width:model.width,height:model.height,scaleFactor:1});
    const png=image.toPNG();if(png.length>imageEditor.MAX_BYTES)throw Error('长图超过 64 MB，请减小选区后重试');
    await writeClipboardImage(image);
    await ensureDirs();const filePath=path.join(capturesDir(),makeId('long')+'.png');await fsp.writeFile(filePath,png);
    const item=store.addItem({kind:'image',title:'滚动长截图',filePath,thumbnail:thumbnailDataUrl(image),source:{type:'screenshot',acquisitionMethod:'long-capture'},meta:{width:model.width,height:model.height,hash:hashBuffer(png),byteSize:png.length,captureKind:'long',frames:model.frames}});
    await store.save();broadcast('content:changed',{itemId:item.id});
    longCapture=null;
    for(const target of [session.outline,session.preview,session.win])if(target&&!target.isDestroyed())target.destroy();
    releaseLongCaptureEscape();mainWasVisible=false;
    toastToUser('长截图已复制');
    return {ok:true,item,copied:true};
  }catch(error){
    session.finishing=false;session.controller.stage='paused';
    session.controller.message=error.message||'长图生成失败';
    if(session.win&&!session.win.isDestroyed())session.win.webContents.send('long-capture:state',session.controller.state());
    return {ok:false,error:error.message||'长图生成失败'};
  }
}

/* 图片编辑复用截图标注画布，但拥有独立窗口、输入与输出，不读取桌面。 */
async function openImageEditor(options = {}) {
  try {
    let filePath = options.filePath || '', sourceItem = null;
    if (options.itemId) {
      sourceItem = store.getItem(String(options.itemId));
      if (!sourceItem || sourceItem.kind !== 'image' || !sourceItem.filePath) return { ok:false, error:'原图片不存在或已被清理' };
      filePath = sourceItem.filePath;
    }
    // 打开入口先呈现工作台，用户可以点打开、拖入或粘贴图片。
    const payload = filePath ? await imageEditor.loadImage(filePath, nativeImage) : options.dataUrl
      ? {dataUrl:options.dataUrl,size:imageEditor.validateImage(imageEditor.decodeOutput(options.dataUrl,nativeImage)),name:'粘贴图片.png'} : null;
    if (payload && options.tool === 'select') payload.tool = 'select';
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const compact = Boolean(sourceItem);
    const width = Math.min(1120, area.width, compact ? Math.max(680, payload.size.width + 32) : 1120);
    const previewHeight = compact ? Math.min(payload.size.height, (width - 32) * payload.size.height / payload.size.width) : 0;
    const height = Math.min(800, area.height, compact ? Math.max(172, Math.ceil(previewHeight) + 112) : 800);
    const win = new BrowserWindow({
      width, height, minWidth:Math.min(640, area.width), minHeight:Math.min(compact ? 172 : 480, area.height),
      show:false,frame:false,thickFrame:false,hasShadow:false,backgroundColor:nativeTheme.shouldUseDarkColors?'#18191b':'#f0f0f3',
      title:'随序 · 改图',icon:assetPath('icon.ico'),
      webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:false,spellcheck:false}
    });
    prepareFloatingSurface(win);
    const session = {win,payload,filePath,sourceId:sourceItem?.id||'',busy:false};
    const editorId=win.webContents.id;
    editorWindows.set(editorId,session);
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',event=>event.preventDefault());
    win.once('closed',()=>editorWindows.delete(editorId));
    await win.loadFile(path.join(__dirname,'src','overlay.html'),{query:{mode:'image-editor', ...(compact ? {compact:'1'} : {})}}).catch(error=>{win.destroy();throw error;});
    win.show();win.focus();
    if(quickWindow&&!quickWindow.isDestroyed())hideQuickPanel();
    if(clipboardBarWindow&&!clipboardBarWindow.isDestroyed())hideClipboardBar();
    return {ok:true};
  } catch(error) { return {ok:false,error:error.message||'无法打开图片编辑器'}; }
}

async function finishImageEdit(session, payload) {
  if(session.busy)return {ok:false,error:'正在处理图片，请稍候'};
  session.busy=true;
  try {
    if(!session.payload)return {ok:false,error:'请先打开图片'};
    const action=String(payload?.action||'copy');
    if(!['copy','save','pin','ocr'].includes(action))return {ok:false,error:'不支持的图片操作'};
    const image=imageEditor.decodeOutput(payload?.dataUrl,nativeImage);
    let destination='';
    if(action==='save') {
      const name=path.parse(session.payload.name).name;
      const selected=await dialog.showSaveDialog(session.win,{title:'另存编辑后的图片',defaultPath:path.join(app.getPath('pictures'),name+'-已编辑.png'),filters:[{name:'PNG 图片',extensions:['png']}]});
      if(selected.canceled||!selected.filePath)return {ok:false,canceled:true};
      destination=selected.filePath;
      if(path.extname(destination).toLowerCase()!=='.png')destination+='.png';
      if(await imageEditor.isOriginalDestination(session.filePath,destination))return {ok:false,error:'请使用新的文件名，原图片会保留'};
    }
    const png=image.toPNG(),size=image.getSize();
    await ensureDirs();
    const filePath=path.join(capturesDir(),makeId('edited')+'.png');
    await fsp.writeFile(filePath,png);
    try { if(destination)await fsp.writeFile(destination,png); }
    catch(error){await fsp.rm(filePath,{force:true}).catch(()=>{});throw error;}
    const item=store.addItem({kind:'image',title:path.parse(session.payload.name).name+' · 已编辑',filePath,thumbnail:thumbnailDataUrl(image),
      source:{type:'derived',acquisitionMethod:'image-edit'},parentIds:session.sourceId?[session.sourceId]:[],
      meta:{hash:hashBuffer(png),width:size.width,height:size.height,byteSize:png.length,derivedBy:'image.edit',originItemId:session.sourceId}});
    await store.save();broadcast('content:changed',{itemId:item.id});
    if(action==='copy')await writeClipboardImage(image);
    if(action==='pin')createPinWindow(pathToFileURL(filePath).href,size);
    if(action==='ocr') {
      const result=await actions.execute(item.id,'ocr.local');
      return {...result,item};
    }
    return {ok:true,item,message:action==='save'?'已另存为，并保存到内容库':action==='pin'?'已钉在桌面':'已复制，并保存到内容库'};
  } catch(error) {return {ok:false,error:error.message||'图片处理失败'};}
  finally{session.busy=false;}
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
      lockWorkstation,
      // 速记：接着最近一条写，没有才新建
      openNote: () => openLatestNote(),
      openVoiceInput,
      openTextTools,
      openImageEditor: () => openImageEditor()
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
 * 执行某个键位当前的有效绑定（自定义优先，回落出厂默认）。
 * 自定义绑定支持：内置动作 / 应用 / 文件夹 / 网页 / 任意文件。
 */
async function runBindingKey(key) {
  if (!store) return { ok: false, error: '数据层尚未就绪' };
  const binding = effectiveBinding(store.getPanelBindings(), key);
  if (!binding || binding.type === 'none') return { ok: false, error: '这个键还没有绑定内容' };
  if (binding.type === 'action') return runPanelAction(binding.id);
  if(binding.type==='recipe'){
    const recipe=getRecipe(binding.id,store.data.recipes||[]);if(!recipe)return {ok:false,error:'组合动作已被删除，请重新绑定'};
    let item;
    if(panelSelection&&store.getSettings().selectionEnabled&&quickWindow?.isVisible()&&Date.now()-panelSelection.createdAt<60000&&recipe.accepts.includes('text')){item=store.addItem({kind:'text',text:panelSelection.text,source:{type:'selection'},title:actions.safeTitle(panelSelection.text)});await store.save();}
    else item=store.listItems({limit:100}).find(entry=>!entry.meta?.workspace&&recipe.accepts.includes(entry.kind));
    if(!item)return {ok:false,error:'没有适合的内容，请先复制文字或截图'};
    const result=await runRecipe({execute:(id,action)=>actions.execute(id,action),recipes:store.data.recipes||[]},item.id,binding.id,{commit:true});
    return {...result,message:result.ok?'组合动作已完成'+(result.steps.some(step=>!step.ok)?'（已跳过失败步骤，请检查轨迹）':''):result.error};
  }
  if (binding.type === 'url') {
    if (!isSafeHttpUrl(binding.target)) return { ok: false, error: '不是可打开的网址' };
    await shell.openExternal(binding.target);
    return { ok: true, closePanel: true, message: `已打开网页：${binding.name || binding.target}` };
  }
  // app / folder / file 都交给系统默认方式打开
  if (!binding.target || !fs.existsSync(binding.target)) {
    return { ok: false, error: `「${binding.name || binding.target}」不存在或已被移动` };
  }
  const error = await shell.openPath(binding.target);
  if (error) return { ok: false, error };
  return { ok: true, closePanel: true, message: `已打开：${binding.name || binding.target}` };
}

const globalPanelRunning=new Set();
async function dispatchGlobalPanelAction(action) {
  const key=actionKey(store.getPanelBindings(),action);
  if(key)return runGlobalPanelKey(key);
  return runPanelAction(action);
}
async function runGlobalPanelKey(key) {
  // 截图/编辑时，键盘仍只服务当前工具；避免长按重复创建多个窗口。
  if(globalPanelRunning.has(key))return;
  if(captureBusy||longCapture||longCaptureStarting) {
    // Recover the existing tool rather than silently dropping every global action.
    const active = longPickerPayload ? longPickerWindow : longCapture?.win || (capturePayload ? overlayWindow : null);
    if (active && !active.isDestroyed() && active.isVisible()) active.showInactive();
    return;
  }
  globalPanelRunning.add(key);
  try {
    const result=await runBindingKey(key);
    if(result?.openClipboardBar){await showClipboardBar();return;}
    if(result?.openPage){hideQuickPanel();showMain(result.openPage);return;}
    if(result?.translate||result?.ocr||result?.output||!result?.ok) {
      await showQuickPanel();
      await quickWindow?.__loaded;
      quickWindow?.webContents.send('panel:result',result);
      return;
    }
    if(result?.closePanel)hideQuickPanel();
  }catch(error){await showQuickPanel();quickWindow?.webContents.send('panel:result',{ok:false,error:error.message||'动作执行失败'});}
  finally{globalPanelRunning.delete(key);}
}

/**
 * 取出开始菜单快捷方式的图标并转成 data URL。
 * 结果按路径缓存：图标是静态资源，不需要每次打开面板都重新提取。
 */
function getAppIconLoader() {
  const dataUrl=image=>{
    if(!image||image.isEmpty())return '';
    const size=image.getSize();
    const ratio=Math.min(1,256/Math.max(size.width,size.height));
    return ratio<1?image.resize({width:Math.max(1,Math.round(size.width*ratio)),height:Math.max(1,Math.round(size.height*ratio)),quality:'best'}).toDataURL():image.toDataURL();
  };
  if(!appIconLoader)appIconLoader=createAppIconLoader({
    diskCache:createIconDiskCache(path.join(userRoot(),'cache','app-icons-v3.json')),
    readShortcutLink:filePath=>shell.readShortcutLink(filePath),
    getFileIcon:async filePath=>dataUrl(await app.getFileIcon(filePath,{size:'large'})),
    loadImage:filePath=>dataUrl(nativeImage.createFromPath(filePath)),
    extractResources:async sources=>{
      if(!sources.length)return [];
      if(!appIconHost)appIconHost=ensureNativeHost({sourcePath:assetPath('app-icon-host.cs'),targetPath:path.join(userRoot(),'app-icon-host-v2.exe'),references:['System.Drawing.dll']});
      return extractResourceBatch(await appIconHost,sources);
    }
  });
  return appIconLoader;
}

// 每个钉图窗口的期望尺寸：透明窗在 Windows 上被拖动时可能被系统悄悄改大，
// 移动/缩放后按这里记录的期望值核对，发现漂移立即拉回。
const pinExpectedSize = new WeakMap();
const PIN_COLLAPSED_HEIGHT = 60;

function createPinWindow(dataUrl, size = {}, content = null) {
  if(!content&&String(dataUrl||'').startsWith('file:')){try{content=store.data.items.find(item=>item.kind==='image'&&item.filePath===fileURLToPath(dataUrl));}catch{}}
  const display=screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const ratio=(size.height||600)/Math.max(1,size.width||800);
  const width=Math.max(100,Math.min(560,size.width||800,display.workArea.width-40,(display.workArea.height-60)/ratio));
  const height=Math.max(60,Math.round(width*ratio));
  const pin=new BrowserWindow({
    // resizable 必须关：Windows 下 transparent + resizable 的无边框窗带 WS_THICKFRAME，
    // 程序化移动时系统会反复改写窗口尺寸，表现为「一拖就越来越大」。
    // 缩放一律走 zoom() → pin:resize 的 setBounds，不依赖原生边缘拖拽。
    width:Math.round(width),height,frame:false,alwaysOnTop:true,resizable:false,skipTaskbar:false,
    transparent:true,thickFrame:false,hasShadow:false,backgroundColor:'#00000000',title:'随序 · 钉图',
    webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:false,spellcheck:false,preload: path.join(__dirname, 'pin-preload.js')}
  });
  pin.__pinData={url:String(dataUrl||''),width:Math.round(width),height,kind:content?.kind||'image',text:content?.text||'',itemId:content?.id||''};
  pinExpectedSize.set(pin,{width:Math.round(width),height});
  prepareFloatingSurface(pin);
  pin.loadFile(path.join(__dirname,'src','pin.html'));
  pinWindows.add(pin);
  pin.on('closed',()=>pinWindows.delete(pin));
  return pin;
}

/* ---------- 速记（Quick Note） ---------- */

const NOTE_SIZE = { width: 760, height: 550 };
/** 速记写盘防抖：逐字落盘会让每次敲键都重写整个数据文件。 */
const NOTE_SAVE_DEBOUNCE_MS = 700;
/** noteId → BrowserWindow。多页 = 多窗口，与「每个窗口一条笔记」一一对应。 */
const noteWindows = new Map();
let noteSaveTimer = null;

/** 防抖落盘 + 广播变更（列表页与已开窗口都要看到最新正文）。 */
function scheduleNoteSave() {
  if (noteSaveTimer) clearTimeout(noteSaveTimer);
  noteSaveTimer = setTimeout(() => {
    noteSaveTimer = null;
    if (!store) return;
    store.save().catch(() => {});
  }, NOTE_SAVE_DEBOUNCE_MS);
  if (noteSaveTimer.unref) noteSaveTimer.unref();
}

/** 立刻把速记落盘（关窗、退出、切笔记时调用，避免丢最后一次输入）。 */
async function flushNotes() {
  if (noteSaveTimer) { clearTimeout(noteSaveTimer); noteSaveTimer = null; }
  if (store) await store.save();
}

function broadcastNotes() {
  broadcast('notes:changed', store ? store.listNotes() : []);
}

/** 速记窗口的位置：先取笔记自己记住的位置，再校验它是否还在某个显示器上。 */
function noteWindowBounds(note) {
  const displays = screen.getAllDisplays();
  const fallback = {
    width: NOTE_SIZE.width,
    height: NOTE_SIZE.height,
    minVisibleWidth: 160,
    minVisibleHeight: 120
  };
  return sanitizeWindowBounds(note?.bounds || null, displays, fallback);
}

function createNoteWindow(noteId) {
  const note = store ? store.getNote(noteId) : null;
  if (!note) return null;
  const bounds = noteWindowBounds(note);
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 240,
    minHeight: 200,
    show: false,
    frame: false,
    thickFrame: false,
    hasShadow: false,
    // 钉住的速记浮在其它窗口之上；未钉住就是普通窗口，不抢屏幕
    alwaysOnTop: Boolean(note.pinned),
    transparent: true,
    backgroundColor: '#00000000',
    title: '随序 · 速记',
    icon: assetPath('suira-icon.png'),
    roundedCorners: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });
  prepareFloatingSurface(win, 22);
  noteWindows.set(noteId, win);
  win.loadFile(path.join(__dirname, 'src', 'notes.html'));
  win.setMenuBarVisibility(false);
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('notes:opened', { id: noteId });
  });
  // 位置记忆：拖动/缩放结束后写回 store（500ms 防抖）
  let boundsTimer = null;
  const rememberBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (win.isDestroyed() || !store) return;
      store.setNoteBounds(noteId, win.getBounds());
      scheduleNoteSave();
    }, 500);
    if (boundsTimer.unref) boundsTimer.unref();
  };
  win.on('resize', rememberBounds);
  win.on('move', rememberBounds);
  win.on('close', () => {
    if (!store || win.isDestroyed()) return;
    store.setNoteBounds(noteId, win.getBounds());
    // 关窗是低频动作：立刻落盘，不等防抖（否则退出时最后的位置会丢）
    store.save().catch(() => {});
  });
  win.on('closed', () => {
    noteWindows.delete(noteId);
    scheduleNoteSave();
    broadcastNotes();
  });
  let revealed = false;
  const reveal = () => {
    if (revealed || win.isDestroyed()) return;
    revealed = true;
    win.show();
    win.focus();
  };
  win.once('ready-to-show', reveal);
  const revealTimer = setTimeout(reveal, 2500);
  if (revealTimer.unref) revealTimer.unref();
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeHttpUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  return win;
}

/** 打开一条速记（已开就置前）。 */
async function openNoteWindow(noteId) {
  if (!store) return { ok: false, error: '数据未就绪' };
  const note = store.getNote(noteId);
  if (!note) return { ok: false, error: '这条速记已不存在' };
  const existing = noteWindows.get(noteId);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return { ok: true, id: noteId };
  }
  return createNoteWindow(noteId) ? { ok: true, id: noteId } : { ok: false, error: '速记窗口创建失败' };
}

/**
 * 面板 N 键 / 工具箱入口：接着最近一条写，没有才新建。
 * 每次都新建会留下一堆空笔记 —— 那不是顺手，是制造垃圾。
 */
async function openLatestNote() {
  if (!store) return { ok: false, error: '数据未就绪' };
  const latest = store.latestNote();
  if (latest) return openNoteWindow(latest.id);
  const note = store.createNote({ text: '' });
  if (!note) return { ok: false, error: '速记创建失败' };
  await store.save();
  broadcastNotes();
  return openNoteWindow(note.id);
}

function closeNoteWindow(noteId) {
  const win = noteWindows.get(noteId);
  if (win && !win.isDestroyed()) win.close();
  else noteWindows.delete(noteId);
}

function registerIpc() {
  ipcMain.handle('voice:open', event => {
    const caller = BrowserWindow.fromWebContents(event.sender);
    if (caller !== quickWindow && caller !== mainWindow) return { ok: false, error: '语音输入入口无效' };
    return openVoiceInput({ preview: caller === mainWindow });
  });
  ipcMain.handle('voice:status', event => {
    if (BrowserWindow.fromWebContents(event.sender) !== voiceWindow) return { ok: false, error: '语音窗口无效' };
    return voiceStatus();
  });
  ipcMain.handle('voice:open-settings', event => {
    if (BrowserWindow.fromWebContents(event.sender) !== voiceWindow) return { ok: false, error: '语音窗口无效' };
    const win = voiceWindow;
    win?.close();
    showMain('settings:voice');
    return { ok: true };
  });
  ipcMain.handle('voice:transcribe', async (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win !== voiceWindow || !win) return { ok: false, error: '语音窗口无效' };
    if (voiceRequestController) return { ok: false, error: '正在识别上一段录音' };
    const config = voiceConfig();
    const target = voiceSessionTarget;
    const controller = voiceRequestController = new AbortController();
    try {
      const result = await voiceInput.transcribe({ pcm: payload?.pcm, format: config.format, baseUrl: config.baseUrl,
        model: config.model, apiKey: config.apiKey, fetchImpl: electron.net.fetch, signal: controller.signal });
      if (controller.signal.aborted || voiceWindow !== win) return { ok: false, cancelled: true };
      if (!result.ok) return result;
      if (!result.text?.trim()) return { ok: false, error: '没有识别到语音' };
      await writeClipboardText(result.text);
      // Check the same foreground window and native focused control immediately
      // before sending Ctrl+V. Dictation never activates a window behind the user.
      if (!target?.focusHwnd || controller.signal.aborted || voiceWindow !== win) return { ok: true, pasted: false };
      const pasted = await foregroundProbe.pasteTo(target, { stayInForeground: true });
      return { ok: true, pasted: pasted.ok };
    } finally {
      if (voiceRequestController === controller) voiceRequestController = null;
    }
  });
  ipcMain.handle('voice:close', event => {
    if (BrowserWindow.fromWebContents(event.sender) !== voiceWindow) return { ok: false };
    voiceWindow.close();
    return { ok: true };
  });

  /* ---- 钉图窗口控制 ---- */
  // 每个钉图窗口独立保存收起前的边界，便于恢复
  const pinState = new WeakMap();

  const pinFromEvent = (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win && pinWindows.has(win) ? win : null;
  };

  const pinOnly = handler => async(event,payload)=>{
    const win=pinFromEvent(event);if(!win||win.isDestroyed())return {ok:false,error:'钉图已关闭'};
    try{return await handler(win,payload);}catch(error){return {ok:false,error:error.message};}
  };
  const pinImage = win => {
    const url=win.__pinData?.url||'';
    const image=url.startsWith('file:')?nativeImage.createFromPath(fileURLToPath(url)):nativeImage.createFromDataURL(url);
    if(image.isEmpty())throw Error('图片无法读取');return image;
  };
  ipcMain.handle('pin:data',pinOnly(win=>({ok:true,data:win.__pinData})));
  ipcMain.handle('pin:copy',pinOnly(async win=>{if(win.__pinData?.kind==='text')await writeClipboardText(win.__pinData.text);else await writeClipboardImage(pinImage(win));return {ok:true};}));
  ipcMain.handle('pin:save',pinOnly(async win=>{
    if(win.__pinData?.kind==='text'){
      const result=await dialog.showSaveDialog(win,{title:'保存文字',defaultPath:path.join(app.getPath('documents'),'随序文字.txt'),filters:[{name:'文字',extensions:['txt']}]});
      if(result.canceled||!result.filePath)return {ok:false,canceled:true};await fsp.writeFile(result.filePath,win.__pinData.text,'utf8');return {ok:true};
    }
    const image=pinImage(win);
    const result=await dialog.showSaveDialog(win,{title:'保存钉图',defaultPath:path.join(app.getPath('pictures'),'随序钉图.png'),filters:[{name:'PNG 图片',extensions:['png']}]});
    if(result.canceled||!result.filePath)return {ok:false,canceled:true};
    await fsp.writeFile(result.filePath,image.toPNG());return {ok:true,filePath:result.filePath};
  }));
  ipcMain.handle('pin:top',pinOnly(win=>{const value=!win.isAlwaysOnTop();win.setAlwaysOnTop(value);return {ok:true,alwaysOnTop:value};}));
  ipcMain.on('pin:move',(event,point)=>{
    const win=pinFromEvent(event);if(!win||win.isDestroyed()||![point?.x,point?.y].every(Number.isFinite))return;
    const x=Math.round(point.x),y=Math.round(point.y),area=screen.getDisplayNearestPoint({x,y}).workArea;
    const bounds=win.getBounds();
    win.setPosition(Math.max(area.x-bounds.width+40,Math.min(area.x+area.width-40,x)),Math.max(area.y,Math.min(area.y+area.height-40,y)));
    // 拖动后被系统改了尺寸（透明窗在部分环境下会这样）：立即按期望尺寸纠正
    const expected=pinExpectedSize.get(win);
    if(expected){
      const current=win.getBounds();
      if(current.width!==expected.width||current.height!==expected.height){
        win.setBounds({x:current.x,y:current.y,width:expected.width,height:expected.height});
      }
    }
  });

  ipcMain.on('pin:resize', (event, payload) => {
    const win = pinFromEvent(event);
    if (!win || win.isDestroyed()) return;
    if (pinState.get(win)?.collapsed) return;
    const width = Math.max(80, Math.min(4000, Math.round(Number(payload?.width) || 0)));
    const height = Math.max(60, Math.min(4000, Math.round(Number(payload?.height) || 0)));
    if (!width || !height) return;
    const bounds = win.getBounds();
    // 以左上角为锚点缩放，避免窗口跑到屏幕外
    win.setBounds({ x: bounds.x, y: bounds.y, width, height });
    pinExpectedSize.set(win, { width, height });
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
      state.savedSize = pinExpectedSize.get(win) || { width: state.savedBounds.width, height: state.savedBounds.height };
      state.savedOpacity = win.getOpacity();
      state.collapsed = true;
      pinState.set(win, state);
      const b = state.savedBounds;
      // 收成一条细窄条，仍可见可点回
      const collapsedWidth = Math.max(72, Math.min(b.width, 120));
      win.setBounds({ x: b.x, y: b.y, width: collapsedWidth, height: PIN_COLLAPSED_HEIGHT });
      pinExpectedSize.set(win, { width: collapsedWidth, height: PIN_COLLAPSED_HEIGHT });
      win.setOpacity(0.85);
    } else {
      if (!state.collapsed) return;
      state.collapsed = false;
      pinState.set(win, state);
      if (state.savedBounds) {
        // 收起后的位置可以改变：展开时保留当前位置，只恢复原来的尺寸。
        const current = win.getBounds();
        const area = screen.getDisplayNearestPoint({ x: current.x, y: current.y }).workArea;
        const size = state.savedSize || state.savedBounds;
        win.setBounds({ width: size.width, height: size.height,
          x: Math.max(area.x, Math.min(current.x, area.x + area.width - size.width)),
          y: Math.max(area.y, Math.min(current.y, area.y + area.height - size.height)) });
        pinExpectedSize.set(win, { width: size.width, height: size.height });
      }
      win.setOpacity(state.savedOpacity || 1);
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

  const senderWindow = event => BrowserWindow.fromWebContents(event.sender);
  const resizingWindows = new WeakMap();
  ipcMain.on('window:resize-start', (event, edge) => {
    const win = senderWindow(event);
    if (!win || (!win.__surfaceRadius && ![...noteWindows.values()].includes(win)) || !win.isResizable() || win.isMaximized() || !WINDOW_EDGES.has(edge)) return;
    resizingWindows.set(win, { edge, bounds: win.getBounds(), cursor: screen.getCursorScreenPoint() });
  });
  ipcMain.on('window:resize-step', event => {
    const win = senderWindow(event), drag = win && resizingWindows.get(win);
    if (!drag || win.isDestroyed() || win.isMaximized()) return;
    const cursor = screen.getCursorScreenPoint(), minimum = win.getMinimumSize();
    let bounds=resizeBounds(drag.bounds, drag.edge, cursor.x - drag.cursor.x, cursor.y - drag.cursor.y, minimum[0] || 240, minimum[1] || 200);
    if(win===mainWindow||[...workspaceWindows.values()].includes(win))bounds=fitWorkArea(bounds,screen.getDisplayMatching(bounds).workArea,2);
    win.setBounds(bounds);
  });
  ipcMain.on('window:resize-end', event => {
    const win = senderWindow(event); if (win) resizingWindows.delete(win);
  });

  ipcMain.handle('window:minimize', event => senderWindow(event)?.minimize());
  ipcMain.handle('window:maximize', event => {
    const win=senderWindow(event);if(!win)return false;
    if(win.isMaximized())win.unmaximize();else win.maximize();return win.isMaximized();
  });
  ipcMain.handle('window:close', event => senderWindow(event)?.close());
  ipcMain.handle('window:pin', event => {const win=senderWindow(event);if(!win)return false;win.setAlwaysOnTop(!win.isAlwaysOnTop());return win.isAlwaysOnTop();});
  ipcMain.handle('window:is-maximized', event => Boolean(senderWindow(event)?.isMaximized()));
  ipcMain.handle('window:reset',event=>{
    const win=senderWindow(event);if(!win?.__desktopWindow)return {ok:false};
    const area=screen.getDisplayMatching(win.getBounds()).workArea;
    const width=Math.min(win.__tool==='markdown'?1300:1180,area.width-48),height=Math.min(win.__tool?860:820,area.height-48);
    if(win.isMaximized())win.unmaximize();
    win.setBounds({x:Math.round(area.x+(area.width-width)/2),y:Math.round(area.y+(area.height-height)/2),width,height});
    return {ok:true};
  });
  ipcMain.handle('window:state',event=>{const win=senderWindow(event);return {focused:Boolean(win?.isFocused()),maximized:Boolean(win?.isMaximized())};});
  ipcMain.handle('window:hide', event => senderWindow(event)?.hide());
  ipcMain.handle('workspace:open', (_event,type) => {if(!['calendar','markdown'].includes(type))return {ok:false};showWorkspaceWindow(type);return {ok:true};});
  ipcMain.handle('workspace:close-ready', event => {const win=senderWindow(event);if([...workspaceWindows.values()].includes(win)){win.__allowClose=true;win.close();}return {ok:true};});

  ipcMain.handle('quick:hide', () => hideQuickPanel());
  ipcMain.handle('quick:presentation',()=>({mode:quickWindow?.isVisible()?(quickWindow.__launchpadFullscreen?'fullscreen':'window'):(store.getSettings().panelPresentation||'window')}));
  ipcMain.handle('material:preferences',event=>{
    const win=BrowserWindow.fromWebContents(event.sender);
    if(!win||!win.__surfaceRadius)return {};
    return {nativeGlass:Boolean(win.__systemGlass),reducedTransparency:Boolean(nativeTheme.prefersReducedTransparency),highContrast:Boolean(nativeTheme.shouldUseHighContrastColors)};
  });
  ipcMain.handle('quick:background',()=>({dataUrl:'',source:'native'}));
  ipcMain.on('quick:prepared',(event,token)=>{
    const pending=quickWindow?.__prepareShow;
    if(event.sender===quickWindow?.webContents&&pending?.token===token)pending.finish();
  });
  ipcMain.handle('quick:presentation:set',async(event,mode,options)=>{
    if(event.sender!==quickWindow?.webContents||!['window','fullscreen'].includes(mode))return {ok:false,error:'无效的显示模式'};
    if(options?.remember!==false)await store.updateSettings({panelPresentation:mode});
    positionQuickPanel(quickWindow,mode);
    return {ok:true,mode};
  });
  ipcMain.handle('quick:show', () => { showQuickPanel(); return { ok: true }; });
  ipcMain.handle('quick:toggle', () => { toggleQuickPanel(); return { ok: true }; });
  ipcMain.handle('quick:open-main', (_event, page) => { hideQuickPanel(); showMain(page || 'shelf'); return { ok: true }; });
  ipcMain.handle('quick:capture', () => beginScreenCapture('quick'));
  ipcMain.handle('quick:show-main', (_event, page) => { hideQuickPanel(); showMain(page); return { ok: true }; });

  /* ---- 浮引岛（文件中转） ---- */
  ipcMain.handle('island:get-state', () => islandState());  ipcMain.handle('island:toggle', () => toggleIsland());
  ipcMain.handle('island:add-paths', async (_event, paths) => addIslandPaths(paths));
  ipcMain.handle('island:remove-item', async (_event, id) => {
    const current = store.getIsland();
    const next = islandModel.removeShelfItem(current.items, String(id || ''));
    if (next.length === current.items.length) return { ...islandState(), ok: false, error: '暂存条目不存在' };
    await store.updateIsland({ items: next });
    islandUndoStack.push(current.items);
    if (islandUndoStack.length > 10) islandUndoStack.shift();
    scheduleIslandRest();
    broadcastIsland();
    return islandState();
  });
  ipcMain.handle('island:clear', async () => {
    const previous = store.getIsland().items;
    await store.updateIsland({ items: [] });
    if (previous.length) {
      islandUndoStack.push(previous);
      if (islandUndoStack.length > 10) islandUndoStack.shift();
    }
    scheduleIslandRest();
    broadcastIsland();
    return islandState();
  });
  ipcMain.handle('island:undo', async () => {
    const previous = islandUndoStack.pop();
    if (!previous) return { ...islandState(), ok:false, error:'没有可找回的暂存记录' };
    const restored = islandModel.addShelfItems(store.getIsland().items, previous, { cap:ISLAND_MAX_ITEMS });
    try { await store.updateIsland({items:restored.items}); }
    catch (error) { islandUndoStack.push(previous); throw error; }
    broadcastIsland();
    scheduleIslandRest();
    return { ...islandState(), restored:restored.added, dropped:restored.dropped };
  });
  ipcMain.handle('island:set-policy', async (_event, policy) => {
    await store.updateIsland({ policy: policy === 'move' ? 'move' : 'copy' });
    broadcastIsland();
    return islandState();
  });
  ipcMain.handle('island:set-expanded', (_event, expanded) => setIslandExpanded(Boolean(expanded)));
  // 三态由渲染层按交互请求：悬停要胶囊、点击/拖入要卡片、离开要休眠
  ipcMain.handle('island:set-mode', (_event, mode) => setIslandMode(String(mode || 'sleep')));
  // 渲染层心跳：只要还有交互，就把"回休眠"的计时往后推
  ipcMain.on('island:ping', () => { if (islandMode !== 'sleep') scheduleIslandRest(); });
  ipcMain.handle('island:open-item', async (_event, id) => openIslandItem(id));
  ipcMain.handle('island:reveal-item', (_event, id) => revealIslandItem(id));
  ipcMain.handle('island:start-drag', (_event, id) => startIslandDrag(id));

  /* ---- 剪贴板历史条（底部浮层） ---- */
  ipcMain.handle('clipboard-bar:show', () => showClipboardBar());
  ipcMain.handle('clipboard-bar:hide', () => hideClipboardBar());
  ipcMain.handle('clipboard-bar:toggle', () => toggleClipboardBar());
  ipcMain.handle('clipboard-bar:copy-images', async (event, ids) => {
    const win = clipboardBarWindow;
    if (!win || win.isDestroyed() || !win.isVisible() || event.sender !== win.webContents) {
      return { ok: false, error: '请从剪贴板历史操作' };
    }
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 120 || ids.some(id => typeof id !== 'string' || id.length > 200)) {
      return { ok: false, error: '请选择有效的图片记录' };
    }
    const items = [...new Set(ids)].map(id => store.getItem(id));
    if (items.some(item => item?.kind !== 'image' || !item.filePath || !path.isAbsolute(item.filePath))) {
      return { ok: false, error: '部分图片已不在历史记录中，请重新勾选' };
    }
    const paths = [...new Set(items.map(item => item.filePath))];
    const originals = await Promise.all(paths.map(file => fsp.stat(file).catch(() => null)));
    if (originals.some(file => !file?.isFile())) return { ok: false, error: '部分原图已被移动或删除' };
    if (win.isDestroyed() || !win.isVisible()) return { ok: false, error: '剪贴板面板已关闭' };
    try {
      require('./lib/clipboard-file-list').copyFileList(win.getNativeWindowHandle(), paths);
      // Do not record our own file list as another clipboard history item.
      ++captureGeneration;
      lastClipboardSequence = inputInjector.clipboardSequence();
      lastClipboardFilesKey = paths.join('\n').toLowerCase();
      lastClipboardText = lastClipboardImageHash = lastClipboardImageKey = lastClipboardImageType = '';
      lastClipboardImageRaw = null;
      return { ok: true, count: paths.length };
    } catch (error) {
      return { ok: false, error: error.message || '无法复制图片文件' };
    }
  });
  ipcMain.handle('clipboard-bar:save-image', async (event, id) => {
    const win = clipboardBarWindow;
    if (!win || win.isDestroyed() || !win.isVisible() || event.sender !== win.webContents || win.__savingImage) {
      return { ok: false, error: '请从剪贴板历史操作' };
    }
    const item = store.getItem(String(id || ''));
    const extension = path.extname(item?.filePath || '').toLowerCase();
    if (item?.kind !== 'image' || !imageEditor.EXTENSIONS.includes(extension.slice(1))) {
      return { ok: false, error: '原图片不存在或格式不支持' };
    }
    win.__savingImage = true;
    try {
      const source = await fsp.stat(item.filePath).catch(() => null);
      if (!source?.isFile()) return { ok: false, error: '原图片不存在或已被移动' };
      const name = (item.title || '随序图片').replace(/[\\/:*?"<>|]/g, '_');
      const result = await dialog.showSaveDialog(win, {
        title: '另存剪贴板图片',
        defaultPath: path.join(app.getPath('pictures'), name + extension),
        filters: [{ name: `${extension.slice(1).toUpperCase()} 图片`, extensions: [extension.slice(1)] }]
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      if (path.extname(result.filePath).toLowerCase() !== extension) {
        return { ok: false, error: `请选择 ${extension} 扩展名以保留原图格式` };
      }
      if (await imageEditor.isOriginalDestination(item.filePath, result.filePath)) {
        return { ok: false, error: '请选择其他位置，原图会保留' };
      }
      await fsp.copyFile(item.filePath, result.filePath);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.code === 'ENOENT' ? '原图片或保存位置已不可用' : '无法保存图片，请检查目标位置' };
    } finally {
      win.__savingImage = false;
    }
  });

  ipcMain.handle('app:info', event => ({
    name: APP_NAME,
    version: app.getVersion(),
    userData: userRoot(),
    dataPath: dataPath(),
    shortcuts: shortcutBindings(),
    nativeBlur: Boolean(senderWindow(event)?.__nativeBlur),
    runtime: 'Electron prototype'
  }));
  ipcMain.handle('app:open-data-dir', () => shell.openPath(userRoot()));
  ipcMain.handle('app:font-license', () => shell.openPath(assetPath('fonts', 'MiSans-LICENSE.pdf')));
  ipcMain.handle('app:restart', () => { restartApplication(); return {ok:true}; });
  ipcMain.handle('updates:state',()=>updates().snapshot());
  ipcMain.handle('updates:check',()=>updates().check());
  ipcMain.handle('updates:download',()=>updates().download());
  ipcMain.handle('updates:install',event=>event.sender===quickWindow?.webContents?updates().install():{...updates().snapshot(),phase:'error',message:'请从更新面板安装'});
  ipcMain.handle('app:quit',event=>{if(event.sender!==quickWindow?.webContents)return {ok:false};isQuitting=true;app.quit();return {ok:true};});
  ipcMain.handle('app:releases',async()=>{await shell.openExternal('https://github.com/huihui200739/suira-updates/releases');return {ok:true};});

  ipcMain.handle('capture:start', (_event, options) => beginScreenCapture('main', options || {}));
  ipcMain.handle('capture:start-long',(event,selection)=>event.sender===longPickerWindow?.webContents?startLongCapture(selection,true):event.sender===overlayWindow?.webContents&&!longPickerPayload?startLongCapture(selection):{ok:false,error:'请从截图选区开始长截图'});
  ipcMain.handle('long-picker:ready',(event,revision)=>{const ack=longPickerWindow?.__pickerAck;if(event.sender===longPickerWindow?.webContents&&ack?.revision===revision){longPickerWindow.__pickerAck=null;ack.done();}return {ok:true};});
  ipcMain.handle('long-picker:cancel',event=>event.sender===longPickerWindow?.webContents?cancelLongPicker():{ok:false});
  ipcMain.handle('long-capture:state',event=>event.sender===longCapture?.win?.webContents?longCaptureState():null);
  ipcMain.handle('long-capture:command',(event,command)=>{
    const session=longCapture;
    if(!session||session.win?.isDestroyed?.()||event.sender!==session.win?.webContents)return {ok:false,error:'长截图已结束'};
    if(command==='cancel')return cancelLongCapture();
    if(command==='finish')return finishLongCapture();
    if(session.finishing)return {ok:false,error:'正在生成长图'};
    if(!session.controller)return {ok:false,error:'正在准备采集，请稍候'};
    if(command==='pause'){session.controller.pause();return {ok:true};}
    if(command==='resume'){
      session.controller.resume();
      // 用户点「继续」是明确意图：把焦点还给被截的页面，滚轮和键盘都能直接滚。
      if(session.target?.hwnd&&typeof foregroundProbe.focusTo==='function')foregroundProbe.focusTo(session.target.hwnd).catch(()=>{});
      return {ok:true};
    }
    return {ok:false,error:'未知操作'};
  });
  ipcMain.handle('image-editor:open', async (event, options={}) => {
    try {
      const current=editorWindows.get(event.sender.id);
      let filePath=typeof options.filePath==='string'?options.filePath:'';
      if(options.pick) {
        const owner=current?.win||BrowserWindow.fromWebContents(event.sender);
        const selected=await dialog.showOpenDialog(owner,{title:'打开图片',properties:['openFile'],filters:[{name:'图片',extensions:imageEditor.EXTENSIONS}]});
        if(selected.canceled||!selected.filePaths.length)return {ok:false,canceled:true};
        filePath=selected.filePaths[0];
      }
      // 空工作台原位载入；已有图时另开窗口，保留尚未导出的标注。
      if(current&&!current.payload&&(filePath||options.dataUrl)) {
        const next=filePath?await imageEditor.loadImage(filePath,nativeImage)
          : {dataUrl:options.dataUrl,size:imageEditor.validateImage(imageEditor.decodeOutput(options.dataUrl,nativeImage)),name:'粘贴图片.png'};
        if(!current.win.isDestroyed()&&!current.payload) {
          current.payload=next;current.filePath=filePath;
          current.win.webContents.send('image-editor:changed');return {ok:true};
        }
      }
      return openImageEditor({filePath,itemId:options.itemId,dataUrl:options.dataUrl,tool:options.tool});
    } catch(error){return {ok:false,error:error.message||'打开图片失败'};}
  });
  ipcMain.handle('image-editor:data',event=>editorWindows.get(event.sender.id)?.payload||null);
  ipcMain.handle('image-editor:finish',(event,payload)=>{
    const editor=editorWindows.get(event.sender.id);
    return editor?finishImageEdit(editor,payload):{ok:false,error:'图片编辑窗口不可用'};
  });
  ipcMain.handle('image-editor:window',(event,command)=>{
    const win=editorWindows.get(event.sender.id)?.win;
    if(!win||win.isDestroyed())return {ok:false};
    if(command==='close')win.close();
    else if(command==='minimize')win.minimize();
    else if(command==='maximize')win.isMaximized()?win.unmaximize():win.maximize();
    return {ok:true};
  });
  ipcMain.handle('capture:get-data', () => capturePayload);
  ipcMain.handle('capture:cancel', () => {
    if(longPickerPayload)return cancelLongPicker();
    hideOverlayWindow();
    return { ok: true };
  });
  ipcMain.handle('capture:finish', async (_event, payload) => {
    try {
      const session = capturePayload;
      if (!session) return { ok: false, canceled: true };
      const result = await completeCapture(payload?.dataUrl, payload?.action || 'copy', session);
      if(result.ok&&documentCapture&&session===capturePayload){
        const item=session.intent==='document-text'?result.output:result.item;
        if(item){hideOverlayWindow({documentResult:{ok:true,text:item.text||'',itemId:item.id,url:'suira-image://'+item.id}});return result;}
      }
      if (result.ok && payload?.action === 'ocr' && session === capturePayload && session?.intent === 'ocr-return') {
        hideOverlayWindow({ textToolInput: require('./src/text-spacing').compactCapture(result.output?.text || '') });
      }
      return result;
    } catch (error) {
      return { ok: false, error: error.message || '截图处理失败' };
    }
  });

  ipcMain.handle('content:list', async (_event, options) => {
    const items = store.listItems(options || {});
    // 图片条目若缺缩略图（旧数据或生成失败），按需补齐，避免列表出现空白卡
    for (const item of items) {
      if (item.kind === 'image' && !item.thumbnail && item.filePath) {
        const thumbnail = thumbnailFor(item.filePath);
        if (thumbnail) item.thumbnail = thumbnail;
      }
    }
    if (options?.cardDetails === true) {
      // 补齐旧条目的原图信息，进程内缓存成功结果，无需迁移或写盘。
      await Promise.all(items.filter(item => item.kind === 'image' && item.filePath &&
        (!Number.isFinite(item.meta?.byteSize) || !item.meta?.width || !item.meta?.height)).map(async item => {
        const original = await fsp.stat(item.filePath).catch(() => null);
        if (!original?.isFile()) return;
        item.meta.byteSize = original.size;
        if (!item.meta.width || !item.meta.height) {
          const image = nativeImage.createFromPath(item.filePath);
          if (!image.isEmpty()) Object.assign(item.meta, image.getSize());
        }
      }));
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

  ipcMain.handle('dates:parse',(_event,text)=>require('./lib/date-parse').parseDate(String(text||'').slice(0,200000)));
  ipcMain.handle('relay:reply',(event,payload)=>{const pending=relayRequests.get(payload?.token);if(!pending||pending.sender!==event.sender.id)return {ok:false};relayRequests.delete(payload.token);clearTimeout(pending.timer);payload.ok?pending.resolve(payload):pending.reject(Error(payload.error||'接力失败'));return {ok:true};});
  ipcMain.on('workspace:active-document',(event,id)=>{const win=BrowserWindow.fromWebContents(event.sender);if(id&&store.getItem(String(id))?.meta?.workspace==='markdown')activeDocuments.set(event.sender.id,{id:String(id),win,at:Date.now()});else activeDocuments.delete(event.sender.id);});
  ipcMain.handle('workspace:calendar-draft',event=>{const draft=calendarDrafts.get(event.sender.id)||null;calendarDrafts.delete(event.sender.id);return draft;});
  ipcMain.handle('actions:list', (_event, itemId) => {
    const item = typeof itemId==='object'&&itemId?{kind:itemId.kind,text:String(itemId.text||''),qrUrl:String(itemId.qrUrl||'')}:store.getItem(String(itemId || ''));
    return actions.listForItem(item).map((id) => {
      const action = actions.actions.get(id) || {};
      return { id, label: action.label || id, hint: action.hint || '' };
    });
  });
  ipcMain.handle('actions:run', async (event, payload) => {
    let id=String(payload?.itemId||'');
    if(payload?.item&&!id){const value=payload.item,text=String(value.text||'');if(!['text','link'].includes(value.kind)||!text.trim()||text.length>200000)return {ok:false,error:'没有可接力的文字，或正文超过 20 万字符'};
      if(!actions.listForItem(value).includes(payload.actionId))return {ok:false,error:'不支持这个动作'};
      const item=store.addItem({kind:value.kind,text,title:actions.safeTitle(text),meta:{qrUrl:String(value.qrUrl||'').slice(0,8192)},source:{type:'derived',acquisitionMethod:'action-strip'},parentIds:(Array.isArray(value.parentIds)?value.parentIds:[]).filter(parent=>store.getItem(parent)).slice(0,10)});id=item.id;await store.save();}
    if(['text.to-calendar','text.pin','image.pin'].includes(payload?.actionId)&&overlayWindow&&!overlayWindow.isDestroyed()&&event.sender.id===overlayWindow.webContents.id)hideOverlayWindow({restoreMain:false});
    return actions.execute(id,String(payload?.actionId||''));
  });

  ipcMain.handle('colors:list',()=>store.data.colorHistory||[]);
  ipcMain.handle('colors:pick',async(_event,value)=>{const hex=String(value||'').toUpperCase();if(!/^#[0-9A-F]{6}$/.test(hex))return {ok:false,error:'颜色格式无效'};await writeClipboardText(hex);const previous=store.data.items.find(item=>item.meta?.pickedColor===hex);if(previous)store.touchItem(previous.id);else store.addItem({kind:'text',text:hex,title:'颜色 '+hex,source:{type:'clipboard',acquisitionMethod:'color-picker'},meta:{pickedColor:hex}});broadcast('content:changed');store.data.colorHistory=[{hex,at:Date.now()},...(store.data.colorHistory||[]).filter(color=>color.hex!==hex)].slice(0,24);await store.save();broadcast('colors:changed');return {ok:true,hex};});
  ipcMain.handle('recipes:catalog',()=>require('./lib/recipes').RECIPE_STEP_LABELS);
  ipcMain.handle('recipes:save',async(_event,payload)=>{const recipe=require('./lib/recipes').cleanRecipe(payload);if(!recipe)return {ok:false,error:'组合动作无效：需要名称与 1–12 个有效步骤'};const values=store.data.recipes||[];if(values.length>=50&&!values.some(r=>r.id===recipe.id))return {ok:false,error:'最多保存 50 个组合动作'};const previous=values.find(r=>r.id===recipe.id);recipe.version=(previous?.version||0)+1;store.data.recipes=[...values.filter(r=>r.id!==recipe.id),recipe];for(const binding of Object.values(store.data.panelBindings))if(binding.type==='recipe'&&binding.id===recipe.id)binding.name=recipe.title;await store.save();broadcast('recipes:changed');broadcast('panel:changed');return {ok:true,recipe};});
  ipcMain.handle('recipes:remove',async(_event,id)=>{store.data.recipes=(store.data.recipes||[]).filter(recipe=>recipe.id!==id);await store.save();broadcast('recipes:changed');return {ok:true};});
  ipcMain.handle('recipes:list', (_event, kind) => listRecipes(kind ? String(kind) : undefined,store.data.recipes||[]));
  ipcMain.handle('recipes:run', async (_event, payload) => {
    let itemId = String(payload?.itemId || '');
    const recipeId = String(payload?.recipeId || '');
    const recipe = getRecipe(recipeId,store.data.recipes||[]);
    if (!recipe) return { ok: false, error: '配方不存在', steps: [] };
    let item=store.getItem(itemId);
    if(!item&&payload?.item){const value=payload.item,text=String(value.text||'');if(!['text','link'].includes(value.kind)||!text.trim()||text.length>200000||!recipe.accepts.includes(value.kind))return {ok:false,error:'组合动作的输入无效',steps:[]};item=store.addItem({kind:value.kind,text,title:actions.safeTitle(text),source:{type:'selection'}});itemId=item.id;await store.save();}
    if (!item) return { ok: false, error: '内容不存在或已被清理', steps: [] };
    if (!recipe.accepts.includes(item.kind)) {
      return { ok: false, error: `「${recipe.title}」不接受${item.kind}类型的内容`, steps: [] };
    }
    const result = await runRecipe(
      { execute: (id, actionId) => actions.execute(id, actionId),recipes:store.data.recipes||[] },
      itemId,
      recipeId,
      { commit: Boolean(payload?.commit) }
    );
    broadcast('content:changed');
    broadcast('executions:changed');
    return result;
  });

  const currencyService=require('./lib/search').createCurrencyService({fetchImpl:electron.net.fetch});
  ipcMain.handle('search:execute',async(_event,query)=>{const command=require('./lib/search').searchCommand(query,{exchangeEnabled:store.getSettings().currencyEnabled===true});if(!command)return {ok:false,error:'没有可执行的搜索命令'};
    if(command.type==='translate'){const result=await openTextTools('translate',command.text);if(result.ok)hideQuickPanel();return result;}
    if(command.type==='currency'){const result=await currencyService.convert(command,store.getSettings().currencyEnabled===true);if(!result.ok)return result;if(!store.getSettings().currencyEnabled)return {ok:false,error:'已关闭汇率换算，结果已丢弃'};await writeClipboardText(result.text);return {...result,message:result.text+' 已复制 · '+result.date+' Frankfurter 日参考汇率'};}
    if(command.type!=='copy')return {ok:false,error:command.title};await writeClipboardText(command.value);return {ok:true,text:command.value,message:command.value+' 已复制'};
  });
  ipcMain.handle('search:query', async (_event, query, options) => {
    const value = String(query || '').trim();
    if(options?.scope==='apps'){const apps=searchAppCandidates(value,await appIndex.candidates(),{limit:40}),command=require('./lib/search').commandCandidate(value,{exchangeEnabled:store.getSettings().currencyEnabled===true});return command?[command,...apps].slice(0,40):apps;}
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
        contentKind: item.kind,
        title: item.title,
        subtitle: item.kind==='image' ? `${item.source?.appName||'本机'} 图片` : item.text ? item.text.slice(0,80) : path.basename(item.filePath||''),
        keywords: item.source?.appName || '',
        itemId: item.id
      });
    }
    for (const task of store.listTasks({})) {
      candidates.push({ id: task.id, kind: 'task', title: task.title, subtitle: `${task.itemIds.length} 项内容`, taskId: task.id });
    }
    for(const recipe of store.data.recipes||[])candidates.push({id:'recipe:'+recipe.id,kind:'command',title:recipe.title,subtitle:recipe.description,action:'recipe:'+recipe.id});
    const results=searchCandidates(value, candidates, { limit: 40 }),command=require('./lib/search').commandCandidate(value,{exchangeEnabled:store.getSettings().currencyEnabled===true});
    return command?[command,...results].slice(0,40):results;
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

  /* ---- 速记（Quick Note） ---- */
  ipcMain.handle('notes:list', () => (store ? store.listNotes() : []));
  ipcMain.handle('notes:get', (_event, id) => (store ? store.getNote(String(id || '')) : null));
  ipcMain.handle('notes:open', async (_event, id) => openNoteWindow(String(id || '')));
  ipcMain.handle('notes:open-latest', () => openLatestNote());
  ipcMain.handle('notes:create', async () => {
    if (!store) return { ok: false, error: '数据未就绪' };
    const note = store.createNote({ text: '' });
    if (!note) return { ok: false, error: '速记创建失败' };
    await store.save();
    broadcastNotes();
    return openNoteWindow(note.id);
  });
  ipcMain.handle('notes:update', async (_event, payload) => {
    const id = String(payload?.id || '');
    if (!store || !id) return { ok: false, error: '参数不完整' };
    if (typeof payload?.richText === 'string' && payload.richText.length > notesLib.RICH_TEXT_LIMIT) {
      return {ok:false, error:'格式内容超过速记容量，请删减后保存。'};
    }
    const note = store.updateNoteText(id, payload?.text, payload?.title, payload?.richText);
    if (!note) return { ok: false, error: '这条速记已不存在' };
    scheduleNoteSave();
    // 同屏开着多个速记窗口时，列表与其它窗口也要看到最新正文
    broadcastNotes();
    return { ok: true, note };
  });
  ipcMain.handle('notes:pick-file', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || ![...noteWindows.values()].includes(win)) return null;
    const result = await dialog.showOpenDialog(win, {title:'引用本地文件', properties:['openFile']});
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('notes:reveal-file', async (event, file) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    // Only reveal local drive paths. Network shares and device paths are excluded.
    if (!win || ![...noteWindows.values()].includes(win) || typeof file !== 'string' || !/^[a-z]:[\\/]/i.test(file)) {
      return {ok:false, error:'无法定位该本地文件。'};
    }
    const stat = await fs.promises.stat(file).catch(() => null);
    if (!stat?.isFile()) return {ok:false, error:'找不到原文件，它可能已被移动。'};
    shell.showItemInFolder(file);
    return {ok:true};
  });
  ipcMain.handle('notes:toggle-pin', async (_event, id) => {
    const noteId = String(id || '');
    if (!store) return { ok: false, error: '数据未就绪' };
    const note = store.toggleNotePin(noteId);
    if (!note) return { ok: false, error: '这条速记已不存在' };
    const win = noteWindows.get(noteId);
    if (win && !win.isDestroyed()) {
      win.setAlwaysOnTop(Boolean(note.pinned), 'floating');
      if (note.pinned) { win.show(); win.focus(); }
    }
    await store.save();
    broadcastNotes();
    return { ok: true, note };
  });
  ipcMain.handle('notes:delete', async (_event, id) => {
    const noteId = String(id || '');
    if (!store) return { ok: false, error: '数据未就绪' };
    closeNoteWindow(noteId);
    const removed = store.deleteNote(noteId);
    await store.save();
    broadcastNotes();
    return { ok: Boolean(removed) };
  });
  ipcMain.handle('notes:hide-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.close();
    return { ok: true };
  });
  ipcMain.handle('notes:minimize-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.minimize();
    return { ok: true };
  });

  /* ---- 38 键动作面板 ---- */
  ipcMain.handle('panel:state', panelState);
  ipcMain.handle('panel:run', async (_event, actionId) => {
    const id = String(actionId || '');
    // 自定义绑定（应用/文件夹/网页/文件）走 binding:<键位> 通道
    if (id.startsWith('binding:')) {
      let result;
      try { result = await runBindingKey(normalizeKey(id.slice('binding:'.length))); }
      catch (error) { result = { ok: false, error: error.message || '动作执行失败' }; }
      if (result?.closePanel) hideQuickPanel();
      return result;
    }
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

  /* ---- 键位自定义绑定：设置 / 清除 / 选择本机目标 ---- */
  ipcMain.handle('panel:binding:set', (_event, payload) => queuePanelConfiguration(async () => {
    const key = normalizeKey(payload?.key);
    const outcome = assignPanelBinding(store.getPanelBindings(), key, payload?.binding || null);
    if (!outcome.ok) return { ok: false, error: outcome.error };
    if (outcome.changed) {
      const saved = await commitPanelConfiguration(outcome.bindings);
      if (!saved.ok || saved.message) return saved;
    }
    return { ok: true, message: outcome.message };
  }));
  ipcMain.handle('panel:binding:move', (_event, payload) => queuePanelConfiguration(async () => {
    const outcome = movePanelBinding(store.getPanelBindings(), payload?.fromKey, payload?.toKey);
    if (!outcome.ok) return { ok: false, error: outcome.error };
    if (outcome.changed) {
      const saved = await commitPanelConfiguration(outcome.bindings);
      if (!saved.ok || saved.message) return saved;
    }
    return { ok: true, message: outcome.message };
  }));
  ipcMain.handle('panel:binding:pick', async (_event, options) => {
    if (panelBindingPickerOpen) return { ok: false, error: '请先完成当前的文件选择' };
    const owner = BrowserWindow.fromWebContents(_event.sender);
    const type = String(options?.type || 'file');
    const properties = type === 'folder' ? ['openDirectory', 'promptToCreate'] : ['openFile'];
    const filters = type === 'app'
      ? [{ name: '应用与快捷方式', extensions: ['exe', 'lnk', 'url'] }, { name: '所有文件', extensions: ['*'] }]
      : undefined;
    try {
      panelBindingPickerOpen = true;
      const result = await dialog.showOpenDialog(owner, {
        title: type === 'folder' ? '选择要绑定的文件夹' : type === 'app' ? '选择要绑定的应用' : '选择要绑定的文件',
        properties,
        filters
      });
      if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
      return { ok: true, path: result.filePaths[0] };
    } catch (error) {
      return { ok: false, error: error.message || '无法打开选择窗口' };
    } finally {
      panelBindingPickerOpen = false;
      if (owner && !owner.isDestroyed() && owner.isVisible()) owner.focus();
    }
  });

  /* ---- 应用面板：开始菜单应用目录 ---- */
  ipcMain.handle('apps:search',async(_event,query,refresh)=>{
    if(refresh===true)appIndex.invalidate();
    return searchAppCandidates(String(query||'').trim().slice(0,200),await appIndex.candidates(),{limit:200})
      .map(entry=>({name:entry.title,filePath:entry.appPath}));
  });
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
    return getAppIconLoader().getMany(list);
  });
  const sourceIconResolver=require('./lib/app-icons').createSourceIconResolver({listApps:()=>appIndex.ensure(),readShortcutLink:filePath=>shell.readShortcutLink(filePath),loadIcons:paths=>getAppIconLoader().getMany(paths)});
  ipcMain.handle('clipboardbar:source-icons',(_event,names)=>sourceIconResolver.getMany(names));

  /* ---- 快捷键：全局键位 + 按住型侦测 ---- */
  ipcMain.handle('shortcuts:get', () => {
    const snapshot = shortcutManager ? shortcutManager.snapshot() : { bindings: {}, status: {} };
    const momentary = momentaryStatus();
    return {
      bindings: { ...snapshot.bindings, momentary: momentary.accelerator },
      globalEnabled: globalShortcutsEnabled(),
      startupCheck:shortcutStartupReport,
      status: { ...shortcutStatus(snapshot.status), momentary }
    };
  });

  ipcMain.handle('shortcuts:capture', (event, active) => {
    if (event.sender !== mainWindow?.webContents) return { ok: false, error: '无权录入快捷键' };
    return queuePanelConfiguration(() => active ? beginShortcutCapture() : endShortcutCapture());
  });

  ipcMain.handle('shortcuts:check', () => ({ok:true,entries:currentShortcutReport(),note:'全局快捷键只在系统允许注册时生效；按住型使用后台侦测，不会抢占其他程序或系统快捷键。'}));
  ipcMain.handle('shortcuts:retry',()=>queuePanelConfiguration(async()=>{
    if(!globalShortcutsEnabled())return {ok:false,error:'请先开启全局快捷键'};
    registerShortcuts();await setupMomentaryProbe();broadcast('panel:changed');return {ok:true};
  }));

  ipcMain.handle('shortcuts:set', async (_event, payload) => {
    if (!shortcutManager) return { ok: false, error: '快捷键尚未初始化' };
    const name = String(payload?.name || '');
    const accelerator = String(payload?.accelerator || '').trim();

    // 按住型由后台轮询侦测，不注册同一全局组合键；其他随序动作仍参与重复校验。
    if (name === 'momentary') return queuePanelConfiguration(async () => {
      const validation = validateMomentaryAccelerator(accelerator);
      if (!validation.ok) return { ok: false, error: validation.error };
      const conflict = momentaryConflict(accelerator, shortcutManager.snapshot().bindings);
      if (conflict) return { ok: false, error: conflict };
      const previous = store.getSettings().shortcutMomentary;
      await store.updateSettings({ shortcutMomentary: accelerator });
      const started = shortcutCaptureActive
        ? (await endShortcutCapture()).momentary
        : await setupMomentaryProbe();
      if (!started.ok) {
        // 新键位起不来就回滚，不能让设置页显示成功但实际不工作
        await store.updateSettings({
          shortcutMomentary: previous === undefined ? DEFAULT_MOMENTARY_BINDINGS.momentary : previous
        });
        await setupMomentaryProbe();
        return { ok: false, error: `按住型侦测启动失败：${started.error || '未知原因'}` };
      }
      return { ok: true, status: momentaryStatus() };
    });

    if (!SHORTCUT_SETTING_KEYS[name]) return { ok: false, error: '未知的快捷键名称' };
    // 与按住型唤起撞组合会互相抢键：两边都是全局监听，必须提前拒绝
    const momentaryCurrent = momentaryAccelerator();
    if (momentaryCurrent && normalizeAccelerator(momentaryCurrent) === normalizeAccelerator(accelerator)) {
      return { ok: false, error: '与「按住型唤起」的快捷键重复' };
    }
    return queuePanelConfiguration(async () => {
      let bindings = store.getPanelBindings();
      const key = acceleratorKey(accelerator);
      if (PANEL_SHORTCUT_ACTIONS[name] && key) {
        const moved = assignPanelBinding(bindings, key, { type: 'action', id: PANEL_SHORTCUT_ACTIONS[name] });
        if (!moved.ok) return moved;
        bindings = moved.bindings;
      }
      // ShortcutManager was deliberately rebuilt with registration disabled while
      // the recorder is focused. Re-enable it before the transactional rebind so
      // the new accelerator can be registered and persisted instead of failing
      // against the capture-only adapter.
      const resumeCaptureOnFailure = shortcutCaptureActive;
      if (resumeCaptureOnFailure) await endShortcutCapture();
      const result = await commitPanelConfiguration(bindings, { [name]: accelerator });
      if (!result.ok && resumeCaptureOnFailure) await beginShortcutCapture();
      return result;
    });
  });

  // 恢复出厂默认（对应原产品 KeyboardShortcutRecorderController.restoreDefault）
  ipcMain.handle('shortcuts:restore-default', async (_event, payload) => {
    if (!shortcutManager) return { ok: false, error: '快捷键尚未初始化' };
    const name = payload?.name ? String(payload.name) : '';
    if (name && name !== 'momentary' && !SHORTCUT_SETTING_KEYS[name]) {
      return { ok: false, error: '未知的快捷键名称' };
    }
    if (name === 'momentary') return queuePanelConfiguration(async () => {
      await store.updateSettings({ shortcutMomentary: DEFAULT_MOMENTARY_BINDINGS.momentary });
      const started = await setupMomentaryProbe();
      if (!started.ok) return { ok: false, error: started.error || '按住型侦测启动失败' };
      return { ok: true, restored: ['momentary'], status: momentaryStatus() };
    });
    return queuePanelConfiguration(async () => {
      const patch = name ? { [name]: DEFAULT_BINDINGS[name] } : { ...DEFAULT_BINDINGS };
      const desired = { ...shortcutManager.snapshot().bindings, ...patch };
      const aligned = alignPanelShortcuts(store.getPanelBindings(), desired);
      if (!aligned.ok) return aligned;
      const result = await commitPanelConfiguration(aligned.bindings, patch, name ? {} : { momentary: DEFAULT_MOMENTARY_BINDINGS.momentary });
      if (!result.ok) return result;
      if (!name) await setupMomentaryProbe();
      return { ...result, status: { ...result.status, momentary: momentaryStatus() }, restored: [...Object.keys(patch), ...(!name ? ['momentary'] : [])] };
    });
  });

  // 清除绑定（对应原产品 clearShortcut）：解绑后不再响应，但保留条目
  ipcMain.handle('shortcuts:clear', async (_event, payload) => {
    if (!shortcutManager) return { ok: false, error: '快捷键尚未初始化' };
    const name = String(payload?.name || '');
    if (name === 'momentary') return queuePanelConfiguration(async () => {
      await store.updateSettings({ shortcutMomentary: '' });
      await setupMomentaryProbe();
      return { ok: true, status: momentaryStatus() };
    });
    if (!SHORTCUT_SETTING_KEYS[name]) return { ok: false, error: '未知的快捷键名称' };
    return queuePanelConfiguration(async () => {
      const cleared = clearShortcutPanelAction(store.getPanelBindings(), name);
      if (!cleared.ok) return cleared;
      return commitPanelConfiguration(cleared.bindings, { [name]: '' });
    });
  });

  ipcMain.handle('return:target', () => returnTarget);

  ipcMain.handle('return:commit', async (event, payload) => {
    const item = store.getItem(String(payload?.itemId || ''));
    if (!item) return { ok: false, error: '内容不存在或已被清理' };
    const intent = payload?.intent === 'copy-only' ? 'copy-only' : 'return-and-paste';
    // tryReturnToTarget 内部已负责复制；这里不再重复调用 output.copy，
    // 否则会写两次剪贴板并污染回环账本。
    const fromClipboardBar = clipboardBarWindow && !clipboardBarWindow.isDestroyed() && event.sender === clipboardBarWindow.webContents;
    const revision=clipboardShowRevision;
    const target=fromClipboardBar?currentPasteTarget(await queryForeground(),process.pid,clipboardSessionTarget,clipboardBarWindow.isVisible()):null;
    const fromOverlay = overlayWindow && event.sender === overlayWindow.webContents;
    const fromTextTool = [...textToolWindows.values()].some(win => !win.isDestroyed() && event.sender === win.webContents);
    const decision = await tryReturnToTarget(item, intent, { clipboardBar: fromClipboardBar, target, revision, captureOverlay: fromOverlay, explicitPaste: fromOverlay || fromTextTool });
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

  const workspace = require('./lib/workspace').createWorkspace(store);
  markdownFiles=createMarkdownFiles(store,workspace);
  ipcMain.handle('workspace:confirm-close',async(event,id)=>{
    const item=store.getItem(String(id));
    if(item?.meta?.workspace!=='markdown'||!item.meta.externalPath||crypto.createHash('sha256').update(item.text).digest('hex')===item.meta.externalTextHash)return {ok:true};
    const result=await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender),{type:'question',buttons:['保存到原文件','保留草稿并关闭','取消'],defaultId:0,cancelId:2,noLink:true,message:'此文件有尚未写回原位置的修改',detail:item.meta.externalPath});
    if(result.response===2){workspaceQuitRequested=false;return {ok:false,canceled:true};}
    if(result.response===0){try{await markdownFiles.save(item.id);}catch(error){workspaceQuitRequested=false;return {ok:false,error:error.message};}}
    return {ok:true};
  });
  ipcMain.handle('workspace:opened-file',event=>{const win=BrowserWindow.fromWebContents(event.sender);const id=win?.__openedDoc||'';if(win)win.__openedDoc='';return id;});
  ipcMain.handle('workspace:save-file',async(_event,id)=>{try{return {ok:true,...await markdownFiles.save(String(id))};}catch(error){return {ok:false,error:error.message};}});
  ipcMain.handle('workspace:preview-images', async (event, id, references) => {
    const active = activeDocuments.get(event.sender.id);
    if (!active || active.id !== id) return [];
    const images = await markdownFiles.previewImages(id, references);
    return activeDocuments.get(event.sender.id) === active ? images : [];
  });
  ipcMain.handle('workspace:open-link', async (_event,url) => {
    if(/^suira-image:\/\/[-\w]+$/.test(String(url))){const item=store.getItem(String(url).slice(14));if(item?.kind!=='image'||!item.filePath)return {ok:false,error:'截图已被清理'};const error=await shell.openPath(item.filePath);return error?{ok:false,error}:{ok:true};}
    if(!isSafeHttpUrl(url))return {ok:false,error:'只能打开 http(s) 链接'};
    await shell.openExternal(url);return {ok:true};
  });
  ipcMain.handle('workspace:capture',async(event,payload)=>{
    const win=BrowserWindow.fromWebContents(event.sender);
    if(!win||!activeDocuments.get(event.sender.id)||!['image','text'].includes(payload?.kind))return {ok:false,error:'请先打开 Markdown 文档'};
    if(documentCapture||captureBusy||longCapture||longCaptureStarting)return {ok:false,error:'请先完成当前截图'};
    let resolve;const result=new Promise(done=>{resolve=done;});documentCapture={win,resolve};win.hide();
    const closed=()=>{if(documentCapture?.win===win)hideOverlayWindow();};win.once('closed',closed);
    try{await new Promise(done=>setTimeout(done,40));const started=await beginScreenCapture('document',{intent:payload.kind==='text'?'document-text':'document-image'});if(!started.ok && documentCapture?.win === win)hideOverlayWindow({documentResult:started});return await result;}
    catch(error){hideOverlayWindow({documentResult:{ok:false,error:error.message}});return await result;}
    finally{win.removeListener('closed',closed);}
  });
  ipcMain.handle('workspace:clipboard', async()=>({ok:true,text:(await readClipboardText()).slice(0,200000)}));
  ipcMain.handle('workspace:list', (_event,type) => workspace.list(type));
  ipcMain.handle('workspace:recent',async(_event,action,id)=>{
    if(!['clear','open'].includes(action))return {ok:false,error:'无效操作'};
    const items=workspace.list('markdown');
    for(const item of items)if(action==='clear'||item.id===id)item.meta.recentHidden=action==='clear';
    await store.save();return {ok:true};
  });
  ipcMain.handle('text-tools:open',(_event,payload)=>openTextTools(payload?.mode,payload?.text,require('./lib/text-tools').OPERATIONS.has(payload?.operation)?payload.operation:'compact'));
  ipcMain.handle('text-tools:capture', async (event, payload) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || ![...textToolWindows.values()].includes(win)) return { ok: false, error: '请从文字工具窗口截图' };
    if (captureBusy || longCapture || longCaptureStarting) return { ok: false, error: '请先完成当前截图' };
    await rememberReturnTarget('text-tools-capture');
    if(payload && ['translate','convert'].includes(payload.mode))win.__textTool={mode:payload.mode,text:String(payload.text||'').slice(0,200000),operation:require('./lib/text-tools').OPERATIONS.has(payload.operation)?payload.operation:'compact'};
    textCaptureWindow = win;
    win.hide();
    // 给桌面合成器一帧移除文字工具窗口，避免把工具本身截进去。
    await new Promise(resolve => setTimeout(resolve, 40));
    const result = await beginScreenCapture('text-tools', { intent: 'ocr-return' });
    if (!result.ok) {
      textCaptureWindow = null;
      if (!win.isDestroyed()) { win.show(); win.focus(); }
    }
    return result;
  });
  ipcMain.handle('text-tools:initial',event=>BrowserWindow.fromWebContents(event.sender)?.__textTool||{mode:'convert',text:''});
  ipcMain.handle('text-tools:transform',(_event,text,operation)=>{try{return {ok:true,text:require('./lib/text-tools').transformText(text,operation)};}catch(error){return {ok:false,error:error.message};}});
  ipcMain.handle('text-tools:configure',()=>{showMain('settings');const send=()=>mainWindow?.webContents.send('settings:translation');if(mainWindow?.webContents.isLoading())mainWindow.webContents.once('did-finish-load',send);else send();return {ok:true};});
  ipcMain.handle('workspace:save', async (_event,type,payload) => {
    try { const item=workspace.save(type,payload); await store.save(); broadcast('content:changed'); return {ok:true,item}; }
    catch(error){return {ok:false,error:error.message};}
  });
  ipcMain.handle('workspace:remove', async (_event,type,id) => {
    try { workspace.remove(type,id); await store.save(); broadcast('content:changed'); return {ok:true}; }
    catch(error){return {ok:false,error:error.message};}
  });
  ipcMain.handle('workspace:import', async event => {
    const result=await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender),{title:'打开 Markdown',filters:[{name:'Markdown',extensions:['md','markdown','txt']}],properties:['openFile']});
    if(result.canceled)return {ok:false,canceled:true};
    try {
      const file=result.filePaths[0];
      if(/\.(md|markdown)$/i.test(file)) {
        const opened=await markdownFiles.open(file);broadcast('content:changed');return {ok:true,...opened};
      }
      if((await fsp.stat(file)).size>800000)throw Error('文件过大，请选择 800 KB 以内的文档');
      const text=new TextDecoder('utf-8',{fatal:true}).decode(await fsp.readFile(file)); const item=workspace.save('markdown',{title:path.basename(file,path.extname(file)),text});
      await store.save(); broadcast('content:changed'); return {ok:true,item};
    }catch(error){return {ok:false,error:error.message};}
  });
  ipcMain.handle('workspace:export', async (event,id,format='md') => {
    const item=store.getItem(String(id));if(item?.meta?.workspace!=='markdown')return {ok:false,error:'文档不存在'};
    if(!['md','html','pdf'].includes(format))return {ok:false,error:'不支持的导出格式'};
    const result=await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender),{title:'导出文档',defaultPath:item.title.replace(/[\\/:*?"<>|]/g,'_')+'.'+format,filters:[{name:format.toUpperCase(),extensions:[format]}]});
    if(result.canceled)return {ok:false,canceled:true};
    let render;
    try {
      let data=item.text;
      if(format!=='md'){
        render=new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'theme-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:false}});
        await render.loadFile(path.join(__dirname,'src/export.html'));
        const html=await render.webContents.executeJavaScript(`window.renderExport(${JSON.stringify({title:item.title,text:item.text})})`);
        data=format==='pdf'?await render.webContents.printToPDF({printBackground:true,pageSize:'A4'}):html;
      }
      await fsp.writeFile(result.filePath,data);return {ok:true};
    }catch(error){return {ok:false,error:error.message};}finally{render?.destroy();}
  });
  ipcMain.handle('workspace:calendar-export', async event => {
    const result=await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender),{title:'导出日历',defaultPath:'随序日历.ics',filters:[{name:'iCalendar',extensions:['ics']}]});
    if(result.canceled)return {ok:false,canceled:true};
    try{await fsp.writeFile(result.filePath,require('./lib/calendar-export').calendarICS(workspace.list('calendar')),'utf8');return {ok:true};}catch(error){return {ok:false,error:error.message};}
  });
  ipcMain.handle('tasks:status', async (_event,payload) => {
    const task=store.updateTask(String(payload?.id||''),{progress:payload?.done?'done':'idle'});
    await store.save();broadcast('tasks:changed');return {ok:Boolean(task)};
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

  ipcMain.handle('settings:get', () => publicSettings());
  ipcMain.handle('settings:update', async (_event, patch) => {
    const incoming = patch && typeof patch === 'object' ? { ...patch } : {};
    if (typeof incoming.voiceBaseUrl === 'string' && incoming.voiceBaseUrl.trim()) {
      const checked = voiceInput.validateEndpoint(incoming.voiceBaseUrl);
      if (!checked.ok) return { ok: false, error: checked.error };
      incoming.voiceBaseUrl = checked.url;
    }
    if ([...Object.values(SHORTCUT_SETTING_KEYS), 'shortcutMomentary'].some(key => Object.hasOwn(incoming, key))) {
      return { ok: false, error: '请通过快捷键设置修改组合键，以便同步面板键位' };
    }
    if(Object.hasOwn(incoming,'globalShortcutsEnabled')) {
      if(typeof incoming.globalShortcutsEnabled!=='boolean'||Object.keys(incoming).length!==1)return {ok:false,error:'请单独设置快捷键响应范围'};
      return queuePanelConfiguration(async () => {
        await store.updateSettings(incoming);
        registerShortcuts();
        await setupMomentaryProbe();
        broadcast('panel:changed');
        const settings = publicSettings();
        broadcast('settings:changed', settings);
        return { ok: true, settings };
      });
    }
    // 翻译密钥：界面传明文，主进程加密后落盘；空串表示"不改动"，null 才是清除
    let keyTouched = false;
    let voiceKeyTouched = false;
    if (Object.prototype.hasOwnProperty.call(incoming, 'translateApiKey')) {
      const raw = incoming.translateApiKey;
      delete incoming.translateApiKey;
      if (raw === null) {
        incoming.translateApiKeyEnc = null;
        keyTouched = true;
      } else if (typeof raw === 'string' && raw.trim()) {
        const envelope = encryptSecret(raw.trim());
        if (!envelope) {
          return { ok: false, error: '内容加密不可用，无法安全保存密钥（可在设置里关闭加密后重试）' };
        }
        incoming.translateApiKeyEnc = envelope;
        keyTouched = true;
      }
    }
    if (Object.prototype.hasOwnProperty.call(incoming, 'voiceApiKey')) {
      const raw = incoming.voiceApiKey;
      delete incoming.voiceApiKey;
      if (raw === null) {
        incoming.voiceApiKeyEnc = null;
        voiceKeyTouched = true;
      } else if (typeof raw === 'string' && raw.trim()) {
        const envelope = encryptSecret(raw.trim(), VOICE_KEY_AAD);
        if (!envelope) return { ok: false, error: '内容加密不可用，无法安全保存 ASR 密钥' };
        incoming.voiceApiKeyEnc = envelope;
        voiceKeyTouched = true;
      }
    }
    const recordedClipboard = store.getSettings().recordClipboard;
    const settings = await store.updateSettings(incoming);
    if (settings.recordClipboard !== recordedClipboard) {
      ++captureGeneration;
      lastClipboardSequence = null;
      lastClipboardText = lastClipboardFilesKey = '';
      lastClipboardImageRaw = null;
      lastClipboardImageKey = lastClipboardImageType = lastClipboardImageHash = '';
      if (settings.recordClipboard) {
        try { await seedClipboardWatcher(); }
        catch (error) { console.warn('剪贴板基线读取失败:', error.message); }
      }
    }
    if(incoming.selectionEnabled===false){panelSelection=null;broadcast('quick:selection',null);}
    // 保留期/上限变小后要立刻生效，不能等下一次复制才清理
    if (incoming.retentionDays !== undefined || incoming.maxItems !== undefined) {
      store.prune();
      await store.save();
      broadcast('content:changed');
    }
    // 换肤只改一处：nativeTheme 一变，所有窗口的 prefers-color-scheme 同时跟着变
    if (incoming.theme !== undefined) applyTheme();
    if (['theme','themePreset','accentSource','panelMaterial'].some(key => incoming[key] !== undefined)) await themeController?.refresh();
    if (incoming.panelMaterial !== undefined) {
      for (const win of BrowserWindow.getAllWindows()) if (win.__allowNativeBlur && !win.isDestroyed()) updateWindowMaterial(win);
    }
    const safe = publicSettings();
    broadcast('settings:changed', safe);
    if (keyTouched) broadcast('translate:status', translateStatus());
    if (keyTouched || voiceKeyTouched || incoming.voiceProvider !== undefined || incoming.voiceBaseUrl !== undefined
      || incoming.voiceModel !== undefined || incoming.translateBaseUrl !== undefined || incoming.translateProvider !== undefined) {
    }
    return { ok: true, settings: safe };
  });

  /* ---------- 翻译（图片取词翻译 = 翻译 B 支） ---------- */

  ipcMain.handle('translate:status', () => translateStatus());
  ipcMain.handle('translate:models',()=>translateLib.listModels(translateConfig(),electron.net.fetch));
  ipcMain.handle('translate:run', async (_event, payload) => {
    const text = String(payload?.text || '');
    if (!text.trim()) return { ok: false, error: '没有需要翻译的文字' };
    const overrides = {};
    if (payload?.target) overrides.target = translateLib.normalizeLang(payload.target, { allowAuto: false });
    if (payload?.source) overrides.source = translateLib.normalizeLang(payload.source);
    const result = await runTranslation(text, overrides);
    return result;
  });
  // 设置页的「测试」：拿一句固定短句走一遍真实链路，不写任何内容
  ipcMain.handle('translate:test', async () => {
    const config=translateConfig();
    const result = await runTranslation(config.target==='en'?'你好，这是一条翻译测试。':'Hello, this is a translation test.', { source: config.target==='en'?'zh':'en' });
    if (!result.ok) return result;
    return { ...result, sample: result.text };
  });

  // 清空剪贴板来源的内容（保留固定项与任务内引用）
  ipcMain.handle('content:clear-clipboard', async () => {
    const plan=require('./lib/history-cleanup').historyCleanup(store.data.items,store.data.tasks);
    const items=plan.removed;
    for (const item of items) {
      store.removeItem(item.id);
      if (item.kind === 'image' && item.filePath && !plan.kept.some(kept=>kept.filePath===item.filePath)) {
        const owned=[capturesDir(),clipboardImageDir()].some(dir=>path.resolve(item.filePath).startsWith(path.resolve(dir)+path.sep));
        if(owned)await fsp.rm(item.filePath, { force: true }).catch(() => {});
      }
    }
    await store.save();
    broadcast('content:changed');
    return { ok: true, removed: items.length, protected:plan.protectedCount };
  });

}

/** 加速键转托盘/界面展示文案。 */
function prettyAcceleratorLabel(accelerator) {
  return String(accelerator || '').replace(/CommandOrControl/gi, 'Ctrl') || '未绑定';
}

function createTray() {
  const trayImage = nativeImage.createFromPath(assetPath('suira-icon.png')).resize({ width: 32, height: 32 });
  tray = new Tray(trayImage);
  tray.setToolTip(`${APP_NAME} · 顺手接住，让工作继续。`);
  const bindings = shortcutBindings();
  const menu = Menu.buildFromTemplate([
    { label: `随手面板  ${prettyAcceleratorLabel(bindings.quick)}`, click: showQuickPanel },
    { label: `剪贴板历史  ${prettyAcceleratorLabel(bindings.clipboardBar)}`, click: () => toggleClipboardBar() },
    { label: '浮引岛 · 文件暂存（临时打开）', click: () => toggleIsland() },
    { label: '速记（接着上一条写）', click: () => openLatestNote() },
    { label: '重启并应用更新', click: () => restartApplication() },
    { type: 'separator' },
    { label: '任务匣', click: () => showMain('shelf') },
    { label: '内容库', click: () => showMain('library') },
    { label: '处理轨迹', click: () => showMain('trail') },
    { label: '设置', click: () => showMain('settings') },
    { type: 'separator' },
    { label: `开始截图  ${prettyAcceleratorLabel(bindings.capture)}`, click: () => beginScreenCapture('tray') },
    { type: 'separator' },
    { label: '退出随序', click: () => { isQuitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', showQuickPanel);
}

let shortcutStartupReport=[];
function globalShortcutsEnabled() { return store?.getSettings().globalShortcutsEnabled === true; }
function currentShortcutReport() {
  const bindings = shortcutManager?.bindings || shortcutBindings();
  const entries = shortcutCaptureActive
    ? Object.entries(bindings).filter(([,accelerator])=>accelerator).map(([name,accelerator])=>({name,accelerator,state:'paused',reason:'正在录制组合键'}))
    : shortcutReport(globalShortcut, bindings);
  const accelerator = momentaryAccelerator();
  if (accelerator) {
    const entry = shortcutCaptureActive
      ? { name:'momentary', accelerator, state:'paused', reason:'正在录制组合键' }
      : !globalShortcutsEnabled()
        ? { name:'momentary', accelerator, state:'paused', reason:'未启用全局快捷键' }
        : momentaryProbe?.status === 'watching'
          ? { name:'momentary', accelerator, state:'watching', reason:'' }
          : { name:'momentary', accelerator, state:'conflict', reason:momentaryError || '按键侦测助手未运行' };
    entries.push(entry);
  }
  return entries;
}
function publishShortcutStatus() {
  shortcutStartupReport = currentShortcutReport();
  if (shortcutManager) broadcast('shortcuts:changed', shortcutStatus(shortcutManager.snapshot().status));
}
function shortcutStatus(status) {
  return Object.fromEntries(Object.entries(status).map(([name,entry])=>[name,shortcutCaptureActive&&entry.accelerator?{...entry,recording:true}:(!globalShortcutsEnabled() && entry.accelerator)?{...entry,localOnly:true}:entry]));
}
function registerShortcuts() {
  shortcutManager?.dispose();
  const enabled=globalShortcutsEnabled() && !shortcutCaptureActive;
  shortcutManager = new ShortcutManager({
    globalShortcut:shortcutAdapter(globalShortcut,enabled),
    legacyBindings:false,
    handlers: {
      ...Object.fromEntries(KEY_ROWS.flat().map(key=>[panelShortcutName(key),()=>runGlobalPanelKey(key)])),
      quick: toggleQuickPanel,
      capture: () => beginScreenCapture('shortcut'),
      longCapture: () => dispatchGlobalPanelAction('long-capture'),
      panelCycle: cyclePanelMode,
      pinnedToggle: togglePinnedVisibility,
      clipboardBar: toggleClipboardBar,
      voice: async () => {
        const result = await openVoiceInput();
        if (!result.ok) {
          await showQuickPanel();
          await quickWindow?.__loaded;
          quickWindow?.webContents.send('panel:result', result);
        }
      },
      legacy: toggleQuickPanel
    },
    bindings: panelGlobalBindings(store.getPanelBindings(),shortcutBindings()),
    onChange: (status) => {
      // 把注册结果同步给设置页，让用户看到哪个键被占用
      broadcast('shortcuts:changed', shortcutStatus(status));
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
  shortcutStartupReport=currentShortcutReport();
  return shortcutManager.status;
}

async function initialize() {
  const root = resolveDataRoot();
  if (!root) {
    // 一个可写目录都找不到：给出可操作的说明，而不是抛一段 stack
    throw new Error([
      '找不到可写的数据目录。',
      `已尝试：%APPDATA%\\${APP_NAME}、系统临时目录、程序同级 data 目录。`,
      '常见原因是安全策略禁止当前会话写入这些位置——请在有写权限的桌面会话里启动，',
      '或以管理员身份放开该目录的写入权限后重试。'
    ].join('\n'));
  }
  dataRoot = root;
  if (dataRootNotice) {
    console.warn(`[数据目录] 默认位置不可写，已回落到${dataRootNotice}：${dataRoot}`);
  }
  const dirs = await ensureDirs();
  if (!dirs.ok) {
    throw new Error(`数据目录无法写入：${dirs.error}\n目录：${dataRoot}`);
  }

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
  // 旧版本的 theme 只存了个 'system'，界面上又没有开关：等于把配色交给系统。
  // 结果就是"浅色主窗口 + 深色浮层"的割裂，升级后一次性钉成浅色，
  // 之后以用户在设置里的选择为准（themeChosen 一旦为 true 就不再迁移）。
  if (!store.getSettings().themeChosen) {
    await store.updateSettings({ theme: 'light', themeChosen: true });
  }
  if(store.getSettings().glassSystemVersion!==1)await store.updateSettings({panelMaterial:'liquid',glassSystemVersion:1});
  // 主题要在建任何窗口之前定下来，否则首帧会闪一下系统默认色
  applyTheme();
  themeController = require('./lib/theme-controller').createThemeController({
    getSettings: () => store.getSettings(), nativeTheme, systemPreferences,
    readWallpaper: () => require('./lib/launchpad-background').readWallpaperSample(nativeImage),
    publish: state => broadcast('theme:changed', state)
  });
  await themeController.refresh();
  // 旧版三键默认键位迁移到两键组合；改过键的用户不受影响
  await migrateShortcutDefaults();
  const shortcutSettings = store.getSettings();
  const voiceChord = shortcutSettings.shortcutVoice
    ?? (actionKey(store.getPanelBindings(), 'voice') === 'H' ? 'Alt+H' : '');
  const pinnedChord = shortcutSettings.shortcutPinnedToggle ?? DEFAULT_BINDINGS.pinnedToggle;
  if (voicePinConflict(voiceChord, pinnedChord) && !Object.values(shortcutBindings()).some(value =>
    normalizeAccelerator(value) === normalizeAccelerator(PINNED_TOGGLE_VOICE_ALTERNATE))
    && normalizeAccelerator(momentaryAccelerator()) !== normalizeAccelerator(PINNED_TOGGLE_VOICE_ALTERNATE)) {
    await store.updateSettings({ shortcutVoice: voiceChord, shortcutPinnedToggle: PINNED_TOGGLE_VOICE_ALTERNATE });
  }
  // 老版本覆盖表基于 Z/X/V。先还原旧有效绑定，再按实际保存的组合键对齐。
  const currentPanel = migrateLegacyPanelBindings(store.getPanelBindings(), store.data.panelShortcutVersion);
  const alignedPanel = alignPanelShortcuts(currentPanel, shortcutBindings());
  if (!alignedPanel.ok) console.warn(`面板键位无法自动对齐：${alignedPanel.error}`);
  await store.setPanelConfiguration(alignedPanel.ok ? alignedPanel.bindings : currentPanel, {}, 2);
  // 全局关掉拼写检查：各窗口已经传了 spellcheck:false，这里再兜一层底，
  // 避免任何渲染进程加载/初始化系统拼写词典（一个常驻的词库 + 后台线程）。
  try { session.defaultSession.setSpellCheckerEnabled(false); } catch { /* 会话未就绪时忽略 */ }
  await migrateLegacyHistory();  // 按保留策略启动清理一次：过期内容不该等到下一次复制才消失
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
    // 翻译用当前设置里的引擎；未配置时返回可读原因，不产出假译文
    translate: (text) => runTranslation(text),
    ai:(mode,text)=>require('./lib/ai-actions').runAi({mode,text,config:translateConfig(),fetchImpl:electron.net.fetch}),
    clipboard: {
      writeText: writeClipboardText,
      writeImage: writeClipboardImage
    },
    shell,
    nativeImage,
    openPath: (target) => shell.openPath(target),
    pinImage: (filePath, width, height) => createPinWindow(pathToFileURL(filePath).href, { width, height }),
    pinText: (text,item) => createPinWindow('',{width:420,height:300},{...item,kind:'text',text}),
    appendMarkdown:appendRelayMarkdown,
    openCalendarDraft:openRelayCalendar,
    prepareNotes:async()=>{for(const win of noteWindows.values())if(!win.isDestroyed())await requestRelay(win,{kind:'notes.flush'});},
    broadcast,
    assetPath,
    capturesDir,
    makeId
  });
  registerIpc();
  if (!process.argv.includes('--background')) createMainWindow();
  createTray();
  registerShortcuts();
  captureHost = prepareCaptureHost();
  foregroundProbe.nativeHostReady = ensureNativeHost({ sourcePath: assetPath('foreground-host.cs'), targetPath: path.join(userRoot(), 'foreground-host-v5.exe'), references: ['System.Web.Extensions.dll'] });
  foregroundProbe.start().catch(error => console.warn('前台助手预热失败:', error.message));
  islandWakeReady = setupIslandPointer().catch(error => { islandWakeError = error.message; });
  const repositionIsland = () => {
    if (islandWindow && !islandWindow.isDestroyed()) {
      setIslandMode('sleep');
      islandWindow.setBounds(islandBounds('sleep'));
    }
  };
  screen.on('display-added', repositionIsland);
  screen.on('display-removed', repositionIsland);
  screen.on('display-metrics-changed', repositionIsland);
  // 原生助手保持热启动；系统缺少编译器时使用 PowerShell 兼容路径。
  scheduleForegroundStop();
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

/**
 * 等一个 Promise，但最多等 timeout 毫秒。
 * 自检要等三个异步子系统（剪贴板监听 / 按住型侦测 / 拖入唤醒）就绪，
 * 任何一个卡住都会让 `npm run diag` 永远不返回 —— 报告里如实写「等待超时」，
 * 比把命令挂死有用得多。
 */
function waitWithTimeout(promise, timeout = 8000) {
  return Promise.race([
    Promise.resolve(promise).catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), timeout))
  ]);
}

app.whenReady().then(initialize).then(async () => {
  queueMarkdownFiles([]); await markdownOpenChain;
  // --diag：启动自检。把环境、窗口、快捷键、能力可用性写成一份报告，
  // 便于在没有开发者工具的情况下定位真机问题。见 docs/REAL-MACHINE-CHECKLIST.md
  if (process.argv.includes('--diag')) {
    // 剪贴板监听是异步启动的：不等它完成，报告会把「正在启动」误报成「未运行」。
    // 这类误报会直接误导排查，必须等；但每个最多等 8 秒，卡住也要出报告。
    try { await waitWithTimeout(clipboardWatcherReady); } catch { /* 错误已记录在 clipboardWatcherError */ }
    try { await waitWithTimeout(momentaryReady); } catch { /* 错误已记录在 momentaryError */ }
    try { await waitWithTimeout(islandWakeReady); } catch { /* 错误已记录在 islandWakeError */ }
    let exitCode = 0;
    try {
      const report = await collectDiagnostics();
      const target = path.join(app.getPath('userData'), 'diag-report.txt');
      fs.writeFileSync(target, report, 'utf8');
      console.log(report);
      console.log('\n报告已写入: ' + target);
    } catch (error) {
      console.error('自检失败:', error && error.stack ? error.stack : error);
      exitCode = 1;
    }
    // 自检是一次性命令：报告写完就该退出。否则 `npm run diag` 会一直挂着，
    // 用户只能靠 Ctrl+C 结束，还以为应用卡死了。
    // 先走 app.quit() 让 will-quit 正常释放子进程；再留一个兜底定时器，
    // 万一有窗口拦着不退出，也不会把命令挂死。
    process.exitCode = exitCode;
    isQuitting = true;
    app.quit();
    const bail = setTimeout(() => app.exit(exitCode), 1500);
    if (bail.unref) bail.unref();
  }
}).catch((error) => {
  console.error('随序启动失败:', error);
  // 启动失败的原因要给人看：自检是命令行用法，弹一个模态错误框会把它挂死
  // （没人能点确定），所以这种情况只打印并带非零退出码返回。
  if (process.argv.includes('--diag')) {
    process.exitCode = 1;
    app.exit(1);
    return;
  }
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
  add('数据目录', userRoot());
  add('数据目录回落', dataRootNotice ? `是 — ${dataRootNotice}` : '否（默认位置）');
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
  const clipboardBar = clipboardBarWindow && !clipboardBarWindow.isDestroyed() ? clipboardBarWindow : null;
  for (const [name, win] of [['主窗口', mainWindow], ['面板', quickWindow], ['浮引岛', island], ['剪贴板历史条', clipboardBar]]) {
    if (!win || win.isDestroyed()) { add(name, '未创建'); continue; }
    const [w, h] = win.getSize();
    add(`${name} 尺寸`, `${w}×${h}`);
    add(`${name} 可见`, win.isVisible() ? '是' : '否');
  }

  section('快捷键');
  add('响应范围',globalShortcutsEnabled()?'全局（仅成功注册的组合键）':'面板内（全局快捷键未启用）');
  const snap = shortcutManager ? shortcutManager.snapshot() : { bindings: {}, status: {} };
  for (const [name, accelerator] of Object.entries(snap.bindings)) {
    const entry = snap.status[name] || {};
    const state = !accelerator ? '未绑定' : (!globalShortcutsEnabled()?'仅保留配置，未注册':entry.ok ? '已注册' : '注册失败：' + (entry.error || '未知'));
    add(name, `${accelerator || '—'} ${state}`);
  }
  if (!shortcutManager) add('管理器', '未初始化');
  const momentaryInfo = momentaryStatus();
  add('按住型唤起', !momentaryInfo.accelerator
    ? '未绑定'
    : `${momentaryInfo.accelerator} ${momentaryInfo.watching ? '侦测中' : '未运行'}`);

  section('浮引岛');
  const islandInfo = islandState();
  add('形态', { sleep: '休眠（透明热区）', rail: '胶囊', sheet: '暂存卡片' }[islandMode] || islandMode);
  add('可见', islandInfo.visible ? '是' : '否');
  add('暂存条目', `${islandInfo.items.length} / ${islandInfo.maxItems}`);
  add('拖动唤醒', islandInfo.wake.ready ? '已就绪（仅按住拖动到顶部时启用接收）' : islandWakeError || '正在启动');
  add('拖入策略', islandInfo.policy === 'move' ? '移动' : '复制');

  section('速记');
  const noteSummary = notesLib.summarizeNotes(store ? store.listNotes() : []);
  add('速记条数', `${noteSummary.count} / ${noteSummary.limit}`);
  add('钉在桌面', String(noteSummary.pinned));
  add('已开窗口', String([...noteWindows.values()].filter((win) => win && !win.isDestroyed()).length));

  section('能力');
  add('屏幕数量', String(screen.getAllDisplays().length));
  screen.getAllDisplays().forEach((d, i) => {
    add(`  显示器 ${i + 1}`, `${d.size.width}×${d.size.height} @${d.scaleFactor}x`);
  });
  add('OCR 引擎', ocr ? '已创建' : '未创建');
  const translateInfo = translateStatus();
  // 翻译走主进程的 fetch：这条能区分「没配密钥」和「运行时不支持网络请求」
  add('网络请求能力', typeof fetch === 'function' ? '可用' : '不可用');
  add('翻译引擎', translateInfo.configured
    ? `${translateInfo.providerLabel}（${translateInfo.sourceLabel} → ${translateInfo.targetLabel}）`
    : translateInfo.provider === 'none'
      ? '未配置（设置 → 翻译里选择引擎）'
      : `${translateInfo.providerLabel} 缺少密钥（设置 → 翻译）`);
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

function restartApplication() {
  const args = process.argv.slice(1).filter(arg => !/^--(?:remote-debugging-|inspect)/.test(arg));
  hideIsland();
  app.relaunch({args});
  setTimeout(() => app.quit(), 150);
}

app.on('before-quit', event => {
  const unsaved=[...workspaceWindows.values()].filter(win=>!win.isDestroyed()&&!win.__allowClose);
  if(unsaved.length){event.preventDefault();workspaceQuitRequested=true;isQuitting=false;for(const win of unsaved)win.webContents.send('workspace:closing');return;}
  if(longCapture){try{longCapture.worker?.stop();}catch{}try{longCapture.controller?.stop();}catch{}}
  isQuitting = true;
});
app.on('will-quit', () => {
  themeController?.dispose();
  clearIslandRest();
  islandPointerProbe?.stop();
  clearInterval(clipboardTimer);
  if (foregroundIdleTimer) { clearTimeout(foregroundIdleTimer); foregroundIdleTimer = null; }
  shortcutManager?.dispose();
  // 第二个实例会在 ready 前退出，此时 Electron 不允许访问全局快捷键。
  if (app.isReady()) globalShortcut.unregisterAll();
  ocr?.terminate().catch(() => {});
  foregroundProbe.dispose();
  try { momentaryProbe?.stop().catch(() => {}); } catch {}
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && isQuitting) app.quit(); });

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', (_event,args,cwd) => {
    const files=markdownPaths(args.slice(app.isPackaged?1:2),cwd);
    if(files.length){queueMarkdownFiles(files);return;}
    if (!app.isReady()) return;
    cancelIdleTeardown(mainWindow);
    if (!mainWindow || mainWindow.isDestroyed()) {
      createMainWindow();
    } else {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
