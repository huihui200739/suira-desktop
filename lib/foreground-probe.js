'use strict';

/**
 * 前台窗口查询客户端。
 *
 * Electron 不暴露「当前前台窗口」的 Win32 句柄，而「放回原处」必须在唤起
 * 面板前记录目标窗口。这里通过一个常驻的 PowerShell 辅助进程完成查询：
 *
 * - 常驻进程：实测首次查询约 165ms（含 Add-Type 编译），之后约 12ms
 * - 一次性调用：每次启动进程约 300–600ms，会明显拖慢热唤起
 *
 * 该进程只做只读查询，不注入输入、不修改任何状态。
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const QUERY_TIMEOUT = 1200;
const STARTUP_GRACE = 4000;
/** dispose 后等待优雅退出的宽限时间，超时则 taskkill 强制结束。 */
const FORCE_KILL_DELAY = 1500;

/**
 * 解析辅助脚本路径。
 *
 * 打包后脚本位于 asar 外部（build.asarUnpack），因此需要把
 * `app.asar/` 替换为 `app.asar.unpacked/`；PowerShell 无法读取 asar 内部文件。
 */
function resolveScriptPath() {
  const raw = path.join(__dirname, '..', 'assets', 'foreground-helper.ps1');
  const unpacked = raw.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  if (unpacked !== raw && fs.existsSync(unpacked)) return unpacked;
  return raw;
}

class ForegroundProbe {
  constructor(options = {}) {
    this.scriptPath = options.scriptPath || resolveScriptPath();
    this.host = options.host || 'powershell.exe';
    this.child = null;
    this.ready = false;
    this.pending = [];
    this.buffer = '';
    this.starting = null;
    this.disposed = false;
    this.onWarn = options.onWarn || (() => {});
  }

  isAvailable() {
    return process.platform === 'win32' && fs.existsSync(this.scriptPath);
  }

  /** 启动常驻辅助进程（幂等）。 */
  async start() {
    if (this.disposed || !this.isAvailable()) return false;
    if (this.ready && this.child) return true;
    if (this.starting) return this.starting;

    this.starting = new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      let child;
      try {
        child = spawn(this.host, [
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
          '-File', this.scriptPath
        ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (error) {
        this.onWarn('无法启动前台窗口查询助手:', error.message);
        this.starting = null;
        finish(false);
        return;
      }

      this.child = child;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => this.handleData(chunk));
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        const text = String(chunk).trim();
        if (text) this.onWarn('前台窗口助手输出:', text.slice(0, 200));
      });
      child.on('error', (error) => {
        this.onWarn('前台窗口助手错误:', error.message);
        this.teardown();
        finish(false);
      });
      child.on('exit', () => {
        this.teardown();
        finish(false);
      });

      // 用 ping 确认 Add-Type 已完成编译，避免首个 get 落在启动期
      setTimeout(() => {
        if (!this.child || this.disposed) { finish(false); return; }
        this.send('ping', (result) => {
          this.ready = Boolean(result && result.ok);
          finish(this.ready);
        }, () => finish(false));
      }, STARTUP_GRACE);
    }).finally(() => {
      this.starting = null;
    });

    return this.starting;
  }

  handleData(chunk) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      const waiter = this.pending.shift();
      if (!waiter) continue;
      clearTimeout(waiter.timer);
      let parsed = null;
      try { parsed = JSON.parse(line); } catch { parsed = null; }
      waiter.resolve(parsed);
    }
  }

  send(command, resolve, reject) {
    if (!this.child || !this.child.stdin.writable) {
      if (reject) reject(new Error('助手未运行'));
      else resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      const index = this.pending.findIndex((entry) => entry.timer === timer);
      if (index >= 0) this.pending.splice(index, 1);
      resolve(null);
    }, QUERY_TIMEOUT);
    this.pending.push({ resolve, timer });
    try {
      this.child.stdin.write(command + '\n');
    } catch (error) {
      clearTimeout(timer);
      const index = this.pending.findIndex((entry) => entry.timer === timer);
      if (index >= 0) this.pending.splice(index, 1);
      resolve(null);
    }
  }

  /**
   * 查询当前前台窗口。
   * @returns {Promise<object|null>} 形如 {hwnd, pid, processName, processStartedAt, title}
   */
  async query() {
    if (this.disposed || !this.isAvailable()) return null;
    if (!this.ready) {
      const ok = await this.start();
      if (!ok) return null;
    }
    return new Promise((resolve) => {
      this.send('get', (result) => {
        if (!result || result.ok !== true) { resolve(null); return; }
        resolve({
          hwnd: String(result.hwnd),
          pid: Number(result.pid),
          processName: String(result.processName || ''),
          processStartedAt: Number(result.processStartedAt) || 0,
          title: String(result.title || ''),
          elevated: Boolean(result.elevated)
        });
      });
    });
  }

  teardown() {
    this.ready = false;
    this.child = null;
    this.buffer = '';
    for (const waiter of this.pending) {
      clearTimeout(waiter.timer);
      waiter.resolve(null);
    }
    this.pending = [];
  }

  dispose() {
    this.disposed = true;
    const child = this.child;
    if (child) {
      // 先请求优雅退出
      try { child.stdin.write('quit\n'); } catch {}
      try { child.kill(); } catch {}
      // kill() 是异步的；若进程阻塞在 ReadLine() 上，可能迟迟不退出。
      // 超时后用 taskkill 强制结束，避免辅助进程残留。
      const pid = child.pid;
      if (pid) {
        const timer = setTimeout(() => {
          try {
            const { execFile } = require('node:child_process');
            execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
          } catch {}
        }, FORCE_KILL_DELAY);
        if (timer.unref) timer.unref();
      }
      // 不让 Node 因残留管道句柄而挂住
      try { child.stdin?.destroy(); } catch {}
      try { child.stdout?.destroy(); } catch {}
      try { child.stderr?.destroy(); } catch {}
    }
    this.teardown();
  }
}

module.exports = { ForegroundProbe, QUERY_TIMEOUT, FORCE_KILL_DELAY, resolveScriptPath };
