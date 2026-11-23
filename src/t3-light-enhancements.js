'use strict';
/* T3 light preview refinements (v9–v14) that need DOM work, not just CSS.
   Loaded after app.js. Everything here is defensive: if a selector is
   absent it does nothing, and it never replaces app.js logic — it only
   moves the buttons app.js already created, so their handlers keep working.
   No new app functions are invented. */
(function () {
  var root = document.documentElement;
  if (!root.classList.contains('workbench') && !root.classList.contains('tool-window')) return;
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  /* Task shelf: weak drop hint at the bottom of the task column. */
  function addDropHint() {
    try {
      var col = $('.task-column');
      if (!col || col.querySelector('.drop-hint')) return;
      var hint = document.createElement('div');
      hint.className = 'drop-hint';
      hint.textContent = '拖入文字、图片或链接到这里';
      col.appendChild(hint);
    } catch (e) { /* leave the shelf as it is */ }
  }

  /* Library: one primary action + a "···" menu per card.
     The menu holds the card's own real buttons (moved, not recreated), so
     copy / paste / open / OCR / pin / shelf / pin / delete keep working.
     Delete stays last and keeps its .is-danger styling. */
  function enhanceLibraryCards() {
    try {
      var grid = $('#library-grid');
      if (!grid) return;
      $$('.library-card', grid).forEach(function (card) {
        if (card.dataset.libMenuDone) return;
        var footer = card.querySelector('.shelf-card-actions');
        if (!footer) return;
        var buttons = $$(':scope > button', footer);
        if (buttons.length <= 2) return;
        var kind = (card.querySelector('.kind-tag') || { className: '' }).className;
        var primary = null;
        if (/files/.test(kind)) primary = footer.querySelector('[data-open]');
        if (!primary) primary = footer.querySelector('[data-copy]');
        if (!primary) primary = buttons[0];
        var menu = document.createElement('div');
        menu.className = 'lib-menu';
        menu.setAttribute('role', 'menu');
        menu.hidden = true;
        var rest = buttons.filter(function (b) { return b !== primary; });
        rest.forEach(function (b, i) {
          if (b.classList.contains('is-danger') && i === rest.length - 1) {
            var hr = document.createElement('hr');
            menu.appendChild(hr);
          }
          menu.appendChild(b);
        });
        var toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'lib-menu-toggle';
        toggle.textContent = '···';
        toggle.setAttribute('aria-label', '更多操作');
        toggle.setAttribute('aria-haspopup', 'true');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.addEventListener('click', function (event) {
          event.stopPropagation();
          var willOpen = menu.hidden;
          $$('.lib-menu').forEach(function (m) { m.hidden = true; });
          $$('.lib-menu-toggle').forEach(function (t) { t.setAttribute('aria-expanded', 'false'); });
          menu.hidden = !willOpen;
          toggle.setAttribute('aria-expanded', String(willOpen));
        });
        footer.appendChild(toggle);
        footer.appendChild(menu);
        card.dataset.libMenuDone = '1';
      });
      var countEl = $('#page-library .page-head h1');
      var n = $$('.library-card', grid).length;
      if (countEl && n) {
        var span = countEl.querySelector('.lib-count');
        if (!span) { span = document.createElement('span'); span.className = 'lib-count'; countEl.appendChild(span); }
        span.textContent = n + ' 项';
      }
      $$('.library-card', grid).forEach(function (card) {
        if (card.dataset.libSelectDone) return;
        card.dataset.libSelectDone = '1';
        card.addEventListener('click', function () {
          $$('.library-card.is-selected', grid).forEach(function (c) { c.classList.remove('is-selected'); });
          card.classList.add('is-selected');
        });
      });
    } catch (e) { /* leave the library as it is */ }
  }
  function closeMenus() {
    $$('.lib-menu').forEach(function (m) { m.hidden = true; });
    $$('.lib-menu-toggle').forEach(function (t) { t.setAttribute('aria-expanded', 'false'); });
  }

  /* Preview dialog: "紧凑复制" becomes the small "整理并复制" row below the
     body, with its real behaviour untouched (the button itself is moved). */
  function enhancePreview() {
    try {
      var preview = $('#preview');
      var cleanup = $('#preview-clean-spacing');
      var body = $('#preview-body');
      if (!preview || !cleanup || !body) return;
      var existing = body.parentElement.querySelector('.pv-compact-row');
      if (cleanup.hidden) { if (existing) existing.remove(); return; }
      if (existing) return;
      cleanup.textContent = '整理并复制';
      var row = document.createElement('div');
      row.className = 'pv-compact-row';
      var note = document.createElement('span');
      note.className = 'pv-compact-note';
      note.textContent = '清理多余空行后另存一份并复制，原文不动';
      row.appendChild(cleanup);
      row.appendChild(note);
      body.insertAdjacentElement('afterend', row);
    } catch (e) { /* leave the preview as it is */ }
  }

  /* Markdown: no-wrap source, weak "＋ 新建文档" entry at the list bottom. */
  function enhanceMarkdown() {
    try {
      var editor = $('#md-editor');
      if (editor) editor.setAttribute('wrap', 'off');
      var list = $('#md-list');
      var create = $('#md-new');
      if (!list || !create) return;
      if (list.querySelector('.md-new-weak')) return;
      var weak = document.createElement('button');
      weak.type = 'button';
      weak.className = 'md-new-weak';
      weak.textContent = '＋ 新建文档';
      weak.addEventListener('click', function () { create.click(); });
      list.appendChild(weak);
    } catch (e) { /* leave Markdown as it is */ }
  }

  /* Calendar: full event names on hover. */
  function enhanceCalendarTitles() {
    try {
      $$('#calendar-grid .calendar-day small').forEach(function (el) {
        if (!el.getAttribute('title')) el.setAttribute('title', el.textContent.trim());
      });
    } catch (e) { /* leave the calendar as it is */ }
  }

  onReady(function () {
    addDropHint();
    enhanceLibraryCards();
    enhanceMarkdown();
    enhanceCalendarTitles();
    document.addEventListener('click', function (event) {
      if (!event.target.closest || !event.target.closest('.lib-menu-toggle') && !event.target.closest('.lib-menu')) closeMenus();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeMenus();
    });
    var grid = $('#library-grid');
    if (grid && window.MutationObserver) {
      new MutationObserver(function () { enhanceLibraryCards(); }).observe(grid, { childList: true });
    }
    var mdList = $('#md-list');
    if (mdList && window.MutationObserver) {
      new MutationObserver(function () { enhanceMarkdown(); }).observe(mdList, { childList: true });
    }
    var calGrid = $('#calendar-grid');
    if (calGrid && window.MutationObserver) {
      new MutationObserver(function () { enhanceCalendarTitles(); }).observe(calGrid, { childList: true, subtree: true });
    }
    var preview = $('#preview');
    if (preview && window.MutationObserver) {
      new MutationObserver(function () { setTimeout(enhancePreview, 0); }).observe(preview, { attributes: true, attributeFilter: ['hidden'] });
    }
  });
})();
