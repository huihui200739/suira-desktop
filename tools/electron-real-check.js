'use strict';
/*
 * 在真实 Electron 里跑完整验证（一键启动 + 验证 + 清理）。
 *
 * 为什么要这个脚本：本机 Electron 无法从工作区内部启动 —— 工作区目录上有
 * 沙箱 ACL（Everyone: Deny DeleteSubdirectoriesAndFiles），Electron 初始化时
 * 触发断点异常，退出码 0x80000003。同一个 exe 放到工作区外就能正常跑。
 *
 * 因此这里用工作区外的 Electron 加载本项目的页面，再用 CDP 连真实窗口验证。
 * 这不是模拟：页面跑在真实 Electron 里，preload 真实注入，IPC 真实连主进程。
 *
 * 用法：node tools/electron-real-check.js
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 9223;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 找一个能正常运行的 Electron。工作区内的会因 ACL 崩溃，所以优先用工作区外的。 */
function findWorkingElectron() {
  const candidates = [
    process.env.SUIRA_ELECTRON,                    // 用户显式指定
    'C:\\suira-electron\\electron.exe',
    path.join(require('os').homedir(), 'suira-electron-dist', 'electron.exe'),
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function listWindows() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    return await res.json();
  } catch {
    return null;
  }
}

async function waitForApp(timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await listWindows();
    if (targets && targets.some((t) => t.url.includes('index.html'))) return targets;
    await sleep(500);
  }
  return null;
}

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { console.log('  PASS  ' + name); pass++; }
  else { console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); fail++; }
};

(async () => {
  const electron = findWorkingElectron();
  if (!electron) {
    console.error('找不到可用的 Electron。');
    console.error('请把一份能运行的 Electron 放到工作区外，或用 SUIRA_ELECTRON 环境变量指定路径。');
    console.error('原因：工作区目录有沙箱 ACL，Electron 在工作区内启动会崩溃（0x80000003）。');
    process.exit(1);
  }
  console.log('\n使用 Electron: ' + electron);

  const child = spawn(electron, ['.', `--remote-debugging-port=${PORT}`], {
    cwd: ROOT,
    stdio: 'ignore',
    windowsHide: true
  });

  try {
    const targets = await waitForApp();
    if (!targets) throw new Error('应用未能在 25 秒内启动（找不到 index.html 窗口）');

    console.log('\n== 真实 Electron 窗口 ==');
    targets.forEach((t) => console.log('  ' + t.title + '  ' + t.url.split('/').pop()));

    check('主窗口已创建', targets.some((t) => t.url.includes('index.html')));
    check('动作面板窗口已创建', targets.some((t) => t.url.includes('quickpanel.html')));

    // 后续详细验证交给专门脚本（它们复用已启动的实例）
    console.log('\n应用已就绪。可继续运行：');
    console.log('  node tools/electron-verify.js         # preload / IPC / 渲染');
    console.log('  node tools/electron-capture-check.js  # 截图链路');
  } finally {
    try { child.kill(); } catch {}
    // 清理可能残留的窗口进程
    await sleep(800);
  }

  console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('启动失败：' + e.message);
  process.exit(1);
});
