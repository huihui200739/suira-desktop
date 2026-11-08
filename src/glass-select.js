'use strict';
// Keep the native control as the form/value/event authority. The visible
// combobox only supplies presentation and keyboard navigation.
(() => {
  if (window.SuiraGlassSelect) return;
  const instances = new Set(), mounted = new WeakMap();
  let opened = null, serial = 0, search = '', searchAt = 0;
  const valueProperty = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  const indexProperty = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
  const disabled = option => option.disabled || option.parentElement?.disabled || option.hidden || option.parentElement?.hidden;

  function available(instance) {
    const { select, host, trigger } = instance;
    if (!select.isConnected || !trigger.isConnected || select.matches(':disabled') || trigger.disabled || host.hidden ||
        trigger.closest('[hidden],[inert],[aria-hidden="true"]') || !trigger.getClientRects().length) return false;
    const style = getComputedStyle(trigger);
    return style.visibility !== 'hidden' && style.visibility !== 'collapse';
  }

  function close({ focus = false } = {}) {
    const instance = opened;
    if (!instance) return;
    opened = null; search = '';
    instance.menu.hidden = true;
    instance.trigger.setAttribute('aria-expanded', 'false');
    instance.trigger.removeAttribute('aria-activedescendant');
    if (focus && available(instance)) instance.trigger.focus({ preventScroll: true });
  }

  function nameOf(select) {
    const labelled = select.getAttribute('aria-labelledby');
    if (labelled) return labelled.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
    const label = select.labels?.[0];
    return select.getAttribute('aria-label') || (label && [...label.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim()) ||
      select.closest('.setting-row')?.querySelector('b')?.textContent || '选择';
  }

  function position(instance) {
    const { trigger, menu } = instance, rect = trigger.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-2')) || 8;
    menu.style.width = Math.min(Math.max(rect.width, 176), innerWidth - gap * 2) + 'px';
    menu.style.maxHeight = Math.min(320, innerHeight - gap * 2) + 'px';
    const height = menu.getBoundingClientRect().height;
    const below = innerHeight - rect.bottom - gap;
    menu.style.left = Math.max(gap, Math.min(rect.left, innerWidth - menu.offsetWidth - gap)) + 'px';
    menu.style.top = Math.max(gap, below >= height || below >= rect.top ? rect.bottom + gap : rect.top - height - gap) + 'px';
    menu.style.maxHeight = Math.max(gap * 3, Math.min(320, below >= height || below >= rect.top ? below - gap : rect.top - gap * 2)) + 'px';
  }

  function highlight(instance, index) {
    instance.active = index;
    instance.menu.querySelectorAll('[role="option"]').forEach(option => option.classList.toggle('is-active', Number(option.dataset.index) === index));
    const option = instance.menu.querySelector(`[data-index="${index}"]`);
    if (option) {
      instance.trigger.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({ block: 'nearest' });
    } else instance.trigger.removeAttribute('aria-activedescendant');
  }

  function render(instance) {
    const { select, trigger, host, caption, menu } = instance;
    if (!select.isConnected) return;
    if (select.nextElementSibling !== host) select.after(host);
    const selected = select.options[select.selectedIndex];
    const label=selected?.label || '请选择', unavailable=select.matches(':disabled');
    if(caption.textContent!==label) caption.textContent=label;
    if(trigger.dataset.hint!==label) trigger.dataset.hint=label;
    if(trigger.disabled!==unavailable) trigger.disabled=unavailable;
    const accessible=nameOf(select)+'：'+label, required=String(select.required);
    if(trigger.getAttribute('aria-label')!==accessible) trigger.setAttribute('aria-label',accessible);
    if(trigger.getAttribute('aria-required')!==required) trigger.setAttribute('aria-required',required);
    if(trigger.hasAttribute('aria-invalid')) trigger.setAttribute('aria-invalid',String(!select.validity.valid));
    const hidden=select.hidden || getComputedStyle(select).display==='none';
    if(host.hidden!==hidden) host.hidden=hidden;
    if (opened === instance && !available(instance)) close();
    if (opened !== instance) return;
    menu.replaceChildren();
    let group;
    [...select.options].forEach((option, index) => {
      if (option.hidden || option.parentElement?.hidden) return;
      if (option.parentElement instanceof HTMLOptGroupElement && group !== option.parentElement) {
        group = option.parentElement;
        const label = document.createElement('div'); label.className = 'glass-select-group'; label.textContent = group.label;
        menu.append(label);
      }
      const row = document.createElement('div');
      row.id = menu.id + '-' + index; row.dataset.index = String(index); row.className = 'glass-select-option';
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(index === select.selectedIndex));
      row.setAttribute('aria-disabled', String(Boolean(disabled(option)))); row.textContent = option.label;
      menu.append(row);
    });
    position(instance);
    highlight(instance, instance.active);
  }

  function open(instance) {
    if (!available(instance)) return;
    close(); opened = instance; search = '';
    instance.active = instance.select.selectedIndex;
    if (instance.active < 0 || disabled(instance.select.options[instance.active])) instance.active = [...instance.select.options].findIndex(option => !disabled(option));
    instance.menu.hidden = false; instance.trigger.setAttribute('aria-expanded', 'true');
    render(instance); if (opened === instance) instance.trigger.focus({ preventScroll: true });
  }

  function commit(instance, index) {
    const option = instance.select.options[index];
    if (!option || disabled(option)) return;
    const changed = index !== instance.select.selectedIndex;
    instance.select.selectedIndex = index;
    close({ focus: true });
    if (changed) {
      instance.select.dispatchEvent(new Event('input', { bubbles: true }));
      instance.select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function keydown(event) {
    const instance = mounted.get(event.target) || [...instances].find(i => i.trigger === event.target);
    if (!instance || instance.trigger.disabled || event.isComposing || event.ctrlKey || event.metaKey) return;
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape', 'Tab'];
    if (event.key === 'Tab') { if (opened === instance) close(); return; }
    if (event.key === 'Escape') {
      if (opened !== instance) return;
      event.preventDefault(); event.stopImmediatePropagation(); close({ focus: true }); return;
    }
    const typed = event.key.length === 1 && event.key !== ' ' && !event.altKey;
    if (!keys.includes(event.key) && !typed) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const wasOpen = opened === instance;
    if (!wasOpen) open(instance);
    if (opened !== instance) return;
    if (event.key === 'Enter' || event.key === ' ') { if (wasOpen) commit(instance, instance.active); return; }
    const enabled = [...instance.select.options].map((option, index) => disabled(option) ? -1 : index).filter(index => index >= 0);
    if (!enabled.length) return;
    if (event.key === 'Home') highlight(instance, enabled[0]);
    else if (event.key === 'End') highlight(instance, enabled.at(-1));
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const current = enabled.indexOf(instance.active), step = event.key === 'ArrowDown' ? 1 : -1;
      highlight(instance, enabled[Math.max(0, Math.min(enabled.length - 1, current + step))]);
    } else if (typed) {
      const now = performance.now(), char = event.key.toLocaleLowerCase();
      search = now - searchAt < 700 ? search + char : char; searchAt = now;
      if ([...search].every(c => c === char)) search = char;
      const start = enabled.indexOf(instance.active);
      const ordered = enabled.slice(start + 1).concat(enabled.slice(0, start + 1));
      const match = ordered.find(index => {
        const option = instance.select.options[index];
        return option.label.toLocaleLowerCase().startsWith(search) || option.value.toLocaleLowerCase().startsWith(search);
      });
      if (match !== undefined) highlight(instance, match);
    }
  }

  function mountSelect(select) {
    if (select.multiple || select.size > 1) return;
    if (mounted.has(select)) { render(mounted.get(select)); return; }
    const host = document.createElement('span'), trigger = document.createElement('button'), caption = document.createElement('span'), menu = document.createElement('div');
    host.className = 'glass-select'; trigger.type = 'button'; trigger.className = 'glass-select-trigger'; caption.className = 'glass-select-value';
    menu.className = 'glass-select-menu'; menu.id = 'glass-select-' + ++serial; menu.hidden = true;
    menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', nameOf(select));
    trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-controls', menu.id); trigger.setAttribute('aria-expanded', 'false');
    const arrow = document.createElement('span'); arrow.className = 'glass-select-arrow'; arrow.setAttribute('aria-hidden', 'true');
    arrow.innerHTML = window.suiraIcons?.svg('chevron_down') || '';
    trigger.append(caption, arrow); host.append(trigger); select.after(host); document.body.append(menu);
    const instance = { select, host, trigger, caption, menu, active: select.selectedIndex, saved: {}, events: new AbortController() };
    mounted.set(select, instance); instances.add(instance);
    for (const [name, descriptor] of [['value', valueProperty], ['selectedIndex', indexProperty]]) {
      const own = Object.getOwnPropertyDescriptor(select, name); instance.saved[name] = own;
      if (!own || own.configurable) Object.defineProperty(select, name, { configurable: true, get() { return (own?.get || descriptor.get).call(this); }, set(value) { (own?.set || descriptor.set).call(this, value); instance.active=this.selectedIndex; render(instance); } });
    }
    instance.saved.tabIndex = select.getAttribute('tabindex'); instance.saved.ariaHidden = select.getAttribute('aria-hidden');
    select.classList.add('glass-select-native'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
    trigger.addEventListener('click', () => opened === instance ? close() : open(instance));
    menu.addEventListener('pointerdown', event => event.preventDefault());
    menu.addEventListener('click', event => { const row = event.target.closest('[role="option"]'); if (row) commit(instance, Number(row.dataset.index)); });
    const listener = { signal: instance.events.signal };
    select.addEventListener('change', () => render(instance), listener); select.addEventListener('input', () => render(instance), listener);
    select.addEventListener('focus', () => trigger.focus(), listener);
    select.addEventListener('click', event => { event.preventDefault(); open(instance); }, listener);
    select.addEventListener('invalid', event => { event.preventDefault(); trigger.setAttribute('aria-invalid', 'true'); trigger.focus(); }, listener);
    render(instance);
  }

  function mount(root = document) {
    if (root.matches?.('select')) mountSelect(root);
    root.querySelectorAll?.('select').forEach(mountSelect);
    // Checkbox presentation is CSS-only. Mutating editor-owned checkbox nodes
    // would make ProseMirror repair them and could create an observer loop.
  }

  document.addEventListener('keydown', keydown, true);
  document.addEventListener('pointerdown', event => { if (opened && !opened.host.contains(event.target) && !opened.menu.contains(event.target)) close(); }, true);
  document.addEventListener('focusin', () => { if(opened && document.activeElement!==opened.trigger && !opened.menu.contains(document.activeElement)) close(); });
  document.addEventListener('scroll', event => { if (opened && !opened.menu.contains(event.target)) close(); }, true);
  document.addEventListener('reset', event => requestAnimationFrame(() => instances.forEach(i => { if (i.select.form === event.target) render(i); })), true);
  window.addEventListener('resize', () => close()); window.addEventListener('blur', () => close());
  document.addEventListener('visibilitychange', () => { if (document.hidden) close(); });
  function init() {
    mount();
    new MutationObserver(records => {
      for (const record of records) {
        const element = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
        const select = element?.closest?.('select');
        if (select && mounted.has(select)) render(mounted.get(select));
        if (element?.tagName === 'FIELDSET') instances.forEach(render);
        for (const added of record.addedNodes || []) if (added.nodeType === Node.ELEMENT_NODE) mount(added);
      }
      for (const instance of instances) {
        if (instance.select.isConnected) { if (instance.select.nextElementSibling !== instance.host) render(instance); continue; }
        if (opened === instance) close(); instance.events.abort(); instance.host.remove(); instance.menu.remove();
        for (const name of ['value', 'selectedIndex']) { delete instance.select[name]; if (instance.saved[name]) Object.defineProperty(instance.select, name, instance.saved[name]); }
        instance.select.classList.remove('glass-select-native');
        for (const [attribute, saved] of [['tabindex', instance.saved.tabIndex], ['aria-hidden', instance.saved.ariaHidden]]) saved === null ? instance.select.removeAttribute(attribute) : instance.select.setAttribute(attribute, saved);
        instances.delete(instance); mounted.delete(instance.select);
      }
      // The popup lives under body, so hiding/inerting a parent of the control
      // does not hide the menu itself. Recheck after ancestor/layout mutations.
      if (opened && !available(opened)) close();
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'inert', 'aria-hidden', 'selected', 'label', 'class', 'style', 'aria-label', 'aria-labelledby', 'required'] });
  }
  window.SuiraGlassSelect = Object.freeze({ mount, refresh(select) { const instance = mounted.get(select); if (instance) render(instance); }, close, isOpen: () => Boolean(opened) });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
