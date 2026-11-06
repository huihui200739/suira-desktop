'use strict';

/**
 * 38 键面板的自定义键位绑定（纯模型，便于测试）。
 *
 * 数据形态：一张「覆盖表」——键位字母 → 绑定描述。
 *   { type:'action', id:'capture' }                  内置面板动作
 *   { type:'app' | 'folder' | 'file', target, name } 本机路径
 *   { type:'url', target, name }                     网页（http/https）
 *   { type:'recipe', id, name }                     用户组合动作
 *   { type:'none' }                                  显式清空：出厂默认也不生效
 * 不在表里的键回落出厂默认（lib/keybindings.js 的 DEFAULT_KEY_BINDINGS）。
 *
 * 换位语义（对应用户「把截图功能换到其他键位」的说法）：把内置动作指派到
 * 新键时，与目标键的当前有效绑定互换——动作挪过来，目标键原有的内容挪到
 * 动作原来的键上，双方都不丢。
 */

const { PANEL_ACTIONS, DEFAULT_KEY_BINDINGS, KEY_ROWS, normalizeKey } = require('./keybindings');

const BINDING_TYPES = new Set(['action', 'app', 'folder', 'url', 'file', 'recipe', 'none']);
const VALID_KEYS = new Set(KEY_ROWS.flat());

function baseName(value) {
  return String(value || '').split(/[\\/]/).filter(Boolean).pop() || '';
}

/** 校验并规范化一个绑定；非法返回 null（调用方据此拒绝落盘）。 */
function cleanBinding(input) {
  if (!input || typeof input !== 'object') return null;
  if (input.type === 'none') return { type: 'none' };
  const type = BINDING_TYPES.has(input.type) ? input.type : '';
  if (!type) return null;
  if(type==='recipe'){const id=String(input.id||'');if(!/^(?:user\.[a-zA-Z0-9_-]{1,80}|capture-to-clean-text|clean-text|collect-to-shelf)$/.test(id))return null;return {type,id,name:String(input.name||'组合动作').trim().slice(0,60)};}
  if (type === 'action') {
    const id = String(input.id || '').trim();
    if (!PANEL_ACTIONS[id] || !PANEL_ACTIONS[id].implemented) return null;
    return { type, id };
  }
  const target = String(input.target || '').trim().slice(0, 4096);
  if (!target) return null;
  if (type === 'url') {
    try {
      const parsed = new URL(target);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    } catch { return null; }
  }
  const fallbackName = type === 'url'
    ? (() => { try { return new URL(target).hostname.replace(/^www\./, ''); } catch { return target; } })()
    : baseName(target);
  return { type, target, name: String(input.name || fallbackName).trim().slice(0, 60) || fallbackName };
}

/** 清洗整张覆盖表：非法条目丢弃，键位统一大写。 */
function cleanBindingMap(input) {
  const map = {};
  if (!input || typeof input !== 'object') return map;
  for (const [key, value] of Object.entries(input)) {
    const normalized = normalizeKey(key);
    if (!VALID_KEYS.has(normalized)) continue;
    const cleaned = cleanBinding(value);
    if (cleaned) map[normalized] = cleaned;
  }
  return map;
}

/** 某键当前的有效绑定：覆盖表优先，否则出厂默认；无绑定返回 {type:'none'}。 */
function effectiveBinding(bindings, key) {
  const normalized = normalizeKey(key);
  if (bindings && Object.prototype.hasOwnProperty.call(bindings, normalized)) {
    return bindings[normalized] || { type: 'none' };
  }
  return DEFAULT_KEY_BINDINGS[normalized] ? { type: 'action', id: DEFAULT_KEY_BINDINGS[normalized] } : { type: 'none' };
}

function bindingLabel(binding) {
  if (!binding || binding.type === 'none') return '空';
  if (binding.type === 'action') return PANEL_ACTIONS[binding.id]?.label || binding.id;
  return binding.name || binding.target || '未命名';
}

/**
 * 把一个绑定指派到键位上。
 * @param {object} bindings 当前覆盖表
 * @param {string} key 目标键位（字母/数字，大小写不限）
 * @param {object|null} binding 新绑定；null 等价于清除
 * @returns {{ok:boolean, error?:string, bindings:object, message:string, changed:boolean}}
 */
function assignPanelBinding(bindings, key, binding) {
  const normalized = normalizeKey(key);
  if (!VALID_KEYS.has(normalized)) return { ok: false, error: '未知的键位', bindings, message: '', changed: false };
  const cleaned = binding ? cleanBinding(binding) : { type: 'none' };
  if (!cleaned) return { ok: false, error: '绑定内容无效', bindings, message: '', changed: false };
  const next = { ...bindings };
  const previous = effectiveBinding(bindings, normalized);

  if (cleaned.type === 'none') {
    if (previous.type === 'none') {
      return { ok: true, bindings: next, message: `${normalized} 键本来就没有绑定`, changed: false };
    }
    next[normalized] = { type: 'none' };
    return { ok: true, bindings: next, message: `已清除 ${normalized} 键的「${bindingLabel(previous)}」`, changed: true };
  }

  if (cleaned.type === 'action') {
    const sameAction = (entry) => Boolean(entry) && entry.type === 'action' && entry.id === cleaned.id;
    if (sameAction(previous)) {
      return { ok: true, bindings: next, message: `「${bindingLabel(cleaned)}」本来就在 ${normalized} 键上`, changed: false };
    }
    // 未实现的占位动作（壁纸/长截图等）没有真实内容可保留，换位时视同空键
    const swapOut = previous.type === 'action' && !PANEL_ACTIONS[previous.id]?.implemented
      ? { type: 'none' }
      : previous;
    // 动作当前所在键（默认键位或已被用户换过的键）
    let homeKey = '';
    for (const candidate of VALID_KEYS) {
      if (candidate === normalized) continue;
      if (sameAction(effectiveBinding(bindings, candidate))) { homeKey = candidate; break; }
    }
    next[normalized] = cleaned;
    if (homeKey) {
      next[homeKey] = swapOut.type === 'none' ? { type: 'none' } : swapOut;
      const moved = swapOut.type === 'none'
        ? ''
        : `，${normalized} 键原来的「${bindingLabel(swapOut)}」换到 ${homeKey}`;
      return { ok: true, bindings: next, message: `「${bindingLabel(cleaned)}」已换到 ${normalized} 键${moved}`, changed: true };
    }
    const replaced = swapOut.type === 'none' ? '' : `，原「${bindingLabel(swapOut)}」已移除`;
    return { ok: true, bindings: next, message: `「${bindingLabel(cleaned)}」已绑到 ${normalized} 键${replaced}`, changed: true };
  }

  // 自定义绑定（应用 / 文件夹 / 网页 / 文件）：直接落到目标键
  next[normalized] = cleaned;
  const replaced = previous.type === 'none' ? '' : `，原「${bindingLabel(previous)}」已移除`;
  return { ok: true, bindings: next, message: `${normalized} 键已绑定「${bindingLabel(cleaned)}」${replaced}`, changed: true };
}

/** 左键拖动只允许移到空位；源和目标必须在同一次保存中更新。 */
function movePanelBinding(bindings, fromKey, toKey) {
  const from = normalizeKey(fromKey), to = normalizeKey(toKey);
  const reject = (error) => ({ ok: false, error, bindings, changed: false });
  if (!VALID_KEYS.has(from) || !VALID_KEYS.has(to)) return reject('未知的键位');
  const source = effectiveBinding(bindings, from);
  if (source.type === 'none' || !cleanBinding(source)) return reject('这个键没有可移动的绑定');
  if (from === to) return { ok: true, bindings, changed: false, message: '键位没有改变' };
  const target = effectiveBinding(bindings, to);
  const placeholder = target.type === 'action' && !PANEL_ACTIONS[target.id]?.implemented;
  if (target.type !== 'none' && !placeholder) return reject(`${to} 键已经绑定「${bindingLabel(target)}」，请移到空键位`);
  return {
    ok: true, changed: true,
    bindings: { ...bindings, [from]: { type: 'none' }, [to]: { ...source } },
    message: `「${bindingLabel(source)}」已移到 ${to} 键`
  };
}

module.exports = {
  BINDING_TYPES,
  VALID_KEYS,
  cleanBinding,
  cleanBindingMap,
  effectiveBinding,
  bindingLabel,
  assignPanelBinding,
  movePanelBinding
};
