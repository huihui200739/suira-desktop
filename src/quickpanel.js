'use strict';

/**
 * 动作面板渲染层。
 *
 * 结构对齐本机浮引：顶部搜索条 + 右侧工具箱；主体是 38 键固定键位面板；
 * 空格在「动作面板 / 应用面板」之间切换；工具箱是独立入口。
 *
 * 键位与动作的对应关系由主进程 lib/keybindings.js 决定，渲染层只负责展示
 * 与把按键交回主进程（window.suira.panel.run）。未绑定的键显示「绑定」，
 * 未实现的键显示动作名与「未实现」，都不会假装可以执行。
 */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const GLYPHS = {
  capture: '<svg viewBox="0 0 24 24"><path d="M7 3.5v13.5M7 20v.5M3.5 7h13.5M20 7h.5M17 20H3.5V6.5"/><path d="M3.5 3.5h4M20 3.5h.5v4M20 20.5h.5v-4"/></svg>',
  ocr: '<span class="glyph-text">T</span>',
  pin: '<svg viewBox="0 0 24 24"><path d="M9 3.5h6l-1 5 3.5 3.5H6.5L10 8.5z"/><path d="M12 12v8"/></svg>',
  clipboard: '<svg viewBox="0 0 24 24"><rect x="5.5" y="4.5" width="13" height="16" rx="2.5"/><path d="M9 4.5V3.2h6v1.3M9 10h6M9 14h4"/></svg>',
  'text-clean': '<span class="glyph-text">Aa</span>',
  desktop: '<svg viewBox="0 0 24 24"><path d="M6 20.5V6.5"/><path d="M6 4.5 18.5 9 6 13.5"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5.5" y="10.5" width="13" height="9.5" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>'
};

const PLANNED_GLYPH = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5" stroke-dasharray="3 3"/><path d="M12 8.5v4M12 15.2v.6"/></svg>';

const APP_PAGE_SIZE = 28;

const state = {
  mode: 'actions',
  rows: [],
  keys: [],
  count: 0,
  tools: [],
  query: '',
  commandResults: [],
  commandIndex: 0,
  apps: [],
  appPage: 0,
  appsLoaded: false,
  appsLoading: false,
  returnTarget: null,
  recentItem: null,
  toastTimer: null,
  composing: false
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function toast(message, type = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast is-visible ${type}`.trim();
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { el.className = 'toast'; }, 2000);
}

function relativeTime(timestamp) {
  const delta = Date.now() - Number(timestamp || 0);
  if (delta < 60000) return '刚刚';
  if (delta < 3600000) return `${Math.floor(delta / 60000)} 分钟前`;
  if (delta < 86400000) return `${Math.floor(delta / 3600000)} 小时前`;
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

/* ---------- 模式 ---------- */

function setMode(mode) {
  state.mode = mode;
  const panel = $('#panel');
  panel.dataset.mode = mode;
  $('#mode-chip').textContent = mode === 'apps' ? '应用' : mode === 'toolbox' ? '工具箱' : '动作';

  $('#key-grid').hidden = mode !== 'actions' || Boolean(state.query);
  $('#apps-panel').hidden = mode !== 'apps' || Boolean(state.query);
  $('#toolbox-panel').hidden = mode !== 'toolbox';
  $('#command-section').hidden = !state.query;

  // 搜索条在应用面板里负责过滤，在动作面板里只在显式搜索时获得焦点
  const input = $('#search');
  if (mode === 'apps' || state.query) {
    input.placeholder = mode === 'apps' ? '搜索应用' : '搜索命令、应用或内容';
    input.focus();
  } else {
    input.placeholder = '按空格查看全部应用';
    input.blur();
  }
  if (mode === 'apps' && !state.appsLoaded) loadApps();
  if (mode === 'apps') renderApps();
  if (mode === 'toolbox') renderTools();
}

function toggleApps() {
  if (state.query) clearSearch();
  setMode(state.mode === 'apps' ? 'actions' : 'apps');
}

/* ---------- 动作面板 ---------- */

function renderKeys() {
  const grid = $('#key-grid');
  const rows = new Map();
  for (const key of state.keys) {
    if (!rows.has(key.row)) rows.set(key.row, []);
    rows.get(key.row).push(key);
  }
  grid.innerHTML = [...rows.keys()].sort((a, b) => a - b).map((rowIndex) => `
    <div class="key-row" data-row="${rowIndex}">
      ${rows.get(rowIndex).map((key) => keyMarkup(key)).join('')}
    </div>
  `).join('');
  $$('.key', grid).forEach((button) => {
    button.addEventListener('click', () => pressKey(button.dataset.key));
  });
}

function keyMarkup(key) {
  const bound = key.state === 'bound';
  const classes = ['key', bound ? 'is-bound' : key.state === 'unimplemented' ? 'is-unimplemented' : 'is-unbound'];
  const glyph = bound ? (GLYPHS[key.actionId] || `<span class="glyph-text">${escapeHtml(key.label.slice(0, 1))}</span>`) : '';
  const inner = bound
    ? `<span class="key-glyph">${glyph}</span><span class="key-badge">${escapeHtml(key.key)}</span>`
    : `<span class="key-letter">${escapeHtml(key.key)}</span>`;
  // 未绑定显示「绑定」；未实现显示动作名，让用户知道这个键规划给什么能力
  const label = bound ? key.label : key.state === 'unimplemented' ? `${key.label}·未实现` : '绑定';
  const title = bound ? key.hint : key.state === 'unimplemented' ? `${key.label}：尚未实现` : '这个键还没有绑定动作';
  return `<button class="${classes.join(' ')}" type="button" data-key="${escapeHtml(key.key)}" data-action="${escapeHtml(key.actionId)}" title="${escapeHtml(title)}">
    <span class="key-card">${inner}</span>
    <span class="key-label">${escapeHtml(label)}</span>
  </button>`;
}

function keyByChar(char) {
  const target = String(char || '').toUpperCase();
  return state.keys.find((key) => key.key === target) || null;
}

function pressKey(char) {
  const key = keyByChar(char);
  if (!key) return;
  if (key.state === 'bound') {
    runAction(key.actionId);
    return;
  }
  if (key.state === 'unimplemented') {
    toast(`「${key.label}」尚未实现，不会假装可用`);
    return;
  }
  toast(`按键 ${key.key} 还没有绑定动作`);
}

/* ---------- 应用面板 ---------- */

async function loadApps() {
  state.appsLoading = true;
  renderApps();
  try {
    const apps = await window.suira.apps.list();
    state.apps = Array.isArray(apps) ? apps : [];
    state.appsLoaded = true;
  } catch {
    state.apps = [];
    state.appsLoaded = true;
  } finally {
    state.appsLoading = false;
    renderApps();
    loadAppIcons();
  }
}

/** 当前页图标按需补齐：先出名称，再补图标，避免整页等待。 */
async function loadAppIcons() {
  const start = state.appPage * APP_PAGE_SIZE;
  const pageApps = filteredApps().slice(start, start + APP_PAGE_SIZE);
  const missing = pageApps.filter((app) => !app.icon).map((app) => app.filePath);
  if (!missing.length) return;
  let icons = {};
  try {
    icons = await window.suira.apps.icons(missing) || {};
  } catch {
    return;
  }
  let changed = false;
  for (const app of state.apps) {
    if (icons[app.filePath]) { app.icon = icons[app.filePath]; changed = true; }
  }
  if (changed && state.mode === 'apps') renderApps();
}

function filteredApps() {
  const query = state.query.trim().toLowerCase();
  if (!query) return state.apps;
  return state.apps.filter((app) => String(app.name || '').toLowerCase().includes(query));
}

function renderApps() {
  const grid = $('#apps-grid');
  const apps = filteredApps();
  const pageCount = Math.max(1, Math.ceil(apps.length / APP_PAGE_SIZE));
  if (state.appPage > pageCount - 1) state.appPage = 0;
  const start = state.appPage * APP_PAGE_SIZE;
  const pageApps = apps.slice(start, start + APP_PAGE_SIZE);

  $('#empty-state').hidden = !(state.appsLoaded && !state.appsLoading && !apps.length);

  grid.innerHTML = pageApps.map((app) => {
    const icon = app.icon ? `<img src="${escapeHtml(app.icon)}" alt="">` : escapeHtml(String(app.name || '?').slice(0, 1));
    return `<button class="app-item" type="button" data-path="${escapeHtml(app.filePath || '')}" title="${escapeHtml(app.name || '')}">
      <span class="app-icon">${icon}</span>
      <span class="app-name">${escapeHtml(app.name || '')}</span>
    </button>`;
  }).join('');

  $$('.app-item', grid).forEach((button) => {
    button.addEventListener('click', () => openApp(button.dataset.path));
  });
  $('#apps-pager').textContent = `第 ${state.appPage + 1} / ${pageCount} 页`;
  $('#apps-prev').disabled = state.appPage <= 0;
  $('#apps-next').disabled = state.appPage >= pageCount - 1;
}

async function openApp(filePath) {
  if (!filePath) return;
  const result = await window.suira.quick.openApp(filePath);
  if (!result?.ok) { toast(result?.error || '无法启动该应用', 'error'); return; }
  window.suira.quick.hide();
}

/* ---------- 工具箱 ---------- */

function renderTools() {
  $('#tool-grid').innerHTML = state.tools.map((tool) => `
    <button class="tool-item ${tool.implemented ? '' : 'is-todo'}" type="button" data-id="${escapeHtml(tool.id)}" ${tool.implemented ? '' : 'aria-disabled="true"'}>
      <span class="tool-mark">${escapeHtml(tool.label.slice(0, 1))}</span>
      <span class="tool-copy"><b>${escapeHtml(tool.label)}</b><small>${escapeHtml(tool.implemented ? tool.hint : '尚未实现')}</small></span>
    </button>
  `).join('');
  $$('.tool-item').forEach((button) => {
    button.addEventListener('click', async () => {
      const tool = state.tools.find((entry) => entry.id === button.dataset.id);
      if (!tool) return;
      if (!tool.implemented) { toast(`「${tool.label}」尚未实现`); return; }
      // 浮引岛是浮层，不是主窗口页面：显示/收起后回到原来的工作面
      if (tool.toggleIsland) {
        const result = await window.suira.island.toggle();
        if (result && result.ok === false) { toast(result.error || '浮引岛不可用', 'error'); return; }
        window.suira.quick.hide();
        return;
      }
      if (tool.open) { window.suira.quick.showMain(tool.open); return; }
      runAction(tool.id);
    });
  });
}

/* ---------- 搜索 ---------- */

let commandTimer = null;

function clearSearch() {
  state.query = '';
  state.commandResults = [];
  $('#search').value = '';
  setMode(state.mode === 'apps' ? 'apps' : 'actions');
}

function updateSearch(value) {
  state.query = value.trim();
  state.commandIndex = 0;
  if (!state.query) {
    state.commandResults = [];
    $('#key-grid').hidden = state.mode !== 'actions';
    $('#apps-panel').hidden = state.mode !== 'apps';
    $('#command-section').hidden = true;
    renderApps();
    return;
  }
  $('#key-grid').hidden = true;
  $('#apps-panel').hidden = true;
  $('#command-section').hidden = false;
  clearTimeout(commandTimer);
  commandTimer = setTimeout(refreshCommands, 90);
  if (state.mode === 'apps') renderApps();
}

async function refreshCommands() {
  try {
    const results = await window.suira.search.query(state.query);
    state.commandResults = Array.isArray(results) ? results : [];
  } catch {
    state.commandResults = [];
  }
  renderCommands();
}

function renderCommands() {
  const list = $('#command-list');
  const results = state.commandResults;
  if (!results.length) {
    list.innerHTML = `<div class="command-empty">没有匹配的命令、应用或内容</div>`;
    return;
  }
  list.innerHTML = results.slice(0, 12).map((entry, index) => {
    const glyph = entry.kind === 'command' ? '⌘' : entry.kind === 'app' ? '应' : entry.kind === 'task' ? '▤' : '字';
    return `<button class="command-item ${index === state.commandIndex ? 'is-selected' : ''}" type="button" data-index="${index}" data-kind="${escapeHtml(entry.kind)}" data-id="${escapeHtml(entry.id)}">
      <span class="command-icon">${glyph}</span>
      <span class="command-copy"><b>${escapeHtml(entry.title)}</b><small>${escapeHtml(entry.subtitle || '')}</small></span>
    </button>`;
  }).join('');
  $$('.command-item', list).forEach((button) => {
    button.addEventListener('click', () => runCommand(Number(button.dataset.index)));
  });
}

async function runCommand(index) {
  const entry = state.commandResults[index];
  if (!entry) return;
  const kind = entry.kind;
  if (kind === 'app') {
    // 主进程返回的应用候选把快捷方式路径放在 appPath；id 只是 'app:'+path 的展示键。
    // 之前直接拿 id 去壳，遇到没有 appPath 的候选会拼出错误路径。
    const target = entry.appPath || String(entry.id || '').replace(/^app:/, '');
    await openApp(target);
    return;
  }
  if (kind === 'task') { window.suira.quick.showMain('shelf'); return; }
  if (kind === 'content') { window.suira.quick.showMain('library'); return; }
  const action = String(entry.action || '');
  if (action === 'capture') { runAction('capture'); return; }
  if (action === 'quick') { clearSearch(); return; }
  if (action.startsWith('navigate:')) { window.suira.quick.showMain(action.slice('navigate:'.length)); return; }
  if (action.startsWith('recipe:')) {
    // 配方需要一条具体内容作为输入：用最近内容，没有就直接说明白，
    // 不再拿空 itemId 去调主进程换回一句「内容不存在」。
    const item = state.recentItem;
    if (!item) { toast('还没有内容可以整理，先截一张图或复制一段文字'); return; }
    const result = await window.suira.recipes.run({
      itemId: item.id,
      recipeId: action.slice('recipe:'.length),
      commit: false
    });
    if (!result?.ok) { toast(result?.error || '执行失败', 'error'); return; }
    const marks = (result.steps || []).map((step) => (step.ok ? '✓' : '✕')).join('');
    toast(`处理完成 ${marks}`);
    await loadRecent();
    return;
  }
}

/* ---------- 执行动作 ---------- */

async function runAction(actionId) {
  if (!actionId) return;
  try {
    const result = await window.suira.panel.run(actionId);
    if (!result) return;
    if (result.ocr) { showOcr(result.ocr.text || '', result.ocr.itemId || ''); return; }
    if (result.message) toast(result.message, result.ok ? '' : 'error');
    else if (result.error) toast(result.error, 'error');
    // 动作结果在主窗口某页里（内容库 / 任务匣）：带用户过去看，
    // 而不是让结果留在看不见的地方
    if (result.openPage) {
      window.suira.quick.showMain(result.openPage);
      return;
    }
    if (result.closePanel) window.suira.quick.hide();
  } catch (error) {
    toast(error.message || '动作执行失败', 'error');
  }
}

function showOcr(text, itemId) {
  const panel = $('#ocr-panel');
  panel.hidden = false;
  $('#ocr-text').value = text || '';
  $('#ocr-text').placeholder = text ? '' : '没有识别到文字，换一张更清晰的图片试试';
  panel.dataset.itemId = itemId;
}

function closeOcr() {
  $('#ocr-panel').hidden = true;
  delete $('#ocr-panel').dataset.itemId;
}

/* ---------- 最近内容与放回 ---------- */

async function loadRecent() {
  try {
    const items = await window.suira.content.list({ limit: 1 });
    state.recentItem = items?.[0] || null;
  } catch {
    state.recentItem = null;
  }
  renderRecent();
}

const KIND_LABELS = { text: '文字', link: '链接', image: '图片', files: '文件', collection: '集合' };

function renderRecent() {
  const card = $('#source-card');
  const item = state.recentItem;
  if (!item) { card.hidden = true; return; }
  card.hidden = false;
  $('#source-kind').textContent = `最近内容 · ${KIND_LABELS[item.kind] || '内容'}`;
  $('#source-time').textContent = relativeTime(item.createdAt);
}

function renderReturnBar() {
  const bar = $('#return-bar');
  const target = state.returnTarget;
  if (!target) { bar.hidden = true; return; }
  bar.hidden = false;
  const name = target.processName || '原窗口';
  const title = target.title ? ` · ${target.title.slice(0, 26)}` : '';
  $('#return-target-text').textContent = `回到 ${name}${title}`;
}

async function commitReturn() {
  const item = state.recentItem;
  if (!item) { toast('还没有可放回的内容', 'error'); return; }
  const button = $('#return-commit');
  button.disabled = true;
  try {
    const result = await window.suira.returnTo.commit({ itemId: item.id, intent: 'return-and-paste' });
    if (!result?.ok) { toast(result?.error || '放回失败', 'error'); return; }
    toast(result.message || '已复制');
    if (result.copied) window.suira.quick.hide();
  } catch (error) {
    toast(error.message || '放回失败', 'error');
  } finally {
    button.disabled = false;
  }
}

/* ---------- 初始化 ---------- */

async function loadState() {
  try {
    const snapshot = await window.suira.panel.state();
    state.rows = snapshot?.rows || [];
    state.keys = snapshot?.keys || [];
    state.count = snapshot?.count || state.keys.length;
    state.tools = snapshot?.tools || [];
  } catch {
    state.keys = [];
  }
  renderKeys();
}

function focusSearch() {
  $('#search').focus();
}

function installEvents() {
  const input = $('#search');
  input.addEventListener('input', (event) => updateSearch(event.target.value));
  input.addEventListener('compositionstart', () => { state.composing = true; });
  input.addEventListener('compositionend', () => { state.composing = false; });
  input.addEventListener('keydown', (event) => {
    if (event.isComposing || state.composing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (state.query) clearSearch();
      else if (state.mode !== 'actions') setMode('actions');
      else window.suira.quick.hide();
      return;
    }
    if (event.key === ' ' && !state.query && !event.ctrlKey && !event.altKey && !event.metaKey) {
      // 搜索条为空时空格是面板切换键，不写入内容。
      // 带修饰键的空格要放过去：那是「按住型唤起」的键位，不能被面板吃掉。
      event.preventDefault();
      toggleApps();
      return;
    }
    if (event.key === 'Escape' || event.key === 'Tab') return;
    // 搜索模式下 ↑↓ 与 Enter 只作用于搜索结果列表；没有结果时 Enter
    // 不做任何事（也不会回落到动作执行），避免"按了没反应"或误执行
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!state.commandResults.length) return;
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      state.commandIndex = Math.max(0, Math.min(state.commandResults.length - 1, state.commandIndex + delta));
      renderCommands();
      return;
    }
    if (event.key === 'Enter') {
      if (!state.commandResults.length) {
        // 结果是异步拉取的，按得太早时给一次明确反馈，而不是静默
        if (state.query) toast('还在搜索，稍等一下');
        return;
      }
      event.preventDefault();
      runCommand(state.commandIndex);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.isComposing || state.composing) return;
    if (!$('#ocr-panel').hidden) {
      if (event.key === 'Escape') { event.preventDefault(); closeOcr(); }
      return;
    }
    const inInput = event.target === input;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (state.mode !== 'actions') { clearSearch(); setMode('actions'); }
      else window.suira.quick.hide();
      return;
    }
    if (inInput) return; // 输入框自行处理，避免把字母解释成动作
    // 搜索进行中：键盘只服务结果列表，不能把字母再解释成 38 键动作
    if (state.query) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (!state.commandResults.length) return;
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        state.commandIndex = Math.max(0, Math.min(state.commandResults.length - 1, state.commandIndex + delta));
        renderCommands();
        return;
      }
      if (event.key === 'Enter') {
        if (!state.commandResults.length) return;
        event.preventDefault();
        runCommand(state.commandIndex);
        return;
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        input.value = state.query.slice(0, -1);
        updateSearch(input.value);
        focusSearch();
        return;
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        input.value = state.query + event.key;
        updateSearch(input.value);
        focusSearch();
      }
      return;
    }
    if (event.key === ' ' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      toggleApps();
      return;
    }
    if (event.key === '/' || event.key === 'F3') { event.preventDefault(); focusSearch(); return; }
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key.length === 1) {
      const key = keyByChar(event.key);
      if (!key) return;
      event.preventDefault();
      if (key.state === 'unbound') {
        // 未绑定的键没有动作可执行，转成搜索输入，避免"按键没反应"
        input.value = event.key;
        updateSearch(event.key);
        focusSearch();
        return;
      }
      pressKey(event.key);
    }
  });

  $('#toolbox').addEventListener('click', () => {
    if (state.mode === 'toolbox') setMode('actions');
    else { clearSearch(); setMode('toolbox'); }
  });
  $('#capture').addEventListener('click', () => runAction('capture'));
  $('#return-commit').addEventListener('click', commitReturn);
  $('#source-open').addEventListener('click', () => window.suira.quick.showMain('library'));
  $('#apps-prev').addEventListener('click', () => { state.appPage -= 1; renderApps(); loadAppIcons(); });
  $('#apps-next').addEventListener('click', () => { state.appPage += 1; renderApps(); loadAppIcons(); });
  $('#panel-body').addEventListener('click', (event) => {
    if (event.target === $('#panel-body') && state.mode === 'actions' && !state.query) focusSearch();
  });

  $('#ocr-close').addEventListener('click', closeOcr);
  $('#ocr-original').addEventListener('click', async () => {
    // 识别结果的来源图片：面板只持有 itemId，打开原图交给主进程，
    // 避免在渲染层拼 file:// 路径（之前这里没有任何 handler，点了必报错）
    const itemId = $('#ocr-panel').dataset.itemId || '';
    if (!itemId) { toast('找不到这张识别结果的来源图片', 'error'); return; }
    const result = await window.suira.content.openOriginal(itemId);
    if (!result?.ok) toast(result?.error || '无法打开原图', 'error');
  });
  $('#ocr-copy').addEventListener('click', async () => {
    const text = $('#ocr-text').value;
    if (!text.trim()) { toast('没有可复制的文字', 'error'); return; }
    const saved = await window.suira.content.addText({ text, title: '识别文字', source: 'ocr' });
    if (!saved?.ok) { toast(saved?.error || '保存失败', 'error'); return; }
    const result = await window.suira.actions.run(saved.item.id, 'output.copy');
    if (result?.ok) { toast('识别文字已复制'); closeOcr(); } else toast(result?.error || '复制失败', 'error');
  });
  $('#ocr-merge').addEventListener('click', async () => {
    const text = $('#ocr-text').value;
    if (!text.trim()) return;
    const saved = await window.suira.content.addText({ text, title: '识别文字', source: 'ocr' });
    if (!saved?.ok) return;
    const result = await window.suira.actions.run(saved.item.id, 'text.merge-lines');
    if (result?.ok && result.output) { $('#ocr-text').value = result.output.text; toast('已合并换行'); }
    else toast(result?.error || '处理失败', 'error');
  });
  $('#ocr-shelf').addEventListener('click', async () => {
    const text = $('#ocr-text').value;
    if (!text.trim()) return;
    const saved = await window.suira.content.addText({ text, title: '识别文字', source: 'ocr' });
    if (!saved?.ok) return;
    const result = await window.suira.actions.run(saved.item.id, 'output.shelf');
    if (result?.ok) { toast('已加入任务匣'); closeOcr(); } else toast(result?.error || '加入失败', 'error');
  });

  window.suira.content.onChanged(() => loadRecent());
  // 主进程的「面板布局轮换」快捷键：动作 / 应用 / 工具箱 之间切换
  window.suira.quick.onMode((mode) => {
    if (typeof mode !== 'string' || !mode) return;
    clearSearch();
    setMode(mode);
  });
  window.suira.quick.onShown(async () => {
    clearSearch();
    setMode('actions');
    closeOcr();
    state.appPage = 0;
    await loadState();
    loadRecent();
    window.suira.returnTo.target().then((target) => {
      state.returnTarget = target || null;
      renderReturnBar();
    }).catch(() => { state.returnTarget = null; renderReturnBar(); });
  });
}

installEvents();
loadState();
loadRecent();
setMode('actions');
