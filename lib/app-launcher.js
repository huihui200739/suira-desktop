'use strict';

/**
 * Fast, single-instance-friendly Windows app launcher.
 *
 * Before spawning a new process via shell.openPath (which is slow and causes
 * apps like WeChat 4.x / Weixin.exe to pop up a duplicate login window even
 * when already logged in), resolve the shortcut/executable target, scan
 * existing top-level windows in-process via Win32 FFI, and activate the
 * running window directly (including minimized and hidden-to-tray windows)
 * without blocking the Electron main thread.
 */

const fs = require('node:fs');
const path = require('node:path');

const GW_HWNDNEXT = 2;
const GW_OWNER = 4;
const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;

const WS_CHILD = 0x40000000;
const WS_DISABLED = 0x08000000;
const WS_CAPTION = 0x00c00000;
const WS_SYSMENU = 0x00080000;
const WS_THICKFRAME = 0x00040000;
const WS_MINIMIZEBOX = 0x00020000;
const WS_MAXIMIZEBOX = 0x00010000;

const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_TRANSPARENT = 0x00000020;
const WS_EX_APPWINDOW = 0x00040000;
const WS_EX_NOACTIVATE = 0x08000000;

const SW_SHOWMINIMIZED = 2;
const SW_SHOWMAXIMIZED = 3;
const SW_SHOW = 5;
const SW_RESTORE = 9;
const DWMWA_CLOAKED = 14;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

// Generic script/shell hosts whose existing windows belong to unrelated tasks.
const GENERIC_HOSTS = new Set([
  'explorer', 'cmd', 'powershell', 'pwsh', 'conhost', 'rundll32',
  'mmc', 'control', 'msiexec', 'wscript', 'cscript', 'mshta',
  'javaw', 'java', 'python', 'pythonw', 'node', 'regsvr32'
]);

// Known sibling executable names within the same app installation.
const EXE_ALIASES = new Map([
  ['wechat', ['weixin']],
  ['weixin', ['wechat']],
  ['wechatappex', ['weixin', 'wechat']],
  ['qqsclauncher', ['qq']],
  ['dingtalklauncher', ['dingtalk']]
]);

const WECHAT_STEMS = new Set(['wechat', 'weixin', 'wechatappex']);

const HELPER_CLASS_RE = /^(?:ime|msctfime ui|tooltips_class32|gdi\+ hook window class|trayiconmessagewindow|sysshadow|progman|workerw|shell_traywnd)$/i;
const HELPER_CLASS_FRAGMENT_RE = /(?:shadow|tooltip|trayicon|savebits|messageloop|dummy|notifyicon)/i;
const LOGIN_CLASS_RE = /(?:wechatloginwnd|loginwnd|splash)/i;
const KNOWN_MAIN_CLASS_RE = /^(?:WeChatMainWndForPC|TXGuiFoundation|Qt\d+QWindowIcon|Chrome_WidgetWin_1|ApplicationFrameWindow)$/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeWinPath(value) {
  return String(value || '').trim().replace(/^"(.*)"$/, '$1').replace(/\//g, '\\').toLowerCase();
}

function exeStem(filePath) {
  const base = path.win32.basename(normalizeWinPath(filePath));
  return base.replace(/\.exe$/i, '');
}

function isGenericHost(stem) {
  return GENERIC_HOSTS.has(String(stem || '').toLowerCase());
}

/**
 * Extract the target executable stem from a pure Squirrel Update.exe wrapper.
 * Requires ONLY `--processStart <bare-exe-name.exe>` with no path separators
 * and no extra arguments of any kind.
 */
function extractSquirrelTarget(args) {
  const raw = String(args || '').trim();
  if (!raw) return '';
  const match = raw.match(/^--processstart(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))$/i);
  if (!match) return '';
  const target = (match[1] || match[2] || match[3] || '').trim();
  if (!target || /[\\/:]/.test(target) || target.includes('..') || !/\.exe$/i.test(target)) return '';
  return exeStem(target);
}

/**
 * Any non-empty shortcut arguments alter launch intent by default (files,
 * workspaces, profiles, PWA --app-id, --new-window, URLs, etc.).
 * Only a pure Squirrel Update.exe --processStart wrapper is allowed.
 */
function isMultiInstanceArgs(args, { isSquirrel = false } = {}) {
  const value = String(args || '').trim();
  if (!value) return false;
  if (isSquirrel) return !extractSquirrelTarget(value);
  return true;
}

function isSpecificInstallDir(dirPath) {
  const norm = normalizeWinPath(dirPath).replace(/\\+$/, '');
  if (!norm || /^[a-z]:$/.test(norm)) return false;
  const parts = norm.split('\\').filter(Boolean);
  if (parts.length < 2) return false;
  if (/^[a-z]:\\windows(?:\\(?:system32|syswow64))?$/i.test(norm)) return false;
  if (/^[a-z]:\\(?:program files|program files \(x86\)|programdata)$/i.test(norm)) return false;
  if (/^[a-z]:\\users\\[^\\]+(?:\\(?:desktop|downloads|documents|appdata|appdata\\local|appdata\\roaming|appdata\\local\\programs))?$/i.test(norm)) {
    return false;
  }
  return true;
}

function defaultIsSquirrelDir(dirPath) {
  if (!dirPath) return false;
  try {
    try {
      if (fs.statSync(path.win32.join(dirPath, 'packages')).isDirectory()) return true;
    } catch {}
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.some((entry) => entry.isDirectory() && /^app-\d/i.test(entry.name));
  } catch {
    return false;
  }
}

function createShortcutResolver({ readShortcutLink, statSync = fs.statSync, isSquirrelDir = defaultIsSquirrelDir, maxCache = 256 } = {}) {
  const cache = new Map();

  function readCachedShortcut(filePath) {
    if (typeof readShortcutLink !== 'function') return null;
    let mtimeMs = 0;
    try { mtimeMs = statSync(filePath).mtimeMs || 0; } catch { return null; }
    const cached = cache.get(filePath);
    if (cached && cached.mtimeMs === mtimeMs) return cached.data;
    try {
      const data = readShortcutLink(filePath);
      if (cache.size >= maxCache) cache.delete(cache.keys().next().value);
      cache.set(filePath, { mtimeMs, data });
      return data;
    } catch {
      return null;
    }
  }

  return function resolveLaunchSpec(targetPath, displayName = '') {
    const raw = String(targetPath || '').trim();
    if (!raw) return { activateable: false, targetPath: raw };
    const lower = raw.toLowerCase();
    let resolvedExe = '';
    let args = '';
    if (lower.endsWith('.lnk')) {
      const link = readCachedShortcut(raw);
      if (!link?.target) return { activateable: false, targetPath: raw };
      resolvedExe = String(link.target).trim();
      args = String(link.args || '').trim();
    } else if (lower.endsWith('.exe')) {
      resolvedExe = raw;
    } else {
      return { activateable: false, targetPath: raw };
    }

    const normExe = normalizeWinPath(resolvedExe);
    if (!normExe.endsWith('.exe')) return { activateable: false, targetPath: raw };

    let stem = exeStem(normExe);
    const parentDir = path.win32.dirname(normExe);
    const installDir = isSpecificInstallDir(parentDir) ? parentDir.replace(/\\+$/, '') : '';
    const isSquirrel = stem === 'update' && Boolean(installDir) && Boolean(isSquirrelDir(parentDir));
    if (isMultiInstanceArgs(args, { isSquirrel })) {
      return { activateable: false, targetPath: raw, resolvedExe: normExe };
    }
    if (isSquirrel) {
      const processStart = extractSquirrelTarget(args);
      if (!processStart) return { activateable: false, targetPath: raw, resolvedExe: normExe };
      stem = processStart;
    }
    if (!stem || isGenericHost(stem)) {
      return { activateable: false, targetPath: raw, resolvedExe: normExe };
    }

    const names = new Set([stem]);
    for (const alias of EXE_ALIASES.get(stem) || []) names.add(alias);
    const launcherMatch = stem.match(/^(.+?)(?:sc)?launcher$/i);
    if (launcherMatch && launcherMatch[1].length >= 2) {
      const stripped = launcherMatch[1].toLowerCase();
      names.add(stripped);
      for (const alias of EXE_ALIASES.get(stripped) || []) names.add(alias);
    }

    const label = String(displayName || path.win32.basename(raw).replace(/\.(lnk|exe)$/i, '')).trim().toLowerCase();
    return {
      activateable: true,
      targetPath: raw,
      resolvedExe: isSquirrel ? '' : normExe,
      exeNames: [...names],
      primaryName: stem,
      installDir,
      displayName: label
    };
  };
}

/**
 * Strictly match a running process image path to the resolved launch spec.
 * Never matches by bare executable basename across unrelated directories, and
 * never matches unrelated binaries merely sharing the same install folder.
 */
function matchProcessScore(processPath, spec) {
  const norm = normalizeWinPath(processPath);
  if (!norm || !norm.endsWith('.exe') || !spec) return 0;
  if (spec.resolvedExe && norm === spec.resolvedExe) return 1000;
  const stem = exeStem(norm);
  if (spec.installDir && norm.startsWith(spec.installDir + '\\') && Array.isArray(spec.exeNames) && spec.exeNames.includes(stem)) {
    return 900;
  }
  return 0;
}

function logicalWindowSize(win) {
  const rawW = Math.max(Number(win.normalWidth) || 0, Number(win.width) || 0);
  const rawH = Math.max(Number(win.normalHeight) || 0, Number(win.height) || 0);
  const dpi = Number(win.dpi) || 0;
  const scale = dpi >= 96 ? dpi / 96 : 1;
  return {
    width: rawW / scale,
    height: rawH / scale,
    rawWidth: rawW,
    rawHeight: rawH
  };
}

function classifyWindowRole(win, spec) {
  const style = Number(win.style) || 0;
  const exStyle = Number(win.exStyle) || 0;
  const className = String(win.className || '');
  const title = String(win.title || '').trim();
  const { width, height } = logicalWindowSize(win);
  const hasChrome = (style & (WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU)) !== 0;
  const isResizable = (style & WS_THICKFRAME) !== 0;
  const isAppWindow = (exStyle & WS_EX_APPWINDOW) !== 0;
  const isKnownMain = KNOWN_MAIN_CLASS_RE.test(className);
  const isWeChatMainClass = /^WeChatMainWndForPC$/i.test(className);
  const isWeChatSpec = WECHAT_STEMS.has(String(spec?.primaryName || '').toLowerCase());

  if (LOGIN_CLASS_RE.test(className)) return 'login';
  // WeChat 4.x (Qt) login popups share the Qt*QWindowIcon class and "微信" title
  // with the main chat window, but are portrait non-resizable dialogs (~300x420 DIP)
  // even when scaled to 150%-250% DPI.
  if (isWeChatSpec && !isWeChatMainClass) {
    const isPortraitDialog = height > width * 1.05 && !isResizable;
    const isCompactLogin = width < 480 && height < 560;
    if (isCompactLogin || isPortraitDialog) return 'login';
  }
  if (!win.hasOwner && title && (hasChrome || isAppWindow || isKnownMain) && (isWeChatMainClass || (width >= 520 && height >= 380))) {
    return 'main';
  }
  return 'secondary';
}

function scoreWindowCandidate(win, spec, zIndex = 0) {
  if (!win || !win.hwnd || !win.processScore) return -Infinity;
  if (win.cloaked) return -Infinity;
  const style = Number(win.style) || 0;
  const exStyle = Number(win.exStyle) || 0;
  if ((style & WS_CHILD) !== 0) return -Infinity;
  if ((style & WS_DISABLED) !== 0) return -Infinity;
  if ((exStyle & WS_EX_TOOLWINDOW) !== 0) return -Infinity;
  if ((exStyle & WS_EX_TRANSPARENT) !== 0) return -Infinity;

  const className = String(win.className || '');
  if (HELPER_CLASS_RE.test(className) || HELPER_CLASS_FRAGMENT_RE.test(className)) return -Infinity;

  const { width, height } = logicalWindowSize(win);
  if (width < 200 || height < 150) return -Infinity;

  const title = String(win.title || '').trim();
  const hasChrome = (style & (WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU)) !== 0;
  const isAppWindow = (exStyle & WS_EX_APPWINDOW) !== 0;
  const isKnownMain = KNOWN_MAIN_CLASS_RE.test(className);
  const role = classifyWindowRole(win, spec);

  if (!win.visible) {
    // Hidden-to-tray window: apply strict filters so background helper windows are never shown.
    if (role === 'login') return -Infinity;
    if (win.hasOwner) return -Infinity;
    if ((exStyle & WS_EX_NOACTIVATE) !== 0) return -Infinity;
    if (!title) return -Infinity;
    if (width < 320 || height < 240) return -Infinity;
    if (!hasChrome && !isAppWindow && !isKnownMain) return -Infinity;
  }

  let score = win.processScore;
  if (win.visible) {
    score += win.iconic ? 9800 : 10000;
  } else {
    score += 5000;
  }

  if (!win.hasOwner) score += 600;
  if (title) score += 300;
  if (spec?.displayName && title.toLowerCase().includes(spec.displayName)) score += 350;
  if (isKnownMain) score += 250;
  if (/^WeChatMainWndForPC$/i.test(className)) score += 600;
  if (width >= 560 && height >= 420) score += 450;
  else if (width < 420 && height < 520) score -= 200;

  score -= Math.min(200, zIndex * 2);
  return score;
}

/**
 * Select the best existing window by role tier first:
 *   1. Trusted main windows (including hidden-to-tray logged-in main windows)
 *   2. Other regular app windows
 *   3. Visible login / splash dialogs (only when no main or secondary window exists)
 * A visible login dialog can therefore never outrank a logged-in main window in the tray.
 */
function rankWindowCandidates(candidates, spec) {
  const tiers = { main: [], secondary: [], login: [] };
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const score = scoreWindowCandidate(candidate, spec, i);
    if (!Number.isFinite(score)) continue;
    const role = classifyWindowRole(candidate, spec);
    tiers[role].push({ ...candidate, role, score });
  }
  const activeTier = tiers.main.length ? tiers.main : tiers.secondary.length ? tiers.secondary : tiers.login;
  return activeTier.sort((a, b) => b.score - a.score);
}

function chooseBestWindow(candidates, spec) {
  return rankWindowCandidates(candidates, spec)[0] || null;
}

function createNativeWindowBridge({
  platform = process.platform,
  arch = process.arch,
  load = () => require('koffi'),
  wakeTimeoutMs = 90,
  pollIntervalMs = 20
} = {}) {
  let api = null;
  let attempted = false;

  function init() {
    if (attempted) return api;
    attempted = true;
    if (platform !== 'win32') return null;
    try {
      const ffi = load();
      const user = ffi.load('user32.dll');
      const kernel = ffi.load('kernel32.dll');
      const dwm = ffi.load('dwmapi.dll');
      const point = ffi.struct({ x: 'int32', y: 'int32' });
      const rect = ffi.struct({ left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
      const placement = ffi.struct({
        length: 'uint32', flags: 'uint32', showCmd: 'uint32',
        minPos: point, maxPos: point, normalPos: rect
      });
      const getLongName = arch === 'ia32' ? 'GetWindowLongW' : 'GetWindowLongPtrW';
      const longRet = arch === 'ia32' ? 'int32' : 'intptr_t';
      api = {
        placementSize: ffi.sizeof(placement),
        getTopWindow: user.func('__stdcall', 'GetTopWindow', 'uintptr_t', ['uintptr_t']),
        getWindow: user.func('__stdcall', 'GetWindow', 'uintptr_t', ['uintptr_t', 'uint32']),
        isWindow: user.func('__stdcall', 'IsWindow', 'int', ['uintptr_t']),
        isVisible: user.func('__stdcall', 'IsWindowVisible', 'int', ['uintptr_t']),
        isIconic: user.func('__stdcall', 'IsIconic', 'int', ['uintptr_t']),
        getWindowLong: user.func('__stdcall', getLongName, longRet, ['uintptr_t', 'int']),
        getThreadPid: user.func('__stdcall', 'GetWindowThreadProcessId', 'uint32', ['uintptr_t', 'uint32 *']),
        getWindowText: user.func('__stdcall', 'GetWindowTextW', 'int', ['uintptr_t', 'void *', 'int']),
        getClassName: user.func('__stdcall', 'GetClassNameW', 'int', ['uintptr_t', 'void *', 'int']),
        getPlacement: user.func('__stdcall', 'GetWindowPlacement', 'int', ['uintptr_t', ffi.inout(ffi.pointer(placement))]),
        getWindowRect: user.func('__stdcall', 'GetWindowRect', 'int', ['uintptr_t', ffi.out(ffi.pointer(rect))]),
        getForeground: user.func('__stdcall', 'GetForegroundWindow', 'uintptr_t', []),
        showWindowAsync: user.func('__stdcall', 'ShowWindowAsync', 'int', ['uintptr_t', 'int']),
        setForeground: user.func('__stdcall', 'SetForegroundWindow', 'int', ['uintptr_t']),
        allowForeground: user.func('__stdcall', 'AllowSetForegroundWindow', 'int', ['uint32']),
        openProcess: kernel.func('__stdcall', 'OpenProcess', 'uintptr_t', ['uint32', 'int', 'uint32']),
        queryImageName: kernel.func('__stdcall', 'QueryFullProcessImageNameW', 'int', ['uintptr_t', 'uint32', 'void *', 'uint32 *']),
        closeHandle: kernel.func('__stdcall', 'CloseHandle', 'int', ['uintptr_t']),
        dwmGetAttribute: dwm.func('__stdcall', 'DwmGetWindowAttribute', 'long', ['uintptr_t', 'uint32', 'uint32 *', 'uint32'])
      };
      try {
        api.getDpiForWindow = user.func('__stdcall', 'GetDpiForWindow', 'uint32', ['uintptr_t']);
      } catch {
        api.getDpiForWindow = null;
      }
    } catch {
      api = null;
    }
    return api;
  }

  function queryProcessPath(native, pid, cache) {
    if (cache.has(pid)) return cache.get(pid);
    let imagePath = '';
    let handle = 0;
    try {
      handle = native.openProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
      if (handle) {
        const buf = Buffer.alloc(2048);
        const len = Buffer.alloc(4);
        len.writeUInt32LE(1024, 0);
        if (native.queryImageName(handle, 0, buf, len)) {
          const chars = len.readUInt32LE(0);
          if (chars > 0) imagePath = buf.toString('utf16le', 0, chars * 2);
        }
      }
    } catch {
      imagePath = '';
    } finally {
      if (handle) {
        try { native.closeHandle(handle); } catch {}
      }
    }
    cache.set(pid, imagePath);
    return imagePath;
  }

  function readWide(fn, hwnd, maxChars = 256) {
    const buf = Buffer.alloc(maxChars * 2);
    const chars = fn(hwnd, buf, maxChars);
    return chars > 0 ? buf.toString('utf16le', 0, Math.min(chars, maxChars) * 2) : '';
  }

  function isWindowCloaked(native, hwnd, outBuf) {
    outBuf.writeUInt32LE(0, 0);
    return native.dwmGetAttribute(hwnd, DWMWA_CLOAKED, outBuf, 4) === 0
      && outBuf.readUInt32LE(0) !== 0;
  }

  function verifyCandidateIdentity(native, candidate) {
    if (!native.isWindow(candidate.hwnd)) return false;
    const pidOut = Buffer.alloc(4);
    const tid = native.getThreadPid(candidate.hwnd, pidOut);
    if (!tid || pidOut.readUInt32LE(0) !== candidate.pid) return false;
    if (isWindowCloaked(native, candidate.hwnd, Buffer.alloc(4))) return false;
    return true;
  }

  function findCandidates(spec, { excludePid = process.pid } = {}) {
    const native = init();
    if (!native) return [];
    const pidCache = new Map();
    const pidOut = Buffer.alloc(4);
    const cloakedOut = Buffer.alloc(4);
    const seen = new Set();
    const matches = [];
    let hwnd = native.getTopWindow(0);
    let steps = 0;
    while (hwnd && steps < 4096) {
      steps += 1;
      const key = String(hwnd);
      if (seen.has(key)) break;
      seen.add(key);
      pidOut.writeUInt32LE(0, 0);
      const tid = native.getThreadPid(hwnd, pidOut);
      const pid = tid ? pidOut.readUInt32LE(0) : 0;
      if (pid && pid !== excludePid) {
        const procPath = queryProcessPath(native, pid, pidCache);
        const processScore = matchProcessScore(procPath, spec);
        if (processScore > 0) {
          const visible = Boolean(native.isVisible(hwnd));
          const iconic = Boolean(native.isIconic(hwnd));
          const style = Number(native.getWindowLong(hwnd, GWL_STYLE));
          const exStyle = Number(native.getWindowLong(hwnd, GWL_EXSTYLE));
          const owner = native.getWindow(hwnd, GW_OWNER);
          const title = readWide(native.getWindowText, hwnd, 256);
          const className = readWide(native.getClassName, hwnd, 128);
          const placement = { length: native.placementSize };
          const hasPlacement = Boolean(native.getPlacement(hwnd, placement));
          const rect = {};
          const hasRect = Boolean(native.getWindowRect(hwnd, rect));
          const cloaked = isWindowCloaked(native, hwnd, cloakedOut);
          let dpi = 96;
          if (typeof native.getDpiForWindow === 'function') {
            try { dpi = Number(native.getDpiForWindow(hwnd)) || 96; } catch { dpi = 96; }
          }
          matches.push({
            hwnd,
            pid,
            processPath: procPath,
            processScore,
            visible,
            iconic,
            cloaked,
            dpi,
            style,
            exStyle,
            hasOwner: Boolean(owner),
            title,
            className,
            showCmd: hasPlacement ? Number(placement.showCmd) : 0,
            normalWidth: hasPlacement ? Math.max(0, placement.normalPos.right - placement.normalPos.left) : 0,
            normalHeight: hasPlacement ? Math.max(0, placement.normalPos.bottom - placement.normalPos.top) : 0,
            width: hasRect ? Math.max(0, rect.right - rect.left) : 0,
            height: hasRect ? Math.max(0, rect.bottom - rect.top) : 0
          });
        }
      }
      hwnd = native.getWindow(hwnd, GW_HWNDNEXT);
    }
    return matches;
  }

  /**
   * Non-blocking activation with bounded async confirmation:
   * - Uses ShowWindowAsync (never blocks on a hung target window thread)
   * - Never calls AttachThreadInput or BringWindowToTop
   * - Re-verifies HWND still belongs to candidate.pid and is uncloaked on every path
   * - Returns 'foreground' | 'requested' | 'stale' | 'failed'
   */
  async function activateWindow(candidate) {
    const native = init();
    if (!native || !candidate?.hwnd) return 'failed';
    const hwnd = candidate.hwnd;
    if (!verifyCandidateIdentity(native, candidate)) return 'stale';

    const isConfirmedForeground = () => (
      verifyCandidateIdentity(native, candidate)
      && String(native.getForeground()) === String(hwnd)
      && Boolean(native.isVisible(hwnd))
      && !native.isIconic(hwnd)
    );

    if (isConfirmedForeground()) return 'foreground';

    try { native.allowForeground(candidate.pid); } catch {}
    if (native.isIconic(hwnd)) {
      native.showWindowAsync(hwnd, SW_RESTORE);
    } else if (!native.isVisible(hwnd)) {
      const cmd = candidate.showCmd === SW_SHOWMAXIMIZED
        ? SW_SHOWMAXIMIZED
        : candidate.showCmd === SW_SHOWMINIMIZED
          ? SW_RESTORE
          : SW_SHOW;
      native.showWindowAsync(hwnd, cmd);
    }

    native.setForeground(hwnd);
    if (isConfirmedForeground()) return 'foreground';

    // Wait briefly within a strict time budget for ShowWindowAsync / foreground switch.
    const deadline = Date.now() + Math.max(0, wakeTimeoutMs);
    while (Date.now() < deadline) {
      await sleep(pollIntervalMs);
      if (!verifyCandidateIdentity(native, candidate)) return 'stale';
      if (isConfirmedForeground()) return 'foreground';
      if (native.isVisible(hwnd) && !native.isIconic(hwnd)) {
        native.setForeground(hwnd);
        if (isConfirmedForeground()) return 'foreground';
      }
    }

    if (!verifyCandidateIdentity(native, candidate)) return 'stale';
    return 'requested';
  }

  return { findCandidates, activateWindow };
}

function normalizeActivationOutcome(raw) {
  if (raw === 'foreground' || raw === 'requested' || raw === 'stale' || raw === 'failed') return raw;
  return raw ? 'foreground' : 'failed';
}

function createAppLauncher({
  shell,
  readShortcutLink,
  openPath,
  bridge = createNativeWindowBridge(),
  statSync = fs.statSync,
  isSquirrelDir = defaultIsSquirrelDir,
  excludePid = process.pid
} = {}) {
  const resolveShortcut = typeof readShortcutLink === 'function'
    ? readShortcutLink
    : (filePath) => (typeof shell?.readShortcutLink === 'function' ? shell.readShortcutLink(filePath) : null);
  const openTarget = typeof openPath === 'function'
    ? openPath
    : (filePath) => (typeof shell?.openPath === 'function' ? shell.openPath(filePath) : Promise.resolve('无法启动目标应用'));
  const resolveSpec = createShortcutResolver({ readShortcutLink: resolveShortcut, statSync, isSquirrelDir });

  async function launch(targetPath, { displayName = '', preferExisting = true } = {}) {
    if (preferExisting) {
      let ranked = [];
      try {
        const spec = resolveSpec(targetPath, displayName);
        if (spec.activateable) {
          const candidates = bridge.findCandidates(spec, { excludePid });
          ranked = rankWindowCandidates(candidates, spec);
        }
      } catch {
        // Native enumeration failure falls back cleanly to shell.openPath.
        ranked = [];
      }
      let aliveMainFailure = null;
      for (const candidate of ranked) {
        let outcome = 'failed';
        try {
          outcome = normalizeActivationOutcome(await bridge.activateWindow(candidate));
        } catch {
          outcome = 'failed';
        }
        if (outcome === 'foreground') {
          return { ok: true, activated: true, status: 'foreground', pid: candidate.pid, hwnd: String(candidate.hwnd) };
        }
        if (outcome === 'stale') continue;
        if (candidate.role === 'main' && !aliveMainFailure) {
          aliveMainFailure = {
            ok: false,
            activated: false,
            status: outcome,
            existingWindow: true,
            pid: candidate.pid,
            hwnd: String(candidate.hwnd),
            error: '目标应用已在运行，但系统未允许切到前台，请从任务栏切换'
          };
        }
      }
      if (aliveMainFailure) return aliveMainFailure;
    }
    const error = await openTarget(targetPath);
    if (error) return { ok: false, error };
    return { ok: true, activated: false, status: 'launched' };
  }

  return { launch, resolveSpec };
}

module.exports = {
  createAppLauncher,
  createShortcutResolver,
  createNativeWindowBridge,
  matchProcessScore,
  classifyWindowRole,
  scoreWindowCandidate,
  rankWindowCandidates,
  chooseBestWindow,
  defaultIsSquirrelDir,
  isGenericHost,
  isMultiInstanceArgs,
  isSpecificInstallDir,
  extractSquirrelTarget
};
