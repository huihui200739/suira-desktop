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

/**
 * 出厂默认键位。
 *
 * 全部是「一个修饰键 + 一个主键」的两键组合：唤起要快，三键组合按起来太费劲。
 * Alt+字母 的组合在 Windows 上基本不被系统占用（Alt+Space / Alt+Tab / Alt+F4 除外，
 * 已列在 RESERVED_COMBOS 里），与其他软件偶发冲突时可在设置里改键。
 */
const DEFAULT_BINDINGS = {
  quick: 'Alt+S',
  capture: 'Alt+C',
  longCapture: 'Alt+G',
  panelCycle: 'Alt+E',
  pinnedToggle: 'Alt+H',
  // 剪贴板历史条：屏幕底部横向浏览历史内容
  clipboardBar: 'Alt+V'
};

/**
 * 按住型快捷键：按住时生效，松手收起。
 * 默认不绑定：它是可选的进阶用法（需要常驻侦测助手），而且两键以内的
 * 「按住」组合容易与输入法/系统快捷键抢键。用户可在设置里自行录制
 * 任意「修饰键 + 主键」组合启用。
 *
 * Electron 的 globalShortcut 不支持「松手」事件，因此靠按住期间重复触发 +
 * 定时器兜底判断松开（见 MomentaryWatcher）。
 *
 * 导出名保持 DEFAULT_MOMENTARY_BINDINGS 不变，主进程与设置页都从这里取出厂值。
 */
const DEFAULT_MOMENTARY_BINDINGS = {
  momentary: ''
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

/** 键位的中文名，冲突提示与设置页共用，避免只显示内部字段名。 */
const BINDING_LABELS = {
  quick: '随手面板',
  capture: '区域截图',
  longCapture: '长截图',
  panelCycle: '面板布局轮换',
  pinnedToggle: '钉图显隐',
  momentary: '按住型唤起',
  clipboardBar: '剪贴板历史'
};

/** 被当作「修饰键」的写法（小写）。 */
const MODIFIER_KEYS = new Set([
  'commandorcontrol', 'control', 'ctrl', 'command', 'cmd', 'alt', 'shift', 'super', 'meta'
]);

/** 把加速键字符串规范化为可比较的形式。 */
function normalizeAccelerator(value) {
  return String(value || '')
    .split('+')
    .map((part) => {const key=part.trim().toLowerCase();return ({plus:'=',equal:'=',minus:'-'})[key]||key;})
    .filter(Boolean)
    .sort()
    .join('+');
}

/**
 * 拆解加速键字符串：主键、修饰键集合。
 * @returns {{text:string, parts:string[], modifiers:Set<string>, hasMainKey:boolean}}
 */
function parseAccelerator(accelerator) {
  const text = String(accelerator || '').trim();
  const parts = text ? text.split('+').map((p) => p.trim()).filter(Boolean) : [];
  const modifiers = new Set();
  let hasMainKey = false;
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (MODIFIER_KEYS.has(lower)) {
      modifiers.add(lower === 'ctrl' ? 'control' : lower === 'cmd' ? 'command' : lower);
    } else {
      hasMainKey = true;
    }
  }
  return { text, parts, modifiers, hasMainKey };
}

/**
 * 检查一个加速键是否合法。
 * @returns {{ok:boolean, error:string}}
 */
function validateAccelerator(accelerator) {
  const { text, parts, modifiers, hasMainKey } = parseAccelerator(accelerator);
  if (!text) return { ok: false, error: '快捷键不能为空' };
  if (parts.length < 2) return { ok: false, error: '快捷键至少需要一个修饰键加一个主键' };
  if (!hasMainKey) return { ok: false, error: '快捷键缺少主键' };
  if (modifiers.size === 0) return { ok: false, error: '快捷键至少需要一个修饰键' };
  // 唤起键统一为两键组合：一个修饰键 + 一个主键。三键组合按起来太费劲，
  // 也不符合「全部只用两个组合键唤起」的产品约定。
  if (modifiers.size > 1) {
    return { ok: false, error: '组合键只用两个：一个修饰键 + 一个主键' };
  }

  // 文档要求：默认不全局接管 Control/Shift 单键
  const onlyShift = modifiers.size === 1 && modifiers.has('shift');
  if (onlyShift) return { ok: false, error: '只用 Shift 会干扰正常输入，请再加一个修饰键' };
  // Ctrl+字母 会与大量应用内快捷键冲突，但不绝对禁止，仅提示

  return { ok: true, error: '' };
}

/**
 * 检查按住型（momentary）加速键是否合法。
 *
 * 与普通快捷键同一套规则（修饰键 + 主键）。历史上曾要求两个修饰键，
 * 但按住型默认不绑定、由用户显式启用，误触代价由启用者自己权衡，
 * 不必再替用户把关修饰键数量。
 *
 * @returns {{ok:boolean, error:string}}
 */
function validateMomentaryAccelerator(accelerator) {
  return validateAccelerator(accelerator);
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
 * 检查按住型快捷键是否与其他键位重复。
 *
 * 返回可读的冲突描述，无冲突返回空串。设置页录制时把它写在状态框，
 * 主进程 `shortcuts.set({name:'momentary'})` 也复用同一套文案。
 *
 * @param {string} accelerator 待检查的加速键
 * @param {object} bindings 全部键位，形如 {quick, capture, panelCycle, pinnedToggle, momentary}
 * @param {string} [excludeName='momentary'] 比较时跳过的键名（改自己的键位时跳过自己）
 * @returns {string} '' 表示无冲突
 */
function momentaryConflict(accelerator, bindings, excludeName = 'momentary') {
  const target = normalizeAccelerator(accelerator);
  if (!target) return '';
  const entries = bindings && typeof bindings === 'object' ? bindings : {};
  for (const [name, value] of Object.entries(entries)) {
    if (name === excludeName) continue;
    if (!value) continue;
    if (normalizeAccelerator(value) === target) {
      return `与「${BINDING_LABELS[name] || name}」的快捷键重复`;
    }
  }
  return '';
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
  registerAll({ notify = true } = {}) {
    const results = {};
    for (const [name, accelerator] of Object.entries(this.bindings)) {
      if (!accelerator) {
        results[name] = { ok: true, accelerator: '', error: '', cleared: true };
        continue;
      }
      results[name] = this.registerOne(name, accelerator);
    }
    Object.assign(results, this.registerLegacyBindings());
    this.status = results;
    if (notify) this.onChange(results);
    return results;
  }

  registerLegacyBindings() {
    const results = {};
    for (const [name, accelerator] of Object.entries(LEGACY_BINDINGS)) {
      const owner = Object.entries(this.bindings).find(([, value]) => normalizeAccelerator(value) === normalizeAccelerator(accelerator));
      if (owner) {
        results[name] = { ok: true, accelerator, optional: true, shadowed: true, error: '' };
        continue;
      }
      const ok = this.registered.has(accelerator) || this.tryRegister(accelerator, this.handlers[name]);
      results[name] = { ok, accelerator, optional: true, error: ok ? '' : '已被占用' };
    }
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

  /** 批量换键（允许截图/剪贴板互换），全部注册成功才更新状态。 */
  rebindMany(patch, { notify = true } = {}) {
    const names = Object.keys(patch);
    const next = { ...this.bindings };
    const reject = error => ({ ok: false, error, status: this.status });
    for (const name of names) {
      if ((!DEFAULT_BINDINGS[name] && !/^panelKey:[A-Z0-9=\-]$/.test(name)) || typeof this.handlers[name] !== 'function') return reject('未知的快捷键名称');
      const value = String(patch[name] || '');
      if (value) {
        const validation = validateAccelerator(value);
        if (!validation.ok) return reject(validation.error);
        next[name] = value;
      } else next[name] = '';
    }
    const seen = new Map();
    for (const [name, value] of Object.entries(next)) {
      if(!value)continue;
      const normalized = normalizeAccelerator(value);
      if (seen.has(normalized)) return reject(`${value} 已用于「${BINDING_LABELS[seen.get(normalized)] || seen.get(normalized)}」`);
      seen.set(normalized, name);
    }
    // Alt+F 的兼容入口也参与所有权移交，不能挡住用户把任意内容绑到 F。
    const releasedLegacy=[];
    for(const [name,value] of Object.entries(LEGACY_BINDINGS)) {
      if(this.registered.has(value)&&!Object.values(this.bindings).some(binding=>normalizeAccelerator(binding)===normalizeAccelerator(value))&&seen.has(normalizeAccelerator(value))) {
        this.globalShortcut.unregister(value);this.registered.delete(value);releasedLegacy.push([name,value]);
      }
    }
    const released = names.filter(name => this.registered.has(this.bindings[name]));
    for (const name of released) {
      this.globalShortcut.unregister(this.bindings[name]);
      this.registered.delete(this.bindings[name]);
    }
    const applied = [];
    for (const name of names) {
      if (!next[name]) continue;
      if (!this.tryRegister(next[name], this.handlers[name])) {
        for (const value of applied) { this.globalShortcut.unregister(value); this.registered.delete(value); }
        for (const previous of released) this.tryRegister(this.bindings[previous], this.handlers[previous]);
        for (const [legacy,value] of releasedLegacy)this.tryRegister(value,this.handlers[legacy]);
        return reject(`无法注册 ${next[name]}，可能已被其他程序占用`);
      }
      applied.push(next[name]);
    }
    this.bindings = next;
    for (const name of names) this.status[name] = next[name]
      ? { ok: true, accelerator: next[name], error: '', reserved: findReserved(next[name])?.reason || null }
      : { ok: true, accelerator: '', error: '', cleared: true };
    Object.assign(this.status, this.registerLegacyBindings());
    if (notify) this.onChange(this.status);
    return { ok: true, status: this.status };
  }

  /** 磁盘提交失败时释放新键并回到原配置，注册状态仍如实反映系统占用。 */
  restoreSnapshot(snapshot, { notify = true } = {}) {
    this.dispose();
    this.bindings = { ...snapshot.bindings };
    this.registerAll({ notify: false });
    for (const [name, entry] of Object.entries(snapshot.status)) {
      if (entry.cleared && !this.bindings[name]) this.status[name] = { ...entry };
    }
    if (notify) this.onChange(this.status);
    return this.snapshot();
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
   *
   * 兼容性说明：
   *   - 已处于出厂值且注册正常的键位直接跳过，不再「释放→重注册」，
   *     避免无谓的系统热键抖动；它们不计入 `restored`（没有真正改动）。
   *   - 调用方可能只接管部分键位（例如只传 quick/capture 的处理器），
   *     没有处理器的键位无法注册，这里跳过而不是让整次恢复失败。
   *   - 被 clear() 过或改过值的键位照旧恢复并计入 `restored`。
   *
   * @returns {{ok:boolean, error:string, status:object, restored:string[]}}
   */
  restoreDefault(name) {
    const targets = name ? [name] : Object.keys(DEFAULT_BINDINGS);
    const restored = [];
    for (const target of targets) {
      const defaultValue = DEFAULT_BINDINGS[target];
      if (!defaultValue) {
        return { ok: false, error: `「${target}」没有出厂默认键位`, status: this.status, restored };
      }
      const hasHandler = typeof this.handlers[target] === 'function';
      const entry = this.status[target];
      const alreadyDefault = normalizeAccelerator(this.bindings[target]) === normalizeAccelerator(defaultValue);
      const alreadyApplied = alreadyDefault && entry && entry.ok && !entry.cleared;
      if (!hasHandler || alreadyApplied) continue;
      const result = this.rebind(target, defaultValue);
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
  BINDING_LABELS,
  normalizeAccelerator,
  parseAccelerator,
  validateAccelerator,
  validateMomentaryAccelerator,
  findReserved,
  momentaryConflict,
  ShortcutManager,
  MomentaryWatcher
};
