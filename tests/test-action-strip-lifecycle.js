'use strict';
// Pure ordinary-interaction fixture: run the entire production component with
// explicit toggle delivery, no native windows, user data or running app.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/action-strip.js'), 'utf8');
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

async function harness() {
  let document; const observers = [], calls = [];
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this.attributes = new Map(); this.events = new Map(); this.style = {}; this.dataset = {}; this.className = ''; this.value = ''; this.open = false; this.popoverOpen = false; this.focusCount = 0; this.classList = { add: name => { this.className += ' ' + name; } }; }
    get isConnected() { return this === document.documentElement || Boolean(this.parentElement?.isConnected); }
    get hidden() { return this.attributes.has('hidden'); }
    set hidden(value) { if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    append(...children) { for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); } }
    remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
    replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.append(...children); }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    matches(selector) { return selector.split(',').some(part => { part = part.trim(); if (part === ':popover-open') return this.popoverOpen; if (part.startsWith('.')) return this.className.split(/\s+/).includes(part.slice(1)); const m = /^(\w+)?\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(part); if (m) return (!m[1] || this.tagName.toLowerCase() === m[1]) && (m[3] === undefined ? this.attributes.has(m[2]) : this.getAttribute(m[2]) === m[3]); return this.tagName.toLowerCase() === part; }); }
    closest(selector) { for (let el = this; el; el = el.parentElement) if (el.matches(selector)) return el; return null; }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, listener) { if (!this.events.has(type)) this.events.set(type, new Set()); this.events.get(type).add(listener); }
    removeEventListener(type, listener) { this.events.get(type)?.delete(listener); }
    dispatchEvent(event) { event.target ||= this; for (const listener of [...(this.events.get(event.type) || [])]) listener(event); return true; }
    getClientRects() { if (!this.isConnected) return []; for (let el = this; el; el = el.parentElement) if (el.hidden || el.style.display === 'none' || el.className.split(/\s+/).includes('is-hidden') || (el.tagName === 'DETAILS' && !el.open && this !== el.children[0])) return []; return [this.getBoundingClientRect()]; }
    getBoundingClientRect() { return { left: 100, right: 300, top: 300, bottom: 330, width: 200, height: 30 }; }
    focus() { this.focusCount++; document.activeElement = this; }
    showPopover() { this.popoverOpen = true; }
    hidePopover() { this.popoverOpen = false; }
  }
  document = new Element('document'); document.documentElement = new Element('html'); document.body = new Element('body'); document.append(document.documentElement); document.documentElement.append(document.body); document.hidden = false; document.activeElement = document.body;
  document.createElement = tag => new Element(tag);
  const parent = new Element('section'), host = new Element('div'), origin = new Element('button'); parent.append(origin, host); document.body.append(parent); document.activeElement = origin;
  const actions = [{ id: 'text.clean', label: 'Clean', hint: 'Clean ordinary text' }];
  const window = new Element('window'); window.suira = { actions: { list: async () => actions, run: async (_item, id) => { calls.push(id); return { ok: true, message: 'Done' }; } } };
  const context = { window, document, innerWidth: 900, innerHeight: 700, getComputedStyle: node => ({ visibility: (() => { for (let el = node; el; el = el.parentElement) if (el.style.visibility) return el.style.visibility; return 'visible'; })() }), MutationObserver: class { constructor(callback) { this.callback = callback; this.active = false; observers.push(this); } observe(target, options) { this.target = target; this.options = options; this.active = true; } disconnect() { this.active = false; } } };
  vm.runInNewContext(source, context, { filename: 'src/action-strip.js' });
  const strip = window.SuiraActionStrip.mount(host, { getItem: () => ({ id: 'ordinary', kind: 'text', text: 'fixture' }) }); await tick();
  const more = host.querySelector('details'), menu = host.querySelector('.action-strip-menu'), search = menu.querySelector('input');
  function key(key, extra = {}) { const event = { type: 'keydown', key, target: document.activeElement, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() {}, ...extra }; document.dispatchEvent(event); return event; }
  async function open() { const event = key('k', { ctrlKey: true }); await tick(); more.dispatchEvent({ type: 'toggle' }); assert.equal(event.defaultPrevented, true); assert.equal(more.open, true); assert.equal(menu.popoverOpen, true); }
  function mutation(target, attributeName = 'hidden') { for (const observer of observers) if (observer.active && observer.target.contains(target) && (!observer.options.attributeFilter || observer.options.attributeFilter.includes(attributeName))) observer.callback([{ target, type: 'attributes', attributeName }]); }
  function removed() { for (const observer of observers) if (observer.active) observer.callback([{ target: parent, type: 'childList', removedNodes: [host] }]); }
  function assertClosed(message) { assert.equal(more.open, false, message); assert.equal(menu.popoverOpen, false, message); assert.equal(search.value, '', message); }
  return { document, window, parent, host, origin, more, menu, search, strip, calls, observers, key, open, mutation, removed, assertClosed };
}
(async () => {
  {
    const h = await harness(); await h.open(); h.search.value = 'query'; h.key('Escape');
    h.assertClosed('Escape must synchronously dismiss manual popover before toggle delivery'); assert.equal(h.document.activeElement, h.origin);
  }
  for (const [attribute, hide] of [
    ['hidden', node => { node.hidden = true; }], ['inert', node => node.setAttribute('inert', '')], ['aria-hidden', node => node.setAttribute('aria-hidden', 'true')],
    ['class', node => { node.className = 'is-hidden'; }], ['style', node => { node.style.display = 'none'; }], ['style', node => { node.style.visibility = 'hidden'; }]
  ]) {
    const h = await harness(); await h.open(); const focusBefore = h.origin.focusCount; hide(h.parent); h.mutation(h.parent, attribute);
    h.assertClosed(`Ancestor ${attribute} must clear details and top layer`); assert.equal(h.origin.focusCount, focusBefore, 'Lifecycle cleanup must not restore focus to a hidden ancestor');
    h.key('k', { ctrlKey: true }); await tick(); h.more.dispatchEvent({ type: 'toggle' }); h.assertClosed(`Ctrl+K must not open through ancestor ${attribute}`);
  }
  for (const kind of ['blur', 'visibilitychange', 'remove', 'destroy']) {
    const h = await harness(); await h.open();
    if (kind === 'blur') h.window.dispatchEvent({ type: 'blur' });
    if (kind === 'visibilitychange') { h.document.hidden = true; h.document.dispatchEvent({ type: 'visibilitychange' }); }
    if (kind === 'remove') { h.host.remove(); h.removed(); }
    if (kind === 'destroy') { h.strip.destroy(); assert.equal(h.observers.every(observer => !observer.active), true, 'Destroy must disconnect lifecycle observer'); }
    h.assertClosed(`${kind} must synchronously dismiss manual popover`);
  }
  {
    const h = await harness(); h.key('1'); await tick(); assert.deepEqual(h.calls, ['text.clean'], 'Number shortcut retains its ordinary action');
    await h.open(); h.key('1'); await tick(); assert.deepEqual(h.calls, ['text.clean'], 'Numbers typed into search must not run an action');
    h.more.querySelector('summary').focus(); h.key('1'); await tick(); h.assertClosed('Running an action closes the popover synchronously'); assert.deepEqual(h.calls, ['text.clean', 'text.clean']);
    await h.open(); h.document.dispatchEvent({ type: 'pointerdown', target: h.document.body }); h.assertClosed('Outside click closes');
    h.strip.destroy(); const count = h.calls.length; h.key('1'); h.key('k', { ctrlKey: true }); await tick(); assert.equal(h.calls.length, count); assert.equal(h.more.open, false, 'Destroyed keyboard handlers must be detached');
  }
  console.log('PASS action strip: synchronous close, ancestor hidden/inert/aria-hidden/style, blur/visibility/removal/destroy and Ctrl+K/Escape/number lifecycle');
})().catch(error => { console.error(error); process.exitCode = 1; });
