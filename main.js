'use strict';

const {
  app, BrowserWindow, ipcMain, screen, desktopCapturer, clipboard,
  nativeImage, ClipboardItem, globalShortcut, Tray, Menu, shell, dialog
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
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
const { DEFAULT_BINDINGS, ShortcutManager } = require('./lib/shortcuts');
const { KeyVault, encryptItem, decryptItem, encryptText, decryptText } = require('./lib/crypto-store');
const { unionBounds, maxScaleFactor, tileLayout } = require('./lib/display-geometry');
const { InputInjector } = require('./lib/input-injector');
const { execFileSync } = require('node:child_process');

const APP_NAME = '随序 SUIRA';
const APP_ID = 'com.suira.desktop';
const MAIN_WIDTH = 1180;
const MAIN_HEIGHT = 820;
const QUICK_WIDTH = 660;
const QUICK_HEIGHT = 620;
const TEXT_HISTORY_LIMIT = 2000;

let store = null;
let ocr = null;
let actions = null;
let mainWindow = null;
let quickWindow = null;
let overlayWindow = null;
let tray = null;
let capturePayload = null;
let clipboardTimer = null;
let lastClipboardText = '';
let lastClipboardImageHash = '';
let clipboardWriteGuard = '';
let isQuitting = false;
let quickReady = false;
let captureBusy = false;
let captureGeneration = 0;
let mainWasVisible = false;
const pinWindows = new Set();

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

/** 从设置读取当前键位，回落到出厂默认。 */
function shortcutBindings() {
  const settings = store ? store.getSettings() : {};
  return {
    quick: settings.shortcutQuick || DEFAULT_BINDINGS.quick,
    capture: settings.shortcutCapture || DEFAULT_BINDINGS.capture
  };
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

async function rememberClipboardText(text) {
  const settings = store.getSettings();
  if (!settings.recordClipboard) return null;

  // 敏感来源与敏感内容排除（开发方案 P0 / 第 8 节）
  const guard = shouldExcludeCapture({
    text,
    excludeSensitive: settings.pauseSensitive
  });
  if (guard.excluded) {
    console.info('跳过敏感剪贴板内容:', guard.reason);
    return null;
  }

  const { text: safeText, truncated } = summarizeLargeText(String(text || '').replace(/\u0000/g, ''));
  const value = safeText.slice(0, 200000);
  if (!value.trim()) return null;

  const latest = store.listItems({ limit: 1 })[0];
  if (latest && latest.kind !== 'image' && latest.text === value) return latest;

  clipboardWriteGuard = value;
  const item = store.addItem({
    kind: classifyText(value),
    title: value.trim().slice(0, 42) || '文字',
    text: value,
    source: { type: 'clipboard', acquisitionMethod: 'clipboard-poll', confidence: 'inferred' },
    meta: truncated ? { truncated: true } : {}
  });
  await store.save();
  broadcast('content:changed', { itemId: item.id });
  return item;
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

async function writeClipboardText(text) {
  const value = String(text || '');
  clipboardWriteGuard = value;
  await clipboard.writeText(value);
  // 记录序号与内容，供自写回环判定（第 7 节）
  clipboardLedger.record(value);
  lastClipboardText = value;
  clipboardWriteGuard = '';
}

async function writeClipboardImage(image) {
  const png = image.toPNG();
  clipboardWriteGuard = await readClipboardText();
  lastClipboardImageHash = hashBuffer(png);
  await clipboard.write([new ClipboardItem({ 'image/png': png })]);
  lastClipboardText = await readClipboardText();
  clipboardLedger.record(lastClipboardText);
  clipboardWriteGuard = '';
}

async function pollClipboard() {
  try {
    const generation = ++captureGeneration;
    const text = await readClipboardText();
    const image = await readClipboardImage();
    const imageHash = image ? hashBuffer(image.toPNG()) : '';
    if (generation !== captureGeneration) return;
    const textChanged = Boolean(text && text !== lastClipboardText);
    const imageChanged = Boolean(imageHash && imageHash !== lastClipboardImageHash);
    // 自写回环：本次变化若仍是我们刚写入的内容，不重复入库
    const ownWrite = clipboardLedger.shouldIgnore(text);
    if (textChanged && !ownWrite && text !== clipboardWriteGuard) await rememberClipboardText(text);
    else if (imageChanged && !text) await addImageToStore(image, { type: 'clipboard', acquisitionMethod: 'clipboard-poll', confidence: 'inferred' });
    if (text) lastClipboardText = text;
    if (imageHash) lastClipboardImageHash = imageHash;
    if (clipboardWriteGuard && text === clipboardWriteGuard) clipboardWriteGuard = '';
  } catch (error) {
    console.warn('剪贴板读取失败:', error.message);
  }
}

async function startClipboardWatcher() {
  clearInterval(clipboardTimer);
  lastClipboardText = await readClipboardText();
  const initialImage = await readClipboardImage();
  lastClipboardImageHash = initialImage ? hashBuffer(initialImage.toPNG()) : '';
  clipboardTimer = setInterval(pollClipboard, 550);
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
    return { ...decision, canPaste: false, message: `复制失败：${error.message}` };
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
  return { ...decision, canPaste: true, pasted: true, message: '已返回并粘贴' };
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
  const display = screen.getPrimaryDisplay();
  mainWindow = new BrowserWindow({
    width: Math.min(MAIN_WIDTH, display.workAreaSize.width - 48),
    height: Math.min(MAIN_HEIGHT, display.workAreaSize.height - 48),
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
  mainWindow.once('ready-to-show', () => { mainWindow.show(); mainWindow.focus(); });
  mainWindow.on('close', (event) => {
    if (!isQuitting) { event.preventDefault(); mainWindow.hide(); }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeHttpUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function showMain(page = 'shelf') {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('app:navigate', page);
}

async function beginScreenCapture(source = 'panel') {
  if (captureBusy) return { ok: true };
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.focus();
    return { ok: true };
  }
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
    const result = await dialog.showSaveDialog(mainWindow, {
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
}function registerIpc() {
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

  ipcMain.handle('window:minimize', () => mainWindow?.minimize());  ipcMain.handle('window:maximize', () => {
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

  ipcMain.handle('app:info', () => ({
    name: APP_NAME,
    version: app.getVersion(),
    userData: userRoot(),
    dataPath: dataPath(),
    shortcuts: { quick: 'Ctrl+Alt+Space', capture: 'Ctrl+Shift+A' },
    runtime: 'Electron prototype'
  }));
  ipcMain.handle('app:open-data-dir', () => shell.openPath(userRoot()));

  ipcMain.handle('capture:start', () => beginScreenCapture('main'));
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

  ipcMain.handle('shortcuts:get', () => (shortcutManager ? shortcutManager.snapshot() : { bindings: {}, status: {} }));

  ipcMain.handle('shortcuts:set', async (_event, payload) => {
    if (!shortcutManager) return { ok: false, error: '快捷键尚未初始化' };
    const name = String(payload?.name || '');
    const accelerator = String(payload?.accelerator || '').trim();
    if (name !== 'quick' && name !== 'capture') return { ok: false, error: '未知的快捷键名称' };
    const result = shortcutManager.rebind(name, accelerator);
    if (!result.ok) return { ok: false, error: result.error, status: result.status };
    await store.updateSettings(name === 'quick' ? { shortcutQuick: accelerator } : { shortcutCapture: accelerator });
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
    const result = await dialog.showSaveDialog(mainWindow, {
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

  ipcMain.handle('settings:get', () => store.getSettings());
  ipcMain.handle('settings:update', async (_event, patch) => {
    const settings = await store.updateSettings(patch || {});
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
}function createTray() {
  const trayImage = nativeImage.createFromPath(assetPath('suira-icon.png')).resize({ width: 32, height: 32 });
  tray = new Tray(trayImage);
  tray.setToolTip(`${APP_NAME} · 顺手接住，让工作继续。`);
  const menu = Menu.buildFromTemplate([
    { label: '随手面板  Ctrl+Alt+Space', click: showQuickPanel },
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
  return status;
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
  // 剪贴板监听失败时不能只写日志：剪贴板历史会完全失效，用户必须知道
  startClipboardWatcher().catch((error) => {
    console.warn('剪贴板监听启动失败:', error.message);
    const message = `剪贴板监听未启动：${error.message || '未知错误'}`;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:toast', { message, type: 'error' });
    }
    if (tray) tray.setToolTip(`${APP_NAME} · 剪贴板监听未启动`);
  });
}

app.whenReady().then(initialize).catch((error) => {
  console.error('随序启动失败:', error);
  dialog.showErrorBox('随序启动失败', error.stack || error.message || String(error));
  app.quit();
});

app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', () => {
  clearInterval(clipboardTimer);
  shortcutManager?.dispose();
  globalShortcut.unregisterAll();
  ocr?.terminate().catch(() => {});
  foregroundProbe.dispose();
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
