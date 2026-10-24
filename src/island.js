'use strict';

/**
 * 浮引岛（文件中转）渲染层。
 *
 * 职责边界：
 * - 只负责「画」与「传递用户意图」：状态由主进程（window.suira.island）持有，
 *   文件移动/打开/拖出都由主进程完成，渲染层不碰文件系统。
 * - 窗口尺寸由主进程改：渲染层只切 data-mode 并调 setMode，不自己改窗口。
 * - 缺少 island 接口时进入「不可用」态：给出可读提示、按钮明确禁用，不允许点了没反应。
 *
 * 三态（由主进程按窗口尺寸配套）：
 *   sleep  隐形热区 —— 屏幕上什么都没有，只等文件拖进来
 *   rail   胶囊     —— 保留兼容形态，普通悬停不会唤醒
 *   sheet  暂存卡片 —— 拖入文件或点击胶囊后出现，闲置几秒自动回休眠
 *
 * 交互节奏：
 *   - 普通悬停、已有暂存内容都不唤醒；文件拖入才展开
 *   - 指针离开 320ms 回休眠：留出从胶囊移到卡片的时间
 *   - 拖入立刻展开、离开立刻收起：拖放过程中不能有"展示动画"挡路
 */

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  // 指针离开后的收起延迟。island-check 会检查这个值，改动要同步说明。
  const COLLAPSE_DELAY = 180;
  // 胶囊回收成休眠的延迟：比收起卡片更宽容，避免从胶囊点到卡片时闪一下
  const REST_DELAY = 320;
  const TOAST_DURATION = 2200;

  const POLICY_TEXT = { copy: '复制', move: '移动' };
  const KIND_TEXT = { image: '图片', document: '文档', archive: '压缩包', folder: '文件夹', file: '文件' };
  const MODES = ['sleep', 'sheet'];

  const GLYPHS = {
    image: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4.6 17 4.4-4.4 3.5 3.5 3-3 3.9 3.9"/></svg>',
    document: '<svg viewBox="0 0 24 24"><path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4"/><path d="M9.5 12h6M9.5 15.5h4.5"/></svg>',
    archive: '<svg viewBox="0 0 24 24"><rect x="4" y="4.5" width="16" height="4" rx="1.2"/><path d="M5.5 8.5v10a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-10"/><path d="M10.5 12h3"/></svg>',
    folder: '<svg viewBox="0 0 24 24"><path d="M3.5 7.5a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h7.5a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z"/></svg>',
    file: '<svg viewBox="0 0 24 24"><path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4"/></svg>'
  };

  const state = {
    api: null,
    items: [],
    policy: 'copy',
    mode: 'sleep',
    maxItems: 24,
    loaded: false,
    canUndo: false,
    loading: false,
    error: '',
    hovering: false,
    draggingOut: false,
    receiving: false,
    dragDepth: 0,
    hoverTimer: 0,
    restTimer: 0,
    toastTimer: 0,
    lastPingAt: 0,
    offState: null,
    offExpanded: null,
    offMode: null
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

  function toast(message) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'toast is-visible';
    clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => { el.className = 'toast'; }, TOAST_DURATION);
  }

  function policyText(policy = state.policy) {
    return POLICY_TEXT[policy] || POLICY_TEXT.copy;
  }

  function detectApi() {
    const candidate = window.suira && window.suira.island;
    if (!candidate || typeof candidate.getState !== 'function') return null;
    return candidate;
  }

  function canSetMode() {
    return Boolean(state.api && typeof state.api.setMode === 'function');
  }

  function hasFiles(dataTransfer) {
    if (!dataTransfer) return false;
    try {
      return Array.from(dataTransfer.types || []).indexOf('Files') >= 0;
    } catch {
      return false;
    }
  }

  function fileUrl(target) {
    if (typeof target !== 'string' || !target) return '';
    let normalized = target.replace(/\\/g, '/');
    if (!/^[a-zA-Z]:\//.test(normalized) && !normalized.startsWith('/')) normalized = '/' + normalized;
    try {
      return 'file://' + encodeURI(normalized).replace(/#/g, '%23').replace(/\?/g, '%3F');
    } catch {
      return '';
    }
  }

  /* ---------- 状态 ---------- */

  function normalizeItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const path = typeof raw.path === 'string' ? raw.path : '';
    if (!path) return null;
    const kind = KIND_TEXT[raw.kind] ? raw.kind : 'file';
    const name = typeof raw.name === 'string' && raw.name ? raw.name : path;
    const id = typeof raw.id === 'string' && raw.id ? raw.id : path;
    return { id, name, path, kind, addedAt: Number(raw.addedAt) || 0 };
  }

  function applyPayload(payload) {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items)) return false;
    state.items = payload.items.map(normalizeItem).filter(Boolean);
    state.canUndo = Boolean(payload.canUndo);
    if (payload.policy === 'copy' || payload.policy === 'move') state.policy = payload.policy;
    const max = Number(payload.maxItems);
    if (Number.isFinite(max) && max > 0) state.maxItems = Math.floor(max);
    // 指针还停在场内时不要被一次旧快照打回休眠（初始 getState 与悬停可能并发）
    if (typeof payload.mode === 'string' && MODES.includes(payload.mode) && !state.hovering && !state.dragDepth && !state.receiving) {
      state.mode = payload.mode;
    }
    state.error = '';
    state.loaded = true;
    render();
    return true;
  }

  function commitPayload(payload) {
    return applyPayload(payload);
  }

  /**
   * 主进程的岛 IPC 失败时多数是「resolve 一个 ok:false 的状态」而不是 reject
   * （例如条目已被移走、没有可暂存路径）。把这些错误提取出来，界面必须有反馈。
   */
  function payloadError(payload) {
    if (!payload || typeof payload !== 'object' || payload.ok !== false) return '';
    return typeof payload.error === 'string' && payload.error ? payload.error : '操作失败';
  }

  async function loadState() {
    const api = state.api;
    if (!api || state.loading) return;
    state.loading = true;
    try {
      const payload = await api.getState();
      state.error = '';
      if (!applyPayload(payload)) {
        state.error = '暂存状态格式无法识别';
        render();
      }
    } catch (error) {
      state.error = errorText(error, '读取暂存状态失败');
      render();
    } finally {
      state.loading = false;
    }
  }

  /* ---------- 三态切换 ---------- */

  function clearHoverTimer() {
    if (!state.hoverTimer) return;
    clearTimeout(state.hoverTimer);
    state.hoverTimer = 0;
  }

  function clearRestTimer() {
    if (!state.restTimer) return;
    clearTimeout(state.restTimer);
    state.restTimer = 0;
  }

  /** 还有交互就把主进程的「回休眠」计时往后推 */
  function ping() {
    const api = state.api;
    if (api && typeof api.ping === 'function') {
      try {
        const request = api.ping();
        if (request?.catch) request.catch(() => {});
      } catch { /* 主进程已退出时不阻塞界面 */ }
    }
  }

  /**
   * 请求切换形态。渲染层先乐观更新再通知主进程，
   * 主进程改完窗口尺寸再回推一次 island:mode 做最终对齐。
   */
  function requestMode(mode) {
    const next = MODES.includes(mode) ? mode : 'sleep';
    if (next !== 'sleep') ping();
    if (state.mode === next) {
      // 拖动穿过子元素时不重建卡片 DOM，避免制造新的 enter/leave 循环。
      return true;
    }
    state.mode = next;
    render();
    if (next === 'sheet' && !state.loaded) loadState();

    const api = state.api;
    if (!api) return false;
    try {
      if (typeof api.setMode === 'function') {
        const result = api.setMode(next);
        if (result && typeof result.then === 'function') result.catch(() => {});
      } else if (typeof api.setExpanded === 'function') {
        // 旧版主进程只有两态：sheet / rail
        api.setExpanded(next === 'sheet');
      }
    } catch {
      /* 窗口正在销毁时忽略 */
    }
    return true;
  }

  /** 指针离开后延迟回收：从胶囊挪到卡片、或拖放途经的空档都不该闪 */
  function scheduleRest(delay = REST_DELAY) {
    clearRestTimer();
    if (state.dragDepth > 0 || state.receiving) return;
    state.restTimer = window.setTimeout(() => {
      state.restTimer = 0;
      if (state.hovering || state.draggingOut || state.dragDepth > 0 || state.receiving) return;
      requestMode('sleep');
    }, delay);
  }

  /* ---------- 渲染 ---------- */

  function render() {
    const root = $('#island');
    const rail = $('#rail');
    const sheet = $('#sheet');
    const offline = !state.api;
    const mode = offline || state.mode !== 'sheet' ? 'sleep' : 'sheet';

    root.classList.toggle('is-offline', offline);
    root.dataset.mode = mode;
    root.dataset.expanded = mode === 'sheet' ? 'true' : 'false';
    root.dataset.policy = state.policy;
    root.dataset.empty = String(state.items.length === 0);

    const count = state.items.length;
    $('#rail-count').textContent = offline ? '—' : String(count);
    $('#rail-policy').textContent = offline ? '离线' : policyText();

    rail.hidden = true;
    sheet.hidden = mode !== 'sheet';
    const railLabel = offline
      ? '文件中转服务未就绪'
      : `文件中转：暂存 ${count} 个文件；点击展开，实际拖出操作由目标应用决定`;
    rail.title = railLabel;
    rail.setAttribute('aria-label', railLabel);

    renderShelf();
    renderFoot();
  }

  function cardMarkup(item) {
    const kind = KIND_TEXT[item.kind] ? item.kind : 'file';
    const name = item.name || item.path;
    const thumb = fileUrl(item.path);
    const mark = kind === 'image' && thumb
      ? `<span class="file-mark is-thumb"><img class="file-thumb" src="${escapeHtml(thumb)}" alt="" draggable="false" decoding="async"></span>`
      : `<span class="file-mark">${GLYPHS[kind] || GLYPHS.file}</span>`;
    const title = `${name}（${KIND_TEXT[kind]}），拖动可移除`;
    return `<div class="file-card" role="listitem" draggable="true" data-id="${escapeHtml(item.id)}" title="${escapeHtml(title)}">
      <button class="file-open" type="button" data-open="${escapeHtml(item.id)}" aria-label="打开 ${escapeHtml(name)}">
        ${mark}<span class="file-name">${escapeHtml(name)}</span>
      </button>
      <button class="file-remove" type="button" data-remove="${escapeHtml(item.id)}" aria-label="移除 ${escapeHtml(name)}" title="移除">×</button>
    </div>`;
  }

  function renderShelf() {
    const shelf = $('#shelf');
    const empty = $('#empty');
    const emptyTitle = $('#empty-title');
    const emptyHint = $('#empty-hint');
    const retry = $('#retry');
    const hasItems = state.items.length > 0;

    shelf.innerHTML = hasItems ? state.items.map(cardMarkup).join('') : '';
    shelf.hidden = !hasItems;
    shelf.classList.toggle('is-sparse', hasItems && state.items.length <= 4);
    empty.hidden = hasItems;

    if (state.api && retry) retry.hidden = !state.error;

    if (!state.api) {
      empty.dataset.mode = 'offline';
      emptyTitle.textContent = '文件中转暂不可用';
      emptyHint.textContent = '主进程没有提供 island 接口，重启随序后再试。';
    } else if (state.error) {
      empty.dataset.mode = 'error';
      emptyTitle.textContent = '暂时读不到暂存内容';
      emptyHint.textContent = state.error;
    } else {
      empty.dataset.mode = 'empty';
      emptyTitle.textContent = '把文件拖进来暂存';
      emptyHint.textContent = '从资源管理器拖入文件，之后可以点开或拖出去。';
    }

    // 缩略图加载失败时退回类型图标，避免出现破图
    $$('.file-thumb', shelf).forEach((img) => {
      img.addEventListener('error', () => {
        const holder = img.parentElement;
        if (!holder) return;
        holder.classList.remove('is-thumb');
        holder.innerHTML = GLYPHS.image;
      }, { once: true });
    });

    // 同步量一次（布局此时已可读），下一帧再量一次兜住字体/图片加载后的高度变化
    updateScrollHint();
    window.requestAnimationFrame(updateScrollHint);
  }

  function renderFoot() {
    const offline = !state.api;
    const count = state.items.length;
    $('#foot-count').textContent = `暂存 ${count} / ${state.maxItems} 个`;

    $$('.policy-btn').forEach((button) => {
      const active = button.dataset.policy === state.policy;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.disabled = offline;
    });

    const clear = $('#clear');
    clear.disabled = offline || count === 0;
    clear.title = count === 0 ? '暂存是空的' : '清空暂存';
    $('#undo').disabled = offline || !state.canUndo || typeof state.api.undo !== 'function';
  }

  function updateScrollHint() {
    const shelf = $('#shelf');
    const wrap = shelf && shelf.parentElement;
    if (!shelf || !wrap) return;
    const more = shelf.scrollHeight - shelf.clientHeight - shelf.scrollTop > 2;
    wrap.classList.toggle('is-scrollable', more);
  }

  /* ---------- 用户操作 ---------- */

  async function onOpen(id) {
    const api = state.api;
    if (!api || typeof api.openItem !== 'function') {
      toast('当前版本不支持打开暂存文件');
      return;
    }
    try {
      const result = await api.openItem(id);
      const message = payloadError(result);
      if (message) toast(message);
    } catch (error) {
      toast(errorText(error, '打开失败，文件可能已被移动或删除'));
    }
  }

  async function onRemove(id) {
    const api = state.api;
    if (!api || typeof api.removeItem !== 'function') {
      toast('当前版本不支持移除暂存文件');
      return;
    }
    try {
      const payload = await api.removeItem(id);
      const message = payloadError(payload);
      if (!commitPayload(payload)) {
        state.items = state.items.filter((item) => item.id !== id);
        render();
      }
      if (message) toast(message);
    } catch (error) {
      toast(errorText(error, '移除失败'));
    }
  }

  async function onClear() {
    const api = state.api;
    if (!api || typeof api.clear !== 'function') {
      toast('当前版本不支持清空暂存');
      return;
    }
    if (!state.items.length) {
      toast('暂存是空的');
      return;
    }
    try {
      const payload = await api.clear();
      const message = payloadError(payload);
      if (!commitPayload(payload)) {
        state.items = [];
        render();
      }
      toast(message || '已清空暂存');
    } catch (error) {
      toast(errorText(error, '清空失败'));
    }
  }

  async function onUndo() {
    if (!state.api || typeof state.api.undo !== 'function') return;
    try {
      const payload = await state.api.undo();
      const message = payloadError(payload);
      if (message) { toast(message); return; }
      commitPayload(payload);
      toast(payload?.dropped > 0 ? '已找回；容量已满，最早的暂存引用已移出' : '已找回暂存引用，原文件未改变');
      ping();
    } catch (error) { toast(errorText(error, '找回失败')); }
  }

  async function onPolicy(policy) {
    if (policy !== 'copy' && policy !== 'move') return;
    const api = state.api;
    if (!api || typeof api.setPolicy !== 'function') {
      toast('当前版本不支持切换策略');
      return;
    }
    if (state.policy === policy) return;
    const previous = state.policy;
    state.policy = policy;
    render();
    try {
      const payload = await api.setPolicy(policy);
      const message = payloadError(payload);
      commitPayload(payload);
      if (message) {
        state.policy = previous;
        render();
        toast(message);
      } else toast(`已记录${policyText()}偏好，实际拖放操作由目标应用决定`);
    } catch (error) {
      state.policy = previous;
      render();
      toast(errorText(error, '策略切换失败'));
    }
  }

  function setDropClass(active) {
    $('#island').classList.toggle('is-drop', Boolean(active));
  }

  async function onDrop(event) {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (state.receiving) return;
    state.dragDepth = 0;
    setDropClass(false);
    clearRestTimer();

    const api = state.api;
    const shelf = $('#shelf');
    const files = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
    if (!files.length) {
      toast('没有读到拖入的文件');
      return;
    }
    if (!api || typeof api.addPaths !== 'function' || typeof api.pathForFile !== 'function') {
      toast('文件中转服务未就绪，拖入的文件没有接收');
      return;
    }

    const paths = files.map((file) => {
      try { return api.pathForFile(file) || ''; } catch { return ''; }
    }).filter(Boolean);
    if (!paths.length) {
      toast('没有拿到文件路径，拖入失败');
      return;
    }

    try {
      state.receiving = true;
      const before = new Set(state.items.map((item) => item.id));
      const payload = await api.addPaths(paths);
      const message = payloadError(payload);
      if (!commitPayload(payload)) {
        await loadState();
      }
      if (message) {
        toast(message);
        return;
      }
      const added = state.items.filter((item) => !before.has(item.id)).length;
      if (payload?.skipped > 0) {
        toast(`已暂存 ${added} 个文件，${payload.skipped} 个文件不存在或无法读取`);
      } else if (added === 0) {
        toast('这些文件已经在暂存里了');
      } else if (payload?.dropped > 0) {
        toast(`已暂存 ${added} 个文件；超出容量，移除了 ${payload.dropped} 条最早的暂存引用，原文件不受影响`);
      } else if (state.items.length >= state.maxItems) {
        toast(`已暂存 ${added} 个文件，最多 ${state.maxItems} 个`);
      } else {
        toast(`已暂存 ${added} 个文件`);
      }
      if (shelf) shelf.scrollTop = 0;
      // 让用户看清"接住了什么"：主进程会在几秒无交互后自动回休眠
      requestMode('sheet');
    } catch (error) {
      toast(errorText(error, '暂存失败'));
    } finally {
      state.receiving = false;
      if (!state.hovering) scheduleRest(1200);
    }
  }

  function onShelfDragStart(event) {
    const card = closestFrom(event.target, '.file-card');
    if (!card) return;
    // 取消 HTML5 拖拽，由主进程的 startDrag 接管真正的系统拖放。
    event.preventDefault();
    const api = state.api;
    if (!api || typeof api.startDrag !== 'function') {
      toast('当前版本不支持拖出文件');
      return;
    }
    const id = card.dataset.id;
    state.draggingOut = true;
    card.classList.add('is-dragging');
    let request;
    try {
      // 同步发起：主进程的 webContents.startDrag 必须在鼠标仍按下时调用，
      // 因此这里不在 Promise/await 之后再发（避免拖放时机被推迟）。
      request = api.startDrag(id);
    } catch (error) {
      card.classList.remove('is-dragging');
      state.draggingOut = false;
      toast(errorText(error, '拖出失败'));
      return;
    }
    Promise.resolve(request)
      .then((ok) => {
        card.classList.remove('is-dragging');
        if (ok === false) toast('无法拖出这个文件，它可能已经被移动或删除');
      })
      .catch((error) => {
        card.classList.remove('is-dragging');
        toast(errorText(error, '拖出失败'));
      })
      .finally(() => { state.draggingOut = false; });
  }

  function onShelfDragEnd() {
    $$('.file-card.is-dragging').forEach((card) => card.classList.remove('is-dragging'));
    state.draggingOut = false;
  }

  /* ---------- 事件绑定 ---------- */

  function bindStaticEvents() {
    const root = $('#island');
    const shelf = $('#shelf');

    // 普通指针进入只维持已有卡片，不能把休眠岛唤醒。
    root.addEventListener('mouseenter', () => {
      state.hovering = true;
      clearRestTimer();
    });
    root.addEventListener('mouseleave', () => {
      state.hovering = false;
      clearHoverTimer();
      scheduleRest();
    });
    // 指针在岛里移动 = 还在用：把主进程的回收计时不断往后推（500ms 节流）
    root.addEventListener('mousemove', () => {
      if (state.mode === 'sleep') return;
      const now = Date.now();
      if (now - state.lastPingAt < 500) return;
      state.lastPingAt = now;
      ping();
    }, { passive: true });

    // 拖入：立刻展开成卡片，这是岛存在的主要理由
    root.addEventListener('dragenter', (event) => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      state.dragDepth += 1;
      clearHoverTimer();
      clearRestTimer();
      requestMode('sheet');
      setDropClass(true);
    });
    root.addEventListener('dragover', (event) => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      try { event.dataTransfer.dropEffect = 'copy'; } catch {}
      clearRestTimer();
      if (state.mode !== 'sheet') requestMode('sheet');
      setDropClass(true);
    });
    root.addEventListener('dragleave', (event) => {
      if (!hasFiles(event.dataTransfer)) return;
      state.dragDepth = Math.max(0, state.dragDepth - 1);
      if (state.dragDepth === 0) {
        setDropClass(false);
        state.hovering = false;
        scheduleRest(COLLAPSE_DELAY);
      }
    });
    root.addEventListener('drop', onDrop);

    shelf.addEventListener('click', (event) => {
      const remove = closestFrom(event.target, '[data-remove]');
      if (remove) {
        event.preventDefault();
        event.stopPropagation();
        onRemove(remove.dataset.remove);
        return;
      }
      const open = closestFrom(event.target, '[data-open]');
      if (open) onOpen(open.dataset.open);
    });
    shelf.addEventListener('dragstart', onShelfDragStart);
    shelf.addEventListener('dragend', onShelfDragEnd);
    shelf.addEventListener('scroll', updateScrollHint, { passive: true });

    $('#rail').addEventListener('click', () => {
      if (!state.api) {
        toast('文件中转服务未就绪，重启随序后再试');
        return;
      }
      requestMode('sheet');
    });

    $('#clear').addEventListener('click', onClear);
    $('#undo').addEventListener('click', onUndo);
    $('#retry').addEventListener('click', () => { loadState(); });

    $$('.policy-btn').forEach((button) => {
      button.addEventListener('click', () => onPolicy(button.dataset.policy));
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (state.mode === 'sleep') return;
      event.preventDefault();
      state.dragDepth = 0;
      setDropClass(false);
      requestMode('sleep');
    });

    window.addEventListener('resize', () => window.requestAnimationFrame(updateScrollHint));
    window.addEventListener('beforeunload', () => {
      if (typeof state.offState === 'function') state.offState();
      if (typeof state.offExpanded === 'function') state.offExpanded();
      if (typeof state.offMode === 'function') state.offMode();
    });
  }

  /* ---------- 启动 ---------- */

  function init() {
    state.api = detectApi();
    bindStaticEvents();
    render();

    if (!state.api) return;

    if (typeof state.api.onState === 'function') {
      try {
        const off = state.api.onState((payload) => { applyPayload(payload); });
        if (typeof off === 'function') state.offState = off;
      } catch {}
    }
    // 旧通道：只有「展开 / 收起」两态，映射成卡片 / 胶囊
    if (typeof state.api.onMode !== 'function' && typeof state.api.onExpanded === 'function') {
      try {
        const off = state.api.onExpanded((expanded) => {
          const next = expanded ? 'sheet' : 'sleep';
          if (state.mode === next) return;
          state.mode = next;
          if (next === 'sheet') clearRestTimer();
          render();
        });
        if (typeof off === 'function') state.offExpanded = off;
      } catch {}
    }
    // 新通道：主进程改完窗口尺寸后回推最终形态，渲染层以此为准
    if (typeof state.api.onMode === 'function') {
      try {
        const off = state.api.onMode((mode) => {
          const next = MODES.includes(mode) ? mode : 'sleep';
          if (next === 'sleep') {
            state.dragDepth = 0;
            state.hovering = false;
            setDropClass(false);
            clearHoverTimer();
            clearRestTimer();
          }
          if (state.mode === next) return;
          state.mode = next;
          render();
        });
        if (typeof off === 'function') state.offMode = off;
      } catch {}
    }

    if (!canSetMode() && state.api && typeof state.api.setExpanded === 'function') {
      // 旧接口也从隐藏态开始，不主动显示胶囊。
      state.api.setExpanded(false);
    }
    loadState();
  }

  init();
})();
