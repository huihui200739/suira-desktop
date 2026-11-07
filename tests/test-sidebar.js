'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/sidebar.js'), 'utf8');
function fixture({ collapsed = false, tool = false, blockedStorage = false } = {}) {
  const classes = new Set(tool ? ['tool-window'] : ['workbench']);
  const handlers = {}, windowHandlers = {}, attrs = {}, links = ['任务匣', '内容库', '日历', 'Markdown', '设置'].map(label => ({ dataset: {}, getAttribute: () => label }));
  let saved = String(collapsed), inert = false;
  const button = { dataset: {}, setAttribute: (k, v) => { attrs[k] = v; }, addEventListener: (k, v) => { handlers['button:' + k] = v; }, closest: () => inert };
  const document = {
    readyState: 'loading', documentElement: { classList: { contains: k => classes.has(k), toggle: (k, on) => on ? classes.add(k) : classes.delete(k) } },
    addEventListener: (k, v) => { handlers[k] = v; },
    getElementById: id => id === 'sidebar-toggle' ? button : { querySelectorAll: () => links }
  };
  vm.runInNewContext(source, { document, window: { addEventListener: (k, v) => { windowHandlers[k] = v; } }, localStorage: { getItem() { if (blockedStorage) throw Error('Storage unavailable'); return saved; }, setItem(k, v) { if (blockedStorage) throw Error('Storage unavailable'); saved = v; } } });
  const restoredBeforeDOM = classes.has('sidebar-collapsed');
  handlers.DOMContentLoaded?.();
  const key = (extra = {}) => { let prevented = false; handlers.keydown?.({ key: '\\', ctrlKey: true, preventDefault() { prevented = true; }, ...extra }); return prevented; };
  return { classes, attrs, links, button, handlers, windowHandlers, restoredBeforeDOM, key, saved: () => saved, setInert: v => { inert = v; } };
}
const f = fixture({ collapsed: true });
assert.equal(f.restoredBeforeDOM, true, 'Restores without expanded first paint');
assert.equal(f.attrs['aria-expanded'], 'false');
assert.equal(f.attrs['aria-label'], '展开侧边栏');
assert.ok(f.links.every(link => link.dataset.hint));
f.handlers['button:click']();
assert.equal(f.saved(), 'false');
assert.equal(f.attrs['aria-expanded'], 'true');
assert.ok(f.links.every(link => !link.dataset.hint));
assert.equal(f.key(), true);
assert.equal(f.saved(), 'true');
for (const ignored of [{ isComposing: true }, { repeat: true }, { defaultPrevented: true }, { altKey: true }, { shiftKey: true }, { target: { closest: () => true } }]) {
  assert.equal(f.key(ignored), false);
  assert.equal(f.saved(), 'true');
}
f.setInert(true); assert.equal(f.key(), false); f.setInert(false);
f.windowHandlers.storage({ key: 'suira.sidebar.collapsed', newValue: 'false' });
assert.equal(f.attrs['aria-expanded'], 'true');
f.windowHandlers.storage({ key: null }); assert.equal(f.classes.has('sidebar-collapsed'), false);
const blocked = fixture({ blockedStorage: true });
blocked.handlers['button:click'](); assert.equal(blocked.attrs['aria-expanded'], 'false');
assert.equal(fixture({ tool: true }).handlers.keydown, undefined, 'Standalone tools keep their own shortcuts');
console.log('PASS sidebar preference, pre-paint restore, toggles, ARIA, hints, keyboard guards, storage sync and storage failure');
