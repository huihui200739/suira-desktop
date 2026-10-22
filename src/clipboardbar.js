'use strict';

/**
 * 剪贴板历史条渲染层。
 *
 * 契约：主进程创建 1180×196 的置顶无边框透明窗口，贴着主显示器工作区底部；
 * 页面只适配这个视口，不自己改窗口尺寸。隐藏与失焦由主进程负责，页面不额外处理。
 *
 * 职责：
 * - 从 window.suira.content 拉取内容库列表，按类型渲染卡片：
 *   图片用 thumbnail 缩略图，文字用前 90 字摘要，files 用文件名 + 文件数，link 用域名；
 * - 键盘（← → Home End Enter Esc）与滚轮横向浏览，单击选中、双击提交；
 * - Enter 调 window.suira.returnTo.commit({ itemId, intent: 'return-and-paste' })：
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
  const SUMMARY_LIMIT = 90;
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
    selected: -1,
    loading: true,
    loaded: false,
    error: '',
    offline: false,
    committing: false,
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
      createdAt: Number(raw.createdAt) || 0
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
    if (item.title) return item.title;
    if (item.kind === 'image') return '图片';
    if (item.kind === 'files') return filesTitle(item);
    if (item.kind === 'link') return linkDomain(item);
    return textSummary(item);
  }

  function selectionMeta(item) {
    const bits = [];
    if (item.appName) bits.push(`来源 ${item.appName}`);
    const time = relativeTime(item.createdAt);
    if (time) bits.push(time);
    return bits.join(' · ');
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
    let visual = '';
    let visualClass = 'card-visual';

    if (item.kind === 'image') {
      visual = imageVisual(item);
      if (!item.thumbnail) visualClass += ' is-placeholder';
    } else if (item.kind === 'files') {
      visualClass += ' is-stack';
      visual = `<span class="card-glyph">${GLYPHS.file}</span>
        <b class="card-name" title="${escapeHtml(filesTitle(item))}">${escapeHtml(filesTitle(item))}</b>
        <span class="card-count">${fileCount(item)} 个文件</span>`;
    } else if (item.kind === 'link') {
      visualClass += ' is-stack';
      visual = `<span class="card-glyph">${GLYPHS.link}</span>
        <b class="card-name" title="${escapeHtml(linkDomain(item))}">${escapeHtml(linkDomain(item))}</b>`;
    } else {
      visual = `<p class="card-snippet">${escapeHtml(textSummary(item))}</p>`;
    }

    const tooltip = [label, selectionTitle(item), time].filter(Boolean).join(' · ');
    return `<article class="bar-card" id="bar-card-${index}" role="option" aria-selected="false" tabindex="-1" data-index="${index}" data-id="${escapeHtml(item.id)}" data-kind="${escapeHtml(item.kind)}" title="${escapeHtml(tooltip)}">
      <div class="${visualClass}">${visual}</div>
      <div class="card-foot">
        <span class="card-kind">${label}</span>
        <span class="card-time">${escapeHtml(time)}</span>
      </div>
    </article>`;
  }

  function bindImageFallbacks() {
    $$('.card-thumb').forEach((img) => {
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
      hint.textContent = '主进程没有提供剪贴板历史接口，重启随序后再试。';
      retry.hidden = true;
    } else if (state.loading) {
      mode = 'loading';
      title.textContent = '正在读取剪贴板历史…';
      hint.textContent = '马上就好';
      retry.hidden = true;
    } else if (state.error) {
      mode = 'error';
      title.textContent = '暂时读不到剪贴板历史';
      hint.textContent = state.error;
      retry.hidden = false;
    } else {
      title.textContent = EMPTY_COPY;
      hint.textContent = '唤出后用 ← → 浏览，Enter 复制并返回。';
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
      line.textContent = state.loading ? '正在读取剪贴板历史…' : '用 ← → 选择一条记录';
      return;
    }
    line.classList.remove('is-empty');
    const meta = selectionMeta(item);
    line.innerHTML = `<span class="sel-kind">${escapeHtml(KIND_LABELS[item.kind] || '内容')}</span>
      <span class="sel-title">${escapeHtml(selectionTitle(item))}</span>
      ${meta ? `<span class="sel-meta">${escapeHtml(meta)}</span>` : ''}`;
  }

  function syncSelection() {
    const track = $('#bar-track');
    const cards = $$('.bar-card');
    cards.forEach((card, index) => {
      const active = index === state.selected;
      card.classList.toggle('is-selected', active);
      card.setAttribute('aria-selected', active ? 'true' : 'false');
      card.setAttribute('tabindex', active ? '0' : '-1');
    });
    if (track) {
      if (state.selected >= 0) track.setAttribute('aria-activedescendant', `bar-card-${state.selected}`);
      else track.removeAttribute('aria-activedescendant');
    }
    renderSelectionLine();
  }

  function render() {
    const track = $('#bar-track');
    const empty = $('#bar-empty');
    const count = $('#bar-count');
    if (!track) return;

    const showItems = !state.offline && !state.loading && !state.error && state.items.length > 0;
    track.hidden = !showItems;
    if (empty) empty.hidden = showItems;
    if (showItems) {
      track.innerHTML = state.items.map(cardMarkup).join('');
      bindImageFallbacks();
    } else {
      track.innerHTML = '';
    }
    if (count) {
      count.textContent = state.offline ? '—' : (state.loading ? '…' : `${state.items.length} 条`);
    }
    configureEmpty();
    syncSelection();
  }

  function scrollCardIntoView(index, behavior = 'smooth') {
    const card = document.getElementById(`bar-card-${index}`);
    if (!card || typeof card.scrollIntoView !== 'function') return;
    try {
      card.scrollIntoView({ block: 'nearest', inline: 'center', behavior });
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
    const next = Math.max(0, Math.min(total - 1, Number(index) || 0));
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

  async function load(options = {}) {
    const api = state.contentApi;
    const token = ++loadToken;
    state.loading = true;
    state.error = '';
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
      const payload = await api.list({ limit: 60 });
      if (token !== loadToken) return;
      const items = (Array.isArray(payload) ? payload : []).map(normalizeItem).filter(Boolean);
      state.items = items;
      state.loading = false;
      state.loaded = true;
      state.error = '';
      const keepId = options.keepItemId || '';
      let next = keepId ? items.findIndex((item) => item.id === keepId) : -1;
      if (next < 0) next = items.length ? 0 : -1;
      state.selected = next;
      render();
      if (next >= 0) {
        if (options.resetSelection) resetScroll();
        scrollCardIntoView(next, options.resetSelection ? 'auto' : 'smooth');
      }
    } catch (error) {
      if (token !== loadToken) return;
      state.loading = false;
      state.loaded = true;
      state.error = errorText(error, '读取剪贴板历史失败');
      state.items = [];
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
    if (state.committing) return;
    const item = state.items[state.selected];
    if (!item) return;
    const api = state.returnApi;
    if (!api) {
      showNotice('当前版本不支持复制并返回', true);
      return;
    }
    state.committing = true;
    try {
      const result = await api.commit({ itemId: item.id, intent: 'return-and-paste' });
      if (result && result.ok) {
        if (result.copied) {
          if (result.pasted === true) {
            // 已经粘回原窗口，直接收起，不再显示提示
            await hideBar();
            return;
          }
          // 只复制成功、没能自动粘贴：保留窗口并说明下一步
          showNotice(result.message || '已复制，切回目标后粘贴', false);
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
    }
  }

  /* ---------- 用户操作 ---------- */

  function onKeyDown(event) {
    if (event.defaultPrevented) return;
    if (event.isComposing || event.keyCode === 229) return;
    const key = event.key;
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
    // 竖直滚轮转换成横向浏览；水平触控板的 deltaX 交给浏览器原生滚动
    if (Math.abs(deltaY) >= Math.abs(deltaX)) {
      track.scrollLeft += deltaY;
      event.preventDefault();
    }
  }

  function onTrackClick(event) {
    const card = closestFrom(event.target, '.bar-card');
    if (!card) return;
    const index = Number(card.dataset.index);
    if (Number.isFinite(index)) selectIndex(index);
  }

  function onTrackDoubleClick(event) {
    const card = closestFrom(event.target, '.bar-card');
    if (!card) return;
    event.preventDefault();
    const index = Number(card.dataset.index);
    if (!Number.isFinite(index)) return;
    state.selected = Math.max(0, Math.min(state.items.length - 1, index));
    syncSelection();
    submitSelected();
  }

  /* ---------- 订阅 ---------- */

  function subscribe() {
    const barApi = state.barApi;
    if (barApi && typeof barApi.onShown === 'function') {
      try {
        const off = barApi.onShown(() => {
          state.hasOnShown = true;
          state.visible = true;
          clearNotice();
          load({ resetSelection: true });
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
    if (track) {
      track.addEventListener('click', onTrackClick);
      track.addEventListener('dblclick', onTrackDoubleClick);
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

  init();
})();
