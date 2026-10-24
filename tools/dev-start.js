'use strict';

/**
 * 开发启动器（npm start / npm run dev 的实际入口）。
 *
 * 为什么需要它：Chromium 的沙箱在 electron.exe 位于非 ASCII 路径时起不来。
 * 本仓库的路径是「C:\Users\huihui\Desktop\截图工具」，直接 `electron .`
 * 会让浏览器进程以 STATUS_BREAKPOINT 立刻退出（process_singleton_win.cc
 * 报 Lock file can not be created / access denied）。应用代码路径带中文没问题，
 * 出问题的只是可执行文件路径。
 *
 * 做法：可执行文件在非 ASCII 路径时，把它镜像到 ASCII 目录（默认 %LOCALAPPDATA%，
 * 首次约 360MB；已存在则复用），再用镜像里的 electron.exe 加载本仓库代码。
 * 这样开发时代码仍然改在本仓库、每次启动都是最新代码，只是 exe 换了个位置。
 * 路径本来就是 ASCII 的机器上完全走原来的直启路径。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');
const appArgs = process.argv.slice(2);
const isAscii = (value) => /^[\x00-\x7F]*$/.test(String(value));

const bundledExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const mirrorDir = path.join(os.homedir(), 'suira-electron-dist');
const mirrorExe = path.join(mirrorDir, 'electron.exe');
// 本机第一次修复时已经建好的镜像：直接复用，避免重复拷贝 360MB
const legacyMirrorExe = 'C:\\suira-electron\\electron.exe';

/** 确保有一个 ASCII 路径下的 electron.exe，返回它的路径。 */
function resolveElectronExe() {
  if (isAscii(bundledExe)) return bundledExe;
  if (fs.existsSync(legacyMirrorExe)) return legacyMirrorExe;
  if (fs.existsSync(mirrorExe)) return mirrorExe;
  console.log('[dev-start] Electron 位于非 ASCII 路径，镜像到 ' + mirrorDir + '（首次约 360MB）...');
  fs.rmSync(mirrorDir, { recursive: true, force: true });
  fs.mkdirSync(mirrorDir, { recursive: true });
  fs.cpSync(path.dirname(bundledExe), mirrorDir, { recursive: true });
  if (!fs.existsSync(mirrorExe)) throw new Error('Electron 镜像失败: ' + mirrorExe);
  return mirrorExe;
}

const exe = resolveElectronExe();
// 第一个参数是应用目录（本项目根目录），随后是应用自己的参数（如 --dev）。
const childArgs = [root].concat(appArgs);
const child = spawn(exe, childArgs, {
  cwd: root,
  detached: true,
  stdio: 'ignore',
  windowsHide: false
});
child.unref();
console.log('[dev-start] 已启动: ' + exe + ' ' + childArgs.map((item) => ('"' + item + '"')).join(' '));
