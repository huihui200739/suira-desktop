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
 * - 单击卡片或按 Enter 粘贴到输入窗口，左上角圆圈用于多选；
 * - 置顶时粘贴后保留窗口，主进程负责窗口状态和安全的焦点交接；
 * - clipboardBar.onShown 时重新拉取并重置选中项，content.onChanged 仅在可见时刷新。
 *
 * 所有接口先 feature-detect：缺接口时给出可读提示，不允许点了没反应。
 */

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const actionHost = $('#bar-action-strip');

  const KIND_LABELS = { text: '文字', link: '链接', image: '图片', files: '文件' };
  const NOTICE_DURATION = 2000;
  const SUMMARY_LIMIT = 180;
  const EMPTY_COPY = '还没有剪贴板记录，复制一段文字或一张图再试';

  const GLYPHS = {
    image: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4.6 17 4.4-4.4 3.5 3.5 3-3 3.9 3.9"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4"/><path d="M9.5 12h5M9.5 15.5h3.5"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M13.5 10.5a3.5 3.5 0 0 0-5 0L6 13a3.5 3.5 0 0 0 5 5l1-1"/></svg>'
  };

  const CARD_ACTIONS = {
    select: ['选中这条记录', '<circle cx="12" cy="12" r="8"/><path class="card-select-check" d="m8.5 12 2.4 2.4 4.6-4.8"/>'],
    share: ['分享', '<path d="M12 15V3m-4 4 4-4 4 4M8 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-2"/>'],
    crop: ['改图 · 裁剪', '<path d="M7 3v12a2 2 0 0 0 2 2h12M3 7h12a2 2 0 0 1 2 2v12"/>'],
    open: ['在浏览器打开链接', '<path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1M13.5 10.5a3.5 3.5 0 0 0-5 0L6 13a3.5 3.5 0 0 0 5 5l1-1"/>'],
    copy: ['复制（Ctrl+C）', '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 4H6a2 2 0 0 0-2 2v10"/>'],
    edit: ['编辑', '<path d="m5 16-1 4 4-1L20 7l-3-3zM15 6l3 3"/>'],
    pin: ['钉在桌面', '<path d="m8 3 8 0-1 7 3 4H6l3-4zM12 14v7"/>'],
    save: ['下载原图', '<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>'],
    favorite: ['收藏', '<path d="m12 3 2.75 5.6 6.2.9-4.48 4.36 1.06 6.17L12 17.1l-5.53 2.92 1.06-6.17L3.05 9.5l6.2-.9z"/>'],
    more: ['更多操作（Ctrl+K）', '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>']
  };

  const IMAGE_ACTIONS = ['crop', 'edit', 'pin', 'save'];
  const SOURCE_LABELS = { screenshot: '随序截图', clipboard: '剪贴板', derived: '随序', user: '手动添加' };
  const sizeFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
  const encoder = new TextEncoder();
  const state = {
    barApi: null,
    contentApi: null,
    returnApi: null,
    items: [],
    allItems: [],
    query: '',
    filter: 'all',
    pinning: false,
    shelfPinBusy: false,
    imageActionBusy: false,
    sharingImages: false,
    checkedImages: new Set(),
    batchMode: false,
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
      sourceType: source?.type || '',
      textDetails: ['text', 'link'].includes(kind) && raw.text ? textDetails(raw.text) : '',
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

  function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes >= 1024 ** 2) return `${sizeFormat.format(bytes / 1024 ** 2)} MB`;
    if (bytes >= 1024) return `${sizeFormat.format(bytes / 1024)} KB`;
    return `${sizeFormat.format(bytes)} B`;
  }

  function textDetails(text) {
    let characters = 0;
    for (const character of text) characters++;
    return `${characters} 字符 · ${formatSize(encoder.encode(text).length)}`;
  }

  function cardDetails(item) {
    if (item.kind === 'image') {
      const { width, height, byteSize } = item.meta;
      return [width > 0 && height > 0 ? `${width}×${height}` : '', formatSize(byteSize)].filter(Boolean).join(' · ');
    }
    return item.kind === 'files' ? `${fileCount(item)} 个文件` : item.textDetails;
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

  function cardButton(action, item) {
    const [label, icon] = CARD_ACTIONS[action];
    const name = action === 'select' && item.kind === 'image' ? '勾选图片以分享'
      : action === 'favorite' && item.pinned ? '取消收藏'
      : action === 'edit' && item.kind === 'image' ? '编辑 · 标注' : label;
    const extra = action === 'favorite' ? ` aria-pressed="${item.pinned}"`
      : action === 'select' ? ' class="card-select" aria-pressed="false"'
      : action === 'share' ? ' aria-haspopup="dialog" aria-controls="bar-share" aria-expanded="false"' : '';
    return `<button type="button" tabindex="-1" data-card-action="${action}"${extra} aria-label="${name}" title="${name}"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg></button>`;
  }

  function cardMarkup(item, index) {
    const label = KIND_LABELS[item.kind] || '内容';
    const time = relativeTime(item.createdAt).replace(/前$/, '');
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

    const actions = [];
    if (item.kind === 'image') {
      if (state.barApi?.saveImage) actions.push('save');
      if (state.returnApi) actions.push('share');
      if (window.suira?.imageEditor?.open) actions.push('crop', 'edit');
      if (window.suira?.actions?.run) actions.push('pin');
    } else if (item.kind === 'text' || item.kind === 'link') {
      if (item.kind === 'link' && window.suira?.actions?.run) actions.push('open');
      if (state.returnApi) actions.push('share', 'copy');
      if (state.contentApi?.addText) actions.push('edit');
    } else if (state.returnApi) {
      actions.push('copy');
    }
    if (state.contentApi?.togglePin) actions.push('favorite');
    if (window.suira?.actions) actions.push('more');
    const appName = item.appName || SOURCE_LABELS[item.sourceType] || '本机';
    const source = `<span class="card-source-icon"${item.appName ? ` data-source-app="${escapeHtml(item.appName)}"` : ''} role="img" aria-label="来源：${escapeHtml(appName)}" title="${escapeHtml(appName)}"><span>${escapeHtml(appName.slice(0, 1).toUpperCase())}</span></span>`;
    const details = cardDetails(item);
    const metadata = [time, details].filter(Boolean).join(' · ');
    const name = [label, selectionTitle(item), appName, metadata].filter(Boolean).join('，');
    return `<article class="bar-card" id="bar-card-${index}" role="listitem" tabindex="-1" data-index="${index}" data-id="${escapeHtml(item.id)}" data-kind="${escapeHtml(item.kind)}" aria-label="${escapeHtml(name)}">
      <div class="card-head">
        ${cardButton('select', item)}
        <span class="card-type">${label}${item.pinned ? ' <span class="card-favorite" aria-label="已收藏">★</span>' : ''}</span>
        <div class="card-actions" role="group" aria-label="卡片操作">${actions.map(action => cardButton(action, item)).join('')}<span class="card-more-slot"></span></div>
      </div>
      <div class="${visualClass}">${visual}</div>
      <div class="card-foot">${source}<span class="card-metadata" title="${escapeHtml(metadata)}">${escapeHtml(metadata)}</span></div>
    </article>`;
  }

  const sourceIcons=new Map();let iconsPending=null;
  function loadSourceIcons(){
    const nodes=$$('.card-source-icon[data-source-app]'),names=[...new Set(nodes.map(node=>node.dataset.sourceApp))];
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

  function updateShareButton() {
    const count = state.checkedImages.size;
    const button = $('#bar-share-images');
    $('#bar-track').classList.toggle('has-checked-images', state.batchMode);
    $('#bar-done-selecting').hidden=!state.batchMode;
    if (count === 0 && shareAnchor === button) closeShare();
    button.hidden = count === 0;
    button.disabled = state.sharingImages;
    button.textContent = `分享 ${count} 张图片`;
  }

  function exitBatchMode(restoreFocus=false) {
    state.batchMode=false;state.checkedImages.clear();syncSelection();
    if(restoreFocus)$$('.bar-card')[state.selected]?.focus({preventScroll:true});
  }

  function syncSelection() {
    const cards = $$('.bar-card');
    const selected = cards[state.selected];
    const focusedCard = document.activeElement?.closest('.bar-card');
    for (const card of cards) {
      const active = card === selected;
      const checked = state.checkedImages.has(card.dataset.id);
      card.classList.toggle('is-selected', active);
      card.classList.toggle('is-checked', checked);
      card.tabIndex = active ? 0 : -1;
      if (active) card.setAttribute('aria-current', 'true');
      else card.removeAttribute('aria-current');
      for (const button of card.querySelectorAll('[data-card-action]')) {
        const action = button.dataset.cardAction;
        button.tabIndex = active ? 0 : -1;
        const busy = state.loading || (action === 'copy' && state.committing) ||
          (action === 'favorite' && state.pinning) ||
          (card.dataset.kind === 'image' && IMAGE_ACTIONS.includes(action) && state.imageActionBusy);
        if (busy) button.setAttribute('aria-disabled', 'true');
        else button.removeAttribute('aria-disabled');
        if (action === 'select') {
          const batchSelectable = card.dataset.kind === 'image' && state.barApi?.copyImages;
          button.setAttribute('aria-pressed', String(batchSelectable ? checked : active && !state.checkedImages.size));
        }
        if (action === 'share') button.setAttribute('aria-expanded', String(button === shareAnchor));
      }
    }
    updateShareButton();
    const actionId = state.visible && !state.previewItem ? currentSelectedId() : '';
    const anchor = actionId ? selected?.querySelector('.card-more-slot') : null;
    const parent = anchor || $('.bar-body');
    if (actionHost.parentElement !== parent) parent.append(actionHost);
    if (actionHost.dataset.itemId !== actionId) {
      actionHost.dataset.itemId = actionId;
      actionHost.dispatchEvent(new Event('bar-selection-change'));
    }
    if (focusedCard && selected && focusedCard !== selected) selected.focus({ preventScroll: true });
    $('#bar').setAttribute('aria-busy', String(state.committing));
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
          if (!unchanged) {
            const active = document.activeElement;
            const action = card.contains(active) ? active.dataset.cardAction : '';
            if (card.contains(shareAnchor)) closeShare();
            card.innerHTML = next.innerHTML;
            if (action) card.querySelector(`[data-card-action="${action}"]`)?.focus({ preventScroll: true });
          } else {
            const footer = card.querySelector('.card-metadata');
            const nextFooter = next.querySelector('.card-metadata');
            footer.textContent = nextFooter.textContent;
            footer.title = nextFooter.title;
          }
          card.id = next.id;
          card.dataset.index = String(index);
          card.setAttribute('aria-label', next.getAttribute('aria-label'));
        }
        card._contentMarkup = markup;
        card._recordSignature = JSON.stringify(item);
        existing.delete(item.id);
        if (track.children[index] !== card) track.insertBefore(card,track.children[index] || null);
      });
      existing.forEach(card => {
        if (card.contains(shareAnchor)) closeShare();
        card.remove();
      });
      bindImageFallbacks();
      loadSourceIcons();
    } else {
      closeShare();
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

  function showNotice(message, isError, copied = false) {
    const notice = $('#bar-notice');
    if (!notice) return;
    notice.textContent = String(message || '');
    if (!isError && copied) window.SuiraUI?.copyFeedback(notice);
    notice.hidden = false;
    notice.classList.toggle('is-error', Boolean(isError));
    clearTimeout(state.noticeTimer);
    state.noticeTimer = window.setTimeout(() => {
      state.noticeTimer = 0;
      notice.hidden = true;
      notice.textContent = '';
      notice.classList.remove('is-error');
    }, NOTICE_DURATION);
  }

  function clearNotice() {
    if (state.noticeTimer) {
      clearTimeout(state.noticeTimer);
      state.noticeTimer = 0;
    }
    const notice = $('#bar-notice');
    if (notice) {
      notice.hidden = true;
      notice.textContent = '';
      notice.classList.remove('is-error');
    }
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
      const payload = await api.list({ limit: 120, cardDetails: true });
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
      const availableImages = new Set(items.filter(item => item.kind === 'image').map(item => item.id));
      for (const id of state.checkedImages) {
        if (!availableImages.has(id)) state.checkedImages.delete(id);
      }
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
    if (state.committing || state.imageActionBusy || state.loading || state.batchMode) return;
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
      if (!result?.ok || !result.copied) {
        showNotice(result?.error || result?.message || '复制失败', true);
      } else if (result.keptOpen && !result.pasted) {
        showNotice(result.message || '已复制，请按 Ctrl+V 粘贴', false, Boolean(result.copied));
      }
    } catch (error) {
      showNotice(errorText(error, '复制失败'), true);
    } finally {
      state.committing = false;
      syncSelection();
    }
  }

  function syncShelfPin(pinned) {
    const button = $('#bar-shelf-pin');
    button.setAttribute('aria-pressed', String(pinned));
    button.title = pinned ? '取消置顶' : '置顶剪贴板';
  }

  async function toggleShelfPin() {
    if (state.shelfPinBusy || typeof state.barApi?.setPinned !== 'function') return;
    const pinned = $('#bar-shelf-pin').getAttribute('aria-pressed') === 'true';
    state.shelfPinBusy = true;
    try {
      const result = await state.barApi.setPinned(!pinned);
      if (!result?.ok) throw Error(result?.error || '无法切换剪贴板置顶');
      syncShelfPin(result.pinned === true);
    } catch (error) {
      showNotice(errorText(error, '无法切换剪贴板置顶'), true);
    } finally {
      state.shelfPinBusy = false;
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

  let shareAnchor = null;
  const sharePanel = $('#bar-share');

  function closeShare() {
    if (!shareAnchor) return;
    shareAnchor.setAttribute('aria-expanded', 'false');
    shareAnchor = null;
    if (sharePanel.matches(':popover-open')) sharePanel.hidePopover();
    sharePanel.replaceChildren();
  }

  function showShareMenu(button, choices) {
    const wasOpen = shareAnchor === button && sharePanel.matches(':popover-open');
    closeShare();
    if (wasOpen) return;
    shareAnchor = button;
    button.setAttribute('aria-expanded', 'true');
    for (const [label, run] of choices) {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.textContent = label;
      choice.addEventListener('click', () => {
        closeShare();
        button.focus({ preventScroll: true });
        run();
      });
      sharePanel.append(choice);
    }
    const rect = button.getBoundingClientRect();
    sharePanel.style.top = `${rect.bottom + 4}px`;
    sharePanel.style.right = `${Math.max(8, innerWidth - rect.right)}px`;
    sharePanel.showPopover();
    sharePanel.firstElementChild.focus({ preventScroll: true });
  }

  function openShare(item, button) {
    const label = item.kind === 'image' ? '复制图片以分享' : item.kind === 'link' ? '复制链接以分享' : '复制文字以分享';
    const choices = [[label, () => copySelected('share', item)]];
    if (item.kind === 'image' && state.barApi?.saveImage) choices.push(['下载原图以分享', () => runImageAction(item, 'save')]);
    showShareMenu(button, choices);
  }

  async function copyCheckedImages() {
    if (state.sharingImages || !state.checkedImages.size) return;
    const ids = [...state.checkedImages];
    state.sharingImages = true;
    updateShareButton();
    try {
      const result = await state.barApi.copyImages(ids);
      if (!result?.ok) throw new Error(result?.error || '剪贴板暂时不可用');
      showNotice(`已复制 ${result.count} 张原图，可粘贴到支持文件的应用`, false, true);
    } catch (error) {
      showNotice(errorText(error, '分享失败'), true);
    } finally {
      state.sharingImages = false;
      updateShareButton();
    }
  }

  async function openLink(item) {
    try {
      const result = await window.suira.actions.run(item.id, 'output.open');
      if (!result?.ok) throw new Error(result?.error || '链接无法打开');
    } catch (error) {
      showNotice(errorText(error, '打开链接失败'), true);
    }
  }

  let previewRevision=0;
  function closePreview(focus = true) {
    previewRevision++;
    if (!state.previewItem) return;
    state.previewItem = null;
    $('#bar-preview').hidden = true;
    $('#bar-preview-label').textContent = '内容预览';
    $('#bar-edit-save').hidden = true;
    $('#bar-preview-content').replaceChildren();
    syncSelection();
    if (focus) $$('.bar-card')[state.selected]?.focus({ preventScroll: true });
  }
  async function previewSelected(edit = false){
    const selected=state.items[state.selected];if(!selected)return;
    const revision=++previewRevision;
    try{
      const raw=typeof state.contentApi?.get==='function'?await state.contentApi.get(selected.id):selected;
      if (revision !== previewRevision || !state.visible || currentSelectedId() !== selected.id) return;
      const item=normalizeItem(raw,0);if(!item)throw Error('这条记录已不存在');
      state.previewItem=item;$('#bar-preview-title').textContent=selectionTitle(item);
      const body=$('#bar-preview-content');body.replaceChildren();
      if (edit && ['text', 'link'].includes(item.kind)) {
        const textarea = document.createElement('textarea');
        textarea.className = 'bar-text-editor';
        textarea.setAttribute('aria-label', '编辑剪贴板文字');
        textarea.maxLength = 200000;
        textarea.value = item.text;
        body.append(textarea);
        $('#bar-preview-label').textContent = '编辑内容';
        $('#bar-edit-save').hidden = false;
      } else if(item.kind==='image'&&item.thumbnail){const image=document.createElement('img');image.src=item.thumbnail;image.alt=item.title||'图片预览';body.append(image);}
      else{const text=document.createElement('pre');text.textContent=item.text||item.filePath||item.title;body.append(text);}
      $('#bar-preview').hidden = false;
      syncSelection();
      (body.querySelector('textarea') || body).focus({ preventScroll: true });
    } catch (error) {
      if (revision === previewRevision) showNotice(errorText(error, '预览失败'), true);
    }
  }
  async function saveEditedText() {
    const button = $('#bar-edit-save');
    const field = $('.bar-text-editor');
    const text = field?.value;
    if (!text?.trim()) {
      showNotice('请输入要保存的文字', true);
      field?.focus();
      return;
    }
    if (text === state.previewItem?.text) { closePreview(); return; }
    const revision = previewRevision;
    button.disabled = true;
    try {
      const result = await state.contentApi.addText({ text, source: 'clipboard' });
      if (!result?.ok) throw new Error(result?.error || '无法保存');
      if (revision !== previewRevision) return;
      closePreview();
      showNotice('已保存为新的历史记录', false);
      await load({ keepItemId: result.item?.id });
    } catch (error) {
      if (revision === previewRevision) showNotice(errorText(error, '保存失败'), true);
    } finally {
      button.disabled = false;
    }
  }

  async function copySelected(source='selection', target = null){
    // 预览内的 Ctrl+C 优先复制正在预览的记录。
    const item=target || (source==='preview'?state.previewItem:state.items[state.selected]);if(!item||state.committing||!state.returnApi)return;
    state.committing=true;syncSelection();
    try{const result=await state.returnApi.commit({itemId:item.id,intent:'copy-only'});if(!result?.ok||!result.copied)throw Error(result?.error||'复制失败');showNotice(source === 'share' ? '已复制，可粘贴到要分享的应用' : '已复制，可继续浏览或按 Ctrl+V 粘贴',false,true);}
    catch(error){showNotice(errorText(error,'复制失败'),true);}finally{state.committing=false;syncSelection();}
  }

  function onKeyDown(event) {
    if (event.defaultPrevented) return;
    if (event.isComposing || event.keyCode === 229) return;
    const key = event.key;
    if(event.repeat&&(key==='Escape'||key==='Esc')){event.preventDefault();return;}
    if (shareAnchor) {
      if (key === 'Escape') {
        event.preventDefault();
        const button = shareAnchor;
        closeShare();
        button.focus({ preventScroll: true });
      }
      return;
    }
    if(state.previewItem){
      if(key==='Escape'){event.preventDefault();closePreview();return;}
      if ($('#bar-preview-content textarea')) return;
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
      if (!event.repeat) {
        const item=state.items[state.selected];
        if (state.batchMode) toggleBatchImage(item);
        else submitSelected();
      }
      return;
    }
    if (key === 'Escape' || key === 'Esc') {
      event.preventDefault();
      if (state.batchMode) {exitBatchMode(true);return;}
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

  function toggleBatchImage(item) {
    if (item?.kind !== 'image' || !state.barApi?.copyImages) return false;
    state.batchMode=true;
    if (state.checkedImages.has(item.id)) state.checkedImages.delete(item.id);
    else state.checkedImages.add(item.id);
    syncSelection();
    return true;
  }

  function onTrackClick(event) {
    const card = closestFrom(event.target, '.bar-card');
    if (!card || event.detail > 1 || closestFrom(event.target, '#bar-action-strip, [popover]')) return;
    const index = Number(card.dataset.index);
    if (state.items[index]?.id !== card.dataset.id) return;
    const button = closestFrom(event.target, '[data-card-action]');
    if (button?.getAttribute('aria-disabled') === 'true') return;
    if (state.selected !== index) {
      state.interactionRevision++;
      closePreview(false);
      state.selected = index;
      syncSelection();
    }
    if (!button && !state.batchMode) {
      card.focus({ preventScroll: true });
      submitSelected();
      return;
    }
    const action = button?.dataset.cardAction || 'select';
    if (action === 'select') {
      if (!button) card.focus({ preventScroll: true });
      if (!toggleBatchImage(state.items[index])) card.focus({ preventScroll: true });
    } else if (action === 'share') openShare(state.items[index], button);
    else if (action === 'open') openLink(state.items[index]);
    else if (action === 'edit' && state.items[index].kind !== 'image') previewSelected(true);
    else if (action === 'copy') copySelected('selection');
    else if (action === 'favorite') toggleSelectedPin();
    else if (action === 'more') {
      const summary = $('#bar-action-strip summary');
      summary?.focus({ preventScroll: true });
      summary?.click();
    } else if (IMAGE_ACTIONS.includes(action)) {
      runImageAction(state.items[index], action);
    }
  }

  async function runImageAction(item, action) {
    if (item?.kind !== 'image' || state.imageActionBusy) return;
    state.imageActionBusy = true;
    syncSelection();
    try {
      const result = ['crop', 'edit'].includes(action)
        ? await window.suira.imageEditor.open({ itemId: item.id, ...(action === 'crop' ? { tool: 'select' } : {}) })
        : action === 'pin' ? await window.suira.actions.run(item.id, 'image.pin')
        : await state.barApi.saveImage(item.id);
      if (result?.canceled) return;
      if (!result?.ok) throw new Error(result?.error || `${CARD_ACTIONS[action][0]}失败`);
      if (action === 'save') showNotice('图片已保存', false);
      if (action === 'pin') showNotice('已钉在桌面', false);
    } catch (error) {
      showNotice(errorText(error, '图片操作失败'), true);
    } finally {
      state.imageActionBusy = false;
      syncSelection();
    }
  }

  /* ---------- 订阅 ---------- */

  function subscribe() {
    const barApi = state.barApi;
    if (barApi && typeof barApi.onShown === 'function') {
      try {
        const off = barApi.onShown(({ pinned = false } = {}) => {
          syncShelfPin(pinned);
          closeShare();
          state.batchMode=false;
          state.checkedImages.clear();
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
    const shelfPin = $('#bar-shelf-pin');
    shelfPin.hidden = typeof state.barApi?.setPinned !== 'function';
    shelfPin.addEventListener('click', toggleShelfPin);
    $('#bar-preview-close')?.addEventListener('click',()=>closePreview());
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
      track.addEventListener('scroll', () => {
        if (shareAnchor?.closest('.bar-card')) closeShare();
      }, { passive: true });
      track.addEventListener('click', onTrackClick);
      track.addEventListener('wheel', onWheel, { passive: false });
    }
    const retry = $('#bar-retry');
    if (retry) {
      retry.addEventListener('click', () => {
        clearNotice();
        load({ keepItemId: currentSelectedId() });
      });
    }

    $('#bar-done-selecting').addEventListener('click',()=>exitBatchMode(true));
    $('#bar-share-images').addEventListener('click', event => {
      if (!state.checkedImages.size) return;
      showShareMenu(event.currentTarget, [
        [`复制 ${state.checkedImages.size} 张原图`, copyCheckedImages],
        ['取消全部勾选', () => {
          state.checkedImages.clear();
          syncSelection();
          $$('.bar-card')[state.selected]?.focus({ preventScroll: true });
        }]
      ]);
    });
    $('#bar-edit-save').addEventListener('click', saveEditedText);
    sharePanel.addEventListener('toggle', () => {
      if (!sharePanel.matches(':popover-open')) closeShare();
    });
    document.addEventListener('visibilitychange', () => {
      const wasVisible = state.visible;
      state.visible = document.visibilityState === 'visible';
      if (!state.visible) {
        closeShare();
        state.batchMode=false;
        state.checkedImages.clear();
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
