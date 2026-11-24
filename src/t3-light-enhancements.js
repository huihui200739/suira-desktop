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
      if (countEl) {
        var span = countEl.querySelector('.lib-count');
        if (!span) { span = document.createElement('span'); span.className = 'lib-count'; countEl.appendChild(span); }
        span.textContent = n + ' 项';
      }
      /* Dashed "new content" card at the end of the grid. It does not invent
         an action: it clicks the library's own capture button, the real
         entry that creates new library content (screenshot capture). */
      var capture = $('#library-capture');
      if (capture && !grid.querySelector('.library-new-card')) {
        var nc = document.createElement('button');
        nc.type = 'button';
        nc.className = 'library-new-card';
        nc.title = '截图，新建一条内容';
        var plus = document.createElement('span'); plus.className = 'library-new-plus'; plus.textContent = '＋';
        var label = document.createElement('span'); label.textContent = '新建内容';
        nc.append(plus, label);
        nc.addEventListener('click', function (event) { event.stopPropagation(); capture.click(); });
        grid.appendChild(nc);
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

  /* Calendar: a "tomorrow" preview under the side-panel list, built only
     from data calendar() already rendered — the month grid cells and the
     countdown list. No invented data: tomorrow's rows are the grid cell's
     own event titles, the countdown line is the first countdown row (or,
     in todo mode, the nearest future term/holiday badge in the grid). */
  function tomorrowKey() {
    var d = new Date(); d.setDate(d.getDate() + 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function renderTomorrowPreview() {
    try {
      var aside = document.querySelector('.agenda-card');
      var list = $('#agenda-list');
      if (!aside || !list) return;
      var key = tomorrowKey();
      var day = new Date(); day.setDate(day.getDate() + 1);
      var label = day.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
      var cell = document.querySelector('.calendar-day[data-date="' + key + '"]');
      var titles = cell ? $$('small', cell).map(function (el) { return el.textContent.trim(); }).filter(Boolean) : [];
      var extra = cell ? cell.querySelector('em') : null;
      var countdown = null;
      var firstRow = list.querySelector('.countdown-row');
      if (firstRow) {
        var strong = firstRow.querySelector('strong');
        var titleEl = firstRow.querySelector('b');
        countdown = { title: titleEl ? titleEl.textContent.trim() : '', days: strong ? strong.textContent.trim() : '' };
      } else {
        var today = new Date(); today.setHours(0, 0, 0, 0);
        var best = null;
        $$('.calendar-day .date-badge').forEach(function (badge) {
          var btn = badge.closest('.calendar-day'); if (!btn || !btn.dataset.date) return;
          var d = new Date(btn.dataset.date + 'T12:00:00');
          if (d <= today) return;
          if (!best || d < best.date) best = { date: d, text: badge.textContent.trim(), term: badge.classList.contains('term') };
        });
        if (best) countdown = { title: best.text + (best.term ? ' · 节气' : ' · 节日'), days: String(Math.round((best.date - today) / 86400000)) };
      }
      var sig = key + '|' + titles.join(',') + '|' + (extra ? extra.textContent : '') + '|' + (countdown ? countdown.title + countdown.days : '');
      var section = $('#tomorrow-preview');
      if (section && section.dataset.sig === sig) return;
      if (!section) {
        section = document.createElement('section');
        section.id = 'tomorrow-preview';
        section.className = 'tomorrow-preview';
        section.setAttribute('aria-label', '明天预览');
        list.insertAdjacentElement('afterend', section);
      }
      section.dataset.sig = sig;
      section.replaceChildren();
      var head = document.createElement('div'); head.className = 'tomorrow-head';
      var hb = document.createElement('b'); hb.textContent = '明天 · ' + label; head.appendChild(hb); section.appendChild(head);
      if (titles.length) {
        titles.forEach(function (t) {
          var b = document.createElement('button');
          b.type = 'button'; b.className = 'tomorrow-row'; b.textContent = t;
          b.addEventListener('click', function () {
            var cellBtn = document.querySelector('.calendar-day[data-date="' + key + '"]');
            if (cellBtn) cellBtn.click();
          });
          section.appendChild(b);
        });
        if (extra) { var more = document.createElement('small'); more.className = 'tomorrow-more'; more.textContent = extra.textContent.trim(); section.appendChild(more); }
      } else {
        var empty = document.createElement('p'); empty.className = 'tomorrow-empty'; empty.textContent = '暂无待办'; section.appendChild(empty);
      }
      if (countdown && countdown.title) {
        var cd = document.createElement('p'); cd.className = 'tomorrow-countdown';
        cd.textContent = '倒数日 · ' + countdown.title + ' ' + countdown.days + ' 天后';
        section.appendChild(cd);
      }
    } catch (e) { /* leave the calendar as it is */ }
  }

  /* Markdown: a real format group next to the view switch — bold, italic,
     code, link, list — acting on the selection in #md-editor through the
     same pipeline the app itself uses (setRangeText + an input event, which
     fires editor.oninput -> dirty() -> preview + autosave). Markers match
     SuiraSourceDocument.apply: ** * ` and "- " list lines. */
  function enhanceMarkdownFormat() {
    try {
      var toolbar = document.querySelector('.markdown-toolbar .view-switch');
      var editor = $('#md-editor');
      if (!toolbar || !editor || toolbar.parentElement.querySelector('.md-src-format-group')) return;
      var group = document.createElement('div');
      group.className = 'md-src-format-group';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', '格式');
      [['bold', 'B', '加粗'], ['italic', 'I', '斜体'], ['code', '</>', '行内代码'], ['link', '链', '链接'], ['list', '列', '无序列表']].forEach(function (d) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'md-src-format'; b.dataset.mdFormat = d[0];
        b.textContent = d[1]; b.title = d[2]; b.setAttribute('aria-label', d[2]);
        b.addEventListener('mousedown', function (e) { e.preventDefault(); });
        b.addEventListener('click', function () { applyMarkdownFormat(d[0]); });
        group.appendChild(b);
      });
      toolbar.insertAdjacentElement('afterend', group);
    } catch (e) { /* leave the toolbar as it is */ }
  }
  function applyMarkdownFormat(cmd) {
    try {
      var editor = $('#md-editor');
      if (!editor || editor.disabled) return;
      var split = document.querySelector('#md-split');
      if (split && (split.dataset.view === 'preview' || split.dataset.view === 'write')) {
        var editBtn = document.querySelector('[data-md-view="edit"]');
        if (editBtn) editBtn.click();
      }
      editor.focus();
      var from = editor.selectionStart, to = editor.selectionEnd;
      var value = editor.value, sel = value.slice(from, to);
      function replace(text, rFrom, rTo, selFrom, selTo) {
        editor.setRangeText(text, rFrom, rTo, 'end');
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        if (typeof selFrom === 'number') editor.setSelectionRange(selFrom, selTo);
      }
      function wrap(left, right) {
        if (sel.length > left.length + right.length && sel.startsWith(left) && sel.endsWith(right)) {
          replace(sel.slice(left.length, sel.length - right.length), from, to, from, to - left.length - right.length);
        } else if (!sel) {
          replace(left + right, from, to, from + left.length, from + left.length);
        } else {
          replace(left + sel + right, from, to, from + left.length, to + left.length);
        }
      }
      if (cmd === 'bold') wrap('**', '**');
      else if (cmd === 'italic') wrap('*', '*');
      else if (cmd === 'code') wrap('`', '`');
      else if (cmd === 'link') {
        var text = sel || '链接';
        replace('[' + text.replace(/\]/g, '\\]') + '](https://)', from, to, from + text.length + 3, from + text.length + 11);
      } else if (cmd === 'list') {
        var start = value.lastIndexOf('\n', from - 1) + 1;
        var end = value.indexOf('\n', to); if (end === -1) end = value.length;
        var lines = value.slice(start, end).split('\n');
        var allListed = lines.every(function (l) { return /^\s*[-*+]\s/.test(l); });
        var changed = lines.map(function (l) {
          return allListed ? l.replace(/^(\s*)[-*+]\s/, '$1') : l.replace(/^(\s*)/, '$1- ');
        }).join('\n');
        replace(changed, start, end, start, start + changed.length);
      }
    } catch (e) { /* leave the document as it is */ }
  }

  onReady(function () {
    addDropHint();
    enhanceLibraryCards();
    enhanceMarkdown();
    enhanceMarkdownFormat();
    enhanceCalendarTitles();
    renderTomorrowPreview();
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
      new MutationObserver(function () { enhanceCalendarTitles(); renderTomorrowPreview(); }).observe(calGrid, { childList: true, subtree: true });
    }
    var agendaList = $('#agenda-list');
    if (agendaList && window.MutationObserver) {
      new MutationObserver(function () { renderTomorrowPreview(); }).observe(agendaList, { childList: true });
    }
    var mdToolbar = document.querySelector('.markdown-toolbar .view-switch');
    if (mdToolbar && window.MutationObserver) {
      new MutationObserver(function () { enhanceMarkdownFormat(); }).observe(mdToolbar.parentElement, { childList: true });
    }
  });
})();
