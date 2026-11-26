'use strict';
(() => {
  const api = window.pinApi, $ = id => document.getElementById(id), menu = $('pin-menu');
  let textMode = false;
  let baseW = 300, baseH = 200, scale = 1, opacity = 1, collapsed = false, passthrough = false, hoverUnlock = false;
  let ocrMode = false, ocrDrag = null, ocrSeq = 0;
  let drag = null, moveFrame = 0, movePoint = null, noticeTimer, suppressRestore = false;
  const notify = (message, error = false, copied = false) => {
    clearTimeout(noticeTimer);
    $('pin-notice').textContent = message;
    if (!error && copied) window.SuiraUI?.copyFeedback($('pin-notice'));
    $('pin-notice').hidden = false;
    $('pin-notice').classList.toggle('is-error', error);
    noticeTimer = setTimeout(() => { $('pin-notice').hidden = true; }, 2200);
  };
  let menuAnchor;
  function updateControls() {
    const zoomLabel = Math.round(scale * 100) + '%';
    const opacityLabel = Math.round(opacity * 100) + '%';
    $('zoom-val').textContent = menu.querySelector('[data-value=zoom]').textContent = zoomLabel;
    $('opacity-val').textContent = menu.querySelector('[data-value=opacity]').textContent = opacityLabel;
    const unavailable = { 'zoom-out': scale <= .25, 'zoom-in': scale >= 3, 'opacity-down': opacity <= .25, 'opacity-up': opacity >= 1 };
    for (const [id, disabled] of Object.entries(unavailable)) {
      $(id).disabled = menu.querySelector(`[data-adjust=${id}]`).disabled = disabled;
    }
  }
  function zoom(next, announce = false) {
    if (collapsed) return;
    scale = Math.min(3, Math.max(.25, Math.round(next * 100) / 100));
    updateControls();
    api.resize(Math.round(baseW * scale), Math.round(baseH * scale));
    if (textMode) $('pin-text').style.setProperty('--text-pin-size', (15 * scale) + 'px');
    if (announce) notify(`缩放 ${Math.round(scale * 100)}%`);
  }
  function fade(next, announce = false) {
    opacity = Math.min(1, Math.max(.25, Math.round(next * 100) / 100));
    updateControls();
    api.setOpacity(opacity);
    if (announce) notify(`透明度 ${Math.round(opacity * 100)}%`);
  }
  function applyPassthroughState(enabled) {
    passthrough = Boolean(enabled);
    hoverUnlock = false;
    document.body.classList.toggle('is-passthrough', passthrough);
    $('passthrough-unlock').hidden = !passthrough;
    $('passthrough-btn').classList.toggle('is-active', passthrough);
    $('passthrough-item').setAttribute('aria-checked', String(passthrough));
    if (passthrough) {
      ocrSeq += 1;
      exitOcrMode();
      $('pin-ocr-result').hidden = true;
      hideMenu();
      notify('已开启鼠标穿透 · 移到右上角胶囊或按钉图显隐热键解除');
    }
  }
  async function togglePassthrough(force) {
    if (collapsed) return;
    const target = typeof force === 'boolean' ? force : !passthrough;
    try {
      const result = await api.setPassthrough(target);
      if (!result?.ok) throw Error(result?.error || '鼠标穿透切换失败');
      applyPassthroughState(result.passthrough);
    } catch (error) { notify(error.message, true); }
  }
  function exitOcrMode(invalidate = false) {
    if (invalidate) ocrSeq += 1;
    ocrMode = false;
    ocrDrag = null;
    $('pin-ocr-overlay').hidden = true;
    $('pin-ocr-box').hidden = true;
    $('ocr-btn').classList.remove('is-active');
  }
  function enterOcrMode() {
    if (textMode || collapsed) return;
    if (passthrough) togglePassthrough(false);
    hideMenu();
    ocrSeq += 1;
    $('pin-ocr-result').hidden = true;
    ocrMode = true;
    ocrDrag = null;
    $('pin-ocr-box').hidden = true;
    $('pin-ocr-overlay').hidden = false;
    $('ocr-btn').classList.add('is-active');
  }
  function renderedImageRect() {
    const img = $('pin-image');
    const rect = img.getBoundingClientRect();
    const nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
    const imgRatio = nw / nh, boxRatio = rect.width / Math.max(1, rect.height);
    let drawW = rect.width, drawH = rect.height, offsetX = rect.left, offsetY = rect.top;
    if (boxRatio > imgRatio) {
      drawW = rect.height * imgRatio;
      offsetX = rect.left + (rect.width - drawW) / 2;
    } else {
      drawH = rect.width / imgRatio;
      offsetY = rect.top + (rect.height - drawH) / 2;
    }
    return { x: offsetX, y: offsetY, w: drawW, h: drawH, nw, nh };
  }
  async function runPinOcr(cssBox) {
    const img = $('pin-image');
    if (!img.naturalWidth || !img.naturalHeight) return;
    const fit = renderedImageRect();
    const left = Math.max(fit.x, cssBox ? cssBox.x : fit.x);
    const top = Math.max(fit.y, cssBox ? cssBox.y : fit.y);
    const right = Math.min(fit.x + fit.w, cssBox ? cssBox.x + cssBox.w : fit.x + fit.w);
    const bottom = Math.min(fit.y + fit.h, cssBox ? cssBox.y + cssBox.h : fit.y + fit.h);
    if (right - left < 4 || bottom - top < 4) { notify('框选区域太小，请重新框选', true); return; }
    const sx = Math.max(0, Math.round(((left - fit.x) / fit.w) * fit.nw));
    const sy = Math.max(0, Math.round(((top - fit.y) / fit.h) * fit.nh));
    const sw = Math.max(1, Math.min(fit.nw - sx, Math.round(((right - left) / fit.w) * fit.nw)));
    const sh = Math.max(1, Math.min(fit.nh - sy, Math.round(((bottom - top) / fit.h) * fit.nh)));
    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const dataUrl = canvas.toDataURL('image/png');
    canvas.width = canvas.height = 0;
    const seq = ++ocrSeq;
    exitOcrMode();
    notify('正在识别文字…');
    try {
      const result = await api.ocrRegion(dataUrl);
      if (seq !== ocrSeq || collapsed || passthrough || result?.canceled) return;
      if (!result?.ok) throw Error(result?.error || '识别失败');
      const text = String(result.text || '').trim();
      if (!text) { notify('未识别到文字', true); return; }
      $('pin-ocr-text').value = text;
      $('pin-ocr-result').hidden = false;
      notify(`已识别并复制 ${text.length} 字`, false, true);
    } catch (error) {
      if (seq === ocrSeq && !collapsed && !passthrough) notify(error.message || '识别失败', true);
    }
  }
  function collapse() {
    ocrSeq += 1;
    exitOcrMode();
    $('pin-ocr-result').hidden = true;
    collapsed = !collapsed;
    api.collapse(collapsed);
    document.body.classList.toggle('is-collapsed', collapsed);
    $('restore').hidden = !collapsed;
    hideMenu();
  }
  function hideMenu(restore = false) {
    menu.hidden = true;
    $('more').setAttribute('aria-expanded', 'false');
    if (restore) $(collapsed ? 'restore' : 'more').focus({ preventScroll: true });
  }
  function positionMenu() {
    if (menu.hidden) return;
    const anchor = $(collapsed ? 'restore' : 'more').getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const x = menuAnchor?.x ?? anchor.right - width;
    const y = menuAnchor?.y ?? anchor.top - height - 6;
    menu.style.left = Math.max(6, Math.min(innerWidth - width - 6, x)) + 'px';
    menu.style.top = Math.max(6, Math.min(innerHeight - height - 6, y)) + 'px';
  }
  function openMenu(anchor, focus = true) {
    menuAnchor = anchor;
    menu.hidden = false;
    $('more').setAttribute('aria-expanded', 'true');
    positionMenu();
    if (focus) menu.querySelector('[data-command=copy]').focus({ preventScroll: true });
  }
  new ResizeObserver(positionMenu).observe(menu);
  window.addEventListener('resize', positionMenu);
  window.PinUI = { revealMenu: () => openMenu(undefined, false) };
  updateControls();
  api.onPassthrough?.(applyPassthroughState);

  async function command(name) {
    hideMenu();
    if (name === 'close') { api.close(); return; }
    if (name === 'collapse') { collapse(); return; }
    if (name === 'ocr') { enterOcrMode(); return; }
    if (name === 'passthrough') { togglePassthrough(); return; }
    if (name === 'reset') { if (collapsed) collapse(); zoom(1); fade(1); notify('已恢复默认大小与透明度'); return; }
    try {
      const result = name === 'top' ? await api.toggleTop() : await api[name]();
      if (result?.canceled) return;
      if (!result?.ok) throw Error(result?.error || '操作失败');
      if (name === 'top') $('top-item').setAttribute('aria-checked', String(result.alwaysOnTop));
      else notify(name === 'copy' ? (textMode ? '文字已复制' : '图片已复制') : (textMode ? '文字已保存' : '图片已保存'), false, name === 'copy');
    } catch (error) { notify(error.message, true); }
  }

  $('zoom-in').onclick = () => zoom(scale + .1);
  $('zoom-out').onclick = () => zoom(scale - .1);
  $('opacity-up').onclick = () => fade(opacity + .1);
  $('opacity-down').onclick = () => fade(opacity - .1);
  $('ocr-btn').onclick = () => { if (ocrMode) exitOcrMode(true); else enterOcrMode(); };
  $('passthrough-btn').onclick = () => togglePassthrough();
  $('passthrough-unlock').onclick = () => togglePassthrough(false);
  $('pin-ocr-close').onclick = () => { $('pin-ocr-result').hidden = true; };
  $('pin-ocr-copy').onclick = async () => {
    const text = $('pin-ocr-text').value;
    if (!text) return;
    try { await navigator.clipboard.writeText(text); notify('文字已复制', false, true); }
    catch { notify('复制失败', true); }
  };
  $('copy').onclick = () => command('copy');
  $('close').onclick = () => command('close');
  $('collapse').onclick = collapse;
  $('restore').onclick = event => { if (suppressRestore && event.detail > 0) { suppressRestore = false; return; } collapse(); };
  $('more').onclick = () => { if (menu.hidden) openMenu(); else hideMenu(); };
  menu.addEventListener('click', event => {
    const item = event.target.closest('[data-command],[data-adjust]');
    if (!item) return;
    if (item.dataset.command) command(item.dataset.command);
    else { $(item.dataset.adjust).click(); hideMenu(true); }
  });
  document.addEventListener('contextmenu', event => {
    event.preventDefault();
    if (ocrMode) { exitOcrMode(true); return; }
    openMenu({ x: event.clientX, y: event.clientY });
  });

  // 鼠标穿透安全出口：利用 forward:true 监听鼠标是否停留在右上角退出胶囊上
  document.addEventListener('pointermove', event => {
    if (passthrough) {
      const btn = $('passthrough-unlock');
      const r = btn.getBoundingClientRect();
      const inside = event.clientX >= r.left - 4 && event.clientX <= r.right + 4 && event.clientY >= r.top - 4 && event.clientY <= r.bottom + 4;
      if (inside !== hoverUnlock) {
        hoverUnlock = inside;
        api.setPassthrough(true, { hoverUnlock: inside }).catch(() => {});
      }
      return;
    }
    if (ocrMode && ocrDrag) {
      const x = Math.min(ocrDrag.sx, event.clientX), y = Math.min(ocrDrag.sy, event.clientY);
      const w = Math.abs(event.clientX - ocrDrag.sx), h = Math.abs(event.clientY - ocrDrag.sy);
      const box = $('pin-ocr-box');
      box.hidden = false;
      box.style.left = x + 'px'; box.style.top = y + 'px'; box.style.width = w + 'px'; box.style.height = h + 'px';
      ocrDrag.box = { x, y, w, h };
      return;
    }
    if (!drag || event.pointerId !== drag.pointer) return;
    if (!drag.moved && Math.hypot(event.screenX - drag.sx, event.screenY - drag.sy) < 4) return;
    drag.moved = true;
    movePoint = { x: Math.round(drag.x + event.screenX - drag.sx), y: Math.round(drag.y + event.screenY - drag.sy) };
    if (!moveFrame) moveFrame = requestAnimationFrame(() => { moveFrame = 0; if (movePoint) api.move(movePoint); });
  });

  document.addEventListener('pointerdown', event => {
    if (passthrough) return;
    if (!menu.hidden && !menu.contains(event.target) && !event.target?.closest?.('#more')) hideMenu();
    if (ocrMode) {
      if (event.button !== 0 || event.target?.closest?.('button,.pin-menu,.pin-bar,.pin-ocr-result')) return;
      ocrDrag = { sx: event.clientX, sy: event.clientY, box: null };
      $('pin-ocr-box').hidden = true;
      return;
    }
    const restoring = collapsed && event.target?.closest?.('#restore');
    if (textMode && event.target?.closest?.('.pin-text') && !event.ctrlKey && !event.metaKey) return;
    if (event.button !== 0 || (!restoring && event.target?.closest?.('button,.pin-menu,.pin-bar,.pin-ocr-result'))) return;
    suppressRestore = false;
    drag = { sx: event.screenX, sy: event.screenY, x: window.screenX, y: window.screenY, pointer: event.pointerId, moved: false, capture: restoring ? $('restore') : $('pin-surface') };
    drag.capture.setPointerCapture(event.pointerId);
  });

  const endDrag = (commit = true) => {
    if (ocrMode && ocrDrag) {
      const box = ocrDrag.box;
      ocrDrag = null;
      $('pin-ocr-box').hidden = true;
      if (!commit) { ocrSeq += 1; return; }
      if (box && box.w >= 6 && box.h >= 6) runPinOcr(box);
      return;
    }
    if (moveFrame) { cancelAnimationFrame(moveFrame); moveFrame = 0; if (movePoint) api.move(movePoint); }
    if (collapsed && drag?.moved) suppressRestore = true;
    const pointer = drag?.pointer, capture = drag?.capture;
    drag = movePoint = null;
    if (pointer !== undefined && capture.hasPointerCapture(pointer)) capture.releasePointerCapture(pointer);
  };
  document.addEventListener('pointerup', () => endDrag(true));
  document.addEventListener('pointercancel', () => endDrag(false));
  document.addEventListener('lostpointercapture', () => endDrag(false));
  const restorePassthroughOnLeave = () => {
    if (passthrough && hoverUnlock) {
      hoverUnlock = false;
      api.setPassthrough(true, { hoverUnlock: false }).catch(() => {});
    }
  };
  document.documentElement.addEventListener('pointerleave', restorePassthroughOnLeave);
  document.documentElement.addEventListener('mouseleave', restorePassthroughOnLeave);

  document.addEventListener('dblclick', event => {
    if (event.target?.closest?.('button,.pin-menu,.pin-bar,.pin-ocr-result')) return;
    if (ocrMode) { runPinOcr(null); return; }
    collapse();
  });

  document.addEventListener('wheel', event => {
    if (passthrough || collapsed) return;
    if (event.target?.closest?.('.pin-ocr-result,.pin-menu')) return;
    if (event.ctrlKey) {
      event.preventDefault();
      fade(opacity + (event.deltaY < 0 ? .1 : -.1), true);
      return;
    }
    if (textMode) {
      const pre = $('pin-text');
      if (pre.scrollHeight > pre.clientHeight + 2) return;
    }
    event.preventDefault();
    zoom(scale + (event.deltaY < 0 ? .1 : -.1), true);
  }, { passive: false });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (ocrMode) { exitOcrMode(true); return; }
      if (!$('pin-ocr-result').hidden) { $('pin-ocr-result').hidden = true; return; }
      if (!menu.hidden) { hideMenu(true); return; }
      api.close();
      return;
    }
    if (ocrMode && event.key === 'Enter') { event.preventDefault(); runPinOcr(null); return; }
    if (textMode && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && window.getSelection().toString()) return;
    if ((event.ctrlKey || event.metaKey) && ['c', 's'].includes(event.key.toLowerCase())) {
      event.preventDefault(); command(event.key.toLowerCase() === 'c' ? 'copy' : 'save'); return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === '0') { event.preventDefault(); command('reset'); return; }
    if (menu.hidden && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const k = event.key.toLowerCase();
      if (k === 'o' && !textMode) { event.preventDefault(); if (ocrMode) exitOcrMode(true); else enterOcrMode(); return; }
      if (k === 't') { event.preventDefault(); togglePassthrough(); return; }
      if (k === '0') { event.preventDefault(); command('reset'); return; }
    }
    if (menu.hidden) return;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const buttons = [...menu.querySelectorAll('button')].filter(button => button.getClientRects().length && !button.disabled);
      let index = buttons.indexOf(document.activeElement);
      index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[index].focus();
    } else if (event.key === 'Tab') { event.preventDefault(); hideMenu(true); }
  });
  window.addEventListener('blur', () => { hideMenu(); endDrag(false); restorePassthroughOnLeave(); });
  api.getData().then(result => {
    if (!result.ok) throw Error(result.error);
    textMode = result.data.kind === 'text';
    $('pin-image').hidden = textMode;
    $('pin-text').hidden = !textMode;
    $('ocr-btn').hidden = textMode;
    $('menu-ocr').hidden = textMode;
    if (textMode) {
      $('copy').setAttribute('aria-label', '复制文字');
      $('copy').dataset.hint = '复制文字';
      $('pin-text').textContent = result.data.text;
      document.title = '随序 · 文字钉图';
      menu.querySelector('[data-command=copy]').firstChild.textContent = '复制文字 ';
      menu.querySelector('[data-command=save]').firstChild.textContent = '文字另存为 ';
    } else $('pin-image').src = result.data.url;
    baseW = result.data.width;
    baseH = result.data.height;
  }).catch(error => notify(error.message, true));
})();
