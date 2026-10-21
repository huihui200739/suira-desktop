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
 */

/** 出厂默认键位。 */
const DEFAULT_BINDINGS = {
  quick: 'CommandOrControl+Alt+Space',
  capture: 'CommandOrControl+Shift+A'
};

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
    if (!oldAccelerator) return { ok: false, error: '未知的快捷键名称', status: this.status };

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

  dispose() {
    for (const accelerator of this.registered) {
      try { this.globalShortcut.unregister(accelerator); } catch {}
    }
    this.registered.clear();
  }
}

module.exports = {
  DEFAULT_BINDINGS,
  LEGACY_BINDINGS,
  RESERVED_COMBOS,
  normalizeAccelerator,
  validateAccelerator,
  findReserved,
  ShortcutManager
};
