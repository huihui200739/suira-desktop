'use strict';

/**
 * 剪贴板历史条渲染层。
 *
 * 契约：主进程适配唤出所在显示器工作区，创建宽幅底部内容架；
 * 页面只适配这个视口，不自己改窗口尺寸。隐藏与失焦由主进程负责，页面不额外处理。
 *
 * 职责：
 * - 从 window.suira.content 拉取内容库列表，按类型渲染卡片：
 *   图片用 thumbnail 缩略图，文字用前 180 字摘要，files 用文件名 + 文件数，link 用域名；
 * - 键盘（← → Home End Enter Esc）与滚轮横向浏览，单击选择，双击粘贴；
 * - Enter 调 window.suira.returnTo.commit({ itemId, intent: 'paste-current' })：
 *   直接粘回成功就关闭，只是复制兜底就在底部提示行显示原因并保留窗口；
 * - clipboardBar.onShown 时重新拉取并重置选中项，content.onChanged 仅在可见时刷新。
 *
 * 所有接口先 feature-detect：缺接口时给出可读提示，不允许点了没反应。
 */

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const KIND_LABELS = { text: '文字', link: '链接', image: '图片', files: '文件' };
  const NOTICE_DURATION = 2000;
  const SUMMARY_LIMIT = 180;
  const EMPTY_COPY = '还没有剪贴板记录，复制一段文字或一张图再试';

  const GLYPHS = {
    image: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4.6 17 4.4-4.4 3.5 3.5 3-3 3.9 3.9"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4"/><path d="M9.5 12h5M9.5 15.5h3.5"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M13.5 10.5a3.5 3.5 0 0 0-5 0L6 13a3.5 3.5 0 0 0 5 5l1-1"/></svg>'
  };

  const state = {
    barApi: null,
    contentApi: null,
    returnApi: null,
    items: [],
    allItems: [],
    query: '',
    filter: 'all',
    pinning: false,
    interactionRevision: 0,
    selected: -1,
    loading: true,
    refreshing: false,
    refreshError: '',
    loaded: false,
    error: '',
    offline: false,
    committing: false,
    previewItem: null,
    noticeTimer: 0,
    visible: true,
    hasOnShown: false,
    offShown: null,
    offChanged: null
  };

  /* ---------- 小工具 ---------- */

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[char]));
  }

  function closestFrom(target, selector) {
    if (!target || typeof target.closest !== 'function') return null;
    return target.closest(selector);
  }

  function errorText(error, fallback) {
    const message = error && typeof error.message === 'string' ? error.message.trim() : '';
    return message ? `${fallback}：${message}` : fallback;
  }

  /** 与 src/app.js 的 relativeTime 保持一致，两处显示同一套相对时间。 */
  function relativeTime(timestamp) {
    const value = Number(timestamp || 0);
    if (!value) return '';
    const delta = Date.now() - value;
    if (delta < 60000) return '刚刚';
    if (delta < 3600000) return `${Math.floor(delta / 60000)} 分钟前`;
    if (delta < 86400000) return `${Math.floor(delta / 3600000)} 小时前`;
    return new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  }

  function normalizeItem(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    const rawId = raw.id == null ? '' : String(raw.id);
    const kind = KIND_LABELS[raw.kind] ? raw.kind : 'text';
    const source = raw.source && typeof raw.source === 'object' ? raw.source : null;
    return {
      id: rawId || `item-${index}`,
      kind,
      title: typeof raw.title === 'string' ? raw.title : '',
      text: typeof raw.text === 'string' ? raw.text : '',
      filePath: typeof raw.filePath === 'string' ? raw.filePath : '',
      thumbnail: typeof raw.thumbnail === 'string' ? raw.thumbnail : '',
      appName: source && typeof source.appName === 'string' ? source.appName : '',
      createdAt: Number(raw.createdAt) || 0,
      pinned: Boolean(raw.pinned),
      meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : {}
    };
  }

  function detectApis() {
    const suira = window.suira && typeof window.suira === 'object' ? window.suira : null;
    state.barApi = suira && suira.clipboardBar && typeof suira.clipboardBar === 'object' ? suira.clipboardBar : null;
    state.contentApi = suira && suira.content && typeof suira.content.list === 'function' ? suira.content : null;
    state.returnApi = suira && suira.returnTo && typeof suira.returnTo.commit === 'function' ? suira.returnTo : null;
    state.offline = !state.contentApi;
  }

  /* ---------- 内容摘要 ---------- */

  function fileLines(item) {
    return String(item.text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  function fileCount(item) {
    const lines = fileLines(item);
    if (lines.length > 1) return lines.length;
    return lines.length || (item.filePath ? 1 : 0) || 1;
  }

  function baseName(filePath) {
    const parts = String(filePath || '').replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || '';
  }

  function filesTitle(item) {
    if (item.title) return item.title;
    const first = fileLines(item)[0] || item.filePath;
    return baseName(first) || '文件';
  }

  function firstUrl(text) {
    const match = String(text || '').match(/\bhttps?:\/\/[^\s<>"']+/i);
    return match ? match[0] : '';
  }

  function linkDomain(item) {
    const candidate = firstUrl(item.text) || firstUrl(item.title);
    if (candidate) {
      try {
        const host = new URL(candidate).hostname.replace(/^www\./i, '');
        if (host) return host;
      } catch {
        /* 不是合法 URL 时退回标题 */
      }
    }
    return item.title || String(item.text || '').trim().slice(0, 40) || '链接';
  }

  function textSummary(item) {
    const flat = String(item.text || item.title || '').replace(/\s+/g, ' ').trim();
    return flat.slice(0, SUMMARY_LIMIT) || '（无文字内容）';
  }

  function selectionTitle(item) {
    if (item.kind === 'link') return linkDomain(item);
    if (item.title) return item.title;
    if (item.kind === 'image') return '图片';
    if (item.kind === 'files') return filesTitle(item);
    return textSummary(item);
  }

  /* ---------- 渲染 ---------- */

  function imageVisual(item) {
    if (item.thumbnail) {
      return `<img class="card-thumb" src="${escapeHtml(item.thumbnail)}" alt="" draggable="false" decoding="async">`;
    }
    return `<span class="card-glyph">${GLYPHS.image}</span><em class="card-placeholder-text">图片</em>`;
  }

  function cardMarkup(item, index) {
    const label = KIND_LABELS[item.kind] || '内容';
    const time = relativeTime(item.createdAt);
    let visual;
    let visualClass = 'card-visual';
    if (item.kind === 'image') {
      visual = imageVisual(item);
      if (!item.thumbnail) visualClass += ' is-placeholder';
    } else if (item.kind === 'files' || item.kind === 'link') {
      const isLink = item.kind === 'link';
      const name = isLink ? linkDomain(item) : filesTitle(item);
      const url = isLink ? firstUrl(item.text) || firstUrl(item.title) : '';
      const details = isLink ? url.replace(/^https?:\/\//i, '') : `${fileCount(item)} 个文件`;
      visualClass += ' is-stack';
      visual = `<span class="card-glyph" aria-hidden="true">${isLink ? GLYPHS.link : GLYPHS.file}</span>
        <div class="card-stack"><b class="card-name">${escapeHtml(name)}</b>
          ${details ? `<span class="${isLink ? 'card-caption' : 'card-count'}">${escapeHtml(details)}</span>` : ''}</div>`;
    } else {
      visual = `<p class="card-snippet">${escapeHtml(textSummary(item))}</p>`;
    }

    const edit = item.kind === 'image' && window.suira?.imageEditor
      ? '<button class="card-edit" type="button" tabindex="-1" data-edit-image aria-label="编辑这张图片" title="编辑图片"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 16-1 4 4-1L20 7l-3-3zM15 6l3 3"/></svg></button>' : '';
    const source = item.appName ? `<span class="card-source-icon" data-source-app="${escapeHtml(item.appName)}" role="img" aria-label="来源：${escapeHtml(item.appName)}"><span>${escapeHtml(item.appName.slice(0, 1).toUpperCase())}</span></span>` : '';
    const tooltip = [label, selectionTitle(item), item.appName, time].filter(Boolean).join('，');
    return `<article class="bar-card" id="bar-card-${index}" role="option" aria-selected="false" tabindex="-1" data-index="${index}" data-id="${escapeHtml(item.id)}" data-kind="${escapeHtml(item.kind)}" title="${escapeHtml(tooltip)}">
      <div class="card-head"><span class="card-type">${label}${item.pinned ? ' <span class="card-favorite" aria-label="已收藏">★</span>' : ''}</span>${edit}</div>
      <div class="${visualClass}">${visual}</div>
      <div class="card-foot">${source}<span class="card-time">${escapeHtml(time)}</span></div>
    </article>`;
  }

  const sourceIcons=new Map();let iconsPending=null;
  function loadSourceIcons(){
    const nodes=$$('.card-source-icon'),names=[...new Set(nodes.map(node=>node.dataset.sourceApp))];
    const paint=()=>nodes.forEach(node=>{const icon=sourceIcons.get(node.dataset.sourceApp);if(!icon||!node.isConnected||node.querySelector('img'))return;const img=document.createElement('img');img.alt='';img.src=icon;img.draggable=false;node.replaceChildren(img);});
    paint();const missing=names.filter(name=>!sourceIcons.has(name));
    if(!missing.length||!state.barApi?.sourceIcons)return;
    // A later render may add another source while this request is in flight.
    if(iconsPending){iconsPending.finally(loadSourceIcons);return;}
    iconsPending=Promise.resolve(state.barApi.sourceIcons(missing)).then(result=>{
      for(const name of missing){const data=result?.[name];sourceIcons.set(name,typeof data==='string'&&/^data:image\/(?:png|jpeg|webp|x-icon|vnd.microsoft.icon);base64,/.test(data)?data:'');}
      paint();
    }).catch(()=>{missing.forEach(name=>sourceIcons.set(name,''));}).finally(()=>{iconsPending=null;});
  }

  function bindImageFallbacks() {
    $$('.card-thumb').forEach((img) => {
      if (img.dataset.fallbackBound) return;
      img.dataset.fallbackBound = 'true';
      const fallback = () => {
        const holder = img.parentElement;
        if (!holder) return;
        holder.classList.add('is-placeholder');
        holder.innerHTML = `<span class="card-glyph">${GLYPHS.image}</span><em class="card-placeholder-text">图片</em>`;
      };
      img.addEventListener('error', fallback, { once: true });
      if (img.complete && img.naturalWidth === 0) fallback();
    });
  }

  function configureEmpty() {
    const empty = $('#bar-empty');
    const title = $('#bar-empty-title');
    const hint = $('#bar-empty-hint');
    const retry = $('#bar-retry');
    if (!empty || !title || !hint || !retry) return;

    let mode = 'empty';
    if (state.offline) {
      mode = 'offline';
      title.textContent = '剪贴板历史暂不可用';
      hint.hidden = false;
      hint.textContent = '重启随序后再试。';
      retry.hidden = true;
    } else if (state.loading) {
      mode = 'loading';
      title.textContent = '正在读取剪贴板历史…';
      hint.hidden = true;
      retry.hidden = true;
    } else if (state.error) {
      mode = 'error';
      title.textContent = '暂时读不到剪贴板历史';
      hint.hidden = false;
      hint.textContent = state.error;
      retry.hidden = false;
    } else if (state.allItems.length && (state.query || state.filter !== 'all')) {
      mode = 'filtered';
      title.textContent = state.filter === 'favorite' && !state.query ? '还没有收藏内容' : '没有找到匹配的内容';
      hint.hidden = true;
      retry.hidden = true;
    } else {
      title.textContent = EMPTY_COPY;
      hint.hidden = true;
      retry.hidden = true;
    }
    empty.dataset.mode = mode;
  }

  function renderSelectionLine() {
    const line = $('#bar-selection');
    if (!line) return;
    const item = state.items[state.selected];
    if (!item) {
      line.classList.add('is-empty');
      line.textContent = '';
      return;
    }
    line.classList.remove('is-empty');
    line.textContent = `${state.selected + 1} / ${state.items.length}`;
    line.title = '← → 选择';
  }

  function syncSelection() {
    const cards = $$('.bar-card');
    const focusedCard = document.activeElement?.closest('.bar-card');
    cards.forEach((card, index) => {
      const active = index === state.selected;
      card.classList.toggle('is-selected', active);
      card.setAttribute('aria-selected', active ? 'true' : 'false');
      card.setAttribute('tabindex', active ? '0' : '-1');
      const edit = card.querySelector('[data-edit-image]');
      if (edit) {
        edit.tabIndex = active ? 0 : -1;
        edit.disabled = state.loading || state.committing || state.editing;
      }
    });
    if (focusedCard && cards[state.selected] && focusedCard !== cards[state.selected]) {
      cards[state.selected].focus({ preventScroll: true });
    }
    const actionHost = $('#bar-action-strip');
    const actionId = state.visible && !state.previewItem ? currentSelectedId() : '';
    if (actionHost.dataset.itemId !== actionId) {
      actionHost.dataset.itemId = actionId;
      actionHost.dispatchEvent(new Event('bar-selection-change'));
    }
    renderSelectionLine();
    const item = state.items[state.selected];
    const pin = $('#bar-pin');
    const submit = $('#bar-submit');
    if (pin) {
      pin.disabled = !item || state.loading || state.pinning || typeof state.contentApi?.togglePin !== 'function';
      pin.textContent = item?.pinned ? '已收藏' : '收藏';
      pin.setAttribute('aria-pressed', String(Boolean(item?.pinned)));
    }
    if (submit) submit.disabled = !item || state.loading || state.committing || !state.returnApi;
    if($('#bar-preview-toggle'))$('#bar-preview-toggle').disabled=!item||state.loading;
    if($('#bar-copy'))$('#bar-copy').disabled=!item||state.loading||state.committing||!state.returnApi;
  }

  function render() {
    const track = $('#bar-track');
    const empty = $('#bar-empty');
    if (!track) return;

    const showItems = !state.offline && !state.loading && !state.error && state.items.length > 0;
    track.hidden = !showItems;
    if (empty) empty.hidden = showItems;
    if (showItems) {
      // 用条目 ID 复用同一个卡片，后台刷新不销毁正在浏览或聚焦的内容。
      const existing = new Map(Array.from(track.children).map(card => [card.dataset.id, card]));
      state.items.forEach((item,index) => {
        let card = existing.get(item.id);
        const markup = cardMarkup(item,index);
        if (!card) {
          const template = document.createElement('template');
          template.innerHTML = markup;
          card = template.content.firstElementChild;
        } else if (card._contentMarkup !== markup) {
          const template = document.createElement('template');
          template.innerHTML = markup;
          const next = template.content.firstElementChild;
          // 外层不变，索引变化也不替换缩略图。
          const unchanged = card._recordSignature === JSON.stringify(item);
          if (!unchanged) card.innerHTML = next.innerHTML;
          card.id = next.id;
          card.dataset.index = String(index);
          card.title = next.title;
        }
        card._contentMarkup = markup;
        card._recordSignature = JSON.stringify(item);
        existing.delete(item.id);
        if (track.children[index] !== card) track.insertBefore(card,track.children[index] || null);
      });
      existing.forEach(card => card.remove());
      bindImageFallbacks();
      loadSourceIcons();
    } else {
      track.innerHTML = '';
    }
    track.setAttribute('aria-busy', String(state.refreshing || state.loading));
    const refresh = $('#bar-refresh-retry');
    if (refresh) {
      refresh.hidden = !state.refreshError;
      refresh.disabled = state.refreshing;
      refresh.title = state.refreshError;
    }
    $$('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === state.filter)));
    configureEmpty();
    syncSelection();
  }

  function scrollCardIntoView(index, behavior = 'smooth') {
    const card = document.getElementById(`bar-card-${index}`);
    if (!card || typeof card.scrollIntoView !== 'function') return;
    try {
      card.scrollIntoView({ block: 'nearest', inline: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : behavior });
    } catch {
      /* 极旧内核不支持 options 时退回默认定位 */
      try { card.scrollIntoView(); } catch {}
    }
  }

  function resetScroll() {
    const track = $('#bar-track');
    if (!track) return;
    try {
      track.scrollTo({ left: 0, behavior: 'instant' });
    } catch {
      track.scrollLeft = 0;
    }
  }

  function selectIndex(index, options = {}) {
    const total = state.items.length;
    if (!total) return;
    state.interactionRevision++;
    const next = Math.max(0, Math.min(total - 1, Number(index) || 0));
    if (next !== state.selected) closePreview(false);
    state.selected = next;
    syncSelection();
    scrollCardIntoView(next, options.behavior || 'smooth');
  }

  function currentSelectedId() {
    const item = state.items[state.selected];
    return item ? item.id : '';
  }

  /* ---------- 提示行 ---------- */

  function showNotice(message, isError) {
    const notice = $('#bar-notice');
    const line = $('#bar-selection');
    if (!notice || !line) return;
    notice.textContent = String(message || '');
    if (!isError && /复制/.test(String(message))) window.SuiraUI?.copyFeedback(notice);
    notice.hidden = false;
    notice.classList.toggle('is-error', Boolean(isError));
    line.hidden = true;
    clearTimeout(state.noticeTimer);
    state.noticeTimer = window.setTimeout(() => {
      state.noticeTimer = 0;
      notice.hidden = true;
      notice.textContent = '';
      notice.classList.remove('is-error');
      line.hidden = false;
    }, NOTICE_DURATION);
  }

  function clearNotice() {
    if (state.noticeTimer) {
      clearTimeout(state.noticeTimer);
      state.noticeTimer = 0;
    }
    const notice = $('#bar-notice');
    const line = $('#bar-selection');
    if (notice) {
      notice.hidden = true;
      notice.textContent = '';
      notice.classList.remove('is-error');
    }
    if (line) line.hidden = false;
  }

  /* ---------- 数据加载 ---------- */

  let loadToken = 0;

  function applyFilters(keepId = '', { reset = true } = {}) {
    const query = state.query.trim().toLocaleLowerCase();
    state.items = state.allItems.filter(item => {
      const kindMatch = state.filter === 'all' || (state.filter === 'favorite' ? item.pinned : item.kind === state.filter);
      return kindMatch && (!query || [item.title, item.text, item.filePath, item.appName].join(' ').toLocaleLowerCase().includes(query));
    });
    const index = keepId ? state.items.findIndex(item => item.id === keepId) : -1;
    const selected = index >= 0 ? index : state.items.length ? 0 : -1;
    if (state.previewItem && state.previewItem.id !== state.items[selected]?.id) closePreview(false);
    state.selected = selected;
    render();
    if (reset) {
      resetScroll();
      if (state.selected >= 0) scrollCardIntoView(state.selected, 'auto');
    }
  }

  async function load(options = {}) {
    const api = state.contentApi;
    const token = ++loadToken;
    const interactionAtStart = state.interactionRevision;
    const cached = state.loaded && state.allItems.length > 0;
    state.loading = !cached;
    state.refreshing = cached;
    state.error = '';
    state.refreshError = '';
    if (cached && options.resetSelection) applyFilters();
    render();

    if (!api) {
      state.loading = false;
      state.loaded = true;
      state.items = [];
      state.selected = -1;
      render();
      return;
    }

    try {
      const payload = await api.list({ limit: 120 });
      if (token !== loadToken) return;
      const interacted = state.interactionRevision !== interactionAtStart;
      const keepId = interacted ? currentSelectedId() : options.keepItemId || '';
      const track = $('#bar-track');
      const bounds = track.getBoundingClientRect();
      const anchor = $$('.bar-card',track).find(card => {
        const rect = card.getBoundingClientRect();
        return rect.right > bounds.left + 1 && rect.left < bounds.right - 1;
      });
      const anchorLeft = anchor?.getBoundingClientRect().left;
      const anchorId = anchor?.dataset.id;
      const items = (Array.isArray(payload) ? payload : []).map(normalizeItem).filter(Boolean);
      state.allItems = items;
      state.loading = false;
      state.refreshing = false;
      state.loaded = true;
      state.error = '';
      const reset = !cached || Boolean(options.resetSelection && !interacted);
      applyFilters(keepId, { reset });
      if (cached && !reset && anchorId) {
        const preserved = $$('.bar-card',track).find(card => card.dataset.id === anchorId);
        if (preserved) track.scrollTo({ left: track.scrollLeft + preserved.getBoundingClientRect().left-anchorLeft, behavior:'instant' });
      }
    } catch (error) {
      if (token !== loadToken) return;
      state.loading = false;
      state.refreshing = false;
      state.loaded = true;
      if (cached) {
        state.refreshError = errorText(error, '刷新失败');
        render();
        return;
      }
      state.error = errorText(error, '读取剪贴板历史失败');
      state.items = [];
      state.allItems = [];
      state.selected = -1;
      render();
    }
  }

  /* ---------- 提交 ---------- */

  async function hideBar() {
    const api = state.barApi;
    if (!api || typeof api.hide !== 'function') return;
    try {
      await api.hide();
    } catch {
      /* 主进程窗口已隐藏/销毁时忽略 */
    }
  }

  async function submitSelected() {
    if (state.committing || state.editing || state.loading) return;
    const item = state.items[state.selected];
    if (!item) return;
    const api = state.returnApi;
    if (!api) {
      showNotice('当前版本不支持复制并返回', true);
      return;
    }
    state.committing = true;
    syncSelection();
    try {
      const result = await api.commit({ itemId: item.id, intent: 'paste-current' });
      if (result && result.ok) {
        if (result.copied) {
          if (result.pasted === true) {
            // 已粘贴到当前窗口，直接收起，不再显示提示
            await hideBar();
            return;
          }
          // 系统剪贴板已经更新；收起条，后续 Ctrl+V 使用同一条内容。
          await hideBar();
          return;
        }
        showNotice(result.error || result.message || '复制失败', true);
        return;
      }
      showNotice((result && (result.error || result.message)) || '复制失败', true);
    } catch (error) {
      showNotice(errorText(error, '复制失败'), true);
    } finally {
      state.committing = false;
      syncSelection();
    }
  }

  async function toggleSelectedPin() {
    const item = state.items[state.selected];
    if (!item || state.pinning || typeof state.contentApi?.togglePin !== 'function') return;
    state.interactionRevision++;
    state.pinning = true;
    syncSelection();
    try {
      const result = await state.contentApi.togglePin(item.id);
      if (!result?.ok) throw new Error(result?.error || '内容已不存在');
      // 与 content.onChanged 并发刷新时，以这次写入返回的状态为准。
      const stored = state.allItems.find(record => record.id === item.id);
      if (stored) stored.pinned = Boolean(result.pinned);
      applyFilters(item.id);
      showNotice(result.pinned ? '已收藏，可在「收藏」中找到' : '已取消收藏', false);
    } catch (error) { showNotice(errorText(error, '收藏失败'), true); }
    finally { state.pinning = false; syncSelection(); }
  }

  /* ---------- 用户操作 ---------- */

  let previewRevision=0;
  function closePreview(focus = true) {
    previewRevision++;
    if (!state.previewItem) return;
    state.previewItem = null;
    $('#bar-preview').hidden = true;
    $('#bar-preview-toggle').setAttribute('aria-expanded', 'false');
    $('#bar-preview-content').replaceChildren();
    syncSelection();
    if (focus) $('#bar-preview-toggle').focus({ preventScroll: true });
  }
  async function previewSelected(){
    const selected=state.items[state.selected];if(!selected)return;
    const revision=++previewRevision;
    try{
      const raw=typeof state.contentApi?.get==='function'?await state.contentApi.get(selected.id):selected;
      if (revision !== previewRevision || !state.visible || currentSelectedId() !== selected.id) return;
      const item=normalizeItem(raw,0);if(!item)throw Error('这条记录已不存在');
      state.previewItem=item;$('#bar-preview-title').textContent=selectionTitle(item);
      const body=$('#bar-preview-content');body.replaceChildren();
      if(item.kind==='image'&&item.thumbnail){const image=document.createElement('img');image.src=item.thumbnail;image.alt=item.title||'图片预览';body.append(image);}
      else{const text=document.createElement('pre');text.textContent=item.text||item.filePath||item.title;body.append(text);}
      $('#bar-preview').hidden = false;
      $('#bar-preview-toggle').setAttribute('aria-expanded', 'true');
      syncSelection();
      body.focus({ preventScroll: true });
    } catch (error) {
      if (revision === previewRevision) showNotice(errorText(error, '预览失败'), true);
    }
  }
  async function copySelected(source='selection'){
    // 预览里的 Ctrl+C 复制预览项；底部「复制」按钮始终作用于当前选中项，
    // 不能因为预览开着就复制到另一条内容。
    const item=source==='preview'?state.previewItem:state.items[state.selected];if(!item||state.committing||!state.returnApi)return;
    state.committing=true;syncSelection();
    try{const result=await state.returnApi.commit({itemId:item.id,intent:'copy-only'});if(!result?.ok||!result.copied)throw Error(result?.error||'复制失败');showNotice('已复制，可继续浏览或按 Ctrl+V 粘贴',false);}
    catch(error){showNotice(errorText(error,'复制失败'),true);}finally{state.committing=false;syncSelection();}
  }

  function onKeyDown(event) {
    if (event.defaultPrevented) return;
    if (event.isComposing || event.keyCode === 229) return;
    const key = event.key;
    if(state.previewItem){
      if(key==='Escape'){event.preventDefault();closePreview();return;}
      if((event.ctrlKey||event.metaKey)&&key.toLowerCase()==='a'){event.preventDefault();const range=document.createRange();range.selectNodeContents($('#bar-preview-content'));const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);return;}
      if((event.ctrlKey||event.metaKey)&&key.toLowerCase()==='c'&&!window.getSelection()?.toString()){event.preventDefault();copySelected('preview');return;}
      // 预览态刻意只响应上面三个键：其余按键若继续作用于列表，
      // 选中项会与正在预览的内容错位，Enter 还可能误提交。
      return;
    }
    // 按钮的 Enter / Space 交给原生点击，不能被全局 Enter 抢走去粘贴。
    if (event.target.closest?.('.relay-result, #bar-action-strip [popover]')) return;
    if (event.target.closest?.('button, summary') && (key === 'Enter' || key === ' ')) return;
    const search = $('#bar-search');
    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'f') {
      event.preventDefault(); search?.focus(); search?.select(); return;
    }
    if (event.target instanceof HTMLInputElement) {
      // 光标键留给输入框，Enter 才提交；Esc 先退出搜索，再关闭面板。
      if (key === 'Escape' || key === 'Esc') {
        event.preventDefault();
        if (search.value) { state.interactionRevision++; search.value = ''; state.query = ''; clearNotice(); applyFilters(); }
        else search.blur();
        return;
      }
      if (key !== 'Enter') return;
    }
    if((event.ctrlKey||event.metaKey)&&key.toLowerCase()==='c'&&!window.getSelection()?.toString()){event.preventDefault();copySelected();return;}
    if(key===' '){event.preventDefault();previewSelected();return;}
    if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Home' || key === 'End') {
      event.preventDefault();
      const total = state.items.length;
      if (!total) return;
      let next = state.selected;
      if (key === 'ArrowLeft') next = Math.max(0, state.selected - 1);
      else if (key === 'ArrowRight') next = Math.min(total - 1, state.selected + 1);
      else if (key === 'Home') next = 0;
      else next = total - 1;
      selectIndex(next);
      return;
    }
    if (key === 'Enter') {
      event.preventDefault();
      submitSelected();
      return;
    }
    if (key === 'Escape' || key === 'Esc') {
      event.preventDefault();
      clearNotice();
      hideBar();
    }
  }

  function onWheel(event) {
    const track = $('#bar-track');
    if (!track) return;
    const deltaX = Number(event.deltaX) || 0;
    const deltaY = Number(event.deltaY) || 0;
    if (!deltaX && !deltaY) return;
    state.interactionRevision++;
    // 鼠标滚轮按像素/行/页归一化后加速；水平触控板保留原生精细滚动。
    if (Math.abs(deltaY) >= Math.abs(deltaX)) {
      const unit = event.deltaMode === 1 ? 36 : event.deltaMode === 2 ? track.clientWidth : 1;
      const distance = Math.sign(deltaY) * Math.min(Math.abs(deltaY) * unit * 2.8, track.clientWidth * .9);
      // 不让 CSS smooth 动画吞掉连续滚轮的位移；键盘选中仍保留平滑滚动。
      track.scrollTo({ left: track.scrollLeft + distance, behavior: 'instant' });
      event.preventDefault();
    }
  }

  function onTrackClick(event) {
    if (state.committing || state.editing || event.detail > 1) return;
    const card = closestFrom(event.target, '.bar-card');
    if (!card) return;
    const index = Number(card.dataset.index);
    if (!Number.isFinite(index)) return;
    if (state.selected !== index) {
      state.interactionRevision++;
      closePreview(false);
      state.selected = index;
      syncSelection();
    }
    card.focus({ preventScroll: true });
    if (closestFrom(event.target, '[data-edit-image]')) editSelectedImage();
  }

  async function editSelectedImage() {
    const item=state.items[state.selected];
    if(!item||item.kind!=='image'||state.editing)return;
    state.editing=true;syncSelection();
    try {
      const result=await window.suira.imageEditor.open({itemId:item.id});
      if(!result?.ok)showNotice(result?.error||'打开图片失败',true);
    } catch(error){showNotice(error.message||'打开图片失败',true);}
    finally{state.editing=false;syncSelection();}
  }

  /* ---------- 订阅 ---------- */

  function subscribe() {
    const barApi = state.barApi;
    if (barApi && typeof barApi.onShown === 'function') {
      try {
        const off = barApi.onShown(() => {
          closePreview(false);
          state.hasOnShown = true;
          state.visible = true;
          clearNotice();
          state.query = ''; state.filter = 'all';
          if ($('#bar-search')) $('#bar-search').value = '';
          load({ resetSelection: true });
          if (document.activeElement !== document.body) document.activeElement.blur();
        });
        if (typeof off === 'function') state.offShown = off;
        // 主进程每次 show 都会发 clipboard-bar:shown，可见性变化不再重复拉取
        state.hasOnShown = true;
      } catch {
        /* 订阅失败不阻塞首屏，这里保留可见性兜底刷新 */
      }
    }

    const contentApi = state.contentApi;
    if (contentApi && typeof contentApi.onChanged === 'function') {
      try {
        const off = contentApi.onChanged(() => {
          // 窗口不可见时主进程会在下次 onShown 时重新拉取，这里不重复请求
          if (!state.visible) return;
          load({ keepItemId: currentSelectedId() });
        });
        if (typeof off === 'function') state.offChanged = off;
      } catch {
        /* 订阅失败时静态列表仍然可用 */
      }
    }
  }

  function bindStaticEvents() {
    const track = $('#bar-track');
    document.addEventListener('keydown', onKeyDown);
    $('#bar-search')?.addEventListener('input', event => {
      state.interactionRevision++;
      state.query = event.target.value; clearNotice(); applyFilters();
    });
    $$('[data-filter]').forEach(button => button.addEventListener('click', () => {
      state.interactionRevision++;
      state.filter = button.dataset.filter; clearNotice(); applyFilters();
    }));
    $('#bar-close')?.addEventListener('click', hideBar);
    $('#bar-submit')?.addEventListener('click', submitSelected);
    $('#bar-pin')?.addEventListener('click', toggleSelectedPin);
    $('#bar-preview-toggle')?.addEventListener('click', () => state.previewItem ? closePreview() : previewSelected());
    $('#bar-preview-close')?.addEventListener('click',()=>closePreview());
    $('#bar-copy')?.addEventListener('click',()=>copySelected('selection'));
    track?.addEventListener('contextmenu',event=>{const card=closestFrom(event.target,'.bar-card');if(!card)return;event.preventDefault();selectIndex(Number(card.dataset.index));previewSelected();});
    $('#bar-refresh-retry')?.addEventListener('click', () => load({ keepItemId: currentSelectedId() }));
    $('#bar-library')?.addEventListener('click', async () => {
      try {
        if (typeof window.suira?.quick?.showMain !== 'function') throw new Error('内容库接口不可用');
        const result = await window.suira.quick.showMain('library');
        if (result?.ok === false) throw new Error(result.error || '打开失败');
        await hideBar();
      } catch (error) { showNotice(errorText(error, '无法打开内容库'), true); }
    });
    if (track) {
      track.addEventListener('click', onTrackClick);
      track.addEventListener('dblclick', event => {
        const card = closestFrom(event.target, '.bar-card');
        if (card?.dataset.id === currentSelectedId() && !closestFrom(event.target, 'button')) submitSelected();
      });
      track.addEventListener('wheel', onWheel, { passive: false });
    }
    const retry = $('#bar-retry');
    if (retry) {
      retry.addEventListener('click', () => {
        clearNotice();
        load({ keepItemId: currentSelectedId() });
      });
    }

    document.addEventListener('visibilitychange', () => {
      const wasVisible = state.visible;
      state.visible = document.visibilityState === 'visible';
      if (!state.visible) {
        closePreview(false);
        document.getElementById('relay-result')?.close();
        syncSelection();
      }
      if (state.visible && !wasVisible && !state.hasOnShown) {
        // 没有 onShown 接口时，靠可见性变化兜底刷新
        load({ resetSelection: true });
      }
    });

    window.addEventListener('beforeunload', () => {
      clearTimeout(state.noticeTimer);
      if (typeof state.offShown === 'function') state.offShown();
      if (typeof state.offChanged === 'function') state.offChanged();
    });
  }

  function init() {
    detectApis();
    // 窗口可能先隐藏着预热（主进程 show:false 预创建），按真实可见性初始化
    state.visible = document.visibilityState === 'visible';
    bindStaticEvents();
    render();
    subscribe();
    if (state.offline) {
      state.loading = false;
      state.loaded = true;
      render();
      return;
    }
    load({ resetSelection: true });
  }

  window.ClipboardBarSelection = {
    item: () => state.previewItem || !state.visible ? null : state.items[state.selected],
    notice: showNotice
  };
  init();
})();
