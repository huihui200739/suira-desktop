'use strict';

const assert = require('node:assert/strict');
const {
  createAppLauncher,
  createShortcutResolver,
  createNativeWindowBridge,
  matchProcessScore,
  scoreWindowCandidate,
  chooseBestWindow,
  isGenericHost,
  isMultiInstanceArgs,
  isSpecificInstallDir,
  extractSquirrelTarget
} = require('../lib/app-launcher');
const { clampQuickPosition, QUICK_PANEL_SIZE } = require('../lib/display-geometry');

const WS_CAPTION = 0x00c00000;
const WS_THICKFRAME = 0x00040000;
const WS_SYSMENU = 0x00080000;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_TRANSPARENT = 0x00000020;

let pass = 0;
async function test(name, fn) {
  await fn();
  console.log('  PASS  ' + name);
  pass += 1;
}

(async () => {
  await test('resolves .lnk shortcuts with mtime caching and strict Squirrel wrappers only', () => {
    let reads = 0;
    const resolve = createShortcutResolver({
      statSync: () => ({ mtimeMs: 1000 }),
      isSquirrelDir: (dir) => dir.toLowerCase().includes('\\discord'),
      readShortcutLink: (file) => {
        reads += 1;
        if (file.includes('Discord')) {
          return { target: 'C:\\Users\\demo\\AppData\\Local\\Discord\\Update.exe', args: '--processStart Discord.exe' };
        }
        if (file.includes('RandomUpdater')) {
          return { target: 'C:\\Program Files\\SomeApp\\Update.exe', args: '--processStart SomeApp.exe' };
        }
        return { target: 'C:\\Program Files\\Tencent\\Weixin\\Weixin.exe', args: '' };
      }
    });
    const wx1 = resolve('C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\微信\\微信.lnk', '微信');
    const wx2 = resolve('C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\微信\\微信.lnk', '微信');
    assert.equal(reads, 1, 'identical mtime should hit shortcut cache');
    assert.equal(wx1.activateable, true);
    assert.equal(wx2.primaryName, 'weixin');
    assert.ok(wx1.exeNames.includes('wechat'));
    assert.equal(wx1.installDir, 'c:\\program files\\tencent\\weixin');

    const discord = resolve('C:\\Users\\demo\\Start Menu\\Discord.lnk');
    assert.equal(discord.activateable, true);
    assert.equal(discord.primaryName, 'discord');
    assert.equal(discord.installDir, 'c:\\users\\demo\\appdata\\local\\discord');
    assert.equal(resolve('C:\\Users\\demo\\Start Menu\\RandomUpdater.lnk').activateable, false, 'non-Squirrel Update.exe must not use Squirrel special case');
    assert.equal(extractSquirrelTarget('--processStart "Slack.exe"'), 'slack');
    assert.equal(extractSquirrelTarget('--processStart "Slack.exe" --new-window'), '', 'extra Squirrel flags must not be swallowed');
    assert.equal(extractSquirrelTarget('--processStart "Slack.exe" --process-start-args=""'), '', 'extra --process-start-args must not be swallowed');
    assert.equal(extractSquirrelTarget('--processStart "other\\Discord.exe"'), '', 'directory paths must not be collapsed');
    assert.equal(extractSquirrelTarget('--processStart C:Discord.exe'), '', 'drive-relative paths must not be accepted');
    assert.equal(extractSquirrelTarget('--processStart Discord'), '', 'missing .exe extension must not be accepted');
  });

  await test('defaultIsSquirrelDir requires actual directories, rejecting plain files named packages or app-1.exe', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const { defaultIsSquirrelDir } = require('../lib/app-launcher');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'suira-sq-'));
    try {
      const fakeFileDir = path.join(tmp, 'plain-files');
      fs.mkdirSync(fakeFileDir);
      fs.writeFileSync(path.join(fakeFileDir, 'packages'), 'not a dir');
      fs.writeFileSync(path.join(fakeFileDir, 'app-1.exe'), 'not a dir');
      assert.equal(defaultIsSquirrelDir(fakeFileDir), false, 'plain files must not qualify as Squirrel dir');

      const realAppDir = path.join(tmp, 'real-squirrel');
      fs.mkdirSync(path.join(realAppDir, 'app-1.0.9'), { recursive: true });
      assert.equal(defaultIsSquirrelDir(realAppDir), true, 'app-<ver> directory qualifies');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await test('never swallows shortcut arguments, profiles, workspaces, or Squirrel flags', () => {
    assert.equal(isGenericHost('explorer'), true);
    assert.equal(isGenericHost('powershell'), true);
    assert.equal(isGenericHost('weixin'), false);
    assert.equal(isMultiInstanceArgs('--app-id=abc123'), true);
    assert.equal(isMultiInstanceArgs('--app-id x'), true);
    assert.equal(isMultiInstanceArgs('"C:\\project.code-workspace"'), true);
    assert.equal(isMultiInstanceArgs('--profile-directory="Profile 1"'), true);
    assert.equal(isMultiInstanceArgs('--new-instance'), true);
    assert.equal(isMultiInstanceArgs('--processStart Discord.exe', { isSquirrel: true }), false);
    assert.equal(isMultiInstanceArgs('--processStart Discord.exe --new-window', { isSquirrel: true }), true);
    assert.equal(isSpecificInstallDir('C:\\Windows\\System32'), false);
    assert.equal(isSpecificInstallDir('C:\\Program Files'), false);
    assert.equal(isSpecificInstallDir('C:\\Program Files\\Tencent\\Weixin'), true);

    const resolve = createShortcutResolver({
      statSync: () => ({ mtimeMs: 1 }),
      readShortcutLink: (file) => {
        if (file.includes('Workspace')) return { target: 'C:\\Users\\demo\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe', args: '"C:\\project.code-workspace"' };
        if (file.includes('Profile')) return { target: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', args: '--profile-directory="Profile 1"' };
        if (file.includes('AppId')) return { target: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', args: '--app-id x' };
        if (file.includes('NewInst')) return { target: 'C:\\Program Files\\App\\MyApp.exe', args: '--new-instance' };
        if (file.includes('SquirrelNewWin')) return { target: 'C:\\Users\\demo\\AppData\\Local\\Discord\\Update.exe', args: '--processStart Discord.exe --new-window' };
        return { target: 'C:\\Windows\\explorer.exe', args: '' };
      }
    });
    assert.equal(resolve('C:\\Demo\\Workspace.lnk').activateable, false);
    assert.equal(resolve('C:\\Demo\\Profile.lnk').activateable, false);
    assert.equal(resolve('C:\\Demo\\AppId.lnk').activateable, false);
    assert.equal(resolve('C:\\Demo\\NewInst.lnk').activateable, false);
    assert.equal(resolve('C:\\Demo\\SquirrelNewWin.lnk').activateable, false);
    assert.equal(resolve('C:\\Demo\\Explorer.lnk').activateable, false);
    assert.equal(resolve('C:\\Demo\\Notes.txt').activateable, false);
  });

  await test('strictly matches install root + known exe name, rejecting unrelated apps and other installs', () => {
    const resolve = createShortcutResolver({
      statSync: () => ({ mtimeMs: 1 }),
      readShortcutLink: (file) => {
        if (file.includes('钉钉')) return { target: 'C:\\Program Files (x86)\\DingDing\\DingTalkLauncher.exe', args: '' };
        if (file.includes('Code')) return { target: 'C:\\Users\\demo\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe', args: '' };
        return { target: 'C:\\Program Files\\Tencent\\Weixin\\Weixin.exe', args: '' };
      }
    });
    const wxSpec = resolve('C:\\Start\\微信.lnk', '微信');
    assert.equal(matchProcessScore('C:\\Program Files\\Tencent\\Weixin\\Weixin.exe', wxSpec), 1000);
    assert.equal(matchProcessScore('C:\\Program Files\\Tencent\\Weixin\\4.0.3.22\\Weixin.exe', wxSpec), 900);
    assert.equal(matchProcessScore('C:\\Program Files\\Tencent\\Weixin\\4.0.3.22\\CrashReporter.exe', wxSpec), 0);
    assert.equal(matchProcessScore('C:\\Program Files\\Tencent\\Weixin\\4.0.3.22\\OtherUnrelatedTool.exe', wxSpec), 0);

    const dtSpec = resolve('C:\\Start\\钉钉.lnk', '钉钉');
    assert.equal(matchProcessScore('C:\\Program Files (x86)\\DingDing\\main\\current\\DingTalk.exe', dtSpec), 900);

    const codeSpec = resolve('C:\\Start\\Code.lnk', 'VS Code');
    assert.equal(matchProcessScore('D:\\Portable\\Code\\Code.exe', codeSpec), 0, 'different install path must never match by basename alone');
    assert.equal(matchProcessScore('C:\\Users\\demo\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\OtherTool.exe', codeSpec), 0, 'unrelated exe in same install dir must not match');
  });

  await test('hidden-to-tray logged-in WeChat main window beats visible login dialog in head-to-head competition', () => {
    const spec = {
      activateable: true,
      resolvedExe: 'c:\\program files\\tencent\\weixin\\weixin.exe',
      exeNames: ['weixin', 'wechat'],
      primaryName: 'weixin',
      installDir: 'c:\\program files\\tencent\\weixin',
      displayName: '微信'
    };
    const visibleLegacyLogin = { hwnd: 3n, pid: 200, processScore: 900, visible: true, iconic: false, cloaked: false, style: WS_CAPTION, exStyle: 0, hasOwner: false, title: '微信', className: 'WeChatLoginWndForPC', normalWidth: 300, normalHeight: 420, width: 300, height: 420 };
    const visibleQtLogin = { hwnd: 5n, pid: 201, processScore: 900, visible: true, iconic: false, cloaked: false, style: WS_CAPTION, exStyle: 0, hasOwner: false, title: '微信', className: 'Qt51514QWindowIcon', normalWidth: 320, normalHeight: 440, width: 320, height: 440 };
    const hiddenTrayMain = { hwnd: 11n, pid: 100, processScore: 900, visible: false, iconic: false, cloaked: false, style: WS_CAPTION | WS_SYSMENU, exStyle: 0, hasOwner: false, title: '微信', className: 'Qt51514QWindowIcon', normalWidth: 960, normalHeight: 680, width: 960, height: 680 };
    const shadow = { hwnd: 1n, pid: 100, processScore: 900, visible: true, iconic: false, cloaked: false, style: WS_CAPTION, exStyle: WS_EX_TRANSPARENT, hasOwner: false, title: '微信', className: 'Qt51514QWindowToolSaveBits', normalWidth: 900, normalHeight: 700, width: 900, height: 700 };
    const cloakedMain = { hwnd: 12n, pid: 100, processScore: 900, visible: true, iconic: false, cloaked: true, style: WS_CAPTION | WS_THICKFRAME, exStyle: 0, hasOwner: false, title: '微信', className: 'Qt51514QWindowIcon', normalWidth: 1020, normalHeight: 740, width: 1020, height: 740 };

    assert.equal(scoreWindowCandidate(cloakedMain, spec), -Infinity, 'cloaked windows must be rejected');
    const best = chooseBestWindow([shadow, cloakedMain, visibleLegacyLogin, visibleQtLogin, hiddenTrayMain], spec);
    assert.equal(best.hwnd, 11n, 'hidden logged-in main window must beat visible login windows');
    assert.equal(best.role, 'main');

    // High-DPI (200%): 320x440 login scaled to 640x880 must STILL lose to 960x680 tray main scaled to 1920x1360.
    const hiDpiLogin = { hwnd: 31n, pid: 202, processScore: 900, visible: true, iconic: false, cloaked: false, dpi: 192, style: WS_CAPTION, exStyle: 0, hasOwner: false, title: '微信', className: 'Qt51514QWindowIcon', normalWidth: 640, normalHeight: 880, width: 640, height: 880 };
    const hiDpiLoginNoDpi = { ...hiDpiLogin, hwnd: 32n, dpi: 0 };
    const hiDpiTrayMain = { hwnd: 33n, pid: 100, processScore: 900, visible: false, iconic: false, cloaked: false, dpi: 192, style: WS_CAPTION | WS_THICKFRAME | WS_SYSMENU, exStyle: 0, hasOwner: false, title: '微信', className: 'Qt51514QWindowIcon', normalWidth: 1920, normalHeight: 1360, width: 1920, height: 1360 };
    assert.equal(chooseBestWindow([hiDpiLogin, hiDpiTrayMain], spec).hwnd, 33n, '200% DPI tray main must beat visible 200% DPI login');
    assert.equal(chooseBestWindow([hiDpiLoginNoDpi, hiDpiTrayMain], spec).hwnd, 33n, '200% DPI portrait login without DPI info must still lose to tray main');

    // If ONLY a visible login window exists (user has not logged in yet), reuse it instead of opening a 2nd login dialog.
    const onlyLogin = chooseBestWindow([visibleLegacyLogin], spec);
    assert.equal(onlyLogin.hwnd, 3n);
    assert.equal(onlyLogin.role, 'login');
  });

  await test('recovers hidden-to-tray main window while ignoring hidden untitled helpers', async () => {
    const spec = {
      activateable: true,
      resolvedExe: 'c:\\program files\\tencent\\weixin\\weixin.exe',
      exeNames: ['weixin', 'wechat'],
      primaryName: 'weixin',
      installDir: 'c:\\program files\\tencent\\weixin',
      displayName: '微信'
    };
    const hiddenHelper = { hwnd: 10n, pid: 100, processScore: 900, visible: false, iconic: false, cloaked: false, style: WS_CAPTION, exStyle: 0, hasOwner: false, title: '', className: 'Qt51514QWindowIcon', normalWidth: 800, normalHeight: 600, width: 800, height: 600 };
    const trayMain = { hwnd: 11n, pid: 100, processScore: 900, visible: false, iconic: false, cloaked: false, style: WS_CAPTION | WS_SYSMENU, exStyle: 0, hasOwner: false, title: '微信', className: 'Qt51514QWindowIcon', normalWidth: 960, normalHeight: 680, width: 960, height: 680 };
    assert.equal(scoreWindowCandidate(hiddenHelper, spec), -Infinity);
    assert.equal(chooseBestWindow([hiddenHelper, trayMain], spec).hwnd, 11n);

    const opened = [];
    const activated = [];
    const launcher = createAppLauncher({
      statSync: () => ({ mtimeMs: 1 }),
      readShortcutLink: () => ({ target: 'C:\\Program Files\\Tencent\\Weixin\\Weixin.exe', args: '' }),
      openPath: async (p) => { opened.push(p); return ''; },
      bridge: {
        findCandidates: () => [hiddenHelper, trayMain],
        activateWindow: async (win) => { activated.push(win.hwnd); return 'foreground'; }
      }
    });
    const res = await launcher.launch('C:\\Start\\微信.lnk', { displayName: '微信' });
    assert.equal(res.ok, true);
    assert.equal(res.activated, true);
    assert.equal(res.status, 'foreground');
    assert.deepEqual(activated, [11n]);
    assert.deepEqual(opened, [], 'must not spawn a duplicate process when existing window is activated');
  });

  await test('does not fake success or spawn duplicate when confirmed main window fails to take foreground', async () => {
    const opened = [];
    const trayMain = { hwnd: 21n, pid: 100, processScore: 900, visible: true, iconic: false, cloaked: false, style: WS_CAPTION | WS_THICKFRAME, exStyle: 0, hasOwner: false, title: '微信', className: 'Qt51514QWindowIcon', normalWidth: 960, normalHeight: 680, width: 960, height: 680 };
    const launcher = createAppLauncher({
      statSync: () => ({ mtimeMs: 1 }),
      readShortcutLink: () => ({ target: 'C:\\Program Files\\Tencent\\Weixin\\Weixin.exe', args: '' }),
      openPath: async (p) => { opened.push(p); return ''; },
      bridge: {
        findCandidates: () => [trayMain],
        activateWindow: async () => 'requested'
      }
    });
    const res = await launcher.launch('C:\\Start\\微信.lnk', { displayName: '微信' });
    assert.equal(res.ok, false, 'unconfirmed foreground activation must not pretend success');
    assert.equal(res.activated, false);
    assert.equal(res.status, 'requested');
    assert.equal(res.existingWindow, true);
    assert.deepEqual(opened, [], 'must not spawn a duplicate WeChat process when main window is already running');

    // Even if activateWindow returns 'failed' (alive main window failed to raise), never spawn duplicate; only 'stale' falls back.
    const failedLauncher = createAppLauncher({
      statSync: () => ({ mtimeMs: 1 }),
      readShortcutLink: () => ({ target: 'C:\\Program Files\\Tencent\\Weixin\\Weixin.exe', args: '' }),
      openPath: async (p) => { opened.push(p); return ''; },
      bridge: { findCandidates: () => [trayMain], activateWindow: async () => 'failed' }
    });
    const failedRes = await failedLauncher.launch('C:\\Start\\微信.lnk', { displayName: '微信' });
    assert.equal(failedRes.ok, false);
    assert.equal(failedRes.existingWindow, true);
    assert.deepEqual(opened, [], 'failed activation of live main window must not spawn duplicate');

    const staleLauncher = createAppLauncher({
      statSync: () => ({ mtimeMs: 1 }),
      readShortcutLink: () => ({ target: 'C:\\Program Files\\Tencent\\Weixin\\Weixin.exe', args: '' }),
      openPath: async (p) => { opened.push(p); return ''; },
      bridge: { findCandidates: () => [trayMain], activateWindow: async () => 'stale' }
    });
    const staleRes = await staleLauncher.launch('C:\\Start\\微信.lnk', { displayName: '微信' });
    assert.equal(staleRes.ok, true);
    assert.equal(staleRes.status, 'launched');
    assert.deepEqual(opened, ['C:\\Start\\微信.lnk'], 'stale/closed HWND should fall back to shell.openPath');

    // If the top-ranked main window is stale, try the second main window instead of spawning a duplicate.
    const openedMulti = [];
    const triedHwnds = [];
    const main1 = { ...trayMain, hwnd: 41n, visible: true };
    const main2 = { ...trayMain, hwnd: 42n, visible: false };
    const multiLauncher = createAppLauncher({
      statSync: () => ({ mtimeMs: 1 }),
      readShortcutLink: () => ({ target: 'C:\\Program Files\\Tencent\\Weixin\\Weixin.exe', args: '' }),
      openPath: async (p) => { openedMulti.push(p); return ''; },
      bridge: {
        findCandidates: () => [main1, main2],
        activateWindow: async (w) => {
          triedHwnds.push(w.hwnd);
          return w.hwnd === 41n ? 'stale' : 'foreground';
        }
      }
    });
    const multiRes = await multiLauncher.launch('C:\\Start\\微信.lnk', { displayName: '微信' });
    assert.equal(multiRes.ok, true);
    assert.equal(multiRes.activated, true);
    assert.equal(multiRes.hwnd, '42');
    assert.deepEqual(triedHwnds, [41n, 42n]);
    assert.deepEqual(openedMulti, [], 'must activate second main window instead of calling openPath');

    // Throwing inside activateWindow on a confirmed main window must not bypass duplicate protection.
    const openedThrow = [];
    const throwLauncher = createAppLauncher({
      statSync: () => ({ mtimeMs: 1 }),
      readShortcutLink: () => ({ target: 'C:\\Program Files\\Tencent\\Weixin\\Weixin.exe', args: '' }),
      openPath: async (p) => { openedThrow.push(p); return ''; },
      bridge: {
        findCandidates: () => [trayMain],
        activateWindow: async () => { throw new Error('simulated wake error'); }
      }
    });
    const throwRes = await throwLauncher.launch('C:\\Start\\微信.lnk', { displayName: '微信' });
    assert.equal(throwRes.ok, false);
    assert.equal(throwRes.existingWindow, true);
    assert.deepEqual(openedThrow, [], 'wake throw on confirmed main window must not spawn duplicate');
  });

  await test('native bridge re-verifies PID on fast-path foreground and never uses BringWindowToTop', async () => {
    const makeBridge = ({ fgReturns, pidSequence = [100], setFgReturns = 0, cloaked = 0 } = {}) => {
      let pidCalls = 0;
      const fns = {
        GetTopWindow: () => 0n,
        GetWindow: () => 0n,
        IsWindow: () => 1,
        IsWindowVisible: () => 1,
        IsIconic: () => 0,
        GetWindowLongPtrW: () => 0,
        GetWindowThreadProcessId: (_hwnd, outBuf) => {
          const pid = pidSequence[Math.min(pidCalls, pidSequence.length - 1)];
          pidCalls += 1;
          outBuf.writeUInt32LE(pid, 0);
          return 77;
        },
        GetWindowTextW: () => 0,
        GetClassNameW: () => 0,
        GetWindowPlacement: () => 1,
        GetWindowRect: () => 1,
        GetForegroundWindow: () => fgReturns,
        ShowWindowAsync: () => 1,
        SetForegroundWindow: () => setFgReturns,
        AllowSetForegroundWindow: () => 1,
        OpenProcess: () => 0n,
        QueryFullProcessImageNameW: () => 0,
        CloseHandle: () => 1,
        GetDpiForWindow: () => 192,
        DwmGetWindowAttribute: (_hwnd, _attr, outBuf) => { outBuf.writeUInt32LE(cloaked, 0); return 0; }
      };
      const fakeFfi = {
        load: () => ({
          func: (_cc, name) => {
            assert.notEqual(name, 'BringWindowToTop', 'must not bind synchronous BringWindowToTop');
            assert.notEqual(name, 'AttachThreadInput', 'must not bind synchronous AttachThreadInput');
            return fns[name];
          }
        }),
        struct: () => ({}),
        sizeof: () => 44,
        inout: (x) => x,
        out: (x) => x,
        pointer: (x) => x
      };
      return createNativeWindowBridge({ platform: 'win32', arch: 'x64', load: () => fakeFfi, wakeTimeoutMs: 10, pollIntervalMs: 5 });
    };

    const candidate = { hwnd: 55n, pid: 100, showCmd: 1 };
    assert.equal(await makeBridge({ fgReturns: 99n, setFgReturns: 0 }).activateWindow(candidate), 'requested');
    assert.equal(await makeBridge({ fgReturns: 55n, setFgReturns: 1 }).activateWindow(candidate), 'foreground');
    assert.equal(await makeBridge({ fgReturns: 55n, pidSequence: [999] }).activateWindow(candidate), 'stale', 'HWND reassigned to another PID must return stale');
    assert.equal(await makeBridge({ fgReturns: 55n, pidSequence: [100, 100, 999], setFgReturns: 1 }).activateWindow({ hwnd: 55n, pid: 100, showCmd: 1 }), 'foreground');
    // Fast-path PID swap RIGHT between initial verify and post-SetForegroundWindow confirm:
    let fgStep = 0;
    const swapBridge = (() => {
      let pidCalls = 0;
      const pids = [100, 100, 999, 999];
      const fns = {
        GetTopWindow: () => 0n, GetWindow: () => 0n, IsWindow: () => 1, IsWindowVisible: () => 1, IsIconic: () => 0,
        GetWindowLongPtrW: () => 0,
        GetWindowThreadProcessId: (_h, outBuf) => { outBuf.writeUInt32LE(pids[Math.min(pidCalls++, pids.length - 1)], 0); return 77; },
        GetWindowTextW: () => 0, GetClassNameW: () => 0, GetWindowPlacement: () => 1, GetWindowRect: () => 1,
        GetForegroundWindow: () => (fgStep++ === 0 ? 1n : 55n),
        ShowWindowAsync: () => 1, SetForegroundWindow: () => 1, AllowSetForegroundWindow: () => 1,
        OpenProcess: () => 0n, QueryFullProcessImageNameW: () => 0, CloseHandle: () => 1, GetDpiForWindow: () => 96,
        DwmGetWindowAttribute: (_h, _a, outBuf) => { outBuf.writeUInt32LE(0, 0); return 0; }
      };
      const fakeFfi = { load: () => ({ func: (_c, n) => fns[n] }), struct: () => ({}), sizeof: () => 44, inout: x => x, out: x => x, pointer: x => x };
      return createNativeWindowBridge({ platform: 'win32', arch: 'x64', load: () => fakeFfi, wakeTimeoutMs: 10, pollIntervalMs: 5 });
    })();
    assert.equal(await swapBridge.activateWindow(candidate), 'stale', 'PID change during SetForegroundWindow must never report foreground');
    assert.equal(await makeBridge({ fgReturns: 55n, cloaked: 1 }).activateWindow(candidate), 'stale', 'cloaked window must return stale');
  });

  await test('falls back to shell.openPath when app is not running or enumeration throws', async () => {
    const opened = [];
    const launcher = createAppLauncher({
      statSync: () => ({ mtimeMs: 1 }),
      readShortcutLink: () => ({ target: 'C:\\Program Files\\Tencent\\Weixin\\Weixin.exe', args: '' }),
      openPath: async (p) => { opened.push(p); return ''; },
      bridge: {
        findCandidates: () => { throw new Error('simulated native enum failure'); },
        activateWindow: async () => 'failed'
      }
    });
    const res = await launcher.launch('C:\\Start\\微信.lnk', { displayName: '微信' });
    assert.equal(res.ok, true);
    assert.equal(res.activated, false);
    assert.equal(res.status, 'launched');
    assert.deepEqual(opened, ['C:\\Start\\微信.lnk']);
  });

  await test('clampQuickPosition keeps dragged panel reachable across single and multi displays', () => {
    const displays = [
      { workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
      { workArea: { x: 1920, y: 0, width: 1920, height: 1040 } }
    ];
    const inside = clampQuickPosition({ x: 300, y: 200 }, QUICK_PANEL_SIZE, displays);
    assert.deepEqual(inside, { x: 300, y: 200, width: QUICK_PANEL_SIZE.width, height: QUICK_PANEL_SIZE.height });

    const secondMonitor = clampQuickPosition({ x: 2200, y: 120 }, QUICK_PANEL_SIZE, displays);
    assert.equal(secondMonitor.x, 2200);
    assert.equal(secondMonitor.y, 120);

    const tooHigh = clampQuickPosition({ x: 200, y: -500 }, QUICK_PANEL_SIZE, displays);
    assert.equal(tooHigh.y, 0, 'top edge must never disappear above workArea');

    const tooFarRight = clampQuickPosition({ x: 9000, y: 200 }, QUICK_PANEL_SIZE, displays);
    assert.ok(tooFarRight.x <= 1920 + 1920 - 180, 'panel must remain grabbable on rightmost monitor');
  });

  console.log(`\nPASS ${pass} app-launcher & quickpanel-drag tests`);
})().catch((error) => {
  console.error('FAIL', error);
  process.exitCode = 1;
});
