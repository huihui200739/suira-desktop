'use strict';

// 共享交互：状态先变化，过渡可以被下一次输入打断，不锁鼠标或键盘。
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const feedback = new WeakMap();
  const animations = new WeakMap();
  function animate(element, className) {
    if (!element || reduce.matches) return;
    const previous=animations.get(element);
    if(previous) element.removeEventListener('animationend',previous);
    const restarting=element.classList.contains(className);
    element.classList.remove(className);
    // Prepared reveals need no synchronous layout; only interrupted feedback restarts.
    if(restarting) void element.offsetWidth;
    element.classList.add(className);
    const finish=()=>{element.classList.remove(className);animations.delete(element);};
    animations.set(element,finish);element.addEventListener('animationend',finish,{once:true});
  }
  function copyFeedback(element) {
    if (!element) return;
    element.querySelector('.copy-check')?.remove();
    const check=document.createElementNS('http://www.w3.org/2000/svg','svg');
    check.setAttribute('viewBox','0 0 24 24');check.setAttribute('aria-hidden','true');check.classList.add('copy-check');
    if(!reduce.matches){check.classList.add('is-drawing');check.addEventListener('animationend',()=>check.classList.remove('is-drawing'),{once:true});}
    const path=document.createElementNS(check.namespaceURI,'path');path.setAttribute('d','M5 12l4 4L19 6');check.append(path);element.prepend(check);
  }

  function selectionGroup(group) {
    const indicator = document.createElement('span');
    indicator.className = 'shared-selection';
    indicator.setAttribute('aria-hidden', 'true');
    group.classList.add('has-shared-selection');
    group.append(indicator);
    let frame = 0;
    const update = () => {
      frame = 0;
      const active = group.querySelector('button[aria-pressed="true"], button.is-active');
      if (!active || !group.getClientRects().length) { indicator.hidden = true; return; }
      const target = active.getBoundingClientRect(), parent = group.getBoundingClientRect();
      indicator.hidden = false;
      Object.assign(indicator.style, {
        width: `${target.width}px`, height: `${target.height}px`,
        transform: `translate(${target.left-parent.left+group.scrollLeft-group.clientLeft}px, ${target.top-parent.top+group.scrollTop-group.clientTop}px)`
      });
      if (!group.classList.contains('selection-ready')) {
        // 初次放置不从坐标原点飞入。
        requestAnimationFrame(() => group.classList.add('selection-ready'));
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    new MutationObserver(schedule).observe(group, { subtree: true, attributes: true, attributeFilter: ['class', 'aria-pressed'] });
    const resize = new ResizeObserver(schedule);
    resize.observe(group);
    group.querySelectorAll('button').forEach(button => resize.observe(button));
    update();
  }

  // 焦点约束与返回来源；动效关闭不延后完成操作，也不会挡住下一次点击。
  function openDialog(layer, { surface = layer.firstElementChild, trigger = document.activeElement, close } = {}) {
    layer._dialogCleanup?.(false);
    const origin = trigger?.getBoundingClientRect?.();
    const bounds = surface.getBoundingClientRect();
    surface.style.transformOrigin = origin && origin.width
      ? `${Math.max(0,Math.min(bounds.width,origin.x+origin.width/2-bounds.x))}px ${Math.max(0,Math.min(bounds.height,origin.y+origin.height/2-bounds.y))}px`
      : '50% 50%';
    const background = Array.from(document.querySelectorAll('.titlebar, .app-body'));
    const inertBefore = background.map(node => node.inert);
    background.forEach(node => { node.inert = true; });
    window.SuiraUI?.dismissHints?.();
    const focusable = () => Array.from(surface.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]')).filter(node => node.getClientRects().length && !node.matches('.glass-select-native,[tabindex="-1"],[aria-hidden="true"]'));
    const focusFirst = () => (surface.querySelector('input:not(:disabled)') || focusable()[0])?.focus({ preventScroll: true });
    const onFocus = event => { if (!surface.contains(event.target)) focusFirst(); };
    const onKey = event => {
      if (event.key === 'Escape' && close) { event.preventDefault(); event.stopImmediatePropagation(); close(); return; }
      if (event.key !== 'Tab') return;
      const list = focusable(), first = list[0], last = list.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !surface.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !surface.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus);
    focusFirst();
    let cleaned = false;
    layer._dialogCleanup = (restore = true) => {
      if (cleaned) return;
      cleaned = true;
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus);
      background.forEach((node,index) => { node.inert = inertBefore[index]; });
      if (restore && trigger?.isConnected && trigger.getClientRects().length && !trigger.closest('[inert]')) trigger.focus({ preventScroll: true });
    };
  }

  function notify(element, message, { error = false, duration = error ? 5000 : 2200 } = {}) {
    if (!element) return;
    const previous = feedback.get(element);
    const repeats = previous && element.classList.contains('is-visible') && previous.message === String(message) && previous.error === error ? previous.repeats + 1 : 1;
    clearTimeout(previous?.timer);
    element.textContent = String(message) + (repeats > 1 ? `（${repeats} 次）` : '');
    if (!error && /复制|copied/i.test(String(message))) copyFeedback(element);
    element.classList.toggle('is-error', error);
    element.classList.toggle('error', error);
    element.setAttribute('role', 'status');
    element.setAttribute('aria-live', 'polite');
    element.classList.add('is-visible');
    const timer = setTimeout(() => element.classList.remove('is-visible'), duration);
    feedback.set(element, { message: String(message), error, repeats, timer });
    return timer;
  }

  function installHints() {
    // A pointer click often leaves focus on a button. Focus is not hover:
    // only keyboard navigation may keep a focus hint alive without the pointer.
    const hint = document.createElement('div');
    hint.id = 'surface-hint'; hint.className = 'surface-hint'; hint.hidden = true;
    hint.setAttribute('role', 'tooltip'); document.body.append(hint);
    const titleHints = new WeakSet(), automaticLabels = new WeakMap();
    let target = null, source = '', timer = 0, frame = 0, mode = 'pointer';
    let pointer = null, blockedHover = null, shownBounds = null;
    const owner = node => node?.closest?.('[data-hint]') || null;
    function normalizeTitle(element) {
      const label = element.getAttribute('title');
      if (label === null) return;
      if (!element.dataset.hint || titleHints.has(element)) {
        if (label) element.dataset.hint = label;
        else delete element.dataset.hint;
        titleHints.add(element);
      }
      const previous = automaticLabels.get(element);
      if (element.matches('button, [role="button"]') && (!element.hasAttribute('aria-label') || element.getAttribute('aria-label') === previous)) {
        if (label) { element.setAttribute('aria-label', label); automaticLabels.set(element, label); }
        else { element.removeAttribute('aria-label'); automaticLabels.delete(element); }
      }
      element.removeAttribute('title');
    }
    function normalizeTree(node) {
      if (node.nodeType !== 1) return;
      if (node.hasAttribute('title')) normalizeTitle(node);
      node.querySelectorAll('[title]').forEach(normalizeTitle);
    }
    normalizeTree(document.documentElement);
    // Rendered lists, menus and changing pin/fullscreen labels must not recreate
    // a second native tooltip or retain the text from an earlier state.
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes') normalizeTitle(record.target);
        else record.addedNodes.forEach(normalizeTree);
      }
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
    const layoutStyle = text => String(text || '').split(';').filter(value => value.trim() && !value.trim().startsWith('--')).join(';');
    const activeObserver = new MutationObserver(records => {
      if (!target || frame) return;
      const changed = records.some(record => {
        if (hint.contains(record.target)) return false;
        if (record.type !== 'attributes') return true;
        const element = record.target;
        if (!element.contains(target) && !target.contains(element)) return false;
        // Keycap/glass lighting writes CSS variables on every pointer frame;
        // those do not move the stationary anchor and need no geometry reads.
        if (record.attributeName === 'style' && layoutStyle(record.oldValue) === layoutStyle(element.getAttribute('style'))) return false;
        return true;
      });
      if (changed) frame = requestAnimationFrame(validate);
    });
    function hide() {
      clearTimeout(timer); timer = 0;
      cancelAnimationFrame(frame); frame = 0;
      activeObserver.disconnect();
      hint.hidden = true; hint.textContent = '';
      if (target) {
        // Remove only our token; other components can change descriptions while
        // the hint is open and their changes must survive dismissal.
        const ids = (target.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== hint.id);
        if (ids.length) target.setAttribute('aria-describedby', ids.join(' '));
        else target.removeAttribute('aria-describedby');
      }
      target = null; source = ''; shownBounds = null;
    }
    function eligible(element) {
      if (!element?.isConnected || !element.dataset.hint || document.hidden) return false;
      if (element.closest('[hidden], [inert], [aria-hidden="true"]') || element.matches(':disabled, [aria-disabled="true"]')) return false;
      if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || !element.getClientRects().length) return false;
      return element.getAttribute('aria-expanded') !== 'true' || element.dataset.hintWhenExpanded === 'true';
    }
    function valid() {
      if (!eligible(target)) return false;
      if (source === 'keyboard') return mode === 'keyboard' && target.contains(document.activeElement);
      return mode === 'pointer' && pointer && target.contains(document.elementFromPoint(pointer.x, pointer.y));
    }
    function validate() {
      frame = 0;
      if (!valid()) { hide(); return; }
      if (shownBounds) {
        const box = target.getBoundingClientRect();
        if (hint.textContent !== target.dataset.hint || ['x','y','width','height'].some(key => Math.abs(box[key] - shownBounds[key]) > 1)) hide();
      }
    }
    function show(element, kind) {
      if (target === element && source === kind) return;
      hide(); if (!eligible(element)) return;
      target = element; source = kind;
      activeObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['hidden','inert','aria-hidden','aria-expanded','aria-disabled','disabled','data-hint','data-hint-when-expanded','class','style','open'] });
      timer = setTimeout(() => {
        timer = 0;
        if (!valid()) { hide(); return; }
        hint.textContent = target.dataset.hint; hint.hidden = false;
        const ids = new Set((target.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
        ids.add(hint.id); target.setAttribute('aria-describedby', [...ids].join(' '));
        const box = target.getBoundingClientRect(), size = hint.getBoundingClientRect();
        shownBounds = { x: box.x, y: box.y, width: box.width, height: box.height };
        hint.style.left = `${Math.max(12, Math.min(innerWidth-size.width-12, box.left+(box.width-size.width)/2))}px`;
        hint.style.top = `${box.top-size.height-8 >= 12 ? box.top-size.height-8 : Math.min(innerHeight-size.height-12, box.bottom+8)}px`;
      }, kind === 'keyboard' ? 0 : 450);
    }
    function hover(event) {
      if (event.pointerType === 'touch') return;
      mode = 'pointer'; pointer = { x: event.clientX, y: event.clientY };
      const element = owner(event.target);
      if (element !== blockedHover) blockedHover = null;
      if (element !== blockedHover) show(element, 'pointer');
      else hide();
    }
    document.addEventListener('pointerover', hover, true);
    document.addEventListener('pointermove', hover, { capture: true, passive: true });
    document.addEventListener('pointerout', event => {
      if (blockedHover && !blockedHover.contains(event.relatedTarget)) blockedHover = null;
      if (source === 'pointer' && target && !target.contains(event.relatedTarget)) hide();
      if (!event.relatedTarget) { pointer = null; hide(); }
    }, true);
    document.addEventListener('pointerdown', event => {
      mode = 'pointer'; blockedHover = owner(event.target); hide();
    }, true);
    document.addEventListener('keydown', event => {
      if (['Shift','Control','Alt','Meta'].includes(event.key)) return;
      mode = 'keyboard'; blockedHover = target; hide();
    }, true);
    document.addEventListener('focusin', event => {
      if (mode === 'keyboard') show(owner(event.target), 'keyboard');
    }, true);
    document.addEventListener('focusout', event => {
      if (source === 'keyboard' && target && !target.contains(event.relatedTarget)) hide();
    }, true);
    const reset = () => { pointer = null; blockedHover = null; mode = 'pointer'; hide(); };
    document.documentElement.addEventListener('pointerleave', reset);
    document.addEventListener('pointercancel', reset, true);
    document.addEventListener('dragstart', reset, true);
    document.addEventListener('contextmenu', reset, true);
    // Capture: menus/comboboxes deliberately stop bubbling key/pointer events.
    document.addEventListener('beforetoggle', hide, true);
    document.addEventListener('scroll', event => {
      if (event.target === document || event.target?.contains?.(target)) hide();
    }, true);
    window.addEventListener('blur', reset);
    window.addEventListener('resize', reset);
    window.addEventListener('pagehide', reset);
    document.addEventListener('visibilitychange', reset);
    return reset;
  }

  function init() {
    const interruptReveal=event=>{
      const panel=event.target.closest?.('.panel.is-revealing');
      if(!panel)return;panel.classList.remove('is-revealing');
      const finish=animations.get(panel);if(finish)panel.removeEventListener('animationend',finish);animations.delete(panel);
    };
    document.addEventListener('pointerdown',interruptReveal,true);
    document.addEventListener('keydown',interruptReveal,true);
    window.SuiraUI.dismissHints = installHints();
    document.querySelectorAll('[data-selection-group]').forEach(selectionGroup);
    document.querySelectorAll('.bar-search, .capture-chip, .shortcut-pill').forEach(node => node.setAttribute('data-glass',''));
    let frame = 0, last = null, point = null;
    const clear = () => {
      cancelAnimationFrame(frame); frame = 0;
      last?.classList.remove('glass-active'); last = null; point = null;
    };
    document.addEventListener('pointermove', event => {
      if (reduce.matches || event.pointerType === 'touch') { clear(); return; }
      const target = event.target.closest?.('[data-glass]');
      if (target !== last) { last?.classList.remove('glass-active'); last = target; }
      if (!target) return;
      point = { x: event.clientX, y: event.clientY };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!last || !point) return;
        const bounds = last.getBoundingClientRect();
        last.style.setProperty('--glass-x', `${point.x-bounds.left}px`);
        last.style.setProperty('--glass-y', `${point.y-bounds.top}px`);
        last.classList.add('glass-active');
      });
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', clear);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
    reduce.addEventListener('change', () => {
      clear();
      if(!reduce.matches) return;
      document.querySelectorAll('.is-revealing,.is-result-new').forEach(element=>{
        element.classList.remove('is-revealing','is-result-new');
        const finish=animations.get(element);if(finish)element.removeEventListener('animationend',finish);animations.delete(element);
      });
      document.querySelectorAll('.copy-check.is-drawing').forEach(element=>element.classList.remove('is-drawing'));
    });
  }
  window.SuiraUI = { openDialog, notify, copyFeedback, reveal:element=>animate(element,'is-revealing'), result:element=>animate(element,'is-result-new') };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
