'use strict';

/**
 * 「放回原处」目标校验子系统。
 *
 * 对应开发方案第 7 节「放回原处的实现约束」：
 *
 * - 唤起前记录目标 HWND、PID、进程启动时间、选区获取方式和输入法状态
 * - 进入面板后不随每次前台变化覆盖原目标
 * - 提交前再次检查原目标仍存在且属于同一进程实例
 * - 用户明确切换了目标、原窗口关闭或权限不匹配时，显示
 *   「已复制，切回目标后粘贴」
 * - SendInput 受 UIPI 限制，普通权限程序不能可靠向更高完整性级别窗口注入
 * - 写入剪贴板时记录序号并标记自身来源，防止历史回环
 * - 支持明确选择「仅复制」和「返回并粘贴」
 *
 * 本模块只做判定，不执行任何输入注入。注入由调用方注入的
 * `paste` 适配器完成，便于测试与失败隔离。
 */

/** 提交前的校验结果，决定是否可以安全粘贴。 */
const VERDICT = {
  PASTE: 'paste',
  COPY_ONLY: 'copy-only',
  REFUSE: 'refuse'
};

const REFUSE_REASONS = {
  NO_TARGET: '没有记录到目标窗口',
  WINDOW_GONE: '目标窗口已关闭',
  PID_CHANGED: '目标窗口属于另一个进程实例',
  TITLE_CHANGED: '目标窗口内容已改变',
  FOREGROUND_MISMATCH: '当前前台窗口不是原目标',
  ELEVATED: '目标窗口权限高于本程序',
  TARGET_UNKNOWN: '无法确认目标窗口状态'
};

/** 规范化窗口句柄：转字符串、去空白、统一小写，便于可靠比较。 */
function normalizeHwnd(value) {
  if (value == null) return '';
  const text = String(value).trim().toLowerCase();
  if (!text || text === '0' || text === '0x0') return '';
  return text;
}

/**
 * 从一次前台窗口快照构造目标记录。
 *
 * @param {{hwnd:string|number, pid:number, processName?:string,
 *          processStartedAt?:number, title?:string, elevated?:boolean}} info
 * @param {{selectionMethod?:string, imeActive?:boolean, capturedAt?:number}} [extra]
 * @returns {object|null}
 */
function captureTarget(info, extra = {}) {
  if (!info || info.hwnd == null || info.pid == null) return null;
  const hwnd = normalizeHwnd(info.hwnd);
  if (!hwnd) return null;
  return {
    hwnd,
    pid: Number(info.pid),
    processName: String(info.processName || ''),
    // 进程启动时间用于区分「同一 PID 被复用」的情况
    processStartedAt: Number(info.processStartedAt) || 0,
    title: String(info.title || ''),
    elevated: Boolean(info.elevated),
    selectionMethod: String(extra.selectionMethod || 'unknown'),
    imeActive: Boolean(extra.imeActive),
    capturedAt: Number(extra.capturedAt) || Date.now()
  };
}

/**
 * 提交前校验目标是否仍然有效。
 *
 * 关键点：进入面板后**不随前台变化覆盖原目标**。因此这里比较的是
 * 「当前实际前台」与「唤起时记录的目标」，而不是刷新记录。
 *
 * @param {object|null} target 唤起时记录的目标
 * @param {object|null} current 提交时的实际前台窗口快照
 * @returns {{verdict:string, reason:string, canPaste:boolean}}
 */
function validateTarget(target, current) {
  if (!target) {
    return { verdict: VERDICT.COPY_ONLY, reason: REFUSE_REASONS.NO_TARGET, canPaste: false };
  }
  if (!current) {
    return { verdict: VERDICT.COPY_ONLY, reason: REFUSE_REASONS.TARGET_UNKNOWN, canPaste: false };
  }

  const currentHwnd = normalizeHwnd(current.hwnd);
  const currentPid = Number(current.pid);

  // 窗口已关闭：HWND 不存在，或句柄指向了别的窗口
  if (!currentHwnd) {
    return { verdict: VERDICT.COPY_ONLY, reason: REFUSE_REASONS.WINDOW_GONE, canPaste: false };
  }
  if (currentHwnd !== target.hwnd) {
    return { verdict: VERDICT.COPY_ONLY, reason: REFUSE_REASONS.FOREGROUND_MISMATCH, canPaste: false };
  }

  // 同一 HWND 但 PID 变了，说明句柄被复用，目标其实已经不在了
  if (Number.isFinite(currentPid) && currentPid !== target.pid) {
    return { verdict: VERDICT.COPY_ONLY, reason: REFUSE_REASONS.PID_CHANGED, canPaste: false };
  }

  // 进程启动时间不同 = PID 被复用，属于不同进程实例
  const currentStartedAt = Number(current.processStartedAt) || 0;
  if (target.processStartedAt && currentStartedAt && currentStartedAt !== target.processStartedAt) {
    return { verdict: VERDICT.COPY_ONLY, reason: REFUSE_REASONS.PID_CHANGED, canPaste: false };
  }

  // UIPI：不能向更高完整性级别的窗口注入输入
  if (current.elevated && !target.elevated) {
    return { verdict: VERDICT.COPY_ONLY, reason: REFUSE_REASONS.ELEVATED, canPaste: false };
  }

  return { verdict: VERDICT.PASTE, reason: '', canPaste: true };
}

/**
 * 判断一次粘贴提交是否应当执行，并给出用户可见的提示文案。
 *
 * @param {object} options
 * @param {object|null} options.target
 * @param {object|null} options.current
 * @param {'copy-only'|'return-and-paste'} [options.intent='return-and-paste']
 * @param {boolean} [options.pasteAfterCopy=false] 用户设置项
 * @returns {{verdict:string, reason:string, canPaste:boolean, message:string}}
 */
function decideCommit(options = {}) {
  const intent = options.intent === 'copy-only' ? 'copy-only' : 'return-and-paste';

  // 用户明确只要复制：不注入输入
  if (intent === 'copy-only') {
    return { verdict: VERDICT.COPY_ONLY, reason: '', canPaste: false, message: '已复制' };
  }

  // 用户关闭了「复制后粘贴」，退化为仅复制
  if (options.pasteAfterCopy === false) {
    return { verdict: VERDICT.COPY_ONLY, reason: '', canPaste: false, message: '已复制' };
  }

  const check = validateTarget(options.target, options.current);
  if (check.canPaste) {
    return { verdict: VERDICT.PASTE, reason: '', canPaste: true, message: '已粘贴到原窗口' };
  }
  return {
    verdict: check.verdict,
    reason: check.reason,
    canPaste: false,
    message: `已复制，${check.reason}，切回目标后粘贴`
  };
}

/**
 * 剪贴板自写回环防护。
 *
 * 对应第 7 节：写入剪贴板时记录序号并标记自身来源，防止历史回环。
 * 只有当本次写入仍是剪贴板最新内容时，才认为「内容还没被用户覆盖」。
 */
class ClipboardWriteLedger {
  constructor() {
    this.seq = 0;
    this.lastWriteSeq = 0;
    this.lastWriteText = '';
    this.lastWriteAt = 0;
    this.transientDepth = 0;
  }

  /** 记录一次自身写入，返回该次写入的序号。 */
  record(text) {
    this.seq += 1;
    this.lastWriteSeq = this.seq;
    this.lastWriteText = String(text == null ? '' : text);
    this.lastWriteAt = Date.now();
    return this.lastWriteSeq;
  }

  /** 当前剪贴板内容是否仍是自己写入的那一次。 */
  isOwnWriteStillCurrent(currentText) {
    return String(currentText == null ? '' : currentText) === this.lastWriteText;
  }

  /** 判断一次剪贴板变化是否应当忽略（自写回环）。 */
  shouldIgnore(currentText) {
    if(this.transientDepth)return true;
    if (!this.lastWriteText) return false;
    return this.isOwnWriteStillCurrent(currentText);
  }

  beginTransient(){this.transientDepth++;let released=false;return ()=>{if(!released){released=true;this.transientDepth=Math.max(0,this.transientDepth-1);}};}

  /** 用户已覆盖内容后，恢复旧内容的唯一合法时机。 */
  canRestore(seq, currentText) {
    if (seq !== this.lastWriteSeq) return false;
    return this.isOwnWriteStillCurrent(currentText);
  }
}

module.exports = {
  VERDICT,
  REFUSE_REASONS,
  normalizeHwnd,
  captureTarget,
  validateTarget,
  decideCommit,
  ClipboardWriteLedger
};
