'use strict';
(() => {
  const $ = (id) => document.getElementById(id),
    api = window.suira.workspace;
  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  const eventCategory = ({ meta }) =>
    ['work', 'personal', 'study'].includes(meta.category) ? meta.category : 'work';
  const toolEmpty = (id, title, hint = '') =>
    '<div class="workspace-empty"><span class="tool-emblem" aria-hidden="true">' +
    (window.SuiraToolArt?.render(id) || '') +
    '</span><b>' +
    esc(title) +
    '</b>' +
    (hint ? '<p>' + esc(hint) + '</p>' : '') +
    '</div>';
  const dateKey = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const lunarFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { day: 'numeric' });
  const lunarDays = [
    '初一',
    '初二',
    '初三',
    '初四',
    '初五',
    '初六',
    '初七',
    '初八',
    '初九',
    '初十',
    '十一',
    '十二',
    '十三',
    '十四',
    '十五',
    '十六',
    '十七',
    '十八',
    '十九',
    '二十',
    '廿一',
    '廿二',
    '廿三',
    '廿四',
    '廿五',
    '廿六',
    '廿七',
    '廿八',
    '廿九',
    '三十'
  ];
  const lunar = (day) =>
    lunarDays[Number(lunarFormatter.formatToParts(day).find((p) => p.type === 'day')?.value) - 1] ||
    lunarFormatter.format(day);
  let previewTimer,
    richDocument = null,
    sourceDocument = null,
    richText = '',
    richKey = '';
  const views = new Set(['edit', 'split', 'preview', 'write']);
  const viewStorageKey = 'suira:markdown:view';
  let requestedView = localStorage.getItem(viewStorageKey);
  if (!views.has(requestedView)) requestedView = 'edit';
  let renderedText = null,
    focusedWriting = false,
    saveInFlight,
    visualBundle;
  let viewRevision = 0,
    previewRevision = 0,
    imageRequest = null,
    queuedImagePreview = null;
  let imagePreviewDocument = null;
  const editor = $('md-editor'),
    previewPane = $('md-preview');
  editor.wrap = 'off';
  const sourceHighlight = window.SuiraSourceHighlight?.attach(editor, $('md-source-highlight'));
  let sourceHeadingPositions, ignoreEditorScroll, ignorePreviewScroll;
  let documentLayout,
    documentLocation = 'all',
    locationsKey = '',
    mountedFolders = [];
  let outlineCollapsed = true,
    outlineItems = [],
    activeHeading = -1;
  const documentDate = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
  const narrowDocumentLayout = () => matchMedia('(max-width: 540px)').matches;
  const normFolder = (value) => String(value || '').replaceAll('\\', '/').replace(/\/+$/, '');
  const documentFolder = (doc) =>
    (doc.meta?.externalPath || '').replaceAll('\\', '/').replace(/\/[^/]*$/, '');
  const activeLocalFolder = () => {
    if (!documentLocation.startsWith('folder:')) return '';
    const target = documentLocation.slice(7);
    const mounted = mountedFolders.find((dir) => normFolder(dir).toLowerCase() === target);
    if (mounted) return mounted;
    const docMatch = docs.find((doc) => documentFolder(doc).toLowerCase() === target);
    return docMatch ? docMatch.meta.externalPath.replace(/[\\/][^\\/]*$/, '') : '';
  };
  const syncFolderControls = () => {
    const refreshBtn = $('md-refresh-folder');
    if (!refreshBtn) return;
    const target = documentLocation.startsWith('folder:') ? documentLocation.slice(7) : '';
    const isMounted = Boolean(target && mountedFolders.some((dir) => normFolder(dir).toLowerCase() === target));
    refreshBtn.hidden = !isMounted;
  };
  const switchDocumentLocation = (id) => {
    documentLocation = id;
    outlineCollapsed = true;
    if (narrowDocumentLayout()) documentLayout.shell.classList.add('mia-notes-only');
    docList();
    syncDocumentNavigation();
    documentLayout.sections.querySelector('[aria-current="true"]')?.focus();
  };
  const foldedHeadings = new Set();
  function setWritingFocus(enabled) {
    focusedWriting = Boolean(enabled && current);
    document.documentElement.classList.toggle('md-writing-focus', focusedWriting);
    documentLayout?.shell.classList.toggle('mia-focus', focusedWriting);
    if (focusedWriting && $('md-format-toggle')?.getAttribute('aria-expanded') === 'true')
      $('md-format-toggle').click();
    const button = $('md-focus-toggle');
    if (button) {
      button.setAttribute('aria-pressed', String(focusedWriting));
      button.title = (focusedWriting ? '退出专注' : '专注模式') + ' · Ctrl+Shift+F';
      button.setAttribute('aria-label', button.title);
    }
    if (focusedWriting && ['edit', 'split'].includes($('md-split').dataset.view)) editor.focus();
  }
  document.addEventListener('keydown', (event) => {
    if (
      $('md-delete-dialog').open ||
      event.isComposing ||
      event.defaultPrevented ||
      !current ||
      !document.querySelector('#page-markdown.is-active')
    )
      return;
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      setWritingFocus(!focusedWriting);
    } else if (focusedWriting && event.key === 'Escape' && $('md-find').hidden) {
      event.preventDefault();
      setWritingFocus(false);
    }
  });
  function documentIdentity(item) {
    if (document.documentElement.dataset.tool !== 'markdown') return;
    document.title = item ? `${item.title} · 随序 Markdown` : 'Markdown · 随序';
  }
  let agendaMode = 'countdown',
    countdownFilter = 'all',
    upcomingDays = [];
  let calendarView = 'month';
  let month = new Date(),
    selected = dateKey(month),
    events = [],
    editing = '',
    docs = [],
    current = '',
    revision = 0,
    savedRevision = 0,
    timer;
  const notify = (message, type = '') => showGlobalToast(message, type);
  async function checked(promise) {
    const result = await promise;
    if (!result?.ok) throw Error(result?.error || '操作失败');
    return result;
  }
  const safe =
    (fn) =>
    (...args) =>
      Promise.resolve()
        .then(() => fn(...args))
        .catch((error) => notify(error.message, 'error'));
  const tomorrowPreview = document.createElement('section');
  tomorrowPreview.id = 'tomorrow-preview';
  tomorrowPreview.className = 'tomorrow-preview';
  tomorrowPreview.hidden = true;
  const tomorrowButton = document.createElement('button');
  tomorrowButton.type = 'button';
  tomorrowButton.className = 'tomorrow-row';
  tomorrowPreview.append(tomorrowButton);
  $('agenda-list').after(tomorrowPreview);
  const setAgendaMode = (mode) => {
    agendaMode = mode;
    document.querySelectorAll('[data-agenda]').forEach((button) => {
      const active = button.dataset.agenda === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };
  function renderTomorrow() {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    const key = dateKey(next),
      host = tomorrowPreview;
    const pending = events.filter((e) => e.meta.date === key && !e.meta.done);
    host.hidden =
      !pending.length ||
      (agendaMode === 'todo' &&
        selected === key &&
        !$('calendar-search').value.trim() &&
        !$('calendar-category').value);
    if (host.hidden) return;
    const button = tomorrowButton;
    button.textContent = `明天 · ${pending.length} 项待办`;
    button.onclick = () => {
      selected = key;
      month = next;
      setAgendaMode('todo');
      $('calendar-search').value = '';
      $('calendar-category').value = '';
      window.SuiraGlassSelect?.refresh($('calendar-category'));
      calendar();
      $('agenda-list').querySelector('[data-event]')?.focus({ preventScroll: true });
    };
  }
  function calendar() {
    $('calendar-month').textContent = `${month.getFullYear()} 年 ${month.getMonth() + 1} 月`;
    if ($('calendar-jump')) $('calendar-jump').value = dateKey(month).slice(0, 7);
    const search = $('calendar-search').value.trim().toLowerCase(),
      category = $('calendar-category').value;
    const visible = events.filter(
      (e) =>
        (!search ||
          (e.title + ' ' + e.text + ' ' + (e.meta.location || '')).toLowerCase().includes(search)) &&
        (!category || (e.meta.category || 'work') === category) &&
        (!$('calendar-hide-done').checked || !e.meta.done)
    );
    const monthPrefix = dateKey(month).slice(0, 7),
      today = dateKey(new Date()),
      weekEnd = new Date();
    weekEnd.setDate(weekEnd.getDate() + 7);
    $('calendar-stats').innerHTML = [
      ['本月日程', events.filter((e) => e.meta.date.startsWith(monthPrefix)).length],
      ['今天待办', events.filter((e) => e.meta.date === today && !e.meta.done).length],
      [
        '未来七天',
        events.filter((e) => !e.meta.done && e.meta.date >= today && e.meta.date < dateKey(weekEnd)).length
      ]
    ]
      .map(([label, count]) => `<div><span>${label}</span><b>${count}</b></div>`)
      .join('');
    const byDate = new Map();
    for (const item of visible) {
      const key = item.meta.date;
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(item);
    }
    const first =
        calendarView === 'week'
          ? new Date(selected + 'T12:00:00')
          : new Date(month.getFullYear(), month.getMonth(), 1),
      offset = (first.getDay() + 6) % 7;
    if (calendarView === 'week') first.setDate(first.getDate() - offset);
    document.querySelector('.calendar-layout').dataset.view = calendarView;
    document.querySelector('.calendar-week').hidden = calendarView === 'agenda';
    $('calendar-grid').hidden = calendarView === 'agenda';
    $('calendar-agenda').hidden = calendarView !== 'agenda';
    $('calendar-agenda').innerHTML =
      visible
        .filter((e) => e.meta.date.startsWith(monthPrefix))
        .sort((a, b) => (a.meta.date + (a.meta.time || '')).localeCompare(b.meta.date + (b.meta.time || '')))
        .map(
          (e) =>
            `<button class="calendar-agenda-row category-${eventCategory(e)}" data-event-id="${esc(e.id)}"><time>${esc(e.meta.date.slice(5))} ${esc(e.meta.time || '全天')}</time><b>${esc(e.title)}</b><small>${esc(e.meta.location || { work: '工作', personal: '生活', study: '学习' }[eventCategory(e)])}</small></button>`
        )
        .join('') || '<div class="workspace-empty">这个月没有匹配的日程</div>';
    $('calendar-agenda')
      .querySelectorAll('[data-event-id]')
      .forEach(
        (b) =>
          (b.onclick = () => {
            const item = events.find((e) => e.id === b.dataset.eventId);
            selected = item.meta.date;
            editEvent(item);
          })
      );
    $('calendar-grid').innerHTML = Array.from({ length: calendarView === 'week' ? 7 : 42 }, (_, i) => {
      const day =
          calendarView === 'week'
            ? new Date(first.getFullYear(), first.getMonth(), first.getDate() + i)
            : new Date(month.getFullYear(), month.getMonth(), i - offset + 1),
        key = dateKey(day),
        items = byDate.get(key) || [],
        info = window.CalendarData.day(day);
      const badge = info.term || info.festival;
      const shownItems = calendarView === 'week' ? 8 : 2;
      return `<button class="calendar-day ${i % 7 >= 5 ? 'weekend' : ''} ${day.getMonth() !== month.getMonth() ? 'outside' : ''} ${key === today ? 'today' : ''} ${key === selected ? 'selected' : ''}" data-date="${key}" aria-pressed="${key === selected}">` +
        `<span class="day-number">${day.getDate()}${info.work !== null ? `<i class="work-badge ${info.work ? 'work' : 'rest'}">${info.work ? '班' : '休'}</i>` : ''}</span>` +
        `<label class="lunar-day">${badge ? `<span class="date-badge ${info.term ? 'term' : 'holiday'}">${esc(badge)}</span>` : info.lunar}</label>${items
        .slice(0, shownItems)
        .map(
          (e) =>
            `<small title="${esc(e.title)}" class="category-${eventCategory(e)} ${e.meta.done ? 'done' : ''}">${e.meta.priority === 'high' ? '! ' : ''}${esc(e.title)}</small>`
        )
        .join(
          ''
        )}${items.length > shownItems ? `<em>还有 ${items.length - shownItems} 项</em>` : ''}</button>`;
    }).join('');
    $('calendar-grid')
      .querySelectorAll('[data-date]')
      .forEach(
        (button) =>
          (button.onclick = () => {
            selected = button.dataset.date;
            delete $('calendar-quick-date')?.dataset.userPicked;
            setAgendaMode('todo');
            calendar();
            $('calendar-grid').querySelector(`[data-date="${selected}"]`)?.focus({ preventScroll: true });
          })
      );
    if ($('calendar-week-numbers')) {
      const start =
        calendarView === 'week' ? first : new Date(month.getFullYear(), month.getMonth(), 1 - offset);
      $('calendar-week-numbers').innerHTML = Array.from(
        { length: calendarView === 'week' ? 1 : 6 },
        (_, i) =>
          `<span>${window.CalendarData.week(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i * 7))}</span>`
      ).join('');
    }
    if ($('calendar-selected')) {
      const d = new Date(selected + 'T12:00:00'),
        v = window.CalendarData.day(d);
      $('calendar-selected').textContent =
        d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }) +
        ' ' +
        v.month +
        v.lunar;
    }
    $('agenda-date').textContent = new Date(selected + 'T12:00:00').toLocaleDateString('zh-CN', {
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    });
    const entries = visible
      .filter((e) => e.meta.date === selected)
      .sort((a, b) => (a.meta.time || '').localeCompare(b.meta.time || ''));
    $('agenda-count').textContent = `${entries.filter((e) => !e.meta.done).length} 项待办`;
    // 倒数日模式下面这整棵待办 DOM 会立刻被覆盖，别白建一次
    if (agendaMode !== 'countdown')
      $('agenda-list').innerHTML = entries.length
        ? entries
            .map(
              (e) =>
                `<div class="agenda-item category-${eventCategory(e)} ${e.meta.done ? 'done' : ''}">` +
                  `<button class="agenda-check" data-done="${esc(e.id)}" aria-label="${e.meta.done ? '重新打开' : '标记完成'}">${e.meta.done ? '✓' : '○'}</button>` +
                  `<div class="agenda-entry"><button class="agenda-content" data-event="${esc(e.id)}"><small>${esc(e.meta.time || '全天')} ${e.meta.priority === 'high' ? ' · 重要' : ''}</small>` +
                  `<b>${esc(e.title)}</b><small>${esc(e.meta.location || '')}</small></button>${e.text ? `<details class="agenda-notes"><summary>备注</summary><p>${esc(e.text)}</p></details>` : ''}</div>` +
                  `<button class="agenda-remove" data-remove="${esc(e.id)}" aria-label="删除日程">×</button></div>`
            )
            .join('')
        : toolEmpty('calendar', '这一天，留给你安排', '添加日程，或给自己留一点空闲。');
    if (agendaMode === 'countdown') {
      const todayUTC = Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
      const builtins = upcomingDays
        .filter(
          (e) =>
            (countdownFilter === 'all' || countdownFilter === e.kind) &&
            (!search || e.title.toLowerCase().includes(search))
        )
        .map((e) => ({ title: e.title, meta: { date: e.date }, builtin: e.kind }));
      const custom = ['all', 'custom'].includes(countdownFilter)
        ? visible.filter((e) => !e.meta.done && e.meta.date >= today)
        : [];
      const upcoming = [...builtins, ...custom].sort((a, b) => a.meta.date.localeCompare(b.meta.date));
      $('agenda-list').innerHTML =
        upcoming
          .map((e) => {
            const days = Math.round((Date.parse(e.meta.date + 'T00:00:00Z') - todayUTC) / 86400000);
            return `<button class="countdown-row" data-kind="${e.builtin === 'term' ? 'term' : e.builtin === 'holiday' ? 'holiday' : 'custom'}" ${e.builtin ? `data-builtin-date="${e.meta.date}"` : `data-event="${esc(e.id)}"`}>` +
              `<div><b>${esc(e.title)}</b><small>${e.builtin === 'term' ? '节气 · ' : e.builtin === 'holiday' ? '节日 · ' : '自定义 · '}${esc(e.meta.date)}</small>` +
              `</div><strong>${days}</strong><small>天后</small></button>`;
          })
          .join('') || toolEmpty('calendar', '还没有即将到来的日程');
    }
    $('countdown-filters')?.toggleAttribute('hidden', agendaMode !== 'countdown');
    $('calendar-new').textContent = agendaMode === 'countdown' ? '⊕ 添加倒数日' : '⊕ 添加待办';
    const quickTitle = $('calendar-quick-title');
    const quickDate = $('calendar-quick-date');
    if (quickTitle) {
      quickTitle.placeholder = agendaMode === 'countdown' ? '输入倒数日名称，回车添加' : '输入待办，回车快速添加';
      quickTitle.setAttribute('aria-label', agendaMode === 'countdown' ? '快速添加倒数日' : '快速添加待办');
    }
    if (quickDate) {
      quickDate.hidden = agendaMode !== 'countdown';
      if (agendaMode === 'countdown' && !quickDate.dataset.userPicked) {
        quickDate.value = selected >= today ? selected : today;
      }
    }
    $('agenda-list')
      .querySelectorAll('[data-builtin-date]')
      .forEach(
        (b) =>
          (b.onclick = () => {
            selected = b.dataset.builtinDate;
            month = new Date(selected + 'T12:00:00');
            calendar();
          })
      );
    $('agenda-list')
      .querySelectorAll('[data-event]')
      .forEach((b) => (b.onclick = () => editEvent(events.find((e) => e.id === b.dataset.event))));
    $('agenda-list')
      .querySelectorAll('[data-done]')
      .forEach(
        (b) =>
          (b.onclick = safe(async () => {
            const e = events.find((e) => e.id === b.dataset.done);
            b.disabled = true;
            try {
              await checked(
                api.save('calendar', {
                  id: e.id,
                  title: e.title,
                  text: e.text,
                  ...e.meta,
                  done: !e.meta.done
                })
              );
              await loadCalendar();
              notify(e.meta.done ? '已标记为待办' : '已完成');
            } finally {
              b.disabled = false;
            }
          }))
      );
    $('agenda-list')
      .querySelectorAll('[data-remove]')
      .forEach(
        (b) =>
          (b.onclick = safe(async () => {
            b.disabled = true;
            try {
              const result = await checked(api.remove('calendar', b.dataset.remove));
              showRemoveFeedback(
                '已删除日程',
                result,
                loadCalendar,
                () =>
                  $('agenda-list').querySelector(`[data-event="${CSS.escape(b.dataset.remove)}"]`) ||
                  $('calendar-new')
              );
              await loadCalendar();
            } finally {
              b.disabled = false;
            }
          }))
      );
    $('calendar-prev').setAttribute('aria-label', calendarView === 'week' ? '上一周' : '上个月');
    $('calendar-next').setAttribute('aria-label', calendarView === 'week' ? '下一周' : '下个月');
    renderTomorrow();
  }
  async function loadCalendar() {
    await window.CalendarData.ready();
    events = await api.list('calendar');
    upcomingDays = window.CalendarData.upcoming(new Date());
    calendar();
  }
  const form = $('event-form');
  let eventBaseline = '',
    savingEvent = false,
    closingWorkspace = false;
  const queuedCalendarDrafts = [];
  const draftNotice = document.createElement('p');
  draftNotice.className = 'calendar-draft-notice';
  draftNotice.setAttribute('role', 'status');
  draftNotice.hidden = true;
  form.after(draftNotice);
  const updateDraftNotice = () => {
    draftNotice.hidden = !queuedCalendarDrafts.length;
    draftNotice.textContent = `还有 ${queuedCalendarDrafts.length} 条日程草稿待处理`;
  };
  const eventFields = () =>
    Object.fromEntries(
      ['title', 'notes', 'date', 'time', 'category', 'priority', 'location'].map((key) => [
        key,
        $('event-' + key).value
      ])
    );
  const eventDirty = () =>
    !form.hidden && (form.dataset.draft === 'true' || JSON.stringify(eventFields()) !== eventBaseline);
  const unsavedCalendarCount = () => Number(eventDirty()) + queuedCalendarDrafts.length;
  function editEvent(item, fromDraft = false) {
    if (savingEvent || eventDirty()) {
      notify('请先保存或取消正在编辑的日程');
      return false;
    }
    $('agenda-list').before(form, draftNotice);
    $('event-draft-hint')?.remove();
    form.dataset.draft = String(fromDraft);
    editing = item?.id || '';
    form.hidden = false;
    $('event-title').value = item?.title || '';
    $('event-notes').value = item?.text || '';
    $('event-date').value = item?.meta.date || selected;
    $('event-time').value = item?.meta.time || '';
    $('event-category').value = item?.meta.category || 'work';
    $('event-priority').value = item?.meta.priority || 'normal';
    $('event-location').value = item?.meta.location || '';
    eventBaseline = JSON.stringify(eventFields());
    $('event-title').focus();
    return true;
  }
  function showQueuedDraft() {
    if (!queuedCalendarDrafts.length || savingEvent || closingWorkspace || eventDirty()) return;
    const draft = queuedCalendarDrafts.shift();
    updateDraftNotice();
    selected = draft.date;
    month = new Date(draft.date + 'T12:00:00');
    setAgendaMode('todo');
    calendar();
    editEvent({ title: draft.title, text: draft.text, meta: draft }, true);
    const hint = document.createElement('p');
    hint.id = 'event-draft-hint';
    hint.setAttribute('role', 'status');
    hint.textContent = draft.warning || '核对日期和时间后保存';
    form.prepend(hint);
    form.scrollIntoView({ block: 'nearest' });
  }
  async function receiveCalendarDraft() {
    const drafts = await api.calendarDraft();
    queuedCalendarDrafts.push(...drafts);
    updateDraftNotice();
    await window.CalendarData.ready();
    if (!form.contains(document.activeElement)) showQueuedDraft();
  }
  let calendarDraftRead = Promise.resolve();
  if (document.documentElement.dataset.tool === 'calendar') {
    const receive = () => {
      calendarDraftRead = calendarDraftRead
        .then(receiveCalendarDraft)
        .catch((error) => notify(error.message, 'error'));
    };
    api.onCalendarDraft?.(receive);
    receive();
  }
  window.suira.relay?.onRequest?.(async (request) => {
    if (request.kind !== 'markdown.append') return;
    try {
      await flush();
      if (current !== request.id) throw Error('当前文档已切换，请重试');
      $('md-editor').value = [$('md-editor').value, request.text].filter(Boolean).join('\n\n');
      richText = $('md-editor').value;
      richDocument?.load(richText);
      dirty();
      await flush();
      await window.suira.relay.reply({ token: request.token, ok: true });
    } catch (error) {
      await window.suira.relay.reply({ token: request.token, ok: false, error: error.message });
    }
  });
  const monthPicker = document.createElement('label');
  monthPicker.className = 'calendar-month-picker';
  monthPicker.title = '选择年份和月份';
  $('calendar-month').before(monthPicker);
  monthPicker.append($('calendar-month'));
  const monthInput = document.createElement('input');
  monthInput.type = 'month';
  monthInput.id = 'calendar-jump';
  monthInput.min = '1900-01';
  monthInput.max = '2200-12';
  monthInput.setAttribute('aria-label', '跳转到指定月份');
  monthPicker.append(monthInput);
  monthInput.onchange = () => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthInput.value)) return;
    const [year, value] = monthInput.value.split('-').map(Number);
    if (year < 1900 || year > 2200) return;
    month = new Date(year, value - 1, 1);
    selected = dateKey(month);
    delete $('calendar-quick-date')?.dataset.userPicked;
    calendar();
  };
  let wheelLast = 0,
    wheelTotal = 0,
    wheelLocked = false,
    wheelDir = 0;
  function stepCalendarMonth(delta) {
    if (!delta) return;
    const step = delta > 0 ? 1 : -1;
    month = new Date(month.getFullYear(), month.getMonth() + step, 1);
    calendar();
    const grid = $('calendar-grid');
    if (grid) {
      grid.classList.remove('is-month-next', 'is-month-prev');
      void grid.offsetWidth;
      grid.classList.add(step > 0 ? 'is-month-next' : 'is-month-prev');
    }
  }
  $('calendar-grid').addEventListener(
    'wheel',
    (event) => {
      if (calendarView !== 'month' || event.ctrlKey || event.metaKey) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta) return;
      event.preventDefault();
      const now = performance.now();
      const dir = Math.sign(delta);
      const gap = now - wheelLast;
      wheelLast = now;
      if (gap > 160 || (wheelDir && dir !== wheelDir)) {
        wheelLocked = false;
        wheelTotal = 0;
        wheelDir = dir;
      }
      if (wheelLocked) return;
      wheelTotal += delta * (event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? 300 : 1);
      if (Math.abs(wheelTotal) < 48) return;
      wheelDir = Math.sign(wheelTotal);
      wheelTotal = 0;
      wheelLocked = true;
      stepCalendarMonth(wheelDir);
    },
    { passive: false }
  );
  document.addEventListener('keydown', (event) => {
    if (event.isComposing || event.defaultPrevented || $('md-delete-dialog')?.open) return;
    if (!document.querySelector('#page-calendar.is-active')) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
    if ((!event.altKey && event.key === 'PageUp') || (event.altKey && event.key === 'ArrowLeft')) {
      event.preventDefault();
      $('calendar-prev').click();
    } else if ((!event.altKey && event.key === 'PageDown') || (event.altKey && event.key === 'ArrowRight')) {
      event.preventDefault();
      $('calendar-next').click();
    }
  });
  $('calendar-prev').onclick = () => {
    if (calendarView === 'week') {
      const day = new Date(selected + 'T12:00:00');
      day.setDate(day.getDate() - 7);
      selected = dateKey(day);
      month = day;
      calendar();
      return;
    }
    stepCalendarMonth(-1);
  };
  $('calendar-next').onclick = () => {
    if (calendarView === 'week') {
      const day = new Date(selected + 'T12:00:00');
      day.setDate(day.getDate() + 7);
      selected = dateKey(day);
      month = day;
      calendar();
      return;
    }
    stepCalendarMonth(1);
  };
  $('calendar-today').onclick = () => {
    month = new Date();
    selected = dateKey(month);
    calendar();
  };
  $('calendar-new').onclick = () => editEvent();
  $('event-cancel').onclick = () => {
    if (!savingEvent) {
      form.hidden = true;
      $('calendar-new').focus({ preventScroll: true });
      showQueuedDraft();
    }
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    if (savingEvent) return;
    safe(async () => {
      const { notes, ...fields } = eventFields(),
        payload = {
          ...fields,
          id: editing,
          text: notes,
          done: events.find((e) => e.id === editing)?.meta.done || false
        };
      const controls = [...form.elements].filter((control) => !control.disabled),
        focused = document.activeElement;
      const button = form.querySelector('[type="submit"]');
      savingEvent = true;
      controls.forEach((control) => {
        control.disabled = true;
      });
      button.textContent = '正在保存…';
      try {
        await checked(api.save('calendar', payload));
      } finally {
        savingEvent = false;
        controls.forEach((control) => {
          control.disabled = false;
        });
        button.textContent = '保存日程';
        if (form.contains(focused) && document.activeElement === document.body)
          focused.focus({ preventScroll: true });
      }
      selected = payload.date;
      month = new Date(selected + 'T12:00:00');
      form.hidden = true;
      notify('日程已保存');
      showQueuedDraft();
      await loadCalendar();
    })();
  };
  document.querySelectorAll('[data-calendar-view]').forEach(
    (button) =>
      (button.onclick = () => {
        calendarView = button.dataset.calendarView;
        document.querySelectorAll('[data-calendar-view]').forEach((b) => {
          b.classList.toggle('is-active', b === button);
          b.setAttribute('aria-pressed', String(b === button));
        });
        calendar();
      })
  );
  for (const id of ['calendar-search', 'calendar-category', 'calendar-hide-done'])
    $(id).addEventListener(id === 'calendar-search' ? 'input' : 'change', calendar);
  $('calendar-export').onclick = safe(async () => {
    const result = await api.calendarExport();
    if (result.canceled) return;
    await checked(Promise.resolve(result));
    notify('日历已导出');
  });
  function preview() {
    clearTimeout(previewTimer);
    const text = editor.value;
    if (renderedText === text) return;
    const id = current;
    const external = Boolean(docs.find((doc) => doc.id === id)?.meta?.externalPath);
    const showImages = external && ['split', 'preview'].includes($('md-split').dataset.view);
    const { html, headings, images } = window.SuiraMarkdown.renderWithOutline(text, {
      localImages: external
    });
    const change = ++previewRevision;
    // Keep decoded images in this preview only. Text edits should not reread
    // unchanged files or retain attachments from a previously opened document.
    const existing =
      showImages && imagePreviewDocument === id
        ? new Map(
            [...previewPane.querySelectorAll('img[data-md-image-url]')].map((image) => [
              image.dataset.mdImageUrl,
              image
            ])
          )
        : new Map();
    imagePreviewDocument = showImages ? id : null;
    const scroll = previewPane.scrollTop;
    previewPane.innerHTML = html;
    if (showImages && images.length) {
      const referenced = new Set(images);
      for (const placeholder of previewPane.querySelectorAll('[data-md-local-image]')) {
        const url = placeholder.dataset.mdLocalImage;
        if (!referenced.has(url) || !existing.has(url)) continue;
        const image = existing.get(url).cloneNode(false);
        image.alt = placeholder.textContent;
        placeholder.replaceWith(image);
      }
      const missing = images.filter((url) => !existing.has(url));
      if (missing.length) queuePreviewImages(id, missing, change);
    }
    renderedText = text;
    sourceHeadingPositions = null;
    renderOutline(headings);
    previewPane.scrollTop = scroll;
    ignorePreviewScroll = previewPane.scrollTop;
    syncScroll(editor);
    const mins = window.SuiraSlides?.readingMinutes?.(text) || 0;
    const minLabel = mins ? ` · 约 ${mins} 分钟` : '';
    $('md-words').textContent = `${text.length.toLocaleString()} 字符 · ${text.split('\n').length} 行${minLabel}`;
    updateActiveHeading();
  }
  function queuePreviewImages(id, images, change) {
    queuedImagePreview = { id, images, change };
    if (imageRequest) return;
    imageRequest = (async () => {
      while (queuedImagePreview) {
        const request = queuedImagePreview;
        queuedImagePreview = null;
        if (request.id !== current || request.change !== previewRevision) continue;
        const loaded = await api.previewImages(request.id, request.images).catch(() => []);
        if (
          request.id !== current ||
          request.change !== previewRevision ||
          !['split', 'preview'].includes($('md-split').dataset.view)
        )
          continue;
        const byUrl = new Map(loaded.map(({ url, data }) => [url, data]));
        for (const placeholder of previewPane.querySelectorAll('[data-md-local-image]')) {
          const data = byUrl.get(placeholder.dataset.mdLocalImage);
          if (!data) continue;
          const image = document.createElement('img');
          image.alt = placeholder.textContent;
          image.dataset.mdImageUrl = placeholder.dataset.mdLocalImage;
          image.loading = 'lazy';
          image.decoding = 'async';
          image.src = data;
          placeholder.replaceWith(image);
        }
      }
    })().finally(() => {
      imageRequest = null;
    });
  }
  previewPane.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    event.preventDefault();
    const url = link.getAttribute('href');
    if (/^(?:https?:\/\/|suira-image:\/\/[-\w]+$)/i.test(url)) safe(() => checked(api.openLink(url)))();
  });
  function docList({ revealActive = false } = {}) {
    if (documentLayout) {
      const folders = new Map();
      for (const dir of mountedFolders) {
        const clean = normFolder(dir);
        if (clean && !folders.has(clean.toLowerCase())) folders.set(clean.toLowerCase(), clean);
      }
      for (const doc of docs) {
        const folder = documentFolder(doc);
        if (folder && !folders.has(folder.toLowerCase())) folders.set(folder.toLowerCase(), folder);
      }
      const locations = [
        { id: 'all', label: '全部', icon: 'library' },
        { id: 'recent', label: '最近打开', icon: 'recent' },
        { id: 'local', label: '随序文档', icon: 'files' },
        ...[...folders]
          .sort((a, b) => a[1].localeCompare(b[1], 'zh-CN'))
          .map(([key, folder]) => ({
            id: 'folder:' + key,
            label: folder.split('/').at(-1) || folder,
            title: folder
          }))
      ];
      if (!locations.some((item) => item.id === documentLocation)) documentLocation = 'all';
      const key = JSON.stringify([locations, documentLocation]);
      if (key !== locationsKey) {
        window.SuiraMarkdownLayout.renderLocations(
          documentLayout.sections,
          locations,
          documentLocation,
          switchDocumentLocation
        );
        locationsKey = key;
      }
      syncFolderControls();
    }
    const query = $('md-search').value.trim().toLowerCase();
    const visible = docs.filter((doc) => {
      if (documentLocation === 'recent' && doc.meta?.recentHidden) return false;
      if (documentLocation === 'local' && doc.meta?.externalPath) return false;
      if (documentLocation.startsWith('folder:')) {
        const target = documentLocation.slice(7);
        const docDir = documentFolder(doc).toLowerCase();
        if (docDir !== target && !docDir.startsWith(target + '/')) return false;
      }
      return !query || doc.title.toLowerCase().includes(query) || doc.text.toLowerCase().includes(query);
    });
    const list = $('md-list');
    const previousFocus = list.contains(document.activeElement) ? document.activeElement : null;
    const previousScroll = list.scrollTop;
    list.innerHTML =
      visible
        .map((doc) => {
          const active = doc.id === current;
          return `<div class="md-list-item"><button type="button" class="document-row mia-row${active ? ' is-active' : ''}" data-document="${esc(doc.id)}" aria-current="${active}" title="${esc(doc.meta?.externalPath || doc.title)}">` +
            `<b>${esc(doc.title)}</b><time datetime="${new Date(doc.updatedAt).toISOString()}">${documentDate.format(doc.updatedAt)}</time>` +
            `</button><button type="button" class="md-row-delete" data-delete-doc="${esc(doc.id)}" aria-label="${esc((doc.meta?.externalPath ? '移除记录：' : '删除：') + doc.title)}" title="${doc.meta?.externalPath ? '移除记录' : '删除文档'}">` +
            `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 3v7m4-7v7"/>` +
            `</svg></button></div>`;
        })
        .join('') || `<div class="workspace-empty">${query ? '没有匹配的文档' : '这里还没有文档'}</div>`;
    list.scrollTop = previousScroll;
    for (const button of list.querySelectorAll('[data-document]')) {
      button.onclick = safe(() => selectDoc(button.dataset.document));
      if (button.dataset.document === previousFocus?.dataset.document && !narrowDocumentLayout())
        button.focus({ preventScroll: true });
    }
    for (const button of list.querySelectorAll('[data-delete-doc]')) {
      button.onclick = safe(() => deleteDocument(button.dataset.deleteDoc));
      if (button.dataset.deleteDoc === previousFocus?.dataset.deleteDoc)
        button.focus({ preventScroll: true });
    }
    if (revealActive) list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }
  function flush() {
    if (!saveInFlight)
      saveInFlight = saveDocument().finally(() => {
        saveInFlight = null;
      });
    return saveInFlight;
  }
  async function saveDocument() {
    clearTimeout(timer);
    await richDocument?.commit();
    clearTimeout(timer);
    const documentId = current;
    // A switch/close must also wait for edits made while the first snapshot saves.
    while (documentId && current === documentId && revision !== savedRevision) {
      const id = current,
        version = revision,
        payload = {
          id,
          title: $('md-title').value.trim() || '未命名文档',
          text: $('md-editor').value,
          ...(editor._baseExternalHash ? { baseExternalHash: editor._baseExternalHash } : {})
        };
      $('md-status').textContent = '保存中…';
      try {
        const { item } = await checked(api.save('markdown', payload));
        const index = docs.findIndex((doc) => doc.id === id);
        if (index >= 0) docs[index] = item;
        if (current === id) {
          documentIdentity(item);
          docList();
          savedRevision = version;
          $('md-status').textContent = revision === savedRevision ? savedLabel(item) : '有未保存的修改';
        }
      } catch (error) {
        if (current === id) $('md-status').textContent = '保存失败，请重试';
        throw error;
      }
      if (current !== documentId) break;
      clearTimeout(timer);
      await richDocument?.commit();
      clearTimeout(timer);
    }
  }
  async function selectDoc(id) {
    await flush();
    const item = docs.find((doc) => doc.id === id);
    if (item?.meta?.recentHidden) {
      await checked(api.recent('open', item.id));
      item.meta.recentHidden = false;
      await flush();
    }
    clearTimeout(previewTimer);
    closeDocumentFind(false);
    if (typeof closePpt === 'function') closePpt();
    richDocument?.destroy();
    richDocument = null;
    richText = '';
    richKey = '';
    foldedHeadings.clear();
    renderedText = null;
    viewRevision++;
    current = item?.id || '';
    previewRevision++;
    api.activeDocument?.(current);
    revision = savedRevision = 0;
    if (!current) setWritingFocus(false);
    if (item) documentLayout?.shell.classList.remove('mia-notes-only');
    $('md-body').hidden = !item;
    $('md-empty').hidden = Boolean(item);
    if (item) {
      $('md-title').value = item.title;
      editor.value = item.text;
      editor._baseExternalHash = item.meta?.externalHash || '';
      $('md-status').textContent = item.meta?.externalPath ? '本地文件；Ctrl+S 保存到原位置' : '已保存';
      editor.scrollTop = 0;
      previewPane.scrollTop = 0;
      setDocumentView(requestedView, true);
    } else {
      editor.value = '';
      editor._baseExternalHash = '';
      previewPane.replaceChildren();
      $('md-outline').replaceChildren();
      outlineItems = [];
      sourceHeadingPositions = null;
    }
    documentIdentity(item);
    for (const button of ['md-save', 'md-export', 'md-export-format', 'md-delete', 'md-ppt-toggle', 'md-pangu-menu', 'md-ppt-menu']) {
      if ($(button)) $(button).disabled = !item;
    }
    docList({ revealActive: true });
    syncDocumentNavigation();
  }
  async function loadDocs() {
    await flush();
    mountedFolders = (await api.folders?.().catch(() => [])) || [];
    docs = await api.list('markdown');
    const opened = await api.openedFile?.();
    await selectDoc(
      opened ||
        (docs.some((doc) => doc.id === current) ? current : docs.find((doc) => !doc.meta?.recentHidden)?.id)
    );
  }
  function dirty(updatePreview = true) {
    revision++;
    if (updatePreview) sourceHighlight?.schedule();
    $('md-status').textContent = '未保存';
    if (updatePreview) {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(preview, 120);
    }
    clearTimeout(timer);
    timer = setTimeout(() => flush().catch((error) => notify(error.message)), 400);
  }
  editor.oninput = () => dirty();
  $('md-title').oninput = () => dirty(false);
  $('md-search').oninput = () => docList();
  async function openLocalFolder(refresh = false) {
    await flush();
    const refreshDocId = refresh ? current : '';
    const revBefore = revision;
    const hashBefore = editor._baseExternalHash || '';
    const folder = refresh ? activeLocalFolder() : '';
    const result = await api.openFolder(refresh ? { refresh: true, folder } : undefined);
    if (result?.canceled) return;
    await checked(Promise.resolve(result));
    mountedFolders = Array.isArray(result.folders) ? result.folders : mountedFolders;
    docs = await api.list('markdown');
    const folderKey = 'folder:' + normFolder(result.folder).toLowerCase();
    documentLocation = folderKey;
    $('md-search').value = '';
    const targetPrefix = folderKey.slice(7);
    const first =
      result.items?.[0]?.id ||
      docs.find((d) => {
        const dir = documentFolder(d).toLowerCase();
        return dir === targetPrefix || dir.startsWith(targetPrefix + '/');
      })?.id;
    const reloadedCurrent = refreshDocId ? docs.find((d) => d.id === refreshDocId) : null;
    const refreshedCurrent = refreshDocId ? (result.items || []).find((d) => d.id === refreshDocId) : null;
    const diskHashAfterRefresh =
      result.diskHashes?.[refreshDocId] || refreshedCurrent?.meta?.externalHash || reloadedCurrent?.meta?.externalHash || '';
    if (refresh && refreshDocId) {
      if (current !== refreshDocId) {
        docList({ revealActive: true });
      } else if (!reloadedCurrent) {
        await selectDoc(first || '');
      } else if (revision !== revBefore) {
        editor._baseExternalHash = hashBefore;
        docList({ revealActive: true });
        if (diskHashAfterRefresh !== hashBefore) {
          notify('磁盘文件已被外部修改，已保留当前输入；保存前请先核对或导出');
          return;
        }
      } else if (
        reloadedCurrent.text !== editor.value ||
        reloadedCurrent.title !== $('md-title').value ||
        diskHashAfterRefresh !== hashBefore
      ) {
        await selectDoc(current);
      } else {
        docList({ revealActive: true });
      }
    } else if (first) {
      await selectDoc(first);
    } else {
      docList({ revealActive: true });
    }
    const skipHint = result.skipped ? `，跳过 ${result.skipped} 个不兼容文件` : '';
    notify(result.opened ? `已加载 ${result.opened} 篇本地文档${skipHint}` : '已挂载空文件夹，点击新建即可直接落盘 .md');
  }
  $('md-new').onclick = safe(async () => {
    await flush();
    const localDir = activeLocalFolder();
    let result;
    if (localDir && api.createInFolder) {
      result = await checked(api.createInFolder({ folder: localDir, title: '未命名文档' }));
      docs = [result.item, ...docs.filter((d) => d.id !== result.item.id)];
    } else {
      result = await checked(api.save('markdown', { title: '未命名文档', text: '# 新的想法\n\n' }));
      docs.unshift(result.item);
      if (documentLocation.startsWith('folder:')) documentLocation = 'local';
    }
    $('md-search').value = '';
    await selectDoc(result.item.id);
    $('md-title').focus();
    $('md-title').select();
  });
  $('md-import').onclick = safe(async () => {
    await flush();
    const result = await api.import();
    if (result.canceled) return;
    await checked(Promise.resolve(result));
    docs = [result.item, ...docs.filter((item) => item.id !== result.item.id)];
    if (documentLocation !== 'all' && documentLocation !== 'recent')
      documentLocation = 'folder:' + documentFolder(result.item).toLowerCase();
    $('md-search').value = '';
    await selectDoc(result.item.id);
    if (result.recovered) notify('已恢复尚未写回原文件的草稿，请检查后再保存');
  });
  $('md-export').onclick = safe(async () => {
    await flush();
    const result = await api.export(current, $('md-export-format').value);
    if (result.canceled) return;
    await checked(Promise.resolve(result));
    notify('文档已导出');
  });
  async function deleteDocument(id) {
    const item = docs.find((doc) => doc.id === id);
    const dialog = $('md-delete-dialog');
    if (!item || dialog.open || deletingDocument) return;
    deletingDocument = true;
    try {
      const external = Boolean(item.meta?.externalPath);
      const action = external ? '移除记录' : '删除文档';
      $('md-delete-title').textContent = action;
      $('md-delete-detail').textContent = external
        ? '「' + item.title + '」将从随序中移除。磁盘上的原文件会保留，尚未写回的随序草稿会一并移除。'
        : '「' + item.title + '」将从随序中删除，删除后无法恢复。';
      $('md-delete-confirm').textContent = action;
      dialog.returnValue = '';
      const confirm = $('md-delete-confirm');
      const decision = new Promise((resolve) => {
        const accept = (event) => {
          event.preventDefault();
          resolve(true);
        };
        confirm.addEventListener('click', accept, { once: true });
        dialog.addEventListener(
          'close',
          () => {
            confirm.removeEventListener('click', accept);
            resolve(false);
          },
          { once: true }
        );
      });
      dialog.showModal();
      if (!(await decision)) return;
      // Keep the editor inert until its pending save and the removal complete.
      $('md-delete-confirm').disabled = $('md-delete-cancel').disabled = true;
      await flush();
      const rows = [...$('md-list').querySelectorAll('[data-document]')].map((row) => row.dataset.document);
      const index = rows.indexOf(id);
      const next = index < 0 ? undefined : rows[index + 1] || rows[index - 1];
      await checked(api.remove('markdown', id));
      docs = docs.filter((doc) => doc.id !== id);
      if (current === id) await selectDoc(next);
      else docList();
      dialog.close();
      const nextRow = [...$('md-list').querySelectorAll('[data-document]')].find(
        (row) => row.dataset.document === next
      );
      const search = $('md-search');
      const focusTarget = nextRow?.checkVisibility()
        ? nextRow
        : search.checkVisibility()
          ? search
          : current
            ? $('md-title')
            : $('md-new');
      focusTarget.focus({ preventScroll: true });
      notify(external ? '已从随序移除记录' : '文档已删除');
    } finally {
      if (dialog.open) dialog.close();
      $('md-delete-confirm').disabled = $('md-delete-cancel').disabled = false;
      deletingDocument = false;
    }
  }
  let deletingDocument = false;
  $('md-delete-dialog').addEventListener('cancel', (event) => {
    if ($('md-delete-confirm').disabled) event.preventDefault();
  });
  $('md-delete').onclick = safe(() => deleteDocument(current));
  function supportsVisualEditing(text) {
    if (/^---\r?\n[\s\S]*?\n---(?:\r?\n|$)/.test(text) || /(?:^|\n)\[\^[^\]]+\]:/.test(text)) return false;
    let safe = true;
    const walk = (tokens) => {
      for (const token of tokens || []) {
        if (token.type === 'image' && window.SuiraLocalImage?.localImageReference(token.href)) safe = false;
        if (token.type === 'html') {
          const tags = (token.raw || token.text || '').match(/<[^>]*>/g) || [];
          if (
            !tags.length ||
            tags.some(
              (tag) =>
                !/^<\/?(?:span|u|br)\b[^>]*>$/i.test(tag) || /\bon\w+\s*=|\b(?:src|href)\s*=/i.test(tag)
            )
          )
            safe = false;
          for (const tag of tags.filter((tag) => /^<span\b/i.test(tag))) {
            const template = document.createElement('template');
            template.innerHTML = tag + '</span>';
            const span = template.content.querySelector('span');
            if (!span || [...span.attributes].some((a) => a.name !== 'style')) {
              safe = false;
              continue;
            }
            for (const property of span.style)
              if (!['color', 'background-color', 'font-size'].includes(property)) safe = false;
            if (
              span.style.fontSize &&
              !['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px'].includes(span.style.fontSize)
            )
              safe = false;
          }
        }
        if (token.tokens) walk(token.tokens);
        for (const item of token.items || []) walk(item.tokens);
      }
    };
    walk(window.marked.lexer(text, { gfm: true }));
    return safe;
  }
  function syncRichDocument() {
    if (!current || $('md-split').dataset.view !== 'write') return;
    const text = $('md-editor').value;
    if (!supportsVisualEditing(text)) {
      setDocumentView('edit', true);
      notify('这篇文档包含扩展语法，已保留完整源码供编辑');
      return;
    }
    if (richDocument && richText !== text) {
      richDocument.destroy();
      richDocument = null;
    }
    if (!richDocument) {
      const boundDocId = current;
      richDocument = window.SuiraRichDocument.create({
        element: $('md-rich'),
        notify,
        onChange: (value) => {
          richText = value;
          $('md-editor').value = value;
          dirty();
        },
        onSelection: () => updateActiveHeading(),
        openLink: (url) => safe(() => checked(api.openLink(url)))(),
        readClipboard: () => checked(api.clipboard()),
        pasteImage: (opts) => pasteImageToDocument(null, opts?.dataUrl || '', opts?.alt || '图片', { visual: true, docId: boundDocId }),
        formatPangu: () => formatDocumentPangu(),
        capture: async (kind) => {
          const id = current;
          await flush();
          const result = await api.capture({ kind });
          if (current !== id) throw Error('当前文档已切换，未插入截图');
          return result;
        }
      });
      richKey = current;
    }
    if (richText !== text || richKey !== current) {
      richDocument.load(text);
      richText = text;
      richKey = current;
    }
  }
  function loadVisualBundle() {
    if (!visualBundle)
      visualBundle = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'vendor/document-editor.js';
        script.onload = () =>
          window.SuiraRichDocument ? resolve() : reject(Error('可视化编辑器初始化失败'));
        script.onerror = () => reject(Error('无法加载可视化编辑器'));
        document.head.append(script);
      }).catch((error) => {
        visualBundle = null;
        throw error;
      });
    return visualBundle;
  }
  function setDocumentView(view, automatic = false) {
    const change = ++viewRevision;
    sourceDocument?.close();
    richDocument?.closeMenu();
    if (!automatic) {
      requestedView = view;
      localStorage.setItem(viewStorageKey, view);
    }
    // 扩展语法只对当前文档使用源码，不改用户为其他文档选的视图。
    if (view === 'write' && current && !supportsVisualEditing(editor.value)) {
      view = 'edit';
      if (!automatic) notify('这篇文档包含扩展语法，使用源码模式可保持内容完整');
    }
    if (view === 'write' && current && !window.SuiraRichDocument) {
      const id = current;
      loadVisualBundle()
        .then(() => {
          if (current === id && change === viewRevision) setDocumentView('write', true);
        })
        .catch((error) => {
          if (change === viewRevision) notify(error.message);
        });
      view = 'edit';
    }
    const isPreview = (mode) => mode === 'split' || mode === 'preview';
    if (
      isPreview(view) !== isPreview($('md-split').dataset.view) &&
      docs.find((doc) => doc.id === current)?.meta?.externalPath
    )
      renderedText = null;
    $('md-split').dataset.view = view;
    const format = $('md-format-toggle');
    if (format) {
      format.hidden = view === 'preview';
      if (format.hidden && format.getAttribute('aria-expanded') === 'true') format.click();
    }
    document.querySelectorAll('[data-md-view]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.mdView === view);
      b.setAttribute('aria-pressed', String(b.dataset.mdView === view));
    });
    $('md-sync-scroll').closest('label').hidden = view !== 'split';
    if (!current) return;
    sourceHighlight?.refresh();
    if (view === 'write') syncRichDocument();
    else if (richDocument) {
      richDocument.destroy();
      richDocument = null;
      richText = '';
      richKey = '';
    }
    preview();
    if (view === 'split') syncScroll(editor);
    updateActiveHeading();
  }
  function syncDocumentNavigation() {
    const isOpen = Boolean(current);
    const showOutline = isOpen && !outlineCollapsed;
    if ($('md-focus-toggle')) $('md-focus-toggle').disabled = !isOpen;
    $('md-search').hidden = showOutline;
    $('md-list').hidden = showOutline;
    if (documentLayout) {
      documentLayout.listHead.hidden = showOutline;
      $('md-outline-head').hidden = !showOutline;
    }
    $('md-outline').hidden = !showOutline;
    const outline = $('md-outline-toggle');
    if (outline) {
      outline.disabled = !isOpen;
      outline.setAttribute('aria-expanded', String(showOutline));
      outline.title = showOutline ? '收起目录' : '展开目录';
      outline.setAttribute('aria-label', outline.title);
    }
  }
  function toggleOutline() {
    outlineCollapsed = !outlineCollapsed;
    if (documentLayout && narrowDocumentLayout()) documentLayout.shell.classList.add('mia-notes-only');
    syncDocumentNavigation();
  }
  function renderOutline(headings) {
    const counts = new Map();
    outlineItems = [...previewPane.querySelectorAll('[data-md-heading]')].flatMap((node) => {
      const heading = headings[Number(node.dataset.mdHeading)];
      if (!heading || node.tagName !== 'H' + heading.level) return [];
      const text = node.textContent;
      const base = heading.level + ':' + text;
      const occurrence = (counts.get(base) || 0) + 1;
      counts.set(base, occurrence);
      return [{ ...heading, text, key: base + ':' + occurrence, node }];
    });
    const root = [],
      stack = [];
    outlineItems.forEach((h, index) => {
      const entry = { ...h, index, children: [] };
      while (stack.length && stack.at(-1).level >= h.level) stack.pop();
      (stack.at(-1)?.children || root).push(entry);
      stack.push(entry);
    });
    const render = (entries) =>
      entries
        .map(
          (h) =>
            `<div class="md-toc-branch" data-outline-key="${esc(h.key)}"><div class="md-toc-row">` +
              `<button type="button" class="md-toc-fold" data-fold="${h.index}" aria-label="${foldedHeadings.has(h.key) ? '展开' : '折叠'} ${esc(h.text)}" aria-expanded="${!foldedHeadings.has(h.key)}" ${h.children.length ? '' : 'disabled'}>` +
              `<svg viewBox="0 0 16 16"><path d="m6 4 4 4-4 4"/></svg></button><button type="button" data-heading="${h.index}" title="${esc(h.text)}">${esc(h.text || '未命名标题')}</button>` +
              `</div>${h.children.length ? `<div class="md-toc-children" ${foldedHeadings.has(h.key) ? 'hidden' : ''}>${render(h.children)}</div>` : ''}</div>`
        )
        .join('');
    $('md-outline').innerHTML = root.length
      ? render(root)
      : '<p class="md-toc-empty">添加标题后，目录会显示在这里</p>';
    $('md-outline')
      .querySelectorAll('[data-heading]')
      .forEach((button) => (button.onclick = () => jumpToHeading(+button.dataset.heading)));
    $('md-outline')
      .querySelectorAll('[data-fold]')
      .forEach(
        (button) =>
          (button.onclick = () => {
            const h = outlineItems[+button.dataset.fold],
              children = button.closest('.md-toc-branch').querySelector(':scope>.md-toc-children');
            if (!children) return;
            children.hidden = !children.hidden;
            if (children.hidden) foldedHeadings.add(h.key);
            else foldedHeadings.delete(h.key);
            button.setAttribute('aria-expanded', String(!children.hidden));
            button.setAttribute('aria-label', (children.hidden ? '展开 ' : '折叠 ') + h.text);
          })
      );
    syncDocumentNavigation();
    updateActiveHeading();
  }
  function jumpToHeading(index) {
    const heading = outlineItems[index];
    if (!heading) return;
    const view = $('md-split').dataset.view;
    if (view === 'write' && richDocument) richDocument.jump(index);
    else if (view === 'preview') heading.node.scrollIntoView({ block: 'start' });
    else {
      editor.focus();
      editor.setSelectionRange(heading.offset, heading.offset);
      editor.scrollTop = Math.max(0, positionsInEditor()[index] - 24);
      if (view === 'split') {
        previewPane.scrollTop = previewHeadingPosition(heading);
        ignorePreviewScroll = previewPane.scrollTop;
        ignoreEditorScroll = editor.scrollTop;
      }
    }
    activeHeading = index;
    markActiveHeading();
    if (documentLayout && narrowDocumentLayout()) {
      documentLayout.shell.classList.remove('mia-notes-only');
      if (view === 'edit' || view === 'split') editor.focus({ preventScroll: true });
    }
  }
  function markActiveHeading() {
    for (const b of $('md-outline').querySelectorAll('[data-heading]')) {
      const active = +b.dataset.heading === activeHeading;
      b.classList.toggle('is-active', active);
      if (active) b.setAttribute('aria-current', 'location');
      else b.removeAttribute('aria-current');
    }
  }
  function updateActiveHeading() {
    if (!outlineItems.length) return;
    const view = $('md-split').dataset.view;
    if (view === 'write' && richDocument) {
      const heads = richDocument.headings(),
        cursor = richDocument.selection().from;
      activeHeading = Math.max(
        0,
        heads.findLastIndex((h) => h.pos < cursor)
      );
    } else if (view === 'edit' || view === 'split')
      activeHeading = Math.max(
        0,
        outlineItems.findLastIndex((h) => h.offset <= $('md-editor').selectionStart)
      );
    else {
      const top = $('md-preview').getBoundingClientRect().top + 32;
      activeHeading = Math.max(
        0,
        outlineItems.findLastIndex((h) => h.node.getBoundingClientRect().top <= top)
      );
    }
    markActiveHeading();
  }
  document.querySelectorAll('[data-md-view]').forEach((button) => {
    button.onclick = () => setDocumentView(button.dataset.mdView);
  });
  const findBar = document.createElement('div');
  findBar.id = 'md-find';
  findBar.hidden = true;
  findBar.innerHTML =
    '<input id="md-find-query" type="search" maxlength="200" placeholder="查找正文" aria-label="查找当前 Markdown 正文"><span id="md-find-count" role="status" aria-live="polite">0 / 0</span><button id="md-find-prev" title="上一个 · Shift+Enter" aria-label="上一个匹配">↑</button><button id="md-find-next" title="下一个 · Enter" aria-label="下一个匹配">↓</button><button id="md-find-close" title="关闭查找 · Esc" aria-label="关闭文内查找">×</button>';
  document.querySelector('.markdown-toolbar').after(findBar);
  const findToggle = document.createElement('button');
  findToggle.id = 'md-find-toggle';
  findToggle.className = 'quiet-btn';
  findToggle.textContent = '查找';
  findToggle.title = '查找正文 · Ctrl+F';
  document.querySelector('.markdown-toolbar .view-switch').before(findToggle);
  let findMatches = [],
    findIndex = 0,
    findTimer,
    lastFindQuery = '',
    lastFindText = '';
  function closeDocumentFind(focus = true) {
    clearTimeout(findTimer);
    findBar.hidden = true;
    findMatches = [];
    findIndex = 0;
    if (focus) $('md-editor').focus();
  }
  function revealFindMatch() {
    const match = findMatches[findIndex];
    if (!match) return;
    if (['preview', 'write'].includes($('md-split').dataset.view)) setDocumentView('edit', true);
    const editor = $('md-editor');
    editor.setSelectionRange(match.start, match.end);
    const style = getComputedStyle(editor),
      mirror = document.createElement('div'),
      marker = document.createElement('span');
    Object.assign(mirror.style, {
      position: 'fixed',
      left: '-10000px',
      top: '0',
      visibility: 'hidden',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'break-word',
      width: editor.clientWidth + 'px',
      boxSizing: 'border-box',
      font: style.font,
      padding: style.padding,
      tabSize: style.tabSize,
      letterSpacing: style.letterSpacing
    });
    mirror.textContent = editor.value.slice(0, match.start);
    marker.textContent = editor.value.slice(match.start, match.end) || ' ';
    mirror.append(marker);
    document.body.append(mirror);
    editor.scrollTop = Math.max(0, marker.offsetTop - editor.clientHeight / 3);
    mirror.remove();
  }
  function refreshDocumentFind(reveal = true) {
    clearTimeout(findTimer);
    if (findBar.hidden) return;
    findMatches = [];
    findIndex = 0;
    const query = $('md-find-query').value,
      slash = String.fromCharCode(92);
    lastFindQuery = query;
    lastFindText = $('md-editor').value;
    if (query) {
      const pattern = [...query]
        .map((char) => ((slash + '^$.*+?()[]{}|').includes(char) ? slash + char : char))
        .join('');
      for (const match of $('md-editor').value.matchAll(new RegExp(pattern, 'giu'))) {
        findMatches.push({ start: match.index, end: match.index + match[0].length });
        if (findMatches.length === 10000) break;
      }
    }
    $('md-find-count').textContent =
      (findMatches.length ? 1 : 0) + ' / ' + findMatches.length + (findMatches.length === 10000 ? '+' : '');
    $('md-find-prev').disabled = $('md-find-next').disabled = !findMatches.length;
    if (reveal) revealFindMatch();
  }
  function nextFindMatch(step) {
    if (lastFindQuery !== $('md-find-query').value || lastFindText !== $('md-editor').value) {
      refreshDocumentFind();
      return;
    }
    if (!findMatches.length) return;
    findIndex = (findIndex + step + findMatches.length) % findMatches.length;
    $('md-find-count').textContent = findIndex + 1 + ' / ' + findMatches.length;
    revealFindMatch();
  }
  function openDocumentFind() {
    if (!current) return;
    findBar.hidden = false;
    refreshDocumentFind();
    $('md-find-query').focus();
    $('md-find-query').select();
  }
  findToggle.onclick = openDocumentFind;
  $('md-find-close').onclick = () => closeDocumentFind();
  $('md-find-prev').onclick = () => nextFindMatch(-1);
  $('md-find-next').onclick = () => nextFindMatch(1);
  $('md-find-query').oninput = () => {
    clearTimeout(findTimer);
    findTimer = setTimeout(refreshDocumentFind, 100);
  };
  const updateFindAfterEditing = (event) => {
    if (!findBar.hidden) {
      clearTimeout(findTimer);
      if (!event.isComposing) findTimer = setTimeout(() => refreshDocumentFind(false), 150);
    }
  };
  $('md-editor').addEventListener('input', updateFindAfterEditing);
  $('md-editor').addEventListener('compositionend', updateFindAfterEditing);
  document.addEventListener('keydown', (event) => {
    if (
      $('md-delete-dialog').open ||
      event.isComposing ||
      !document.querySelector('#page-markdown.is-active')
    )
      return;
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'f' && current) {
      event.preventDefault();
      openDocumentFind();
    } else if (!findBar.hidden && event.key === 'Escape') {
      event.preventDefault();
      closeDocumentFind();
    } else if (event.target === $('md-find-query') && event.key === 'Enter') {
      event.preventDefault();
      clearTimeout(findTimer);
      nextFindMatch(event.shiftKey ? -1 : 1);
    }
  });
  const savedLabel = (item) => (item?.meta?.externalPath ? '草稿已保存到随序；Ctrl+S 写回原文件' : '已保存');
  async function saveCurrentFile() {
    const id = current;
    await flush();
    if (current !== id) return;
    const item = docs.find((d) => d.id === id),
      version = revision;
    if (item?.meta?.externalPath) {
      const result = await checked(api.saveFile(id)),
        index = docs.findIndex((d) => d.id === id);
      // Only the original-file metadata changed; keep any newer local draft.
      if (index >= 0) docs[index] = { ...docs[index], meta: { ...docs[index].meta, ...result.item.meta } };
      if (current === id) {
        editor._baseExternalHash = result.item.meta?.externalHash || '';
        if (revision === version) $('md-status').textContent = '已写回原文件';
      }
      notify('已保存到 ' + result.item.meta.externalPath);
    } else notify('已保存在随序');
  }
  $('md-save').onclick = safe(saveCurrentFile);
  api.onFileOpened?.(
    safe(async (payload) => {
      await flush();
      docs = await api.list('markdown');
      await selectDoc(payload.id);
      if (payload.recovered) notify('已恢复尚未写回原文件的草稿，请检查后再保存');
    })
  );
  function positionsInEditor() {
    const width = editor.clientWidth;
    if (sourceHeadingPositions?.width === width) return sourceHeadingPositions.positions;
    const style = getComputedStyle(editor);
    const mirror = document.createElement('div');
    Object.assign(mirror.style, {
      position: 'fixed',
      left: '-10000px',
      top: '0',
      visibility: 'hidden',
      width: `${width}px`,
      boxSizing: 'border-box',
      font: style.font,
      lineHeight: style.lineHeight,
      padding: style.padding,
      letterSpacing: style.letterSpacing,
      tabSize: style.tabSize,
      whiteSpace: 'pre-wrap',
      overflowWrap: 'break-word'
    });
    const markers = [];
    let offset = 0;
    for (const heading of outlineItems) {
      mirror.append(renderedText.slice(offset, heading.offset));
      const marker = document.createElement('span');
      mirror.append(marker);
      markers.push(marker);
      offset = heading.offset;
    }
    mirror.append(renderedText.slice(offset));
    document.body.append(mirror);
    const positions = markers.map((marker) => marker.offsetTop);
    mirror.remove();
    sourceHeadingPositions = { width, positions };
    return positions;
  }
  function previewHeadingPosition(heading) {
    return (
      heading.node.getBoundingClientRect().top -
      previewPane.getBoundingClientRect().top +
      previewPane.scrollTop
    );
  }
  function syncScroll(source) {
    if (
      !$('md-sync-scroll').checked ||
      $('md-split').dataset.view !== 'split' ||
      renderedText !== editor.value
    )
      return;
    const fromEditor = source === editor;
    const target = fromEditor ? previewPane : editor;
    const sourceMax = Math.max(0, source.scrollHeight - source.clientHeight);
    const targetMax = Math.max(0, target.scrollHeight - target.clientHeight);
    if (!sourceMax || !targetMax) return;
    const sourcePositions = positionsInEditor();
    const anchors = [[0, 0]];
    outlineItems.forEach((heading, index) => {
      const sourceTop = sourcePositions[index] - 24;
      const previewTop = previewHeadingPosition(heading) - 24;
      const pair = fromEditor ? [sourceTop, previewTop] : [previewTop, sourceTop];
      const previous = anchors.at(-1);
      if (pair[0] > previous[0] && pair[1] > previous[1] && pair[0] < sourceMax && pair[1] < targetMax)
        anchors.push(pair);
    });
    anchors.push([sourceMax, targetMax]);
    const top = Math.min(sourceMax, Math.max(0, source.scrollTop));
    const index = Math.max(
      1,
      anchors.findIndex(([at]) => at >= top)
    );
    const [from, targetFrom] = anchors[index - 1];
    const [to, targetTo] = anchors[index];
    const next = targetFrom + ((top - from) / (to - from)) * (targetTo - targetFrom);
    target.scrollTop = next;
    if (fromEditor) ignorePreviewScroll = target.scrollTop;
    else ignoreEditorScroll = target.scrollTop;
  }
  editor.addEventListener('scroll', () => {
    if (editor.scrollTop !== ignoreEditorScroll) syncScroll(editor);
    ignoreEditorScroll = null;
  });
  previewPane.addEventListener('scroll', () => {
    if (previewPane.scrollTop !== ignorePreviewScroll) syncScroll(previewPane);
    ignorePreviewScroll = null;
    updateActiveHeading();
  });
  $('md-sync-scroll').addEventListener('change', () => syncScroll(editor));
  $('md-editor').addEventListener('click', updateActiveHeading);
  $('md-editor').addEventListener('keyup', updateActiveHeading);
  function replaceEditorRange(text, from, to) {
    if ($('md-split').dataset.view === 'preview' || $('md-split').dataset.view === 'write') {
      setDocumentView('edit', true);
    }
    const scroll = editor.scrollTop;
    editor.focus();
    editor.setSelectionRange(from, to);
    const prev = editor.value;
    if (!document.execCommand('insertText', false, text)) {
      editor.setRangeText(text, from, to, 'end');
      dirty();
    } else if (editor.value === prev) {
      dirty();
    }
    editor.scrollTop = scroll;
  }
  function formatDocumentPangu() {
    if (!current) return false;
    const inVisual = $('md-split').dataset.view === 'write' && richDocument;
    const before = inVisual ? richDocument.getMarkdown() : editor.value;
    const after = window.SuiraTextSpacing?.panguMarkdown?.(before);
    if (!after || after === before) {
      notify('中英文间距已整洁，无需调整');
      return false;
    }
    if (inVisual) {
      richDocument.replaceMarkdown(after);
      notify('已完成中英文自动空格排版（Ctrl+Z 可撤销）');
      return true;
    }
    const ratio = before.length ? editor.selectionStart / before.length : 0;
    replaceEditorRange(after, 0, before.length);
    const caret = Math.min(after.length, Math.round(after.length * ratio));
    editor.setSelectionRange(caret, caret);
    preview();
    notify('已完成中英文自动空格排版（Ctrl+Z 可撤销）');
    return true;
  }
  async function verifyDecodableImageDataUrl(dataUrl) {
    if (!dataUrl || typeof createImageBitmap !== 'function') return true;
    const match = String(dataUrl).match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return false;
    try {
      const bin = atob(match[2]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const bitmap = await createImageBitmap(new Blob([bytes], { type: match[1] }));
      const valid = bitmap.width >= 1 && bitmap.height >= 1 && bitmap.width <= 16384 && bitmap.height <= 16384 && bitmap.width * bitmap.height <= 40000000;
      bitmap.close?.();
      return valid;
    } catch {
      return false;
    }
  }
  async function pasteImageToDocument(range = null, dataUrl = '', alt = '图片', options = {}) {
    const docId = options.docId ?? current;
    const beforeText = options.beforeText ?? editor.value;
    const beforeRev = options.beforeRev ?? revision;
    if (!docId || !api.pasteImage) return { ok: false };
    if (dataUrl && !(await verifyDecodableImageDataUrl(dataUrl))) {
      notify('图片数据已损坏或无法解码', 'error');
      return { ok: false, error: '图片数据已损坏或无法解码' };
    }
    if (current !== docId || (!options.visual && (editor.value !== beforeText || revision !== beforeRev))) {
      notify('粘贴期间文档已变化，已取消插入');
      return { ok: false, canceled: true };
    }
    const target = range || { from: editor.selectionStart, to: editor.selectionEnd };
    const result = await api.pasteImage({ id: docId, dataUrl, alt });
    if (!result?.ok) {
      if (!result?.empty) notify(result?.error || '图片粘贴失败', 'error');
      return result;
    }
    const discardAsset = () => {
      if (result.savedTo === 'assets' && result.relativePath) {
        return api.pasteImage({ id: docId, discardRelativePath: result.relativePath }).catch(() => ({ ok: false }));
      }
      return Promise.resolve({ ok: true });
    };
    if (current !== docId) {
      await discardAsset();
      notify('粘贴期间文档已切换，已取消插入');
      return { ok: false, canceled: true };
    }
    if (options.visual) {
      return {
        ...result,
        discardAsset,
        notifyInserted: () => notify(result.savedTo === 'assets' ? '图片已保存至 assets/ 并插入' : '图片已存入随序并插入'),
        onVisualAssetInserted: () => {
          if (current === docId) setDocumentView('split', true);
        }
      };
    }
    if (editor.value !== beforeText || revision !== beforeRev) {
      await discardAsset();
      notify('粘贴期间文档已变化，请重新粘贴');
      return { ok: false, canceled: true };
    }
    replaceEditorRange(result.markdown, target.from, target.to);
    preview();
    notify(result.savedTo === 'assets' ? '图片已保存至 assets/ 并插入' : '图片已存入随序并插入');
    return result;
  }
  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(Error('无法读取图片文件'));
      reader.readAsDataURL(file);
    });
  }
  editor.addEventListener('paste', (event) => {
    if (!current || $('md-split').dataset.view === 'preview') return;
    const items = [...(event.clipboardData?.items || [])];
    const imageItem = items.find((item) => item.kind === 'file' && /^image\/(png|jpeg|gif|webp)$/i.test(item.type));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    event.preventDefault();
    const docId = current;
    const beforeText = editor.value;
    const beforeRev = revision;
    const range = { from: editor.selectionStart, to: editor.selectionEnd };
    const alt = (file.name || '').replace(/\.[^.]+$/, '') || '图片';
    safe(async () => {
      const dataUrl = await readFileAsDataUrl(file);
      await pasteImageToDocument(range, dataUrl, alt, { docId, beforeText, beforeRev });
    })();
  });
  editor.addEventListener('dragover', (event) => {
    if (!current || $('md-split').dataset.view === 'preview') return;
    if ([...(event.dataTransfer?.types || [])].includes('Files')) event.preventDefault();
  });
  editor.addEventListener('drop', (event) => {
    if (!current || $('md-split').dataset.view === 'preview') return;
    const files = [...(event.dataTransfer?.files || [])].filter((f) => /^image\/(png|jpeg|gif|webp)$/i.test(f.type));
    if (!files.length) return;
    event.preventDefault();
    const docId = current;
    let beforeText = editor.value;
    let beforeRev = revision;
    safe(async () => {
      for (const file of files.slice(0, 6)) {
        const dataUrl = await readFileAsDataUrl(file);
        const alt = (file.name || '').replace(/\.[^.]+$/, '') || '图片';
        const res = await pasteImageToDocument(null, dataUrl, alt, { docId, beforeText, beforeRev });
        if (!res?.ok) break;
        beforeText = editor.value;
        beforeRev = revision;
      }
    })();
  });
  let pptActive = false,
    pptSlides = [],
    pptIndex = 0,
    pptGridOpen = false,
    pptPrevFocus = null,
    pptRenderSeq = 0;
  const pptStage = document.createElement('section');
  pptStage.id = 'md-ppt-stage';
  pptStage.className = 'md-ppt-stage';
  pptStage.hidden = true;
  pptStage.tabIndex = -1;
  pptStage.setAttribute('role', 'dialog');
  pptStage.setAttribute('aria-modal', 'true');
  pptStage.setAttribute('aria-label', 'PPT 演示模式');
  pptStage.innerHTML =
    '<header class="md-ppt-topbar"><span class="md-ppt-doc-title" id="md-ppt-doc-title"></span>' +
    '<div class="md-ppt-top-actions"><button type="button" class="md-ppt-btn" id="md-ppt-grid-btn" aria-pressed="false">总览 (G)</button>' +
    '<button type="button" class="md-ppt-btn" id="md-ppt-exit">退出演示 (Esc)</button></div></header>' +
    '<div class="md-ppt-viewport"><article class="md-ppt-slide" id="md-ppt-slide"></article>' +
    '<div class="md-ppt-grid" id="md-ppt-grid" hidden></div></div>' +
    '<footer class="md-ppt-hud"><button type="button" class="md-ppt-btn" id="md-ppt-prev">上一页</button>' +
    '<span class="md-ppt-counter" id="md-ppt-counter">1 / 1</span>' +
    '<div class="md-ppt-progress"><i id="md-ppt-bar"></i></div>' +
    '<button type="button" class="md-ppt-btn" id="md-ppt-next">下一页</button></footer>';
  document.body.append(pptStage);
  async function renderPptSlide() {
    if (!pptActive || !pptSlides.length) return;
    const seq = ++pptRenderSeq;
    const slide = pptSlides[pptIndex] || pptSlides[0];
    const docId = current;
    const external = Boolean(docs.find((doc) => doc.id === docId)?.meta?.externalPath);
    const rendered = window.SuiraMarkdown.renderWithOutline(slide.markdown || `# ${slide.title}`, { localImages: external });
    const host = $('md-ppt-slide');
    host.innerHTML = rendered.html;
    host.style.animation = 'none';
    void host.offsetWidth;
    host.style.animation = '';
    $('md-ppt-counter').textContent = `${pptIndex + 1} / ${pptSlides.length}`;
    $('md-ppt-bar').style.width = `${((pptIndex + 1) / pptSlides.length) * 100}%`;
    $('md-ppt-prev').disabled = pptIndex <= 0;
    $('md-ppt-next').disabled = pptIndex >= pptSlides.length - 1;
    $('md-ppt-grid').querySelectorAll('.md-ppt-card').forEach((card, idx) => {
      card.setAttribute('aria-current', String(idx === pptIndex));
    });
    if (external && rendered.images.length) {
      const loaded = await api.previewImages(docId, rendered.images).catch(() => []);
      if (!pptActive || seq !== pptRenderSeq || current !== docId) return;
      const byUrl = new Map(loaded.map(({ url, data }) => [url, data]));
      for (const placeholder of host.querySelectorAll('[data-md-local-image]')) {
        const data = byUrl.get(placeholder.dataset.mdLocalImage);
        if (!data) continue;
        const image = document.createElement('img');
        image.alt = placeholder.textContent;
        image.src = data;
        placeholder.replaceWith(image);
      }
    }
  }
  function setPptGrid(open) {
    pptGridOpen = Boolean(open);
    $('md-ppt-grid').hidden = !pptGridOpen;
    $('md-ppt-grid-btn').setAttribute('aria-pressed', String(pptGridOpen));
  }
  function openPpt(startIndex = 0) {
    if (!current || !window.SuiraSlides) return false;
    const parsed = window.SuiraSlides.splitSlides(editor.value, $('md-title').value);
    pptSlides = parsed.slides;
    pptIndex = Math.max(0, Math.min(startIndex, pptSlides.length - 1));
    pptPrevFocus = document.activeElement;
    pptActive = true;
    const shell = document.querySelector('.app-shell');
    if (shell) shell.inert = true;
    $('md-ppt-doc-title').textContent = $('md-title').value.trim() || 'PPT 演示';
    $('md-ppt-grid').innerHTML = pptSlides
      .map((s, idx) => `<button type="button" class="md-ppt-card" data-ppt-idx="${idx}" aria-current="${idx === pptIndex}"><small>第 ${idx + 1} 页</small><b>${esc(s.title)}</b></button>`)
      .join('');
    setPptGrid(false);
    pptStage.hidden = false;
    $('md-ppt-toggle')?.setAttribute('aria-pressed', 'true');
    renderPptSlide();
    pptStage.focus({ preventScroll: true });
    return true;
  }
  function closePpt() {
    if (!pptActive) return false;
    pptActive = false;
    pptRenderSeq++;
    pptStage.hidden = true;
    setPptGrid(false);
    const shell = document.querySelector('.app-shell');
    if (shell) shell.inert = false;
    $('md-ppt-toggle')?.setAttribute('aria-pressed', 'false');
    if (pptPrevFocus && typeof pptPrevFocus.focus === 'function') pptPrevFocus.focus({ preventScroll: true });
    pptPrevFocus = null;
    return true;
  }
  const togglePpt = () => (pptActive ? closePpt() : openPpt());
  $('md-ppt-exit').onclick = () => closePpt();
  $('md-ppt-grid-btn').onclick = () => setPptGrid(!pptGridOpen);
  $('md-ppt-prev').onclick = () => { if (pptIndex > 0) { pptIndex--; renderPptSlide(); } };
  $('md-ppt-next').onclick = () => { if (pptIndex < pptSlides.length - 1) { pptIndex++; renderPptSlide(); } };
  $('md-ppt-grid').addEventListener('click', (event) => {
    const card = event.target.closest('[data-ppt-idx]');
    if (!card) return;
    pptIndex = Number(card.dataset.pptIdx) || 0;
    setPptGrid(false);
    renderPptSlide();
    pptStage.focus({ preventScroll: true });
  });
  $('md-ppt-slide').addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    event.preventDefault();
    const url = link.getAttribute('href');
    if (/^(?:https?:\/\/|suira-image:\/\/[-\w]+$)/i.test(url)) safe(() => checked(api.openLink(url)))();
  });
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.isComposing || !pptActive) return;
      if (event.key === 'Tab') {
        const focusable = [...pptStage.querySelectorAll('button:not(:disabled), a[href]')].filter(
          (el) => (typeof el.checkVisibility === 'function' ? el.checkVisibility() : !el.closest('[hidden]'))
        );
        if (!focusable.length) { event.preventDefault(); pptStage.focus(); return; }
        const idx = focusable.indexOf(document.activeElement);
        event.preventDefault();
        event.stopImmediatePropagation();
        const next = idx < 0
          ? (event.shiftKey ? focusable.length - 1 : 0)
          : (idx + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
        focusable[next]?.focus();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (pptGridOpen) setPptGrid(false);
        else closePpt();
      } else if (event.key === 'g' || event.key === 'G') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setPptGrid(!pptGridOpen);
      } else if (!pptGridOpen && ['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (pptIndex < pptSlides.length - 1) { pptIndex++; renderPptSlide(); }
      } else if (!pptGridOpen && ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (pptIndex > 0) { pptIndex--; renderPptSlide(); }
      } else if (!pptGridOpen && event.key === 'Home') {
        event.preventDefault();
        event.stopImmediatePropagation();
        pptIndex = 0; renderPptSlide();
      } else if (!pptGridOpen && event.key === 'End') {
        event.preventDefault();
        event.stopImmediatePropagation();
        pptIndex = pptSlides.length - 1; renderPptSlide();
      }
    },
    true
  );
  document.addEventListener('keydown', (event) => {
    if (event.isComposing || pptActive) return;
    if (!document.querySelector('#page-markdown.is-active')) return;
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
      const views = { 1: 'edit', 2: 'split', 3: 'preview', 4: 'write' };
      if (views[event.key]) {
        event.preventDefault();
        setDocumentView(views[event.key]);
        return;
      }
      if (event.key === '\\') {
        event.preventDefault();
        $('md-panes')?.click();
        return;
      }
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'l' && current) {
      event.preventDefault();
      formatDocumentPangu();
      return;
    }
    if (((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') || event.key === 'F5') {
      if (current) {
        event.preventDefault();
        togglePpt();
        return;
      }
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveCurrentFile().catch((error) => notify(error.message));
    }
  });
  api.onClosing?.(
    safe(async () => {
      if (closingWorkspace) return;
      closingWorkspace = true;
      try {
        if (document.documentElement.dataset.tool === 'calendar') {
          if (savingEvent) {
            await api.cancelClose();
            notify('正在保存日程，请稍后再关闭');
            return;
          }
          await calendarDraftRead;
          const count = unsavedCalendarCount();
          if (count && !(await api.confirmCalendarClose(count))?.ok) return;
        } else {
          await flush();
          const result = await api.confirmClose(current);
          if (result.canceled) return;
          if (!result.ok) throw Error(result.error || '无法保存');
        }
        await api.closeReady();
      } catch (error) {
        await api.cancelClose();
        throw error;
      } finally {
        closingWorkspace = false;
      }
    })
  );
  window.addEventListener('blur', () => flush().catch(() => {}));
  // Preserve every original settings control and listener while changing the layout.
  document.querySelectorAll('.settings-grid > .setting-card').forEach((card) => {
    card.dataset.category ||= card.querySelector('#recipe-name,#setting-currency,#color-history')
      ? 'tools'
      : card.querySelector('#setting-translate-provider')
        ? 'translation'
        : card.querySelector('#setting-key-longCapture')
          ? 'shortcuts'
          : card.classList.contains('about-card')
            ? 'about'
            : card.querySelector('#setting-record,#setting-days')
              ? 'storage'
              : 'general';
  });
  function settingTab(value) {
    window.SuiraGlassSelect?.close();
    document.querySelectorAll('[data-setting-tab]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.settingTab === value);
      b.setAttribute('aria-pressed', String(b.dataset.settingTab === value));
    });
    document
      .querySelectorAll('[data-category]')
      .forEach((card) => (card.hidden = card.dataset.category !== value));
    document.querySelector('.main-scroll')?.scrollTo(0, 0);
  }
  document
    .querySelectorAll('[data-setting-tab]')
    .forEach((button) => (button.onclick = () => settingTab(button.dataset.settingTab)));
  settingTab('general');
  const tool = document.documentElement.dataset.tool;
  if (tool) {
    const mark = document.createElement('span');
    mark.className = 'tool-kind';
    mark.title = tool === 'markdown' ? 'Markdown 文档' : '日历';
    mark.setAttribute('aria-label', mark.title);
    mark.dataset.toolObject = tool;
    mark.innerHTML = window.SuiraToolArt?.render(tool) || '';
    document.querySelector('.brand').prepend(mark);
    const top = document.createElement('div');
    top.className = 'tool-top-actions';
    document.querySelector('.titlebar').insertBefore(top, document.querySelector('.window-actions'));
    const theme = document.createElement('button');
    theme.className = 'quiet-btn tool-icon';
    theme.title = '切换明暗主题';
    theme.setAttribute('aria-label', theme.title);
    theme.innerHTML =
      '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>';
    theme.onclick = safe(async () => {
      const settings = await window.suira.settings.get();
      await window.suira.settings.update({
        theme: settings?.theme === 'dark' ? 'light' : 'dark',
        themeChosen: true
      });
    });
    top.append(theme);
    const pin = document.createElement('button');
    pin.className = 'quiet-btn tool-icon';
    pin.title = '窗口置顶';
    pin.setAttribute('aria-label', pin.title);
    pin.setAttribute('aria-pressed', 'false');
    pin.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 3h8l-1 7 4 4H5l4-4z M12 14v7"/></svg>';
    pin.onclick = safe(async () => pin.setAttribute('aria-pressed', String(await window.suira.window.pin())));
    top.append(pin);
    if (tool === 'markdown') {
      const { mountEditorLayout, iconButton } = window.SuiraMarkdownLayout;
      const shell = document.querySelector('.markdown-layout');
      const actions = document.createElement('div');
      actions.setAttribute('role', 'group');
      actions.setAttribute('aria-label', '编辑器视图和操作');
      const headingBar = $('md-title').parentElement;
      headingBar.classList.remove('document-heading');
      $('md-title').classList.add('mia-title');
      documentLayout = {
        shell,
        ...mountEditorLayout({
          shell,
          sidebar: document.querySelector('.document-sidebar'),
          search: $('md-search'),
          create: $('md-new'),
          list: $('md-list'),
          main: document.querySelector('.document-main'),
          heading: headingBar,
          actions,
          brand: '随序',
          open: null
        })
      };
      const libraryFoot = document.createElement('div');
      libraryFoot.className = 'mia-library-foot';
      const openFolderBtn = document.createElement('button');
      openFolderBtn.id = 'md-open-folder';
      openFolderBtn.type = 'button';
      openFolderBtn.className = 'mia-folder-btn';
      openFolderBtn.title = '打开本地 Markdown 文件夹';
      openFolderBtn.setAttribute('aria-label', '打开本地 Markdown 文件夹');
      openFolderBtn.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h6l2 2h10v11H3z M12 11v6 M9 14h6"/></svg><span>打开文件夹</span>';
      openFolderBtn.onclick = safe(() => openLocalFolder(false));
      const importFileBtn = $('md-import');
      if (importFileBtn) {
        importFileBtn.className = 'mia-icon mia-import-file-btn';
        importFileBtn.title = '打开单个 Markdown 文件';
        importFileBtn.setAttribute('aria-label', '打开单个 Markdown 文件');
        importFileBtn.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 16v-5m-2.5 2.5L12 11l2.5 2.5"/></svg>';
      }
      const refreshFolderBtn = document.createElement('button');
      refreshFolderBtn.id = 'md-refresh-folder';
      refreshFolderBtn.type = 'button';
      refreshFolderBtn.className = 'mia-icon';
      refreshFolderBtn.hidden = true;
      refreshFolderBtn.title = '刷新本地文件夹';
      refreshFolderBtn.setAttribute('aria-label', '刷新本地文件夹');
      refreshFolderBtn.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6L20 9 M20 4v5h-5"/></svg>';
      refreshFolderBtn.onclick = safe(() => openLocalFolder(true));
      libraryFoot.append(...[openFolderBtn, importFileBtn, refreshFolderBtn].filter(Boolean));
      documentLayout.library.append(libraryFoot);
      const action = (id, icon, label) =>
        iconButton(Object.assign(document.createElement('button'), { id }), icon, label);
      const home = action('md-home', 'library', '返回文档库');
      home.onclick = safe(async () => {
        await flush();
        docs = await api.list('markdown');
        await selectDoc('');
      });
      const panes = action('md-panes', 'sidebar', '显示或收起左栏');
      panes.setAttribute('aria-pressed', 'false');
      panes.onclick = () => {
        if (narrowDocumentLayout()) {
          shell.classList.toggle('mia-notes-only');
          $('md-search').focus();
        } else panes.setAttribute('aria-pressed', String(shell.classList.toggle('mia-hide-library')));
      };
      const back = action('md-notes-back', 'sidebar', '返回编辑区');
      back.onclick = () => {
        shell.classList.remove('mia-notes-only');
        (current ? $('md-title') : compactMore).focus();
      };
      documentLayout.listHead.prepend(back);
      top.remove();
      const shortTitle = document.querySelector('.brand b');
      shortTitle.textContent = 'Markdown';
      const view = document.querySelector('.markdown-toolbar .view-switch');
      for (const button of view.querySelectorAll('button')) {
        const mode = button.dataset.mdView;
        iconButton(button, mode === 'edit' ? 'source' : mode, button.textContent);
      }
      const empty = $('md-empty');
      empty.innerHTML =
        '<span class="welcome-document tool-emblem" data-tool-object="markdown" aria-hidden="true"></span><b>未打开 Markdown</b><p>打开本地文件夹或 Markdown 文件，或新建空白文档</p><div class="welcome-actions"><button class="primary-btn" id="welcome-open">打开文件</button><button class="quiet-btn" id="welcome-folder">打开文件夹</button><button class="quiet-btn" id="welcome-new">新建空白</button></div>';
      $('welcome-open').onclick = () => $('md-import').click();
      $('welcome-folder').onclick = safe(() => openLocalFolder(false));
      $('welcome-new').onclick = () => $('md-new').click();
      const paste = document.createElement('button');
      paste.className = 'quiet-btn';
      paste.id = 'md-paste';
      paste.title = '从剪贴板新建';
      paste.textContent = '从剪贴板新建';
      paste.onclick = safe(async () => {
        await flush();
        const clip = await checked(api.clipboard());
        if (!clip.text.trim()) return notify('剪贴板没有文本');
        const r = await checked(api.save('markdown', { title: '剪贴板文档', text: clip.text }));
        docs.unshift(r.item);
        await selectDoc(r.item.id);
      });
      empty.querySelector('.welcome-actions').after(paste);
      const outline = action('md-outline-toggle', 'outline', '文档目录');
      outline.setAttribute('aria-controls', 'md-outline');
      outline.onclick = toggleOutline;
      $('md-words').after($('md-status'));
      const more = action('md-more', 'more', '更多文档操作');
      more.setAttribute('aria-expanded', 'false');
      more.setAttribute('aria-controls', 'md-file-menu');
      const menu = document.createElement('div');
      menu.id = 'md-file-menu';
      menu.className = 'md-file-menu';
      menu.hidden = true;
      menu.setAttribute('role', 'dialog');
      menu.setAttribute('aria-label', '更多文档操作');
      document.body.append(menu);
      const heading = (text) => {
        const h = document.createElement('small');
        h.textContent = text;
        menu.append(h);
      };
      const clear = document.createElement('button');
      clear.id = 'md-clear-recent';
      clear.type = 'button';
      clear.textContent = '清理最近打开记录';
      clear.className = 'quiet-btn';
      clear.onclick = safe(async () => {
        await flush();
        await checked(api.recent('clear'));
        docs = await api.list('markdown');
        docList();
        notify('最近打开记录已清理，文档仍保存在本地');
      });
      const openFolderMenu = document.createElement('button');
      openFolderMenu.id = 'md-open-folder-menu';
      openFolderMenu.type = 'button';
      openFolderMenu.className = 'quiet-btn';
      openFolderMenu.textContent = '打开本地文件夹';
      openFolderMenu.onclick = safe(() => openLocalFolder(false));
      const panguMenu = document.createElement('button');
      panguMenu.id = 'md-pangu-menu';
      panguMenu.type = 'button';
      panguMenu.className = 'quiet-btn';
      panguMenu.textContent = '中英文自动排版 · Ctrl+Shift+L';
      panguMenu.onclick = () => formatDocumentPangu();
      const pptMenu = document.createElement('button');
      pptMenu.id = 'md-ppt-menu';
      pptMenu.type = 'button';
      pptMenu.className = 'quiet-btn';
      pptMenu.textContent = 'PPT 演示模式 · F5';
      pptMenu.onclick = () => togglePpt();
      heading('文件');
      menu.append(home, openFolderMenu, $('md-save'), clear);
      heading('导出');
      menu.append($('md-export-format'), $('md-export'));
      heading('视图与排版');
      menu.append(panguMenu, pptMenu, theme, pin);
      heading('文档');
      menu.append($('md-delete'));
      const focus = action('md-focus-toggle', 'focus', '专注模式 · Ctrl+Shift+F');
      focus.setAttribute('aria-pressed', 'false');
      focus.onclick = () => setWritingFocus(!focusedWriting);
      const pptToggle = document.createElement('button');
      pptToggle.id = 'md-ppt-toggle';
      pptToggle.type = 'button';
      pptToggle.className = 'mia-icon';
      pptToggle.title = 'PPT 演示 · F5';
      pptToggle.setAttribute('aria-label', 'PPT 演示 · F5');
      pptToggle.setAttribute('aria-pressed', 'false');
      pptToggle.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8M10 8l4 2-4 2z"/></svg>';
      pptToggle.onclick = () => togglePpt();
      const format = action('md-format-toggle', 'format', '格式工具');
      const toolbar = document.querySelector('.markdown-toolbar');
      toolbar.hidden = true;
      toolbar.id = 'md-format-bar';
      format.setAttribute('aria-expanded', 'false');
      format.setAttribute('aria-controls', toolbar.id);
      format.onmousedown = (event) => event.preventDefault();
      format.onclick = () => {
        toolbar.hidden = !toolbar.hidden;
        format.setAttribute('aria-expanded', String(!toolbar.hidden));
      };
      actions.append(panes, outline, view, pptToggle, focus, format, more);
      const compactMore = action('md-empty-more', 'more', '文档库操作');
      compactMore.setAttribute('aria-controls', menu.id);
      compactMore.setAttribute('aria-expanded', 'false');
      const emptyNotes = action('md-empty-notes', 'sidebar', '查看文档列表');
      emptyNotes.onclick = () => {
        shell.classList.add('mia-notes-only');
        $('md-search').focus();
      };
      empty.querySelector('.welcome-actions').append(emptyNotes, compactMore);
      let menuAnchor = more;
      const closeMenu = (focus = false) => {
        menu.hidden = true;
        menuAnchor.setAttribute('aria-expanded', 'false');
        window.SuiraGlassSelect?.close();
        if (focus) menuAnchor.focus();
      };
      for (const trigger of [more, compactMore])
        trigger.onclick = () => {
          if (!menu.hidden) {
            closeMenu();
            return;
          }
          menuAnchor = trigger;
          menu.hidden = false;
          trigger.setAttribute('aria-expanded', 'true');
          const rect = trigger.getBoundingClientRect();
          menu.style.right = Math.max(8, innerWidth - rect.right) + 'px';
          menu.style.top = Math.max(8, Math.min(rect.bottom + 8, innerHeight - menu.offsetHeight - 8)) + 'px';
          menu.querySelector('button:not(:disabled)')?.focus();
        };
      menu.addEventListener('click', (event) => {
        if (event.target.closest('button') && !event.target.closest('.glass-select')) closeMenu();
      });
      document.addEventListener(
        'pointerdown',
        (event) => {
          if (
            !menu.hidden &&
            !menu.contains(event.target) &&
            !menuAnchor.contains(event.target) &&
            !event.target.closest('.glass-select-menu')
          )
            closeMenu();
        },
        true
      );
      document.addEventListener(
        'keydown',
        (event) => {
          if (menu.hidden || window.SuiraGlassSelect?.isOpen()) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            closeMenu(true);
            return;
          }
          if (!menu.contains(event.target) || event.target.closest('.glass-select')) return;
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const list = [...menu.querySelectorAll('button:not(:disabled)')].filter((b) => b.checkVisibility()),
            index = list.indexOf(document.activeElement);
          list[
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? list.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length
          ]?.focus();
        },
        true
      );
      window.addEventListener('resize', () => closeMenu());
      window.addEventListener('blur', () => closeMenu());
      const foot = document.querySelector('.document-foot>span:last-child');
      foot.innerHTML = '<kbd>Ctrl</kbd> + <kbd>S</kbd> 保存';
      const outlineHead = document.createElement('div');
      outlineHead.className = 'md-outline-head';
      outlineHead.id = 'md-outline-head';
      outlineHead.hidden = true;
      const collapse = action('md-sidebar-collapse', 'sidebar', '返回文档列表');
      collapse.setAttribute('aria-controls', 'md-outline');
      collapse.onclick = () => {
        toggleOutline();
        $('md-search').focus();
      };
      const outlineBack = action('md-outline-back', 'sidebar', '返回编辑区');
      outlineBack.onclick = back.onclick;
      const outlineLabel = document.createElement('b');
      outlineLabel.textContent = '文档目录';
      outlineHead.append(outlineLabel, outlineBack, collapse);
      document.querySelector('.document-sidebar').append(outlineHead);
    } else {
      top.append($('calendar-export'));
      const clock = document.createElement('time');
      clock.id = 'calendar-clock';
      clock.className = 'calendar-clock';
      clock.setAttribute('aria-label', '当前时间');
      top.append(clock);
      let tick;
      const updateClock = () => {
        clearTimeout(tick);
        if (document.hidden) return;
        const now = new Date();
        clock.dateTime = now.toISOString();
        clock.textContent = window.CalendarData.clock(now);
        tick = setTimeout(updateClock, Math.max(1, 1000 - now.getMilliseconds()));
      };
      document.addEventListener('visibilitychange', updateClock);
      window.addEventListener('beforeunload', () => clearTimeout(tick));
      updateClock();
      const nav = document.querySelector('.calendar-month');
      nav.prepend($('calendar-prev'));
      nav.append($('calendar-next'), $('calendar-today'));
      const aside = document.querySelector('.agenda-card');
      const quickForm = document.createElement('form');
      quickForm.id = 'calendar-quick-form';
      quickForm.className = 'calendar-quick-form';
      quickForm.noValidate = true;
      quickForm.innerHTML =
        '<input id="calendar-quick-title" class="text-input" type="text" maxlength="120" autocomplete="off" placeholder="输入倒数日名称，回车添加" aria-label="快速添加倒数日">' +
        '<input id="calendar-quick-date" class="text-input" type="date" aria-label="目标日期">' +
        '<button type="submit" class="quiet-btn" id="calendar-quick-submit">添加</button>';
      const quickTitle = quickForm.querySelector('#calendar-quick-title');
      const quickDate = quickForm.querySelector('#calendar-quick-date');
      const quickSubmit = quickForm.querySelector('#calendar-quick-submit');
      quickDate.value = selected;
      const markDatePicked = () => {
        quickDate.dataset.userPicked = 'true';
      };
      quickDate.addEventListener('input', markDatePicked);
      quickDate.addEventListener('change', markDatePicked);
      quickForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        if (savingEvent) return;
        const title = quickTitle.value.trim();
        if (!title) {
          quickTitle.focus();
          return;
        }
        const submitMode = agendaMode;
        const todayKey = dateKey(new Date());
        if (submitMode === 'countdown') {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(quickDate.value)) {
            notify('请选择有效的目标日期', 'error');
            quickDate.focus();
            return;
          }
          if (quickDate.value < todayKey) {
            notify('倒数日请选择今天或之后的日期', 'error');
            quickDate.focus();
            return;
          }
        }
        const targetDate = submitMode === 'countdown' ? quickDate.value : selected;
        const hadFocus = quickForm.contains(document.activeElement);
        safe(async () => {
          savingEvent = true;
          quickTitle.disabled = quickDate.disabled = quickSubmit.disabled = true;
          let savedOk = false;
          try {
            await checked(
              api.save('calendar', {
                title,
                date: targetDate,
                time: '',
                category: $('calendar-category').value || 'work',
                priority: 'normal',
                location: '',
                text: '',
                done: false
              })
            );
            savedOk = true;
          } finally {
            savingEvent = false;
            quickTitle.disabled = quickDate.disabled = quickSubmit.disabled = false;
            if (!savedOk && hadFocus) quickTitle.focus({ preventScroll: true });
          }
          quickTitle.value = '';
          delete quickDate.dataset.userPicked;
          selected = targetDate;
          month = new Date(targetDate + 'T12:00:00');
          if (submitMode === 'countdown' && !['all', 'custom'].includes(countdownFilter)) {
            countdownFilter = 'all';
            for (const filter of $('countdown-filters')?.children || []) {
              const active = filter.dataset.countdown === 'all';
              filter.classList.toggle('is-active', active);
              filter.setAttribute('aria-pressed', String(active));
            }
          }
          notify(submitMode === 'countdown' ? '倒数日已添加' : '待办已添加');
          await loadCalendar();
          if (hadFocus || document.activeElement === document.body) quickTitle.focus({ preventScroll: true });
        })();
      });
      aside.prepend($('calendar-new'));
      $('calendar-new').after(quickForm);
      const tabs = document.createElement('div');
      tabs.className = 'agenda-tabs view-switch';
      tabs.innerHTML =
        '<button data-agenda="countdown" class="is-active" aria-pressed="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10 M7 21h10 M8 3v4l8 10v4 M16 3v4L8 17v4"/></svg>倒数日</button><button data-agenda="todo" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 2 2 3-4 M11 6h10 M3 13h4 M11 13h10 M3 20h4 M11 20h10"/></svg>待办</button>';
      aside.prepend(tabs);
      const filters = document.createElement('div');
      filters.id = 'countdown-filters';
      filters.setAttribute('role', 'group');
      filters.setAttribute('aria-label', '倒数日分类');
      const kinds = [
        ['all', '全部'],
        ['holiday', '节假日'],
        ['term', '24 节气'],
        ['custom', '自定义']
      ];
      for (const [kind, label] of kinds) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.countdown = kind;
        button.textContent = label;
        button.classList.toggle('is-active', kind === countdownFilter);
        button.setAttribute('aria-pressed', String(kind === countdownFilter));
        button.onclick = () => {
          countdownFilter = kind;
          for (const filter of filters.children) {
            filter.classList.toggle('is-active', filter === button);
            filter.setAttribute('aria-pressed', String(filter === button));
          }
          calendar();
        };
        filters.append(button);
      }
      tabs.after(filters);
      const numbers = document.createElement('div');
      numbers.id = 'calendar-week-numbers';
      $('calendar-grid').before(numbers);
      const dates = document.createElement('div');
      dates.className = 'calendar-dates';
      numbers.before(dates);
      dates.append(numbers, $('calendar-grid'));
      const selectedLabel = document.createElement('span');
      selectedLabel.id = 'calendar-selected';
      nav.append(selectedLabel);
      const filterToggle = document.createElement('button');
      const calendarControls = document.querySelector('.calendar-controls');
      calendarControls.id = 'calendar-controls';
      filterToggle.className = 'quiet-btn';
      filterToggle.textContent = '☰';
      filterToggle.title = '搜索和视图';
      filterToggle.setAttribute('aria-label', filterToggle.title);
      filterToggle.setAttribute('aria-controls', calendarControls.id);
      filterToggle.setAttribute('aria-expanded', 'false');
      filterToggle.onclick = () => {
        filterToggle.setAttribute('aria-expanded', String(calendarControls.classList.toggle('is-open')));
      };
      top.prepend(filterToggle);
      tabs.querySelectorAll('button').forEach(
        (button) =>
          (button.onclick = () => {
            setAgendaMode(button.dataset.agenda);
            calendar();
          })
      );
    }
  }
  const visual = document.createElement('div');
  visual.id = 'md-rich';
  visual.className = 'md-rich';
  $('md-split').prepend(visual);
  const writeButton = document.createElement('button');
  writeButton.dataset.mdView = 'write';
  window.SuiraMarkdownLayout.iconButton(writeButton, 'new', '可视化写作');
  writeButton.onclick = () => setDocumentView('write');
  document.querySelector('[data-md-view]').parentElement.prepend(writeButton);
  document.querySelector('[data-md-view="edit"]').setAttribute('aria-label', 'Markdown 源码');
  document.querySelector('[data-md-view="edit"]').setAttribute('title', 'Markdown 源码');
  sourceDocument = window.SuiraSourceDocument.create({
    element: $('md-editor'),
    preview: $('md-preview'),
    enabled: () =>
      Boolean(
        current &&
          document.querySelector('#page-markdown.is-active') &&
          $('md-split').dataset.view !== 'write'
      ),
    readOnly: () => $('md-split').dataset.view === 'preview',
    activate: () => {
      if ($('md-split').dataset.view === 'preview') setDocumentView('edit');
    },
    onChange: dirty,
    notify,
    readClipboard: () => checked(api.clipboard()),
    pasteImage: (range) => safe(() => pasteImageToDocument(range))(),
    formatPangu: () => formatDocumentPangu(),
    capture: async (kind) => {
      const id = current;
      await flush();
      const result = await api.capture({ kind });
      if (current !== id) throw Error('当前文档已切换，未插入截图');
      return result;
    }
  });
  const editingController = () => ($('md-split').dataset.view === 'write' ? richDocument : sourceDocument);
  const documentMenus = document.createElement('div');
  documentMenus.className = 'md-format-menus';
  documentMenus.innerHTML = [
    ['style', '正文与标题'],
    ['color', '文字颜色'],
    ['highlight', '高亮'],
    ['size', '字号'],
    ['insert', '插入']
  ]
    .map(
      ([kind, label]) =>
        `<button type="button" data-document-menu="${kind}">${label}${window.suiraIcons.svg('chevron_down')}</button>`
    )
    .join('');
  document.querySelector('.markdown-toolbar').prepend(documentMenus);
  documentMenus.querySelectorAll('button').forEach((button) => {
    button.onmousedown = (e) => e.preventDefault();
    button.onclick = () => editingController()?.openMenu(button.dataset.documentMenu, button);
  });
  const richFormats = document.createElement('div');
  richFormats.className = 'md-rich-formats';
  richFormats.innerHTML = [
    ['bold', '加粗', '<b>B</b>'],
    ['italic', '斜体', '<i>I</i>'],
    ['underline', '下划线', '<u>U</u>'],
    ['strike', '删除线', '<s>S</s>'],
    ['inlineCode', '行内代码', '&lt;/&gt;']
  ]
    .map(
      ([command, label, icon]) =>
        `<button type="button" data-rich-format="${command}" aria-label="${label}" title="${label}">${icon}</button>`
    )
    .join('');
  documentMenus.after(richFormats);
  richFormats.querySelectorAll('button').forEach((button) => {
    button.onmousedown = (e) => e.preventDefault();
    button.onclick = () => editingController()?.apply(button.dataset.richFormat);
  });
  document.querySelector('.document-sidebar').append($('md-outline'));
  window.SuiraToolArt?.mount();
  window.WorkspaceUI = {
    open: safe(async (type) => {
      if (type === 'calendar') await loadCalendar();
      else await loadDocs();
    }),
    flush,
    async calendarBlocksUpdate() {
      await calendarDraftRead;
      return savingEvent || closingWorkspace || unsavedCalendarCount() > 0;
    },
    get documentEditor() {
      return richDocument;
    },
    openPpt,
    closePpt,
    formatPangu: formatDocumentPangu,
    pasteImage: pasteImageToDocument,
    shortcuts(snapshot) {
      const rows = Object.entries(snapshot.bindings || {}).filter(
        ([name, acc]) => name.startsWith('panelKey:') && acc
      );
      $('all-shortcut-status').innerHTML = rows
        .map(
          ([name, acc]) =>
            `<div><kbd>${esc(acc.replace(/\+/g, ' + '))}</kbd><small class="${snapshot.status?.[name]?.ok ? 'is-ok' : 'is-error'}">${snapshot.status?.[name]?.localOnly ? '仅面板内' : snapshot.status?.[name]?.ok ? '已生效' : esc(snapshot.status?.[name]?.error || '未注册')}</small></div>`
        )
        .join('');
    }
  };
})();
