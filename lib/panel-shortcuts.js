'use strict';

const { KEY_ROWS, DEFAULT_KEY_BINDINGS, PANEL_ACTIONS, normalizeKey } = require('./keybindings');
const { effectiveBinding, assignPanelBinding } = require('./panel-bindings');
const { parseAccelerator, normalizeAccelerator } = require('./shortcuts');

// 只关联同一功能：创建钉图与「钉图显隐」是不同动作，不能混用。
const PANEL_SHORTCUT_ACTIONS = { capture: 'capture', clipboardBar: 'clipboard', longCapture: 'long-capture', voice: 'voice' };
const keys = KEY_ROWS.flat();
function acceleratorKey(accelerator) {
  const { parts } = parseAccelerator(accelerator);
  const last = parts.at(-1) || '';
  const key = normalizeKey(({ Minus: '-', Equal: '=', Plus:'=' })[last] || last);
  return keys.includes(key) ? key : '';
}
function replaceAcceleratorKey(accelerator, key) {
  const parts = parseAccelerator(accelerator).parts;
  return parts.length ? [...parts.slice(0, -1), key].join('+') : '';
}
function actionKey(bindings, action) {
  return keys.find(key => {
    const binding = effectiveBinding(bindings, key);
    return binding.type === 'action' && binding.id === action;
  }) || '';
}

/** 设置页改键时，把同一动作移到对应键；原绑定按换位语义保留。 */
function alignPanelShortcuts(bindings, shortcuts) {
  let next = { ...bindings };
  const occupied = new Map();
  for (const [name, action] of Object.entries(PANEL_SHORTCUT_ACTIONS)) {
    const key = acceleratorKey(shortcuts[name]);
    if (!key) continue;
    if (occupied.has(key)) return { ok: false, error: `${key} 键同时用于多个动作，请选择不同的主键` };
    occupied.set(key, name);
    const result = assignPanelBinding(next, key, { type: 'action', id: action });
    if (!result.ok) return result;
    next = result.bindings;
  }
  return { ok: true, bindings: next };
}

/** 面板拖动/改绑后，沿用原修饰键更新全局组合键；关闭的全局键不擅自开启。 */
function shortcutPatchForPanel(before, after, shortcuts) {
  const patch = {};
  for (const [name, action] of Object.entries(PANEL_SHORTCUT_ACTIONS)) {
    const from = actionKey(before, action), to = actionKey(after, action);
    if (from !== to && shortcuts[name]) patch[name] = to ? replaceAcceleratorKey(shortcuts[name], to) : '';
  }
  return patch;
}

/** 清除专用快捷键时，同步移除动作面板上对应的入口。 */
function clearShortcutPanelAction(bindings, shortcutName) {
  const action = PANEL_SHORTCUT_ACTIONS[shortcutName];
  if (!action) return { ok: true, bindings: { ...bindings }, changed: false };
  const key = actionKey(bindings, action);
  if (!key) return { ok: true, bindings: { ...bindings }, changed: false };
  return assignPanelBinding(bindings, key, null);
}

/** 旧覆盖表以 Z/X/V 为基础，先展开，避免更新出厂值后误覆盖用户绑定。 */
function migrateLegacyPanelBindings(bindings, version = 0) {
  if (version >= 2) return { ...bindings };
  const legacy = { ...DEFAULT_KEY_BINDINGS, B: 'annotate', Z: 'capture', C: '', X: 'clipboard', V: 'text-clean' };
  const next = version >= 1 ? { ...bindings } : Object.fromEntries(keys.map(key => [key, Object.hasOwn(bindings, key) ? bindings[key]
    : legacy[key] ? { type: 'action', id: legacy[key] } : { type: 'none' }]));
  // 仅替换旧出厂 B；显式清空、应用、文件与其他动作全部保留。
  if (!Object.hasOwn(next, 'B') || (next.B?.type === 'action' && next.B.id === 'annotate')) {
    next.B = { type: 'action', id: 'capture-translate' };
  }
  return next;
}

const panelShortcutName = key => `panelKey:${key}`;
const panelAccelerator = key => `Alt+${key === '-' ? 'Minus' : key === '=' ? 'Plus' : key}`;
/** 全部有效键帽派生 Alt 直达；同一动作的专用快捷键共用注册，避免互抢。 */
function panelGlobalBindings(bindings, shortcuts) {
  const next=Object.fromEntries(Object.entries(shortcuts).filter(([name])=>!name.startsWith('panelKey:')));
  const occupied=new Map();
  for(const key of keys) {
    const binding=effectiveBinding(bindings,key);
    if(binding.type==='none'||(binding.type==='action'&&!PANEL_ACTIONS[binding.id]?.implemented))continue;
    occupied.set(normalizeAccelerator(panelAccelerator(key)),{key,binding});
  }
  // Dedicated activation commands keep their configured keys; never silently move them.
  for(const key of keys) {
    const accelerator=panelAccelerator(key),entry=occupied.get(normalizeAccelerator(accelerator));
    const name=panelShortcutName(key);next[name]='';if(!entry)continue;
    if(Object.entries(next).some(([other,value])=>other!==name && value && normalizeAccelerator(value)===normalizeAccelerator(accelerator)))continue;
    const dedicated=Object.entries(PANEL_SHORTCUT_ACTIONS).find(([,action])=>entry.binding.type==='action'&&entry.binding.id===action);
    if(dedicated&&(next[dedicated[0]]===''||normalizeAccelerator(next[dedicated[0]])===normalizeAccelerator(accelerator)))continue;
    next[name]=accelerator;
  }
  return next;
}

module.exports = { PANEL_SHORTCUT_ACTIONS, acceleratorKey, actionKey, alignPanelShortcuts, shortcutPatchForPanel, clearShortcutPanelAction, migrateLegacyPanelBindings, panelShortcutName, panelAccelerator, panelGlobalBindings };
