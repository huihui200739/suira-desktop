'use strict';

// 共享交互：状态先变化，过渡可以被下一次输入打断，不锁鼠标或键盘。
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const feedback = new WeakMap();

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
    const focusable = () => Array.from(surface.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]')).filter(node => node.getClientRects().length);
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
    element.classList.toggle('is-error', error);
    element.classList.toggle('error', error);
    element.setAttribute('role', 'status');
    element.setAttribute('aria-live', 'polite');
    element.classList.add('is-visible');
    const timer = setTimeout(() => element.classList.remove('is-visible'), duration);
    feedback.set(element, { message: String(message), error, repeats, timer });
    return timer;
  }

  function init() {
    document.querySelectorAll('button[title]').forEach(button => {
      const label = button.getAttribute('title');
      if (!button.dataset.hint) button.dataset.hint = label;
      if (!button.hasAttribute('aria-label')) button.setAttribute('aria-label', label);
      button.removeAttribute('title');
    });
    document.querySelectorAll('[data-selection-group]').forEach(selectionGroup);
    document.querySelectorAll('.bar-search, .capture-chip, .shortcut-pill').forEach(node => node.setAttribute('data-glass',''));
    // 使用同一渲染层的提示，避免透明原生窗口上的系统 tooltip 形成白色矩形。
    const hint = document.createElement('div');
    hint.id = 'surface-hint'; hint.className = 'surface-hint'; hint.hidden = true;
    hint.setAttribute('role','tooltip'); document.body.append(hint);
    let hintTarget = null, hintTimer = 0, previousDescription = null;
    const hideHint = () => {
      clearTimeout(hintTimer); hint.hidden = true;
      if (hintTarget) {
        if (previousDescription === null) hintTarget.removeAttribute('aria-describedby');
        else hintTarget.setAttribute('aria-describedby',previousDescription);
      }
      hintTarget = null;
    };
    const showHint = (target, delay) => {
      if (target === hintTarget) return;
      hideHint(); if (!target?.dataset.hint) return;
      hintTarget = target; previousDescription = target.getAttribute('aria-describedby');
      hintTimer = setTimeout(() => {
        if (!target.isConnected || !target.getClientRects().length || document.hidden) { hideHint(); return; }
        hint.textContent = target.dataset.hint; hint.hidden = false;
        target.setAttribute('aria-describedby',[previousDescription,hint.id].filter(Boolean).join(' '));
        const box = target.getBoundingClientRect(), size = hint.getBoundingClientRect();
        hint.style.left = `${Math.max(12,Math.min(innerWidth-size.width-12,box.left+(box.width-size.width)/2))}px`;
        hint.style.top = `${box.top-size.height-8 >= 12 ? box.top-size.height-8 : Math.min(innerHeight-size.height-12,box.bottom+8)}px`;
      },delay);
    };
    document.addEventListener('pointerover', event => showHint(event.target.closest?.('[data-hint]'),450));
    document.addEventListener('pointerout', event => {
      if (hintTarget && !hintTarget.contains(event.relatedTarget)) hideHint();
    });
    document.addEventListener('focusin', event => showHint(event.target.closest?.('[data-hint]'),0));
    document.addEventListener('focusout', hideHint);
    document.addEventListener('pointerdown', hideHint);
    document.addEventListener('keydown', hideHint);
    document.addEventListener('scroll', hideHint, true);
    window.addEventListener('blur', hideHint);
    document.addEventListener('visibilitychange', () => { if (document.hidden) hideHint(); });
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
    reduce.addEventListener('change', clear);
  }
  window.SuiraUI = { openDialog, notify };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
