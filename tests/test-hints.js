'use strict';
// Execute the production hint controller with deterministic ordinary DOM/events.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const js = fs.readFileSync(path.join(__dirname, '../src/ui-motion.js'), 'utf8');
const from = js.indexOf('  function installHints() {'), to = js.indexOf('\n  function init()', from);
assert.ok(from >= 0 && to > from);
function fixture() {
  const listeners = new Map(), windowListeners = new Map(), timers = new Map(), frames = new Map(), observers = []; let seq = 0, hit = null;
  const on = (map, type, fn) => { if (!map.has(type)) map.set(type, []); map.get(type).push(fn); };
  class Element {
    constructor(tag = 'button', parent = null) { this.nodeType = 1; this.tag = tag; this.parentElement = parent; this.children = []; parent?.children.push(this); this.attrs = {}; this.dataset = {}; this.style = {}; this.isConnected = true; this.hidden = false; this.disabled = false; this.visible = true; this.textContent = ''; this.box = { x: 30, y: 30, left: 30, top: 30, right: 70, bottom: 60, width: 40, height: 30 }; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    hasAttribute(k) { return k in this.attrs; }
    removeAttribute(k) { delete this.attrs[k]; }
    append(child) { child.parentElement = this; this.children.push(child); }
    contains(child) { for (let e = child; e; e = e.parentElement) if (e === this) return true; return false; }
    querySelectorAll(selector) { const all = this.children.flatMap(e => [e, ...e.querySelectorAll('*')]); return selector === '[title]' ? all.filter(e => e.hasAttribute('title')) : all; }
    matches(selector) { if (selector === 'button, [role="button"]') return this.tag === 'button' || this.attrs.role === 'button'; return this.disabled || this.attrs['aria-disabled'] === 'true'; }
    closest(selector) { for (let e = this; e; e = e.parentElement) { if (selector === '[data-hint]') { if (e.dataset.hint !== undefined) return e; } else if (e.hidden || e.attrs.inert !== undefined || e.attrs['aria-hidden'] === 'true') return e; } return null; }
    checkVisibility() { for (let e = this; e; e = e.parentElement) if (!e.visible || e.hidden) return false; return true; }
    getClientRects() { return this.checkVisibility() ? [this.box] : []; }
    getBoundingClientRect() { return this.box; }
    addEventListener(type, fn) { on(listeners, 'root:' + type, fn); }
  }
  const root = new Element('html'), body = new Element('body', root), a = new Element('button', body), b = new Element('button', body), icon = new Element('svg', a);
  a.dataset.hint = 'A'; b.dataset.hint = 'B'; a.setAttribute('aria-describedby', 'help');
  const document = { documentElement: root, body, hidden: false, activeElement: body, createElement: tag => new Element(tag), elementFromPoint: () => hit, addEventListener: (type, fn) => on(listeners, type, fn) };
  const window = { addEventListener: (type, fn) => on(windowListeners, type, fn) };
  const context = { document, window, innerWidth: 800, innerHeight: 600, setTimeout: fn => { const id = ++seq; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id), requestAnimationFrame: fn => { const id = ++seq; frames.set(id, fn); return id; }, cancelAnimationFrame: id => frames.delete(id), MutationObserver: class { constructor(fn) { this.fn = fn; this.active = false; observers.push(this); } observe() { this.active = true; } disconnect() { this.active = false; } } };
  vm.runInNewContext(js.slice(from, to) + '\n globalThis.reset=installHints();', context);
  const fire = (type, values = {}) => (listeners.get(type) || []).forEach(fn => fn({ target: a, clientX: 35, clientY: 35, ...values }));
  const flush = map => { const pending = [...map.values()]; map.clear(); pending.forEach(fn => fn()); };
  const mutate = records => { [...observers].filter(o => o.active).forEach(o => o.fn(records || [{ type: 'attributes', target: a }])); flush(frames); };
  const hint = body.children.find(e => e.id === 'surface-hint');
  return { a, b, icon, body, root, document, hint, timers, fire, mutate, Element, reset: context.reset, tick: () => flush(timers), point: e => { hit = e; }, windowEvent: type => (windowListeners.get(type) || []).forEach(fn => fn()), enter(e = a) { hit = e; fire('pointerover', { target: e }); }, keyboard(e = a) { fire('keydown', { key: 'Tab' }); document.activeElement = e; fire('focusin', { target: e }); } };
}
let passed = 0;
function test(name, fn) { fn(); console.log('PASS ' + name); passed++; }
test('short hover leaves no late timer or empty bubble', () => { const f = fixture(); f.enter(); f.fire('pointerout', { relatedTarget: f.body }); f.point(f.body); f.tick(); assert.equal(f.hint.hidden, true); assert.equal(f.timers.size, 0); });
test('mouse click focus never owns a persistent hint', () => { const f = fixture(); f.enter(); f.tick(); assert.equal(f.hint.hidden, false); f.fire('pointerdown'); f.document.activeElement = f.a; f.fire('focusin'); f.fire('pointerout', { relatedTarget: f.body }); f.point(f.body); f.tick(); assert.equal(f.hint.hidden, true); assert.equal(f.a.getAttribute('aria-describedby'), 'help'); });
test('pointerenter programmatic focus still hides on leave and does not block B', () => { const f = fixture(); f.enter(); f.document.activeElement = f.a; f.fire('focusin'); f.tick(); assert.equal(f.hint.textContent, 'A'); f.fire('pointerout', { relatedTarget: f.b }); f.enter(f.b); f.tick(); assert.equal(f.hint.textContent, 'B'); assert.equal(f.a.getAttribute('aria-describedby'), 'help'); });
test('nested icon movement preserves one pending/showing hint', () => { const f = fixture(); f.enter(); f.fire('pointerout', { relatedTarget: f.icon }); f.enter(f.icon); assert.equal(f.timers.size, 1); f.tick(); f.fire('pointermove', { target: f.icon }); assert.equal(f.hint.hidden, false); assert.equal(f.timers.size, 0); });
test('keyboard focus is accessible and Escape dismisses without blurring', () => { const f = fixture(); f.keyboard(); f.tick(); assert.equal(f.hint.hidden, false); assert.equal(f.a.getAttribute('aria-describedby'), 'help surface-hint'); f.fire('keydown', { key: 'Escape' }); f.tick(); assert.equal(f.hint.hidden, true); assert.equal(f.document.activeElement, f.a); f.keyboard(f.b); f.tick(); assert.equal(f.hint.textContent, 'B'); });
test('keyboard to pointer changes ownership; pointer departure closes', () => { const f = fixture(); f.keyboard(); f.tick(); f.enter(); f.tick(); f.fire('pointerout', { relatedTarget: f.body }); assert.equal(f.hint.hidden, true); });
for (const kind of ['removed','hidden','inert','aria-hidden','disabled','hint-removed','expanded','visibility','label-changed']) test('visible target invalidation: ' + kind, () => { const f = fixture(); f.enter(); f.tick(); switch (kind) { case 'removed': f.a.isConnected = false; break; case 'hidden': f.body.hidden = true; break; case 'inert': f.body.setAttribute('inert', ''); break; case 'aria-hidden': f.body.setAttribute('aria-hidden', 'true'); break; case 'disabled': f.a.disabled = true; break; case 'hint-removed': delete f.a.dataset.hint; break; case 'expanded': f.a.setAttribute('aria-expanded', 'true'); break; case 'visibility': f.body.visible = false; break; case 'label-changed': f.a.dataset.hint = 'Changed'; break; } f.mutate(); assert.equal(f.hint.hidden, true); assert.equal(f.a.getAttribute('aria-describedby'), 'help'); });
test('pending target loses hint before delay', () => { const f = fixture(); f.enter(); delete f.a.dataset.hint; f.mutate(); f.tick(); assert.equal(f.hint.hidden, true); });
test('expanded sidebar exception retains a valid hint', () => { const f = fixture(); f.a.setAttribute('aria-expanded','true'); f.a.dataset.hintWhenExpanded = 'true'; f.enter(); f.tick(); assert.equal(f.hint.hidden, false); });
for (const event of ['pointercancel','contextmenu','dragstart','beforetoggle','root:pointerleave']) test('input/lifecycle dismissal: ' + event, () => { const f = fixture(); f.enter(); f.tick(); f.fire(event); f.tick(); assert.equal(f.hint.hidden, true); });
for (const event of ['blur','resize','pagehide']) test('window lifecycle dismissal: ' + event, () => { const f = fixture(); f.enter(); f.tick(); f.windowEvent(event); assert.equal(f.hint.hidden, true); });
test('visibility cancels waiting hints; touch never shows a bubble', () => { const f = fixture(); f.enter(); f.document.hidden = true; f.fire('visibilitychange'); f.tick(); assert.equal(f.hint.hidden, true); f.document.hidden = false; f.fire('pointerover', { pointerType: 'touch' }); f.fire('pointerdown', { pointerType: 'touch' }); f.fire('focusin'); f.tick(); assert.equal(f.hint.hidden, true); });
test('description updates by other components survive tooltip removal', () => { const f = fixture(); f.enter(); f.tick(); f.a.setAttribute('aria-describedby', 'help extra surface-hint'); f.reset(); assert.equal(f.a.getAttribute('aria-describedby'), 'help extra'); });
test('dynamic and changing native titles become one current custom hint', () => { const f = fixture(), e = new f.Element('button', f.body); e.setAttribute('title','Pin'); f.mutate([{type:'childList',addedNodes:[e]}]); assert.equal(e.dataset.hint,'Pin'); assert.equal(e.getAttribute('title'),null); assert.equal(e.getAttribute('aria-label'),'Pin'); e.setAttribute('title','Unpin'); f.mutate([{type:'attributes',target:e}]); assert.equal(e.dataset.hint,'Unpin'); assert.equal(e.getAttribute('aria-label'),'Unpin'); });
console.log('PASS ' + passed + ' tooltip lifecycle regressions');
