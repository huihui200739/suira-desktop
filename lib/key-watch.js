'use strict';

/**
 * 按住型唤起（momentary）的按键边沿侦测客户端。
 *
 * 背景：Electron 的 globalShortcut 只在按下时回调，拿不到「松开」，所以
 * 「按住显示、松手收起」必须旁路侦测。本模块通过一个常驻的 PowerShell
 * 助手轮询 user32!GetAsyncKeyState，再由 Node 侧解析 stdout 的边沿事件：
 *
 *   READY           助手编译完 P/Invoke、即将开始轮询
 *   DOWN            全部目标键第一次同时按下的上升沿（只报一次）
 *   UP              任一目标键松开的下降沿（只报一次）
 *   ERROR <原因>    致命错误，助手随后退出
 *
 * 协议与 assets/key-watch.ps1 严格对应；助手脚本路径、spawn 实现都可注入，
 * 因此本模块不依赖 Electron，也能在测试里用伪造子进程完整覆盖状态机。
 *
 * 与 lib/foreground-probe.js 的分工：那个是只读查询、走 stdin/stdout 的
 * 请求响应；这个是被动事件流，只需要逐行解析、不需要往返命令。
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

/** 等待 READY 的上限。首次 Start-Process 含 Add-Type 编译，实测约 0.4–1.5s。 */
const READY_TIMEOUT = 5000;
/** stop() 后等待子进程退出的宽限时间，超时再强制结束。 */
const STOP_GRACE = 2000;

/**
 * 修饰键名 -> 虚拟键码（Windows VK）。
 *
 * CommandOrControl 在 win32 上等价于 Control（与 Electron 语义一致）；
 * Command/Cmd/Meta 在 Windows 上按 Super（Win 键）处理，便于跨平台键位
 * 记录直接复用。
 */
const MODIFIER_VK = {
  control: 0x11,
  ctrl: 0x11,
  alt: 0x12,
  shift: 0x10,
  super: 0x5b,
  commandorcontrol: 0x11,
  command: 0x5b,
  cmd: 0x5b,
  meta: 0x5b
};

/**
 * 主键名 -> 虚拟键码。字母/数字/F 键另有规则，不在此表中。
 * 符号部分用 VK_OEM_* 对应的 Windows 虚拟键码（与物理键位绑定，
 * 具体字符取决于当前键盘布局，见交付说明中的已知限制）。
 */
const MAIN_KEY_VK = {
  space: 0x20,
  tab: 0x09,
  enter: 0x0d,
  return: 0x0d,
  esc: 0x1b,
  escape: 0x1b,
  up: 0x26,
  arrowup: 0x26,
  down: 0x28,
  arrowdown: 0x28,
  left: 0x25,
  arrowleft: 0x25,
  right: 0x27,
  arrowright: 0x27,
  backspace: 0x08,
  delete: 0x2e,
  del: 0x2e,
  insert: 0x2d,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pagedown: 0x22,
  '-': 0xbd,
  '=': 0xbb,
  ',': 0xbc,
  '.': 0xbe,
  '/': 0xbf,
  ';': 0xba,
  "'": 0xde,
  '[': 0xdb,
  '\\': 0xdc,
  ']': 0xdd,
  '`': 0xc0
};

/** F1–F24 的 VK 起点（0x70 = F1）。 */
const F_KEY_BASE = 0x70;

/**
 * 解析主键名（非修饰键）为 VK。
 * @param {string} part
 * @returns {number|null} 无法识别时返回 null
 */
function resolveMainKey(part) {
  const lower = part.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(MAIN_KEY_VK, lower)) return MAIN_KEY_VK[lower];

  if (part.length === 1) {
    const code = part.charCodeAt(0);
    if (code >= 0x61 && code <= 0x7a) return 0x41 + (code - 0x61); // a-z
    if (code >= 0x41 && code <= 0x5a) return 0x41 + (code - 0x41); // A-Z
    if (code >= 0x30 && code <= 0x39) return 0x30 + (code - 0x30); // 0-9
  }

  const fn = /^f(2[0-4]|1[0-9]|[1-9])$/i.exec(part);
  if (fn) return F_KEY_BASE + (Number(fn[1]) - 1);

  return null;
}

/**
 * 把 Electron 风格的加速键（如 "CommandOrControl+Alt+Space"）解析为 VK 列表。
 *
 * 纯 Node 实现、不依赖 Electron，主进程在注册 globalShortcut 的同时可以把
 * 同一个字符串交给 KeyWatchProbe 做按住侦测，避免两套键位格式。
 *
 * 规则：
 * - 至少一个修饰键 + 恰好一个主键；
 * - 修饰键按出现顺序去重；主键追加在末尾；
 * - 未知按键返回 `不支持的按键 <名字>`。
 *
 * @param {string} accelerator
 * @returns {{ok:boolean, error:string, vks:number[]}}
 */
function parseAcceleratorToVk(accelerator) {
  const text = String(accelerator == null ? '' : accelerator).trim();
  if (!text) return { ok: false, error: '快捷键不能为空', vks: [] };

  const parts = text.split('+').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { ok: false, error: '快捷键不能为空', vks: [] };

  const vks = [];
  const seen = new Set();
  const addUnique = (vk) => {
    if (seen.has(vk)) return;
    seen.add(vk);
    vks.push(vk);
  };

  let modifierCount = 0;
  let mainVk = null;

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(MODIFIER_VK, lower)) {
      modifierCount += 1;
      addUnique(MODIFIER_VK[lower]);
      continue;
    }
    const vk = resolveMainKey(part);
    if (vk == null) return { ok: false, error: '不支持的按键 ' + part, vks: [] };
    if (mainVk != null) return { ok: false, error: '只支持一个主键', vks: [] };
    mainVk = vk;
  }

  if (modifierCount === 0) return { ok: false, error: '快捷键至少需要一个修饰键', vks: [] };
  if (mainVk == null) return { ok: false, error: '快捷键缺少主键', vks: [] };

  addUnique(mainVk);
  return { ok: true, error: '', vks };
}

/**
 * 解析助手脚本路径。
 *
 * 打包后脚本位于 asar 外部（build.asarUnpack），因此需要把
 * `app.asar/` 替换为 `app.asar.unpacked/`；PowerShell 无法读取 asar 内部文件。
 */
function resolveScriptPath() {
  const raw = path.join(__dirname, '..', 'assets', 'key-watch.ps1');
  const unpacked = raw.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  if (unpacked !== raw && fs.existsSync(unpacked)) return unpacked;
  return raw;
}

/**
 * 按住型按键边沿侦测探针。
 *
 * 状态机：
 *
 *   idle ──start()──> starting ──READY──> watching ──stop()──> stopped
 *                        │                   │
 *                        └── 超时/ERROR/退出 ─┴──> error
 *
 * - `started` 后重复调用 start() 幂等返回成功；
 * - spawn 失败、5 秒内未收到 READY、收到 ERROR 行、子进程异常退出都进入
 *   error 并回调 onError；
 * - 若异常发生时正处于按住状态，会先补一次 onUp，避免面板卡在显示状态；
 * - `stop()` 之后不再触发任何 onDown/onUp；`update()` 等价于 stop + start。
 */
class KeyWatchProbe {
  /**
   * @param {object} options
   * @param {string} options.accelerator Electron 风格加速键
   * @param {number} [options.pollMs=25] 助手轮询间隔
   * @param {string} [options.scriptPath] 助手脚本路径，默认 assets/key-watch.ps1
   * @param {string} [options.powershell='powershell.exe'] PowerShell 可执行文件
   * @param {()=>void} [options.onDown] 全部目标键按下的上升沿
   * @param {()=>void} [options.onUp] 任一目标键松开的下降沿
   * @param {(message:string)=>void} [options.onError] 错误（stderr 也走这里）
   * @param {Function} [options.spawnImpl] 测试注入的 spawn 实现
   * @param {string[]} [options.extraArgs] 追加到助手命令行的参数（测试注入 -SelfTest 用）
   * @param {number} [options.readyTimeoutMs=5000] READY 超时，测试可缩短
   * @param {number} [options.stopGraceMs=2000] 退出宽限，测试可缩短
   */
  constructor(options = {}) {
    this.accelerator = options.accelerator || '';
    const pollMs = Number(options.pollMs);
    this.pollMs = Number.isFinite(pollMs) && pollMs > 0 ? Math.round(pollMs) : 25;
    this.scriptPath = options.scriptPath || resolveScriptPath();
    this.powershell = options.powershell || 'powershell.exe';
    this.onDown = options.onDown || (() => {});
    this.onUp = options.onUp || (() => {});
    this.onError = options.onError || (() => {});
    this.spawnImpl = options.spawnImpl || spawn;
    this.extraArgs = Array.isArray(options.extraArgs) ? options.extraArgs.slice() : [];
    this.readyTimeoutMs = Number(options.readyTimeoutMs) > 0 ? Number(options.readyTimeoutMs) : READY_TIMEOUT;
    this.stopGraceMs = Number(options.stopGraceMs) > 0 ? Number(options.stopGraceMs) : STOP_GRACE;

    this._status = 'idle';
    this.child = null;
    this.ready = false;
    this._down = false;
    this.buffer = '';
    this._readyTimer = null;
    this._starting = null;
    this._startResolve = null;
  }

  /** @returns {'idle'|'starting'|'watching'|'error'|'stopped'} */
  get status() {
    return this._status;
  }

  /** 回调抛错不能拖垮侦测循环。 */
  _call(handler, ...args) {
    if (typeof handler !== 'function') return;
    try {
      handler(...args);
    } catch {
      // 忽略：调用方回调的问题不是侦测进程的问题
    }
  }

  _clearReadyTimer() {
    if (this._readyTimer) {
      clearTimeout(this._readyTimer);
      this._readyTimer = null;
    }
  }

  _resolveStart(result) {
    const resolve = this._startResolve;
    this._startResolve = null;
    if (resolve) resolve(result);
  }

  /** 进入 error：结束子进程、兑现等待中的 start()、通知调用方。 */
  _fail(message) {
    if (this._status === 'stopped' || this._status === 'error') return;
    const wasDown = this._down;
    const child = this.child;

    this._status = 'error';
    this.ready = false;
    this._down = false;
    this.buffer = '';
    this._clearReadyTimer();
    this.child = null;

    if (child) {
      try { child.kill(); } catch {}
    }
    this._resolveStart({ ok: false, error: message });
    if (wasDown) this._call(this.onUp);
    this._call(this.onError, message);
  }

  /** 组装助手命令行，供 Lead 对照协议与测试断言。 */
  _buildArgs(vks) {
    return [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', this.scriptPath,
      '-VkCodes', vks.join(','),
      '-PollMs', String(this.pollMs)
    ].concat(this.extraArgs);
  }

  /**
   * 启动助手并等待 READY。
   * @returns {Promise<{ok:boolean, error:string}>}
   */
  async start() {
    if (this._status === 'watching' && this.child) return { ok: true, error: '' };
    if (this._starting) return this._starting;

    const parsed = parseAcceleratorToVk(this.accelerator);
    if (!parsed.ok) {
      this._status = 'error';
      this._call(this.onError, parsed.error);
      return { ok: false, error: parsed.error };
    }

    this._status = 'starting';
    this.ready = false;
    this._down = false;
    this.buffer = '';

    this._starting = new Promise((resolve) => {
      this._startResolve = resolve;

      let child;
      try {
        child = this.spawnImpl(this.powershell, this._buildArgs(parsed.vks), {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } catch (error) {
        // spawn 同步抛错（例如 powershell 不存在）
        this._status = 'error';
        this._clearReadyTimer();
        this._startResolve = null;
        const message = '无法启动键位侦测助手: ' + error.message;
        this._call(this.onError, message);
        resolve({ ok: false, error: message });
        return;
      }

      this.child = child;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => this._handleData(child, chunk));

      // stderr 只作为错误信息转发，不改变状态机：PowerShell 的警告很多
      if (child.stderr) {
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk) => {
          const text = String(chunk).trim();
          if (text) this._call(this.onError, text.slice(0, 400));
        });
      }

      child.on('error', (error) => {
        if (this.child !== child) return;
        this._fail('键位侦测助手错误: ' + error.message);
      });

      child.on('exit', (code, signal) => {
        if (this.child !== child) return;
        this.child = null;
        this._fail('键位侦测助手已退出（code=' + code + ', signal=' + signal + '）');
      });

      this._readyTimer = setTimeout(() => {
        this._readyTimer = null;
        if (this._status !== 'starting') return;
        this._fail('键位侦测助手启动超时（' + this.readyTimeoutMs + 'ms 内未收到 READY）');
      }, this.readyTimeoutMs);
      // 不能 unref：调用方往往只 await start()，此时该定时器是唯一的
      // 存活动作；READY 到达后会被清掉，不会长期占用事件循环。
    }).finally(() => {
      this._starting = null;
    });

    return this._starting;
  }

  /** 按行拼接 stdout；行不完整时留在 buffer 里等下一块数据。 */
  _handleData(child, chunk) {
    if (this.child !== child) return;
    if (this._status === 'stopped' || this._status === 'error') return;

    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) this._handleLine(child, line);
      if (this._status === 'stopped' || this._status === 'error') return;
    }

    // 助手协议逐行输出；异常情况下也不让缓冲无限增长
    if (this.buffer.length > 8192) this.buffer = this.buffer.slice(-8192);
  }

  /** 未知行一律忽略（PowerShell 欢迎信息、编码提示等）。 */
  _handleLine(child, line) {
    if (this.child !== child) return;

    if (line === 'READY') {
      if (this._status !== 'starting') return;
      this.ready = true;
      this._status = 'watching';
      this._clearReadyTimer();
      this._resolveStart({ ok: true, error: '' });
      return;
    }

    if (line === 'DOWN') {
      if (this._status !== 'watching' || this._down) return;
      this._down = true;
      this._call(this.onDown);
      return;
    }

    if (line === 'UP') {
      if (this._status !== 'watching' || !this._down) return;
      this._down = false;
      this._call(this.onUp);
      return;
    }

    if (line.indexOf('ERROR') === 0) {
      const message = line.slice(5).trim() || '键位侦测助手报告错误';
      this._fail(message);
      return;
    }

    // 其它行忽略
  }

  /**
   * 停止助手：关 stdin + SIGTERM，宽限期内没退就强制结束。
   * 停止后不再触发 onDown/onUp；可重复调用。
   * @returns {Promise<void>}
   */
  async stop() {
    const child = this.child;

    this._status = 'stopped';
    this.ready = false;
    this._down = false;
    this.buffer = '';
    this._clearReadyTimer();
    this._resolveStart({ ok: false, error: '键位侦测助手已停止' });
    this.child = null;

    if (!child) return;

    // 先挂 exit 监听再发信号，避免子进程在二者之间退出导致白等宽限期
    const exited = new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve();
      };
      timer = setTimeout(finish, this.stopGraceMs);
      // 不 unref：stop() 的等待本身需要事件循环存续；子进程退出即清掉。
      try { child.once('exit', finish); } catch { finish(); }
    });

    try { child.stdin.end(); } catch {}
    try { child.kill('SIGTERM'); } catch {}

    await exited;

    // Windows 上 SIGTERM 已是 TerminateProcess；这里再兜底一次并释放管道
    try { child.kill('SIGKILL'); } catch {}
    try { if (child.stdin && child.stdin.destroy) child.stdin.destroy(); } catch {}
    try { if (child.stdout && child.stdout.destroy) child.stdout.destroy(); } catch {}
    try { if (child.stderr && child.stderr.destroy) child.stderr.destroy(); } catch {}
  }

  /**
   * 换键：先校验新键，再用它重启助手。旧键在启动新助手前已停止。
   * 校验失败时不动当前正在运行的助手。
   * @param {string} accelerator
   * @returns {Promise<{ok:boolean, error:string}>}
   */
  async update(accelerator) {
    const parsed = parseAcceleratorToVk(accelerator);
    if (!parsed.ok) return { ok: false, error: parsed.error };

    await this.stop();
    this.accelerator = String(accelerator);
    this._status = 'idle';
    return this.start();
  }
}

module.exports = {
  MODIFIER_VK,
  MAIN_KEY_VK,
  READY_TIMEOUT,
  STOP_GRACE,
  parseAcceleratorToVk,
  resolveScriptPath,
  KeyWatchProbe
};
