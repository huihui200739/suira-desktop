'use strict';

/**
 * 快捷键注册与冲突检测。
 *
 * 对应开发方案 5.1：「建议初始快捷键 Ctrl+Alt+Space，安装时检查注册冲突并允许改键。
 * 避开默认占用 Alt+Space、Win+V、Win+Shift+S，保留用户已有习惯。」
 *
 * 以及第 11 节风险项：「中文输入法误触 —— 组合输入期间禁用动作短键」。
 *
 * 本模块只负责注册与状态记录，不直接依赖 Electron，便于测试：
 * `globalShortcut` 由调用方注入。
 *
 * 第三批补充（依据浮引 6.0.1 的 KeyboardMonitorService 字段证据）：
 * 原产品把唤起分成两套语义——
 *   - 切换型（activation）：按一下开，再按一下收
 *   - 按住型（momentary）：按住显示，松手收起
 * 以及「恢复默认」「清除绑定」两个操作（KeyboardShortcutRecorderController
 * 有 restoreDefault / clearShortcut 方法）。这些在此实现。
 */

/** 出厂默认键位。 */
const DEFAULT_BINDINGS = {
  quick: 'CommandOrControl+Alt+Space',
  capture: 'CommandOrControl+Shift+A'
};

/**
 * 按住型快捷键：按住时生效，松手收起。
 * Electron 的 globalShortcut 不支持「松手」事件，因此靠按住期间重复触发 +
 * 定时器兜底判断松开（见 MomentaryWatcher）。
 */
const DEFAULT_MOMENTARY_BINDINGS = {};

/** 兼容键位：不作为主键展示，注册失败也不影响使用。 */
const LEGACY_BINDINGS = {
  legacy: 'Alt+F'
};

/**
 * 已知被系统或其他常用软件占用的组合。
 * 命中时给出提示，但仍允许用户尝试（文档要求「保留用户已有习惯」）。
 */
const RESERVED_COMBOS = [
  { accelerator: 'Alt+Space', reason: '系统窗口菜单' },
  { accelerator: 'Super+V', reason: 'Windows 剪贴板历史' },
  { accelerator: 'Super+Shift+S', reason: 'Windows 截图工具' },
  { accelerator: 'Super+E', reason: '资源管理器' },
  { accelerator: 'Super+L', reason: '锁定屏幕' },
  { accelerator: 'Super+D', reason: '显示桌面' },
  { accelerator: 'Alt+Tab', reason: '切换窗口' },
  { accelerator: 'Alt+F4', reason: '关闭窗口' },
  { accelerator: 'Control+Shift+Escape', reason: '任务管理器' }
];

/** 把加速键字符串规范化为可比较的形式。 */
function normalizeAccelerator(value) {
  return String(value || '')
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('+');
}

/**
 * 检查一个加速键是否合法。
 * @returns {{ok:boolean, error:string}}
 */
function validateAccelerator(accelerator) {
  const text = String(accelerator || '').trim();
  if (!text) return { ok: false, error: '快捷键不能为空' };

  const parts = text.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return { ok: false, error: '快捷键至少需要一个修饰键加一个主键' };

  const modifiers = new Set();
  let hasMainKey = false;
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (['commandorcontrol', 'control', 'ctrl', 'command', 'cmd', 'alt', 'shift', 'super', 'meta'].includes(lower)) {
      modifiers.add(lower === 'ctrl' ? 'control' : lower === 'cmd' ? 'command' : lower);
    } else {
      hasMainKey = true;
    }
  }

  if (!hasMainKey) return { ok: false, error: '快捷键缺少主键' };
  if (modifiers.size === 0) return { ok: false, error: '快捷键至少需要一个修饰键' };

  // 文档要求：默认不全局接管 Control/Shift 单键
  const onlyShift = modifiers.size === 1 && modifiers.has('shift');
  const onlyCtrl = modifiers.size === 1 && (modifiers.has('control') || modifiers.has('commandorcontrol'));
  if (onlyShift) return { ok: false, error: '只用 Shift 会干扰正常输入，请再加一个修饰键' };
  if (onlyCtrl && parts.length === 2) {
    // Ctrl+字母 会与大量应用内快捷键冲突，但不绝对禁止，仅提示
  }

  return { ok: true, error: '' };
}

/** 检查是否命中已知系统占用。 */
function findReserved(accelerator) {
  const target = normalizeAccelerator(accelerator);
  for (const entry of RESERVED_COMBOS) {
    if (normalizeAccelerator(entry.accelerator) === target) return entry;
  }
  return null;
}

/**
 * 快捷键管理器。
 *
 * @param {object} options
 * @param {{register:(acc:string,cb:Function)=>boolean, unregister:(acc:string)=>void, isRegistered:(acc:string)=>boolean}} options.globalShortcut
 * @param {object} [options.handlers] { quick: fn, capture: fn }
 * @param {object} [options.bindings] 初始键位
 */
class ShortcutManager {
  constructor(options = {}) {
    this.globalShortcut = options.globalShortcut || null;
    this.handlers = options.handlers || {};
    this.bindings = { ...DEFAULT_BINDINGS, ...(options.bindings || {}) };
    this.status = {};
    this.registered = new Set();
    this.onChange = options.onChange || (() => {});
  }

  /** 注册全部快捷键，返回每个键的状态。 */
  registerAll() {
    const results = {};
    for (const [name, accelerator] of Object.entries(this.bindings)) {
      results[name] = this.registerOne(name, accelerator);
    }
    for (const [name, accelerator] of Object.entries(LEGACY_BINDINGS)) {
      // 兼容键位失败不报错，只记录
      const ok = this.tryRegister(accelerator, this.handlers[name]);
      results[name] = { ok, accelerator, optional: true, error: ok ? '' : '已被占用' };
    }
    this.status = results;
    this.onChange(results);
    return results;
  }

  registerOne(name, accelerator) {
    const validation = validateAccelerator(accelerator);
    if (!validation.ok) {
      return { ok: false, accelerator, error: validation.error, reserved: null };
    }
    const reserved = findReserved(accelerator);
    const ok = this.tryRegister(accelerator, this.handlers[name]);
    return {
      ok,
      accelerator,
      error: ok ? '' : `无法注册 ${accelerator}，可能已被其他程序占用`,
      reserved: reserved ? reserved.reason : null
    };
  }

  tryRegister(accelerator, handler) {
    if (!this.globalShortcut || typeof handler !== 'function') return false;
    try {
      // 同一加速键重复注册会失败，先释放
      if (this.registered.has(accelerator)) {
        try { this.globalShortcut.unregister(accelerator); } catch {}
        this.registered.delete(accelerator);
      }
      const ok = this.globalShortcut.register(accelerator, handler);
      if (ok) this.registered.add(accelerator);
      return Boolean(ok);
    } catch {
      return false;
    }
  }

  /**
   * 改键。先释放旧键，再注册新键；新键失败时回滚到旧键。
   * @returns {{ok:boolean, error:string, status:object}}
   */
  rebind(name, accelerator) {
    const oldAccelerator = this.bindings[name];
    if (!oldAccelerator) {
      // 键位被 clear() 清除过：允许重新绑定到新键
      if (this.status[name] && this.status[name].cleared) {
        const validation0 = validateAccelerator(accelerator);
        if (!validation0.ok) return { ok: false, error: validation0.error, status: this.status };
        for (const [otherName, otherAccelerator] of Object.entries(this.bindings)) {
          if (otherName !== name && normalizeAccelerator(otherAccelerator) === normalizeAccelerator(accelerator)) {
            return { ok: false, error: `与「${otherName}」的快捷键重复`, status: this.status };
          }
        }
        const okAgain = this.tryRegister(accelerator, this.handlers[name]);
        if (!okAgain) {
          return { ok: false, error: `无法注册 ${accelerator}，可能已被占用`, status: this.status };
        }
        this.bindings[name] = accelerator;
        this.status[name] = { ok: true, accelerator, error: '', reserved: findReserved(accelerator)?.reason || null };
        this.onChange(this.status);
        return { ok: true, error: '', status: this.status };
      }
      return { ok: false, error: '未知的快捷键名称', status: this.status };
    }

    const validation = validateAccelerator(accelerator);
    if (!validation.ok) return { ok: false, error: validation.error, status: this.status };

    // 与其他键位重复
    for (const [otherName, otherAccelerator] of Object.entries(this.bindings)) {
      if (otherName !== name && normalizeAccelerator(otherAccelerator) === normalizeAccelerator(accelerator)) {
        return { ok: false, error: `与「${otherName}」的快捷键重复`, status: this.status };
      }
    }

    // 释放旧键
    if (this.registered.has(oldAccelerator)) {
      try { this.globalShortcut.unregister(oldAccelerator); } catch {}
      this.registered.delete(oldAccelerator);
    }

    const ok = this.tryRegister(accelerator, this.handlers[name]);
    if (!ok) {
      // 回滚
      this.tryRegister(oldAccelerator, this.handlers[name]);
      return { ok: false, error: `无法注册 ${accelerator}，可能已被占用`, status: this.status };
    }

    this.bindings[name] = accelerator;
    this.status[name] = { ok: true, accelerator, error: '', reserved: findReserved(accelerator)?.reason || null };
    this.onChange(this.status);
    return { ok: true, error: '', status: this.status };
  }

  /** 当前键位与状态，供设置页展示。 */
  snapshot() {
    return {
      bindings: { ...this.bindings },
      status: { ...this.status }
    };
  }

  /**
   * 恢复某个（或全部）快捷键到出厂默认。
   * 对应原产品 KeyboardShortcutRecorderController 的 restoreDefault。
   * @returns {{ok:boolean, error:string, status:object, restored:string[]}}
   */
  restoreDefault(name) {
    const targets = name ? [name] : Object.keys(DEFAULT_BINDINGS);
    const restored = [];
    for (const target of targets) {
      if (!DEFAULT_BINDINGS[target]) {
        return { ok: false, error: `「${target}」没有出厂默认键位`, status: this.status, restored };
      }
      const result = this.rebind(target, DEFAULT_BINDINGS[target]);
      if (!result.ok) {
        return { ok: false, error: result.error, status: this.status, restored };
      }
      restored.push(target);
    }
    return { ok: true, error: '', status: this.status, restored };
  }

  /**
   * 清除某个快捷键的绑定（不再响应，但保留条目供设置页显示「未绑定」）。
   * 对应原产品 KeyboardShortcutRecorderController 的 clearShortcut。
   * @returns {{ok:boolean, error:string, status:object}}
   */
  clear(name) {
    if (!Object.prototype.hasOwnProperty.call(this.bindings, name)) {
      return { ok: false, error: '未知的快捷键名称', status: this.status };
    }
    const oldAccelerator = this.bindings[name];
    if (this.registered.has(oldAccelerator)) {
      try { this.globalShortcut.unregister(oldAccelerator); } catch {}
      this.registered.delete(oldAccelerator);
    }
    delete this.bindings[name];
    this.status[name] = { ok: true, accelerator: '', error: '', cleared: true };
    this.onChange(this.status);
    return { ok: true, error: '', status: this.status };
  }

  /** 某键位当前是否已绑定。 */
  isBound(name) {
    return Boolean(this.bindings[name]);
  }

  dispose() {
    for (const accelerator of this.registered) {
      try { this.globalShortcut.unregister(accelerator); } catch {}
    }
    this.registered.clear();
  }
}

/**
 * 按住型唤起的状态机。
 *
 * 为什么要单独一个类：Electron 的 globalShortcut 只在按下时回调，
 * 拿不到「松开」。原产品有 momentary 语义（按住显示、松手收起），
 * 这里用「按下时开始，定时器发现没有后续触发就判定松开」来实现。
 *
 * 这个类不依赖 Electron，只吃时间戳，因此可以完整测试。
 */
class MomentaryWatcher {
  /**
   * @param {object} options
   * @param {number} [options.gapMs] 超过这么久没有再次按下，就判定松手
   * @param {()=>void} [options.onStart] 按住开始
   * @param {()=>void} [options.onEnd] 松手结束
   * @param {()=>number} [options.now] 时间源，测试可注入
   */
  constructor(options = {}) {
    this.gapMs = Number(options.gapMs) > 0 ? Number(options.gapMs) : 220;
    this.onStart = options.onStart || (() => {});
    this.onEnd = options.onEnd || (() => {});
    this.now = options.now || (() => Date.now());
    this.active = false;
    this.lastPressAt = 0;
    this.timer = null;
  }

  /** 按键按下（或按住期间的重复触发）。 */
  press() {
    const at = this.now();
    this.lastPressAt = at;
    if (!this.active) {
      this.active = true;
      this.onStart();
    }
    this.armTimer();
  }

  /** 重新计时：超过 gapMs 没有新按下就结束。 */
  armTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.check(), this.gapMs);
    // 测试环境不阻塞进程退出
    if (this.timer && typeof this.timer.unref === 'function') this.timer.unref();
  }

  /** 检查是否已经松开。 */
  check() {
    if (!this.active) return;
    const elapsed = this.now() - this.lastPressAt;
    if (elapsed >= this.gapMs) {
      this.active = false;
      this.timer = null;
      this.onEnd();
    } else {
      this.armTimer();
    }
  }

  /** 强制结束（失焦、锁屏等场景）。 */
  release() {
    if (!this.active) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.active = false;
    this.onEnd();
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.active = false;
  }
}

module.exports = {
  DEFAULT_BINDINGS,
  DEFAULT_MOMENTARY_BINDINGS,
  LEGACY_BINDINGS,
  RESERVED_COMBOS,
  normalizeAccelerator,
  validateAccelerator,
  findReserved,
  ShortcutManager,
  MomentaryWatcher
};
