'use strict';

const { KEY_ROWS, DEFAULT_KEY_BINDINGS, PANEL_ACTIONS, normalizeKey } = require('./keybindings');
const { effectiveBinding, assignPanelBinding } = require('./panel-bindings');
const { parseAccelerator, normalizeAccelerator } = require('./shortcuts');

// 只关联同一功能：创建钉图与「钉图显隐」是不同动作，不能混用。
const PANEL_SHORTCUT_ACTIONS = { capture: 'capture', clipboardBar: 'clipboard' };
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
    if (occupied.has(key)) return { ok: false, error: `${key} 键同时用于截图和剪贴板，请选择不同的主键` };
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

/** 旧覆盖表以 Z/X/V 为基础，先展开，避免更新出厂值后误覆盖用户绑定。 */
function migrateLegacyPanelBindings(bindings) {
  const legacy = { ...DEFAULT_KEY_BINDINGS, Z: 'capture', C: '', X: 'clipboard', V: 'text-clean' };
  return Object.fromEntries(keys.map(key => [key, Object.hasOwn(bindings, key) ? bindings[key]
    : legacy[key] ? { type: 'action', id: legacy[key] } : { type: 'none' }]));
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
  // 面板上的键位优先；辅助入口自动让到 F 键，仍保留两键唤起。
  for(const [name,fallback] of Object.entries({quick:'Alt+F1',panelCycle:'Alt+F2',pinnedToggle:'Alt+F3'})) {
    if(next[name]&&occupied.has(normalizeAccelerator(next[name]))) {
      const choices=[fallback,...Array.from({length:12},(_,n)=>`Alt+F${n+1}`)];
      next[name]=choices.find(value=>!Object.entries(next).some(([other,current])=>other!==name&&normalizeAccelerator(current)===normalizeAccelerator(value)));
    }
  }
  for(const key of keys) {
    const accelerator=panelAccelerator(key),entry=occupied.get(normalizeAccelerator(accelerator));
    const name=panelShortcutName(key);next[name]='';if(!entry)continue;
    const dedicated=Object.entries(PANEL_SHORTCUT_ACTIONS).find(([,action])=>entry.binding.type==='action'&&entry.binding.id===action);
    if(dedicated&&normalizeAccelerator(next[dedicated[0]])===normalizeAccelerator(accelerator))continue;
    next[name]=accelerator;
  }
  return next;
}

module.exports = { PANEL_SHORTCUT_ACTIONS, acceleratorKey, actionKey, alignPanelShortcuts, shortcutPatchForPanel, migrateLegacyPanelBindings, panelShortcutName, panelAccelerator, panelGlobalBindings };
