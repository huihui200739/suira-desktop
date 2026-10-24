'use strict';

/**
 * 前台窗口查询客户端。
 *
 * Electron 不暴露「当前前台窗口」的 Win32 句柄，而「放回原处」必须在唤起
 * 面板前记录目标窗口。优先使用小型原生助手，编译不可用时回退 PowerShell。
 * stdin 缓冲命令，启动完成立即响应；原生路径还支持校验、恢复焦点并粘贴，
 * 避免每次操作启动 PowerShell / Add-Type。
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
    this.nativeHost = options.nativeHost || '';
    this.nativeHostReady = options.nativeHostReady || null;
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

  /**
   * 助手是否已经在跑（就绪且进程还在）。
   * 用于区分「顺手查询」和「为了查询专门拉起一个 80MB 的 PowerShell」：
   * 剪贴板来源标注这类可选的上下文信息不该付这个代价。
   */
  isReady() {
    return this.ready && Boolean(this.child);
  }

  /** 启动常驻辅助进程（幂等）。 */
  async start() {
    if (this.disposed || !this.isAvailable()) return false;
    if (this.ready && this.child) return true;
    if (this.starting) return this.starting;

    this.starting = (async () => {
      if (this.nativeHostReady) this.nativeHost = await this.nativeHostReady.catch(() => null) || '';
      if (this.disposed) return false;
      return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };

        let child;
        try {
          child = this.nativeHost ? spawn(this.nativeHost, [String(process.pid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }) : spawn(this.host, [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', this.scriptPath, '-ParentPid', String(process.pid)
          ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        } catch (error) {
          this.onWarn('无法启动前台窗口查询助手:', error.message);
          this.starting = null;
          finish(false);
          return;
        }

        this.child = child;
        child.stdin.on('error', () => { if (this.child === child) { this.stopChild(); finish(false); } });
        child.stdout.setEncoding('utf8');
        // 所有回调都先确认"我还是当前那个 child"：stop() 之后旧进程的 exit
        // 是异步来的，如果不判身份，它会把刚拉起的新进程状态一起清掉。
        child.stdout.on('data', (chunk) => { if (this.child === child) this.handleData(chunk); });
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk) => {
          const text = String(chunk).trim();
          if (text) this.onWarn('前台窗口助手输出:', text.slice(0, 200));
        });
        child.on('error', (error) => {
          if (this.child !== child) return;
          this.onWarn('前台窗口助手错误:', error.message);
          this.teardown();
          finish(false);
        });
        child.on('exit', () => {
          if (this.child !== child) return;
          this.teardown();
          finish(false);
        });

        // stdin 会缓冲命令；启动完成即响应，无需固定睡 4 秒。
        this.send('ping', (result) => {
          this.ready = Boolean(result && result.ok);
          finish(this.ready);
        }, () => finish(false), STARTUP_GRACE);
      });
    })().finally(() => {
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

  send(command, resolve, reject, timeout = QUERY_TIMEOUT) {
    if (!this.child || !this.child.stdin.writable) {
      if (reject) reject(new Error('助手未运行'));
      else resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      const index = this.pending.findIndex((entry) => entry.timer === timer);
      if (index >= 0) this.pending.splice(index, 1);
      resolve(null);
      // FIFO 协议超时后丢掉连接，不能把迟到的响应交给下一次请求。
      this.stopChild();
    }, timeout);
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
  async query(hwnd = '') {
    if (this.disposed || !this.isAvailable()) return null;
    if (!this.ready) {
      const ok = await this.start();
      if (!ok) return null;
    }
    return new Promise((resolve) => {
      const handle = String(hwnd);
      if (handle && !/^\d+$/.test(handle)) { resolve(null); return; }
      this.send(handle ? `get ${handle}` : 'get', (result) => {
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

  async pasteTo(target) {
    if (!this.ready && !await this.start()) return { ok: false, error: '助手未就绪' };
    if (!this.nativeHost) return { ok: false, unsupported: true };
    if (!/^\d+$/.test(String(target?.hwnd)) || !Number.isSafeInteger(target?.pid) || !Number.isSafeInteger(target?.processStartedAt)) return { ok: false, error: '目标无效' };
    return new Promise(resolve => this.send(`paste ${target.hwnd} ${target.pid} ${target.processStartedAt} ${process.pid}`, result => resolve(result || { ok: false, error: '助手未响应' })));
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

  /**
   * 放掉常驻进程但保持可用：下次 query() 会重新拉起。
   *
   * 前台查询只在"唤起面板"那一刻需要，长时间没人用的时候没必要
   * 让一个 80MB 级别的常驻助手一直挂在后台。
   */
  stop() {
    if (this.starting) return;
    this.stopChild();
    this.ready = false;
  }

  dispose() {
    this.disposed = true;
    this.stopChild();
  }

  stopChild() {
    const child = this.child;
    // 先断开引用与监听，再杀进程：exit 是异步事件，不能让它在
    // 新进程已经起来之后才回来清状态
    this.child = null;
    this.teardown();
    if (child) {
      try { child.removeAllListeners(); } catch {}
      try { child.on('error', () => {}); } catch {}
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
  }
}

module.exports = { ForegroundProbe, QUERY_TIMEOUT, FORCE_KILL_DELAY, resolveScriptPath };
