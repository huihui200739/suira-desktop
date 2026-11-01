'use strict';

// One active key, one pending animation frame. The button itself never moves:
// pointer hit testing, drag thresholds and the label remain in their original place.
(() => {
  function attach(root, { suspended = () => false } = {}) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    let active = null, pressed = null, point = null, dwell = 0, frame = 0, pulseTimer = 0;
    const keyFrom = node => {
      const key = node?.closest?.('.key');
      return key && root.contains(key) && !key.disabled && key.dataset.state !== 'unimplemented' ? key : null;
    };
    function clear() {
      clearTimeout(dwell); clearTimeout(pulseTimer); cancelAnimationFrame(frame);
      for (const key of new Set([active,pressed])) {
        key?.classList.remove('is-key-hover','is-key-pressed');
        key?.style.removeProperty('--key-rx'); key?.style.removeProperty('--key-ry');
      }
      active = pressed = point = null; dwell = frame = pulseTimer = 0;
    }
    function update() {
      frame = 0;
      if (!active || !point || reduce.matches || suspended()) return;
      // Use the stationary square's width even in a scaled fullscreen keyboard.
      const box = active.getBoundingClientRect();
      if (!box.width) return;
      const x = Math.max(-1,Math.min(1,(point.x-box.left)/box.width*2-1));
      const y = Math.max(-1,Math.min(1,(point.y-box.top)/box.width*2-1));
      active.style.setProperty('--key-rx',(-y*3).toFixed(2)+'deg');
      active.style.setProperty('--key-ry',(x*3).toFixed(2)+'deg');
    }
    root.addEventListener('pointerover', event => {
      const key = keyFrom(event.target);
      if (!key || key === active || event.pointerType === 'touch' || reduce.matches || suspended()) return;
      clear(); active = key; point = {x:event.clientX,y:event.clientY};
      dwell = setTimeout(() => {
        dwell = 0;
        if (!active || suspended() || reduce.matches) { clear(); return; }
        active.classList.add('is-key-hover'); update();
      },120);
    });
    root.addEventListener('pointermove', event => {
      if (!active || event.pointerType === 'touch') return;
      if (reduce.matches || suspended()) { clear(); return; }
      point = {x:event.clientX,y:event.clientY};
      if (!frame) frame = requestAnimationFrame(update);
    },{passive:true});
    root.addEventListener('pointerout', event => {
      if (active && !active.contains(event.relatedTarget)) clear();
    });
    root.addEventListener('pointerleave', clear);
    root.addEventListener('pointerdown', event => {
      if (event.button !== 0 || reduce.matches || suspended()) return;
      const key = keyFrom(event.target); if (!key) return;
      if (pressed && pressed !== key) pressed.classList.remove('is-key-pressed');
      pressed = key; pressed.classList.add('is-key-pressed');
    });
    function release() { pressed?.classList.remove('is-key-pressed'); pressed = null; }
    document.addEventListener('pointerup', release);
    document.addEventListener('pointercancel', clear);
    root.addEventListener('keydown', event => {
      if (![' ','Enter'].includes(event.key) || reduce.matches || suspended()) return;
      const key=keyFrom(event.target); if (key) { pressed=key; key.classList.add('is-key-pressed'); }
    });
    root.addEventListener('keyup', release);
    root.addEventListener('focusout', clear);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
    reduce.addEventListener('change', clear);
    return {
      clear,
      pulse(key) {
        if (!key || reduce.matches || suspended()) return;
        release(); clearTimeout(pulseTimer);
        pressed=key; key.classList.add('is-key-pressed');
        pulseTimer=setTimeout(release,140);
      }
    };
  }
  window.SuiraKeycapMotion = { attach };
})();
