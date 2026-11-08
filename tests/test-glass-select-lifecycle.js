'use strict';
// Execute the production widget against an isolated DOM model. Only ordinary
// display/focus/value interactions are modeled; no browser or user profile runs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/glass-select.js'), 'utf8');

function createHarness() {
  let document;
  const observers = [];
  class Element {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase(); this.nodeType = 1; this.children = [];
      this.parentElement = null; this.attributes = new Map(); this.dataset = {};
      this.style = {}; this.events = new Map(); this.className = ''; this.textContent = '';
      this.disabled = false; this.required = false; this.validity = { valid: true };
      this.classList = {
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
        remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
        toggle: (name, force) => { const next = force ?? !this.className.split(/\s+/).includes(name); this.classList[next ? 'add' : 'remove'](name); return next; }
      };
    }
    get childNodes() { return this.children; }
    get hidden() { return this.hasAttribute('hidden'); }
    set hidden(value) { if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
    get isConnected() { return this === document.documentElement || Boolean(this.parentElement?.isConnected); }
    get nextElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'class') this.className = String(value); }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
    after(node) { node.remove(); node.parentElement = this.parentElement; this.parentElement.children.splice(this.parentElement.children.indexOf(this) + 1, 0, node); }
    remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
    replaceChildren(...nodes) { for (const child of [...this.children]) child.remove(); this.append(...nodes); }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    matches(selector) {
      return selector.split(',').some(part => {
        part = part.trim();
        if (part === ':disabled') return this.disabled || Boolean(this.parentElement?.closest('fieldset')?.disabled);
        if (part.startsWith('.')) return this.className.split(/\s+/).includes(part.slice(1));
        const attr = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(part);
        if (attr) {
          const value = attr[1].startsWith('data-') ? this.dataset[attr[1].slice(5).replace(/-([a-z])/g, (_match, char) => char.toUpperCase())] : this.getAttribute(attr[1]);
          return attr[2] === undefined ? value !== null && value !== undefined : value === attr[2];
        }
        return this.tagName.toLowerCase() === part;
      });
    }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, []); this.events.get(type).push(fn); }
    dispatchEvent(event) { event.target ||= this; for (const fn of this.events.get(event.type) || []) fn(event); return true; }
    focus() { document.activeElement = this; document.dispatchEvent({ type: 'focusin', target: this }); }
    scrollIntoView() {}
    getClientRects() {
      if (!this.isConnected) return [];
      for (let node = this; node; node = node.parentElement) if (node.hidden || node.style.display === 'none' || node.className.split(/\s+/).includes('is-hidden')) return [];
      return [this.getBoundingClientRect()];
    }
    getBoundingClientRect() { return { left: 40, top: 40, right: 200, bottom: 72, width: 160, height: 32 }; }
    get offsetWidth() { return 160; }
  }
  class Select extends Element {
    constructor() { super('select'); this._selectedIndex = 0; this.multiple = false; this.size = 0; this.labels = []; }
    get options() { return this.querySelectorAll('option'); }
    get selectedIndex() { return this._selectedIndex; }
    set selectedIndex(value) { this._selectedIndex = Number(value); }
    get value() { return this.options[this._selectedIndex]?.value || ''; }
    set value(value) { this._selectedIndex = this.options.findIndex(option => option.value === value); }
  }
  class OptGroup extends Element { constructor() { super('optgroup'); } }
  document = new Element('document'); document.nodeType = 9;
  document.documentElement = new Element('html'); document.body = new Element('body');
  document.documentElement.append(document.body); document.append(document.documentElement);
  document.activeElement = document.body; document.readyState = 'complete'; document.hidden = false;
  document.createElement = tag => tag === 'select' ? new Select() : new Element(tag);
  document.getElementById = id => document.querySelectorAll('[id]').find(node => node.id === id) || null;
  const panel = new Element('section'), select = new Select();
  const first = new Element('option'), second = new Element('option');
  first.label = 'First'; first.value = 'first'; second.label = 'Second'; second.value = 'second';
  select.append(first, second); panel.append(select); document.body.append(panel);
  const window = new Element('window');
  const context = {
    window, document, HTMLSelectElement: Select, HTMLOptGroupElement: OptGroup, AbortController,
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 }, innerWidth: 900, innerHeight: 600,
    Event: class { constructor(type, options = {}) { this.type = type; Object.assign(this, options); } },
    performance: { now: () => 1000 }, requestAnimationFrame: fn => fn(),
    getComputedStyle: node => ({
      display: node.style.display || (node.className.split(/\s+/).includes('is-hidden') ? 'none' : 'block'),
      visibility: (() => { for (let item = node; item; item = item.parentElement) if (item.style.visibility) return item.style.visibility; return 'visible'; })(),
      getPropertyValue: () => '8'
    }),
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe(target, options) { this.target = target; this.options = options; }
    }
  };
  vm.runInNewContext(source, context, { filename: 'src/glass-select.js' });
  const api = window.SuiraGlassSelect, host = select.nextElementSibling, trigger = host.querySelector('button'), menu = document.body.querySelector('.glass-select-menu');
  function mutate(target, name) {
    for (const observer of observers) {
      if (!observer.target.contains(target) || (observer.options.attributeFilter && !observer.options.attributeFilter.includes(name))) continue;
      observer.callback([{ type: 'attributes', target, attributeName: name, addedNodes: [] }]);
    }
  }
  function clickTrigger() { trigger.dispatchEvent({ type: 'click' }); }
  function assertClosed(message) { assert.equal(api.isOpen(), false, message); assert.equal(menu.hidden, true, message); assert.equal(trigger.getAttribute('aria-expanded'), 'false', message); assert.equal(trigger.hasAttribute('aria-activedescendant'), false, message); }
  return { document, window, panel, select, host, trigger, menu, api, mutate, clickTrigger, assertClosed };
}

const cases = [
  ['hidden', node => { node.hidden = true; }],
  ['inert', node => { node.setAttribute('inert', ''); }],
  ['aria-hidden', node => { node.setAttribute('aria-hidden', 'true'); }],
  ['class', node => { node.className = 'is-hidden'; }],
  ['style', node => { node.style.display = 'none'; }],
  ['style', node => { node.style.visibility = 'hidden'; }],
  ['style', node => { node.style.visibility = 'collapse'; }]
];
for (const [attribute, hide] of cases) {
  const h = createHarness(); h.clickTrigger(); assert.equal(h.api.isOpen(), true, 'Visible enabled select opens');
  hide(h.panel); h.mutate(h.panel, attribute);
  h.assertClosed(`Ancestor ${attribute} must dismiss the body-mounted menu`);
  h.clickTrigger(); h.assertClosed(`Ancestor ${attribute} must prevent reopening`);
  // A caller may try to open in the same task, before observer delivery.
  const immediate = createHarness(); hide(immediate.panel); immediate.clickTrigger();
  immediate.assertClosed(`Open must reject ancestor ${attribute} before observer delivery`);
}
for (const target of ['body', 'documentElement']) {
  const h = createHarness(); h.clickTrigger(); h.document[target].setAttribute('aria-hidden', 'true'); h.mutate(h.document[target], 'aria-hidden');
  h.assertClosed(`${target} ancestor changes must dismiss the menu`);
}
{
  const h = createHarness(); let input = 0, change = 0;
  h.select.addEventListener('input', () => input++); h.select.addEventListener('change', () => change++);
  h.clickTrigger(); h.panel.hidden = true; h.mutate(h.panel, 'hidden'); h.panel.hidden = false; h.mutate(h.panel, 'hidden');
  h.assertClosed('Restoring a panel must not reopen a stale menu');
  h.clickTrigger(); assert.equal(h.api.isOpen(), true); h.select.value = 'second';
  assert.equal(h.trigger.dataset.hint, 'Second', 'Native value remains the display authority after reopening');
  assert.equal(input, 0); assert.equal(change, 0, 'Visibility cleanup must not emit form changes');
  h.menu.dispatchEvent({ type: 'click', target: h.menu.querySelector('[data-index="0"]') });
  h.assertClosed('Choosing an option after reopening closes normally');
  assert.equal(h.select.value, 'first'); assert.equal(input, 1); assert.equal(change, 1, 'Commit still emits one input and change');
  h.clickTrigger(); h.window.dispatchEvent({ type: 'blur' }); h.assertClosed('Window blur still closes');
  h.clickTrigger(); h.api.close({ focus: true }); h.assertClosed('Explicit close still closes'); assert.equal(h.document.activeElement, h.trigger);
}
console.log('PASS glass select: ancestor hidden/inert/aria-hidden/class/style, root changes, open visibility, clean reopen, native value and blur lifecycle');
