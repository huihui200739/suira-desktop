'use strict';

/**
 * 动作面板渲染层。
 *
 * 结构对齐本机浮引：顶部搜索条 + 右侧工具箱；主体是 38 键固定键位面板；
 * 空格在「动作面板 / 应用面板」之间切换；工具箱是独立入口。
 *
 * 键位与动作的对应关系由主进程 lib/keybindings.js 决定，渲染层只负责展示
 * 与把按键交回主进程（window.suira.panel.run）。未绑定的键只画字母，
 * 未实现的键使用淡轮廓，并通过悬浮提示说明状态。
 */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
let keyMotion = null;

const GLYPHS = {
  calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-12 4h2m4 0h2"/></svg>',
  markdown: '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M5 16V8l3 4 3-4v8m6-8v8m-3-3 3 3 3-3"/></svg>',
  'long-capture': '<svg viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="3"/><path d="M8 7h8M8 10h8M12 13v6m-3-3 3 3 3-3"/></svg>',
  'edit-image': '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 4-7 4 8"/></svg>',
  capture: '<svg viewBox="0 0 24 24"><rect x="4" y="5.8" width="16" height="12.4" rx="2.6" stroke-dasharray="3.5 2.7"/><circle cx="12" cy="12" r="2.5"/></svg>',
  annotate: '<svg viewBox="0 0 24 24"><path d="M4 20.5 5.2 16 16.4 4.8a2 2 0 0 1 2.8 2.8L8 18.8z"/><path d="m14 7.2 2.8 2.8"/></svg>',
  ocr: '<svg viewBox="0 0 24 24"><path d="M4 8V6a2 2 0 0 1 2-2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M20 16v2a2 2 0 0 1-2 2h-2"/><path d="M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M8.2 9.2h7.6"/><path d="M8.2 12.5h5.6"/><path d="M8.2 15.8h3.6"/></svg>',
  translate: '<svg viewBox="0 0 24 24"><path d="M3.5 5.5h8"/><path d="M7.5 3.5v2c0 3.6-1.8 6.3-4.5 7.9"/><path d="M5 11.3c1.3 1.9 3.1 3.3 5.4 4"/><path d="m12.5 20.5 4.4-11h.2l4.4 11"/><path d="M14.2 16.5h5.6"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M9.4 3.5h5.2l-.6 5 3 3c.4.4.1 1-.5 1H7.5c-.6 0-.9-.6-.5-1l3-3z"/><path d="M12 12.5v8"/></svg>',
  clipboard: '<svg viewBox="0 0 24 24"><rect x="5" y="4.8" width="14" height="16.4" rx="2.6"/><path d="M9 4.8V4a1.6 1.6 0 0 1 1.6-1.6h2.8A1.6 1.6 0 0 1 15 4v.8"/><path d="M9 10.5h6"/><path d="M9 14h4.5"/></svg>',
  'text-clean': '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 11h11M4 16h8m3-2 5 5m0-5-5 5"/></svg>',
  island: '<svg viewBox="0 0 24 24"><path d="M4 15h16l1 5H3zM12 3v10m-4-4 4 4 4-4"/></svg>',
  shelf: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 13h5l2 3h4l2-3h5M8 5V3h8v2"/></svg>',
  library: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="16" rx="1"/><path d="m17 5 4 14M4 8h3m4 0h3"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3z"/><circle cx="12" cy="12" r="3"/></svg>',
  desktop: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="12" rx="2.2"/><path d="M9.5 20.5h5"/><path d="M12 16.5v4"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="9.5" rx="2.8"/><path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7"/><path d="M12 14.2v2"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M5 5.8A1.8 1.8 0 0 1 6.8 4h10.4A1.8 1.8 0 0 1 19 5.8v7.2L13.2 19H6.8A1.8 1.8 0 0 1 5 17.2z"/><path d="M18.8 13.4h-3.9a1.7 1.7 0 0 0-1.7 1.7v3.7"/><path d="M8.6 9h6.8"/></svg>'
};

// 自定义绑定（应用/文件夹/网页/文件）的键帽图标
const BINDING_GLYPHS = {
  app: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.8"/><rect x="13" y="4" width="7" height="7" rx="1.8"/><rect x="4" y="13" width="7" height="7" rx="1.8"/><path d="M16.5 13.5v6M13.5 16.5h6"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3.5 7A1.8 1.8 0 0 1 5.3 5.2h4l2 2.3h7.4A1.8 1.8 0 0 1 20.5 9.3v8A1.8 1.8 0 0 1 18.7 19H5.3A1.8 1.8 0 0 1 3.5 17.3z"/></svg>',
  url: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4a12.4 12.4 0 0 1 0 16M12 4a12.4 12.4 0 0 0 0 16"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M6 4.8A1.8 1.8 0 0 1 7.8 3h6L19 8.2v10A1.8 1.8 0 0 1 17.2 20H7.8A1.8 1.8 0 0 1 6 18.2z"/><path d="M13.5 3v5.5H19"/></svg>'
};

const PLANNED_GLYPH = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5" stroke-dasharray="3 3"/><path d="M12 8.5v4M12 15.2v.6"/></svg>';

const appPageSize = () => document.getElementById('panel').dataset.presentation==='fullscreen'?35:28;

const state = {
  mode: 'actions',
  rows: [],
  keys: [],
  count: 0,
  tools: [],
  actions: [],
  query: '',
  commandResults: [],
  commandIndex: 0,
  commandLoading: false,
  commandError: '',
  apps: [],
  appPage: 0,
  appsLoaded: false,
  appsLoading: false,
  appsError: '',
  recentItem: null,
  toastTimer: null,
  composing: false
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function toast(message, type = '') {
  const el = $('#toast');
  if (window.SuiraUI) {
    state.toastTimer = window.SuiraUI.notify(el,message,{error:type === 'error'});
    return;
  }
  el.textContent = message;
  el.className = `toast is-visible ${type === 'error' ? 'is-error' : type}`.trim();
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { el.className = 'toast'; }, 2000);
}

// IPC 拒绝也要在当前面板给出反馈，不留未处理的 Promise。
function listen(target, type, handler) {
  target.addEventListener(type, (event) => {
    try {
      const result = handler(event);
      if (result?.catch) result.catch((error) => toast(error?.message || '操作失败，请重试', 'error'));
    } catch (error) {
      toast(error?.message || '操作失败，请重试', 'error');
    }
  });
}

/* ---------- 模式 ---------- */

function fitFullscreenKeys(){
  const fit=()=>{if(presentation!=='fullscreen'||state.mode!=='actions')return;const grid=$('#key-grid'),body=$('#panel-body');if(!grid.offsetWidth||!grid.offsetHeight)return;$('#panel').style.setProperty('--keyboard-scale',Math.min((body.clientWidth-16)/grid.offsetWidth,(body.clientHeight-16)/grid.offsetHeight));};
  fit();requestAnimationFrame(fit);
}
function setMode(mode) {
  keyMotion?.clear();
  $('#mode-actions')?.setAttribute('aria-pressed', String(mode === 'actions'));
  $('#mode-apps')?.setAttribute('aria-pressed', String(mode === 'apps'));
  state.mode = mode;
  const panel = $('#panel');
  panel.dataset.mode = mode;
  $('#mode-chip').textContent = mode === 'apps' ? '应用' : mode === 'toolbox' ? '工具箱' : '动作';
  $('#toolbox').setAttribute('aria-pressed', String(mode === 'toolbox'));
  $('#toolbox').setAttribute('aria-label', mode === 'toolbox' ? '返回动作面板' : '打开工具箱');

  $('#key-grid').hidden = mode !== 'actions' || Boolean(state.query);
  $('#apps-panel').hidden = mode !== 'apps' || Boolean(state.query);
  $('#toolbox-panel').hidden = mode !== 'toolbox' || Boolean(state.query);
  $('#empty-state').hidden = true;
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
  fitFullscreenKeys();
}

function toggleApps() {
  if (state.query) clearSearch();
  setMode(state.mode === 'apps' ? 'actions' : 'apps');
}

/* ---------- 动作面板 ---------- */

function renderKeys() {
  keyMotion?.clear();
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
    button.addEventListener('click', () => {
      if (performance.now() < dragState.suppressClickUntil || bindingState.busy) return;
      pressKey(button.dataset.key);
    });
    button.addEventListener('pointerdown', (event) => beginKeyDrag(event, button));
    button.addEventListener('dragstart', (event) => event.preventDefault());
    // 右键任意键位：打开绑定编辑器（换功能、绑应用/文件夹/网页/清除）
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      openBindingEditor(button.dataset.key);
    });
  });
  loadAppIcons();fitFullscreenKeys();
}

function keyMarkup(key) {
  const bound = key.state === 'bound';
  const custom = key.state === 'custom';
  const classes = ['key', bound ? 'is-bound' : custom ? 'is-custom' : key.state === 'unimplemented' ? 'is-unimplemented' : 'is-unbound'];
  let glyph = '';
  if (bound) glyph = window.SuiraToolArt?.render(key.actionId) || GLYPHS[key.actionId] || `<span class="glyph-text">${escapeHtml(key.label.slice(0, 1))}</span>`;
  else if (custom) {
    const kind=key.hint === '打开网页' ? 'url' : key.hint === '打开文件夹' ? 'folder' : key.hint === '打开应用' ? 'app' : 'file';
    glyph=window.SuiraToolArt?.render(kind) || BINDING_GLYPHS[kind] || '';
  }
  // 功能名放在键面下，键面只承载图标与直达键。
  const inner = bound || custom
    ? `<span class="key-glyph">${key.appPath?`<span class="key-app-icon" data-icon-path="${escapeHtml(key.appPath)}">${appIconMarkup(key.appPath)}</span>`:glyph}</span><i class="key-badge">${escapeHtml(key.key)}</i>`
    : key.state === 'unimplemented'
      ? `<span class="key-letter">${escapeHtml(key.key)}</span>`
      : `<span class="key-letter">${escapeHtml(key.key)}</span>`;
  const shortcutHint=key.accelerator?`（${key.accelerator.replace(/\+/g, ' + ')}）${key.shortcutStatus?.ok===false?' 全局键不可用：'+key.shortcutStatus.error:''}`:'';
  const title = bound ? `${key.label}${key.hint ? `：${key.hint}` : ''}${shortcutHint}`
    : custom ? `${key.label}：${key.hint}${shortcutHint}（右键可改绑）`
    : key.state === 'unimplemented' ? `${key.label}：尚未实现` : '这个键还没有绑定动作，点击或右键可绑定';
  const aria = bound ? `${key.key}：${key.label}`
    : custom ? `${key.key}：${key.label}`
    : key.state === 'unimplemented' ? `${key.key}：${key.label}（尚未实现）` : `${key.key}：未绑定`;
  return `<button class="${classes.join(' ')}" type="button" data-key="${escapeHtml(key.key)}" data-action="${escapeHtml(key.actionId)}" data-state="${escapeHtml(key.state)}" aria-label="${escapeHtml(aria)}" data-hint="${escapeHtml(title)}">
    <span class="key-contact" aria-hidden="true"></span><span class="key-card"><span class="key-face">${inner}<span class="key-reflection" aria-hidden="true"><span class="key-sheen"></span></span></span></span>
    ${bound || custom || key.state === 'unimplemented' ? `<span class="key-name">${escapeHtml(key.label)}</span>` : ''}
  </button>`;
}

function keyByChar(char) {
  const target = String(char || '').toUpperCase();
  return state.keys.find((key) => key.key === target) || null;
}

function pressKey(char) {
  if (bindingState.busy || dragState.active) return;
  const key = keyByChar(char);
  if (!key) return;
  keyMotion?.pulse($$('.key', $('#key-grid')).find(button => button.dataset.key === key.key));
  if (key.state === 'bound') {
    runAction(key.actionId);
    return;
  }
  if (key.state === 'custom') {
    runAction(`binding:${key.key}`);
    return;
  }
  if (key.state === 'unimplemented') {
    toast(`「${key.label}」尚未实现，不会假装可用`);
    return;
  }
  // 未绑定的键：直接进入绑定编辑，让「空键」成为自定义入口
  openBindingEditor(key.key);
}

/* ---------- 键位绑定编辑器 ---------- */

const bindingState = { key: '', view: 'categories', busy: false };

function bindingEditorOpen() {
  return !$('#binding-editor').hidden;
}

function openBindingEditor(keyChar) {
  keyMotion?.clear();
  closeMoreMenu(false);
  const key = keyByChar(keyChar);
  if (!key || bindingState.busy || dragState.active) return;
  closeBindingEditor(false);
  bindingState.key = key.key;
  $('#binding-key').textContent = key.key;
  $('#binding-hint').textContent = key.state === 'custom'
    ? `当前：${key.label}（${key.hint}）`
    : key.state === 'bound' ? `当前：${key.label}` : '这个键还没有绑定内容';
  $('#binding-clear').hidden = !['custom', 'bound'].includes(key.state);
  $('.binding-foot').hidden = $('#binding-clear').hidden;
  $('#binding-url-input').value = '';
  $('#binding-editor').hidden = false;
  renderBindingActions();
  showBindingView('categories');
  window.SuiraUI?.openDialog($('#binding-editor'), {
    surface: $('.binding-card'), trigger: $$('.key').find(button => button.dataset.key === key.key), close: closeBindingEditor
  });
}

function closeBindingEditor(restore = true) {
  const key = bindingState.key;
  $('#binding-editor')._dialogCleanup?.(false);
  $('#binding-editor').hidden = true;
  bindingState.key = '';
  bindingAppRevision++;clearTimeout(bindingAppTimer);
  if (restore) $$('.key').find(button => button.dataset.key === key)?.focus({ preventScroll: true });
}

function positionBindingEditor() {
  if (!bindingEditorOpen()) return;
  const trigger = $$('.key').find(button => button.dataset.key === bindingState.key);
  if (!trigger) { closeBindingEditor(false); return; }
  const bounds = trigger.getBoundingClientRect();
  const card = $('.binding-card'), margin = 12, gap = 10;
  const { width, height } = card.getBoundingClientRect();
  // 贴在键帽下方；下方空间不足时向上展开，始终留在窗口内部。
  const below = innerHeight - bounds.bottom - gap;
  const preferredTop = below >= height ? bounds.bottom + gap : bounds.top - height - gap;
  const top = Math.max(margin, Math.min(innerHeight - height - margin, preferredTop));
  const left = Math.max(margin, Math.min(innerWidth - width - margin, bounds.left + bounds.width / 2 - width / 2));
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}

function showBindingView(view) {
  bindingState.view = view;
  $('#binding-categories').hidden = view !== 'categories';
  $('#binding-tools-view').hidden = view !== 'tools';
  $('#binding-url-row').hidden = view !== 'url';
  $('#binding-apps-view').hidden = view !== 'apps';
  $('.binding-card').classList.toggle('is-app-picker',view==='apps');
  $('#binding-back').hidden = view === 'categories';
  $('#binding-title').textContent = { categories: '绑定', tools: '内置工具', url: '绑定网页', apps:'绑定应用' }[view];
  positionBindingEditor();
  const focus = view === 'apps' ? $('#binding-app-search') : view === 'url' ? $('#binding-url-input') : view === 'tools'
    ? $('#binding-action-list button:not(:disabled)') : $('#binding-app');
  focus?.focus({ preventScroll: true });
  if(view==='apps')refreshBindingApps();else{bindingAppRevision++;clearTimeout(bindingAppTimer);}
}

let bindingAppRevision=0,bindingAppTimer,bindingApps=[],bindingAppIndex=0;
async function refreshBindingApps(refresh=false){
  const revision=++bindingAppRevision,query=$('#binding-app-search').value;
  $('#binding-app-status').textContent='正在查找本机应用…';
  try{
    const apps=await window.suira.apps.search(query,refresh);
    if(revision!==bindingAppRevision||!bindingEditorOpen()||bindingState.view!=='apps')return;
    bindingApps=Array.isArray(apps)?apps:[];bindingAppIndex=0;renderBindingApps();
    $('#binding-app-status').textContent=bindingApps.length?`${bindingApps.length} 个匹配应用`:'没有匹配的应用，可重新扫描或从文件选择';
  }catch(error){if(revision!==bindingAppRevision)return;bindingApps=[];renderBindingApps();$('#binding-app-status').textContent=error?.message||'读取失败，请重新扫描';}
  positionBindingEditor();
}
function renderBindingApps(){
  $('#binding-app-list').innerHTML=bindingApps.map((app,index)=>`<button type="button" class="binding-app-option ${index===bindingAppIndex?'is-selected':''}" role="option" aria-selected="${index===bindingAppIndex}" data-app-index="${index}" title="${escapeHtml(app.name)}"><span class="picker-app-icon" data-icon-path="${escapeHtml(app.filePath)}">${appIconMarkup(app.filePath)}</span><span>${escapeHtml(app.name)}</span></button>`).join('');
  $$('#binding-app-list button').forEach(button=>listen(button,'click',()=>bindIndexedApp(Number(button.dataset.appIndex))));
  loadAppIcons();
}
async function bindIndexedApp(index){const app=bindingApps[index];if(!app)return;await setKeyBinding({type:'app',target:app.filePath,name:app.name});}

function setBindingBusy(busy) {
  if (busy) keyMotion?.clear();
  bindingState.busy = busy;
  $('#binding-editor').setAttribute('aria-busy', String(busy));
  $$('.binding-card button, .binding-card input').forEach(button => {
    button.disabled = busy || button.dataset.current === 'true';
  });
}

/** 可指派的内置动作按钮（由主进程 panel:state 提供）。 */
function renderBindingActions() {
  const list = $('#binding-action-list');
  const actions = state.actions || [];
  list.innerHTML = actions.map((action) => {
    const home = state.keys.find(key => key.actionId === action.id && key.state === 'bound');
    const current = home?.key === bindingState.key;
    return `<button type="button" data-binding-action="${escapeHtml(action.id)}" data-current="${current}" aria-pressed="${current}" ${current ? 'disabled' : ''} data-hint="${escapeHtml(action.hint || action.label)}">
      <span class="binding-tool-icon" data-action="${escapeHtml(action.id)}">${GLYPHS[action.id] || BINDING_GLYPHS.app}</span>
      <span>${escapeHtml(action.label)}</span><kbd>${escapeHtml(home?.key || '+')}</kbd>
    </button>`;
  }).join('');
  const target = keyByChar(bindingState.key);
  $('#binding-action-help').textContent = ['bound', 'custom'].includes(target?.state)
    ? '已有键位的工具会互换位置，原有绑定会保留'
    : '选中后移到此键，原键位会空出';
  $$('#binding-action-list [data-binding-action]').forEach((button) => {
    listen(button, 'click', async () => {
      await setKeyBinding({ type: 'action', id: button.dataset.bindingAction });
    });
  });
}

async function setKeyBinding(binding, key = bindingState.key) {
  if (!key || bindingState.busy) return;
  setBindingBusy(true);
  try {
    const result = await window.suira.panel.setBinding({ key, binding });
    if (!result?.ok) { toast(result?.error || '绑定失败', 'error'); return; }
    toast(result.message || '已绑定');
    closeBindingEditor(false);
    await loadState();
    $$('.key').find(button => button.dataset.key === key)?.focus({ preventScroll: true });
  } catch (error) {
    toast(error?.message || '绑定失败', 'error');
  } finally {
    setBindingBusy(false);
  }
}

/** 应用/文件夹/文件：弹系统选择窗口后绑定所选路径。 */
async function pickAndBind(type) {
  const key = bindingState.key;
  if (!key || bindingState.busy) return;
  setBindingBusy(true);
  try {
    const picked = await window.suira.panel.pickPath({ type });
    if (!picked?.ok) {
      if (picked && picked.error) toast(picked.error, 'error');
      return;
    }
    setBindingBusy(false);
    await setKeyBinding({ type, target: picked.path }, key);
  } catch (error) {
    toast(error?.message || '选择失败', 'error');
  } finally {
    setBindingBusy(false);
  }
}

/* ---------- 左键拖动换位 ---------- */

const dragState = { source: null, active: false, ghost: null, target: '', suppressClickUntil: 0 };

function canDropOn(key) {
  return key && (key.state === 'unbound' && !key.actionId || key.state === 'unimplemented');
}

function beginKeyDrag(event, button) {
  if (event.button !== 0) return;
  // 新的一次按下立即可用；只拦截上一次拖动松手附带的 click。
  dragState.suppressClickUntil = 0;
  if (bindingEditorOpen() || bindingState.busy || dragState.source) return;
  const key = keyByChar(button.dataset.key);
  if (!key || !['bound', 'custom'].includes(key.state)) return;
  const bounds = button.getBoundingClientRect();
  Object.assign(dragState, { source: button, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
    offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top, width: bounds.width, height: bounds.height,
    active: false, target: '' });
}

function updateKeyDrag(event) {
  const drag = dragState;
  if (!drag.source || event.pointerId !== drag.pointerId) return;
  if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 7) return;
  if (!drag.active) {
    drag.active = true;
    keyMotion?.clear();
    drag.source.setPointerCapture(event.pointerId);
    drag.source.classList.add('is-drag-source');
    $('#panel').classList.add('is-key-dragging');
    drag.ghost = drag.source.cloneNode(true);
    drag.ghost.classList.remove('is-drag-source');
    drag.ghost.classList.add('key-drag-preview');
    drag.ghost.removeAttribute('data-key');
    drag.ghost.removeAttribute('data-hint');
    drag.ghost.removeAttribute('aria-describedby');
    drag.ghost.setAttribute('aria-hidden', 'true');
    drag.ghost.tabIndex = -1;
    drag.ghost.style.width = `${drag.width}px`;
    drag.ghost.style.height = `${drag.height}px`;
    document.body.append(drag.ghost);
    $$('.key', $('#key-grid')).forEach(button => button.classList.toggle('is-drop-target', Boolean(canDropOn(keyByChar(button.dataset.key)))));
    $('#key-drag-status').hidden = false;
  }
  event.preventDefault();
  drag.ghost.style.left = `${event.clientX - drag.offsetX}px`;
  drag.ghost.style.top = `${event.clientY - drag.offsetY}px`;
  const hovered = document.elementFromPoint(event.clientX, event.clientY)?.closest('#key-grid .key');
  const key = keyByChar(hovered?.dataset.key);
  drag.target = canDropOn(key) ? key.key : '';
  $$('.is-drop-over').forEach(button => button.classList.remove('is-drop-over'));
  if (drag.target) hovered.classList.add('is-drop-over');
  drag.ghost.classList.toggle('is-drop-blocked', Boolean(key && !drag.target));
  $('#key-drag-status').textContent = drag.target
    ? `松开移到 ${drag.target} 键，按 ${drag.target} 即可调用`
    : key && key.key !== drag.source.dataset.key ? '这个键已有绑定，请移到空键位' : '拖到空键位，Esc 取消';
}

function cancelKeyDrag() {
  keyMotion?.clear();
  const drag = dragState;
  if (drag.active) drag.suppressClickUntil = performance.now() + 250;
  const source = drag.source, pointerId = drag.pointerId;
  drag.source = null;
  drag.active = false;
  drag.ghost?.remove();
  drag.ghost = null;
  drag.target = '';
  $('#panel').classList.remove('is-key-dragging');
  $('#key-drag-status').hidden = true;
  $$('.is-drag-source, .is-drop-target, .is-drop-over').forEach(button => button.classList.remove('is-drag-source', 'is-drop-target', 'is-drop-over'));
  if (source?.hasPointerCapture(pointerId)) source.releasePointerCapture(pointerId);
}

async function finishKeyDrag(event) {
  const drag = dragState;
  if (!drag.source || event.pointerId !== drag.pointerId) return;
  const fromKey = drag.source.dataset.key, active = drag.active;
  if (active) updateKeyDrag(event);
  const toKey = drag.target;
  cancelKeyDrag();
  if (!active || !toKey) return;
  setBindingBusy(true);
  $('#key-grid').setAttribute('aria-busy', 'true');
  try {
    const result = await window.suira.panel.moveBinding({ fromKey, toKey });
    if (!result?.ok) { toast(result?.error || '键位移动失败', 'error'); return; }
    await loadState();
    $$('.key').find(button => button.dataset.key === toKey)?.focus({ preventScroll: true });
    toast(result.message || `已移到 ${toKey} 键`);
  } catch (error) {
    toast(error?.message || '键位移动失败', 'error');
  } finally {
    setBindingBusy(false);
    $('#key-grid').setAttribute('aria-busy', 'false');
  }
}

/* ---------- 应用面板 ---------- */

async function loadApps() {
  if (state.appsLoading) return;
  state.appsLoading = true;
  state.appsError = '';
  renderApps();
  try {
    const apps = await window.suira.apps.list();
    state.apps = Array.isArray(apps) ? apps : [];
    state.appsLoaded = true;
  } catch (error) {
    state.apps = [];
    state.appsLoaded = false;
    state.appsError = error?.message || '无法读取应用列表';
  } finally {
    state.appsLoading = false;
    renderApps();
    loadAppIcons();
  }
}

/** 当前页图标按需补齐：先出名称，再补图标，避免整页等待。 */
const iconJobs=new Map();
const appIconCache=new Map();
let iconWorkers=0, iconPumpTimer=0;
function appIconMarkup(filePath,icon=''){
  const image=appIconCache.get(filePath)||icon;
  return image?`<img src="${escapeHtml(image)}" alt="" decoding="async">`:BINDING_GLYPHS.app;
}
function pumpIcons() {
  while(iconWorkers<2&&iconJobs.size) {
    const start=state.appPage*appPageSize(),apps=filteredApps();
    const visible=new Set(apps.slice(start,start+appPageSize()).map(a=>a.filePath));
    const queued=Array.from(iconJobs).filter(([,job])=>!job.running).sort((a,b)=>Number(visible.has(b[0]))-Number(visible.has(a[0]))).slice(0,6);
    if(!queued.length)return;
    queued.forEach(([,job])=>job.running=true);iconWorkers++;
    window.suira.apps.icons(queued.map(([p])=>p)).then(icons=>{
      for(const [p] of queued) {
        if(!icons?.[p])continue;
        appIconCache.set(p,icons[p]);
        const app=state.apps.find(a=>a.filePath===p);if(app)app.icon=icons[p];
        // 原地补图标，不重建整页或抢走键盘焦点。
        for(const slot of $$('[data-icon-path]'))if(slot.dataset.iconPath===p){
          const image=new Image();image.src=icons[p];image.alt='';image.decoding='async';slot.replaceChildren(image);
        }
      }
    }).catch(()=>{}).finally(()=>{
      queued.forEach(([p])=>iconJobs.delete(p));iconWorkers--;pumpIcons();
    });
  }
}
async function loadAppIcons() {
  const apps=filteredApps(),start=state.appPage*appPageSize();
  // 当前页优先；前后一页在后台预取，用户翻页时可直接使用。
  const nearby=state.mode==='apps'&&!state.query?apps.slice(Math.max(0,start-appPageSize()),start+appPageSize()*2):[];
  for(const slot of $$('[data-icon-path]'))if(slot.getClientRects().length)nearby.push({filePath:slot.dataset.iconPath});
  const wanted=new Set(nearby.map(a=>a.filePath));
  for(const [p,job] of iconJobs)if(!job.running&&!wanted.has(p))iconJobs.delete(p);
  for(const app of nearby)if(!app.icon&&!appIconCache.has(app.filePath)&&!iconJobs.has(app.filePath))iconJobs.set(app.filePath,{running:false});
  clearTimeout(iconPumpTimer);iconPumpTimer=setTimeout(pumpIcons,0);
}

function filteredApps() {
  const query = state.query.trim().toLowerCase();
  if (!query) return state.apps;
  return state.apps.filter((app) => String(app.name || '').toLowerCase().includes(query));
}

function renderApps() {
  const grid = $('#apps-grid');
  const apps = filteredApps();
  const pageCount = Math.max(1, Math.ceil(apps.length / appPageSize()));
  if (state.appPage > pageCount - 1) state.appPage = 0;
  const start = state.appPage * appPageSize();
  const pageApps = apps.slice(start, start + appPageSize());

  const visible = state.mode === 'apps' && !state.query;
  $('#empty-state').hidden = !visible || Boolean(apps.length);
  $('#empty-title').textContent = state.appsLoading ? '正在读取应用' : state.appsError ? '应用读取失败' : '没有找到应用';
  $('#empty-description').textContent = state.appsLoading ? '首次启动会扫描开始菜单，请稍候。' : state.appsError || '开始菜单中暂时没有应用，可以重新扫描。';
  $('#apps-retry').hidden = state.appsLoading;

  grid.innerHTML = pageApps.map((app,index) => {
    const icon = appIconMarkup(app.filePath,app.icon);
    return `<button class="app-item" type="button" data-path="${escapeHtml(app.filePath || '')}" title="${escapeHtml(app.name || '')}">
      <span class="app-launch-number">${index<7?index+1:''}</span><span class="app-icon" data-icon-path="${escapeHtml(app.filePath)}">${icon}</span>
      <span class="app-name">${escapeHtml(app.name || '')}</span>
    </button>`;
  }).join('');

  $$('.app-item', grid).forEach((button) => {
    button.addEventListener('click', () => openApp(button.dataset.path));
  });
  $('#apps-dots').innerHTML=Array.from({length:pageCount},(_,index)=>`<button type="button" aria-label="第 ${index+1} 页" ${index===state.appPage?'aria-current="page"':''} data-page="${index}"></button>`).join('');
  $$('#apps-dots button').forEach(button=>button.onclick=()=>{state.appPage=Number(button.dataset.page);renderApps();loadAppIcons();});
  $('#apps-pager').textContent = `第 ${state.appPage + 1} / ${pageCount} 页`;
  $('#apps-prev').disabled = state.appPage <= 0;
  $('#apps-next').disabled = state.appPage >= pageCount - 1;
}

async function openApp(filePath) {
  if (!filePath) return;
  try {
    const result = await window.suira.quick.openApp(filePath);
    if (!result?.ok) { toast(result?.error || '无法启动该应用', 'error'); return; }
    await window.suira.quick.hide();
  } catch (error) {
    toast(error?.message || '无法启动该应用', 'error');
  }
}

/* ---------- 工具箱 ---------- */

function renderTools() {
  $('#tool-grid').innerHTML = state.tools.map((tool) => `
    <button class="tool-item ${tool.implemented ? '' : 'is-todo'}" type="button" data-id="${escapeHtml(tool.id)}" ${tool.implemented ? '' : 'aria-disabled="true"'}>
      <span class="tool-mark" data-tool="${escapeHtml(tool.id)}">${window.SuiraToolArt?.render(tool.id)||GLYPHS[tool.id]||BINDING_GLYPHS.app}</span>
      <span class="tool-copy"><b>${escapeHtml(tool.label)}</b><small>${escapeHtml(tool.implemented ? tool.hint : '尚未实现')}</small></span>
    </button>
  `).join('');
  $$('.tool-item').forEach((button) => {
    listen(button, 'click', async () => {
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
let commandRevision = 0;

function cancelCommands() {
  clearTimeout(commandTimer);
  commandRevision += 1;
  state.commandLoading = false;
  state.commandError = '';
}

function clearSearch() {
  cancelCommands();
  state.query = '';
  state.commandResults = [];
  $('#search').value = '';
  setMode(state.mode === 'apps' ? 'apps' : 'actions');
}

function updateSearch(value) {
  keyMotion?.clear();
  cancelCommands();
  state.query = value.trim();
  state.commandIndex = 0;
  state.commandResults = [];
  if (!state.query) {
    state.commandResults = [];
    $('#key-grid').hidden = state.mode !== 'actions';
    $('#apps-panel').hidden = state.mode !== 'apps';
    $('#command-section').hidden = true;
    $('#toolbox-panel').hidden = state.mode !== 'toolbox';
    renderApps();
    return;
  }
  $('#key-grid').hidden = true;
  $('#apps-panel').hidden = true;
  $('#empty-state').hidden = true;
  $('#toolbox-panel').hidden = true;
  $('#command-section').hidden = false;
  state.commandLoading = true;
  renderCommands();
  commandTimer = setTimeout(refreshCommands, 90);
  if (state.mode === 'apps') renderApps();
}

async function refreshCommands() {
  const revision = commandRevision;
  const query = state.query;
  if (!query) return;
  try {
    const results = await window.suira.search.query(query,{scope:state.mode==='apps'?'apps':'all'});
    if (revision !== commandRevision) return;
    state.commandResults = Array.isArray(results) ? results.slice(0, 12) : [];
  } catch (error) {
    if (revision !== commandRevision) return;
    state.commandResults = [];
    state.commandError = error?.message || '请稍后重试';
  }
  state.commandLoading = false;
  renderCommands();
}

function renderCommands() {
  const list = $('#command-list');
  const results = state.commandResults;
  $('#command-heading').textContent=state.mode==='apps'?'搜索应用':'搜索结果';
  if (!results.length) {
    list.innerHTML = `<div class="command-empty" role="status">${state.commandLoading ? '正在搜索…' : state.commandError ? `搜索失败：${escapeHtml(state.commandError)}` : '没有匹配的命令、应用或内容'}</div>`;
    return;
  }
  list.innerHTML = results.slice(0, 12).map((entry, index) => {
    const appPath=entry.kind==='app'?(entry.appPath||String(entry.id).replace(/^app:/,'')):'';
    const action=String(entry.action||'').replace('navigate:','');
    const glyph=appPath?appIconMarkup(appPath):GLYPHS[action]||GLYPHS[entry.kind==='task'?'shelf':entry.contentKind==='image'?'edit-image':'note']||BINDING_GLYPHS.file;
    return `<button class="command-item ${index === state.commandIndex ? 'is-selected' : ''}" type="button" role="option" aria-selected="${index===state.commandIndex}" data-index="${index}" data-kind="${escapeHtml(entry.kind)}" data-id="${escapeHtml(entry.id)}">
      <span class="command-icon" ${appPath?`data-icon-path="${escapeHtml(appPath)}"`:''}>${glyph}</span>
      <span class="command-copy"><b>${escapeHtml(entry.title)}</b><small>${escapeHtml(entry.subtitle || '')}</small></span>
      <span class="command-type">${({app:'应用',command:'工具',task:'任务',content:'内容'})[entry.kind]||'内容'}</span><kbd class="command-enter">↵</kbd>
    </button>`;
  }).join('');
  $$('.command-item', list).forEach((button) => {
    listen(button, 'click', () => runCommand(Number(button.dataset.index)));
  });
  $('.command-item.is-selected',list)?.scrollIntoView({block:'nearest'});
  loadAppIcons();
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
  if (action === 'note') { runAction('note'); return; }
  if (action === 'edit-image') { runAction('edit-image'); return; }
  if (action === 'long-capture') { runAction('long-capture'); return; }
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
    await handleActionResult(result);
  } catch (error) {
    toast(error.message || '动作执行失败', 'error');
  }
}

async function handleActionResult(result) {
    if (!result) return;
    if (result.ocr) { showOcr(result.ocr.text || '', result.ocr.itemId || ''); return; }
    if (result.translate) { await showTranslate(result.translate); return; }
    if (result.openClipboardBar) { await openClipboardBar(); return; }
    if (result.message) toast(result.message, result.ok ? '' : 'error');
    else if (result.error) toast(result.error, 'error');
    // 动作结果在主窗口某页里（内容库 / 任务匣）：带用户过去看，
    // 而不是让结果留在看不见的地方
    if (result.openPage) {
      window.suira.quick.showMain(result.openPage);
      return;
    }
    if (result.closePanel) window.suira.quick.hide();
}

window.suira.panel.onResult?.(result=>handleActionResult(result).catch(error=>toast(error.message||'动作执行失败','error')));

function showOcr(text, itemId) {
  closeTranslate();
  const panel = $('#ocr-panel');
  panel.hidden = false;
  $('#ocr-text').value = text || '';
  $('#ocr-text').placeholder = text ? '' : '没有识别到文字，换一张更清晰的图片试试';
  panel.dataset.itemId = itemId;
  $('#ocr-text').focus();
}

function closeOcr() {
  $('#ocr-panel').hidden = true;
  delete $('#ocr-panel').dataset.itemId;
}

async function openClipboardBar() {
  await window.suira.quick.hide();
  try {
    const result=await window.suira.clipboardBar.show();
    if(result?.ok===false)throw new Error(result.error||'剪贴板横栏打开失败');
  } catch(error) {
    await window.suira.quick.show();
    throw error;
  }
}

/* ---------- 翻译结果 ---------- */

let translateRevision = 0;

/** 目标语言下拉只在第一次打开时填充，之后复用。 */
async function fillTranslateTargets(selected) {
  const select = $('#translate-target');
  if (!select || select.dataset.filled === 'true') {
    if (select && selected) select.value = selected;
    return;
  }
  try {
    const status = await window.suira.translate.status();
    const targets = status?.targets || [];
    if (!targets.length) return;
    select.innerHTML = targets
      .map((entry) => `<option value="${escapeHtml(entry.code)}">${escapeHtml(entry.label)}</option>`)
      .join('');
    select.dataset.filled = 'true';
    if (selected) select.value = selected;
    else if (status?.target) select.value = status.target;
  } catch {
    /* 状态读不到时保留下拉为空，用户仍能看到译文 */
  }
}

async function showTranslate(payload) {
  translateRevision += 1;
  const panel = $('#translate-panel');
  if (!panel) return;
  panel.hidden = false;
  closeOcr();
  const source = String(payload?.source || '');
  const text = String(payload?.text || '');
  $('#translate-source').textContent = source || '（没有原文）';
  $('#translate-text').value = text;
  $('#translate-text').placeholder = text ? '' : '译文会显示在这里';
  panel.dataset.sourceText = source;
  panel.dataset.itemId = payload?.itemId || '';
  // 原文就是图片时才有「查看原图」，纯文字内容没有可看的图
  $('#translate-original').hidden = !payload?.hasImage;
  $('#translate-text').focus();
  await fillTranslateTargets(payload?.to || '');
  if (!text) toast('没有拿到译文，换个引擎或稍后重试', 'error');
}

function closeTranslate() {
  translateRevision += 1;
  const panel = $('#translate-panel');
  if (!panel) return;
  panel.hidden = true;
  delete panel.dataset.sourceText;
  delete panel.dataset.itemId;
}

/* ---------- 命令配方使用的最近内容 ---------- */

async function loadRecent() {
  try {
    const items = await window.suira.content.list({ limit: 1 });
    state.recentItem = items?.[0] || null;
  } catch {
    state.recentItem = null;
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
    state.actions = snapshot?.actions || [];
  } catch (error) {
    state.keys = [];
    toast(error?.message || '面板加载失败，请重新打开', 'error');
  }
  renderKeys();
  syncShortcutChip();
}

/** 底部截图角标显示真实的全局键位（用户改过键时不再显示写死的 Ctrl Shift A）。 */
async function syncShortcutChip() {
  try {
    const snapshot = await window.suira.shortcuts.get();
    for (const [name, selector] of [['capture', '#capture-kbd'], ['clipboardBar', '#clipboard-kbd']]) {
      const el = $(selector);
      if (!el) continue;
      const action=name==='capture'?'capture':'clipboard';
      const bound=state.keys.find(key=>key.actionId===action&&key.state==='bound');
      const accelerator = String(bound?.accelerator || snapshot?.bindings?.[name] || '');
      el.textContent = accelerator ? accelerator.replace(/CommandOrControl/gi, 'Ctrl').split('+').join(' ') : '未绑定';
    }
  } catch {
    /* 读不到键位时保留默认文案 */
  }
}

let submenuTimer=0,submenuSwitchTimer=0;
function closeMoreSubmenu(){
  clearTimeout(submenuTimer);clearTimeout(submenuSwitchTimer);
  $$('[data-menu-group]').forEach(group=>group.hidden=true);
  $$('#panel-more-menu [data-menu-section]').forEach(button=>button.setAttribute('aria-expanded','false'));
}
function openMoreSubmenu(name,focus=false){
  clearTimeout(submenuTimer);clearTimeout(submenuSwitchTimer);
  $$('[data-menu-group]').forEach(group=>group.hidden=group.dataset.menuGroup!==name);
  $$('#panel-more-menu [data-menu-section]').forEach(button=>button.setAttribute('aria-expanded',String(button.dataset.menuSection===name)));
  positionMoreMenu();if(focus)$(`[data-menu-group="${name}"] button`)?.focus();
}
function deferCloseSubmenu(){
  clearTimeout(submenuTimer);submenuTimer=setTimeout(()=>{
    if(!$('#panel-more-menu').matches(':hover')&&!$$('[data-menu-group]').some(group=>!group.hidden&&group.matches(':hover')))closeMoreSubmenu();
  },180);
}
let updateState={phase:'idle'};
function renderUpdate(value){
  updateState=value;$('#update-version').textContent=`当前 ${value.current||''}${value.version?' → '+value.version:''}`;
  $('#update-message').textContent=value.message||'检查是否有新的正式版本。';
  $('#update-progress').hidden=value.phase!=='downloading';$('#update-progress').value=value.percent||0;
  const button=$('#update-action');button.disabled=['checking','downloading','preparing','installing','unsupported'].includes(value.phase);
  button.textContent=value.phase==='available'?'下载更新':value.phase==='ready'?'保存草稿并重启更新':value.phase==='downloading'?`正在下载 ${Math.round(value.percent||0)}%`:value.phase==='checking'?'正在检查…':'检查更新';
}
function closeUpdates(){$('#update-dialog')._dialogCleanup?.(false);$('#update-dialog').hidden=true;$('#panel-more').focus();}
async function openUpdates(){
  $('#update-dialog').hidden=false;$('#update-close').focus();
  window.SuiraUI?.openDialog($('#update-dialog'),{surface:$('.update-card'),trigger:$('#panel-more'),close:closeUpdates});
  try{renderUpdate(await window.suira.updates.check());}catch{renderUpdate({phase:'error',message:'检查失败，请稍后重试。'});}
}
function closeMoreMenu(restore=true){
  const inside=document.activeElement?.closest('#panel-more-menu,[data-menu-group]');
  closeMoreSubmenu();$('#panel-more-menu').hidden=true;$('#panel-more').setAttribute('aria-expanded','false');
  if(restore)$('#panel-more').focus();else if(inside)document.activeElement?.blur();
}
function positionMoreMenu(){
  const menu=$('#panel-more-menu');if(menu.hidden)return;
  const anchor=$('#panel-more').getBoundingClientRect(),box=menu.getBoundingClientRect();
  menu.style.left=Math.max(12,Math.min(innerWidth-box.width-12,anchor.right-box.width))+'px';
  menu.style.top=Math.max(12,Math.min(innerHeight-box.height-12,anchor.bottom+8))+'px';
  const root=menu.getBoundingClientRect();
  $$('[data-menu-group]').filter(group=>!group.hidden).forEach(group=>{
    const trigger=$(`#panel-more-menu [data-menu-section="${group.dataset.menuGroup}"]`).getBoundingClientRect(),rect=group.getBoundingClientRect();
    const right=root.right+6,left=right+rect.width<=innerWidth-12?right:root.left-rect.width-6;
    group.dataset.side=left>=root.right?'right':'left';
    group.style.left=Math.max(12,Math.min(innerWidth-rect.width-12,left))+'px';
    group.style.top=Math.max(12,Math.min(innerHeight-rect.height-12,trigger.top-6))+'px';
  });
}
async function toggleMoreMenu(){
  const menu=$('#panel-more-menu');if(!menu.hidden){closeMoreMenu();return;}
  closeMoreSubmenu();menu.hidden=false;$('#panel-more').setAttribute('aria-expanded','true');
  $$('[data-display]').forEach(button=>button.setAttribute('aria-checked',String(button.dataset.display===presentation)));
  $$('[data-layout]').forEach(button=>button.setAttribute('aria-checked',String(button.dataset.layout===state.mode)));
  positionMoreMenu();menu.querySelector('button').focus();
  try{const settings=await window.suira.settings.get();if(menu.hidden)return;$$('[data-theme]').forEach(button=>button.setAttribute('aria-checked',String(button.dataset.theme===settings.theme)));}catch{}
}
let searchPointerNear = false;
let presentation='window';
function syncPresentation(value){
  const previous=presentation;
  presentation=value?.mode==='fullscreen'?'fullscreen':'window';
  const full=presentation==='fullscreen',button=$('#presentation-toggle');
  $('#panel').dataset.presentation=presentation;button.setAttribute('aria-pressed',String(full));
  button.setAttribute('aria-label',full?'切换到窗口启动台':'切换到全屏启动台');
  if(full&&previous!==presentation){const mode=state.mode;state.appPage=0;clearSearch();setMode(mode);loadImmersiveBackground();}
  if(!full&&previous!==presentation){$('#launchpad-backdrop').style.backgroundImage='';renderApps();}
  if(full){setSearchExpanded(true);$('#search').placeholder=state.mode==='apps'?'直接按首字母搜索':'搜索工具、应用或内容';renderApps();loadAppIcons();fitFullscreenKeys();}
  button.title=full?'窗口模式 (F11 / Esc)':'全屏启动台 (F11)';button.querySelector('span').textContent=full?'窗口':'全屏';
}
async function changePresentation(mode=presentation==='fullscreen'?'window':'fullscreen',remember=true){
  const button=$('#presentation-toggle');if(button.disabled)return;button.disabled=true;
  try{const result=await window.suira.quick.setPresentation(mode,{remember});if(!result?.ok)throw Error(result?.error||'切换显示模式失败');syncPresentation(result);positionBindingEditor();}
  catch(error){toast(error.message,'error');}finally{button.disabled=false;}
}
async function loadImmersiveBackground(){
  try{const result=await window.suira.quick.background?.();if(presentation!=='fullscreen')return;const data=result?.dataUrl||'';if(data.startsWith('data:image/'))$('#launchpad-backdrop').style.backgroundImage=`url("${data}")`;$('#panel').dataset.backdrop=result?.source||'gradient';}catch{}
}
function setSearchExpanded() {
  document.querySelector('.search-field').classList.add('is-expanded');
  $('#search-toggle').setAttribute('aria-expanded','true');
  $('#search').tabIndex=0;
}
function focusSearch() {
  setSearchExpanded(true);
  $('#search').focus();
}

function installEvents() {
  let guideDismissed=false;
  const showGuideIfNeeded=async()=>{
    const settings=await window.suira.settings?.get?.();
    if(!guideDismissed&&settings&&!settings.panelGuideSeen)$('#panel-guide').hidden=false;
  };
  const syncMaterial=settings=>{const value=settings.panelMaterial||'soft';$('#panel').style.setProperty('--panel-opacity',({soft:.94,clear:.87,solid:.98})[value]||.94);$$('[data-material]').forEach(button=>button.setAttribute('aria-checked',String(button.dataset.material===value)));};
  window.suira.settings?.get?.().then(syncMaterial).catch(()=>{});
  window.suira.settings?.onChanged?.(syncMaterial);
  $$('[data-material]').forEach(button=>listen(button,'click',async()=>{const result=await window.suira.settings.update({panelMaterial:button.dataset.material});if(!result?.ok)throw Error(result?.error||'保存失败');syncMaterial(result.settings);closeMoreMenu(false);}));
  $('#guide-close').onclick=async()=>{guideDismissed=true;$('#panel-guide').hidden=true;await window.suira.settings.update({panelGuideSeen:true});};
  // The first shown IPC can precede renderer event installation. Initialize the
  // guide independently, while retaining the dismissal guard for late replies.
  showGuideIfNeeded().catch(()=>{});
  $('#update-close').onclick=closeUpdates;
  window.suira.updates?.onState(renderUpdate);
  listen($('#update-action'),'click',async()=>{const api=window.suira.updates;renderUpdate(await (updateState.phase==='available'?api.download():updateState.phase==='ready'?api.install():api.check()));});
  $('#update-dialog').addEventListener('click',event=>{if(event.target===$('#update-dialog'))closeUpdates();});
  $('#update-dialog').addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();closeUpdates();}});

  setSearchExpanded();
  $('#search-toggle').addEventListener('click',focusSearch);
  $('#panel-more').addEventListener('click',()=>toggleMoreMenu());
  $('#panel-more').addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();toggleMoreMenu();}});
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('#panel-more-menu,#panel-more,[data-menu-group]'))closeMoreMenu(false);});
  window.addEventListener('resize',()=>{positionMoreMenu();fitFullscreenKeys();});
  window.addEventListener('blur',()=>closeMoreMenu(false));
  $$('[data-menu-group]').forEach(group=>{
    group.classList.add('panel-more-submenu');group.setAttribute('role','menu');group.id='panel-submenu-'+group.dataset.menuGroup;
    $('#panel').append(group);group.addEventListener('pointerenter',()=>{clearTimeout(submenuTimer);clearTimeout(submenuSwitchTimer);});group.addEventListener('pointerleave',deferCloseSubmenu);
  });
  $('#panel-more-menu').addEventListener('pointerenter',()=>clearTimeout(submenuTimer));
  $('#panel-more-menu').addEventListener('pointerleave',deferCloseSubmenu);
  $$('#panel-more-menu>button').forEach(button=>{
    button.addEventListener('pointerenter',()=>button.focus({preventScroll:true}));
    if(button.dataset.menuSection){
      button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-controls','panel-submenu-'+button.dataset.menuSection);
      button.addEventListener('pointerenter',()=>{clearTimeout(submenuSwitchTimer);if(!$$('[data-menu-group]').some(group=>!group.hidden))openMoreSubmenu(button.dataset.menuSection);else submenuSwitchTimer=setTimeout(()=>openMoreSubmenu(button.dataset.menuSection),160);});
      button.onclick=()=>openMoreSubmenu(button.dataset.menuSection);
    }else button.addEventListener('pointerenter',()=>{clearTimeout(submenuSwitchTimer);submenuSwitchTimer=setTimeout(()=>{if(!$$('[data-menu-group]').some(group=>!group.hidden&&group.matches(':hover')))closeMoreSubmenu();},180);});
  });
  $$('[data-display]').forEach(button=>listen(button,'click',async()=>{closeMoreMenu(false);await changePresentation(button.dataset.display);}));
  $$('[data-layout]').forEach(button=>button.onclick=()=>{clearSearch();setMode(button.dataset.layout);closeMoreMenu(false);});
  $$('[data-theme]').forEach(button=>listen(button,'click',async()=>{
    const result=await window.suira.settings.update({theme:button.dataset.theme,themeChosen:true});
    if(!result?.ok)throw Error(result?.error||'外观保存失败');closeMoreMenu();
  }));
  $$('#panel-more-menu [data-menu-action]').forEach(button=>listen(button,'click',async()=>{
    const action=button.dataset.menuAction;closeMoreMenu(false);
    if(action==='settings'||action==='shortcuts')await window.suira.quick.showMain(action==='shortcuts'?'settings:shortcuts':'settings');
    else if(action==='guide')$('#panel-guide').hidden=false;
    else if(action==='releases')await openUpdates();
    else if(action==='restart')await window.suira.app.restart();
    else if(action==='quit')await window.suira.app.quit();
  }));
  [$('#panel-more-menu'),...$$('[data-menu-group]')].forEach(surface=>surface.addEventListener('keydown',event=>{
    if(event.isComposing)return;
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();closeMoreMenu();return;}
    if(event.key==='Tab'){closeMoreMenu(false);return;}
    const buttons=$$('button',surface).filter(button=>button.getClientRects().length),index=buttons.indexOf(document.activeElement);
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus();
    }else if(event.key==='ArrowRight'&&document.activeElement.dataset.menuSection){event.preventDefault();openMoreSubmenu(document.activeElement.dataset.menuSection,true);}
    else if(event.key==='ArrowLeft'){const group=document.activeElement.closest('[data-menu-group]');if(group){event.preventDefault();const parent=$(`#panel-more-menu [data-menu-section="${group.dataset.menuGroup}"]`);closeMoreSubmenu();parent.focus();}}
  }));
  document.addEventListener('pointermove', updateKeyDrag, { passive: false });
  listen(document, 'pointerup', finishKeyDrag);
  document.addEventListener('pointercancel', cancelKeyDrag);
  document.addEventListener('lostpointercapture', () => { if (dragState.source) cancelKeyDrag(); });
  window.addEventListener('blur', () => { cancelKeyDrag(); if (!bindingState.busy) closeBindingEditor(false); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelKeyDrag(); closeBindingEditor(false); } });
  window.addEventListener('resize', () => { cancelKeyDrag(); positionBindingEditor(); });
  $('#panel-body').addEventListener('scroll', positionBindingEditor, true);
  const input = $('#search');
  input.addEventListener('input', (event) => updateSearch(event.target.value));
  input.addEventListener('compositionstart', () => { state.composing = true; });
  input.addEventListener('compositionend', () => { state.composing = false; });
  input.addEventListener('keydown', (event) => {
    if (event.isComposing || state.composing) return;
    if(presentation==='fullscreen'&&state.mode==='apps'&&!state.query&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&/^[1-7]$/.test(event.key)){event.preventDefault();const app=filteredApps()[state.appPage*appPageSize()+Number(event.key)-1];if(app)openApp(app.filePath);return;}
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (state.query) clearSearch();
      else if(presentation==='fullscreen')changePresentation('window',false);
      else if (state.mode !== 'actions') setMode('actions');
      else window.suira.quick.hide();
      return;
    }
    if(presentation==='fullscreen'&&state.mode==='apps'&&!state.query&&['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const button=event.key==='ArrowLeft'?$('#apps-prev'):$('#apps-next');if(!button.disabled)button.click();return;}
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
        if (state.commandLoading) toast('还在搜索，稍等一下');
        return;
      }
      event.preventDefault();
      runCommand(state.commandIndex).catch((error) => toast(error?.message || '执行失败', 'error'));
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.isComposing || state.composing) return;
    if(!$('#update-dialog').hidden)return;
    if(event.key==='F11'){event.preventDefault();changePresentation();return;}
    if (dragState.source) {
      if (event.key === 'Escape') { event.preventDefault(); cancelKeyDrag(); }
      return;
    }
    if (bindingState.busy) { event.preventDefault(); return; }
    if (!$('#ocr-panel').hidden) {
      if (event.key === 'Escape') { event.preventDefault(); closeOcr(); }
      return;
    }
    if (!$('#translate-panel').hidden) {
      if (event.key === 'Escape') { event.preventDefault(); closeTranslate(); }
      return;
    }
    // 绑定编辑器打开时按键只服务编辑器：字母不再触发面板动作
    if (bindingEditorOpen()) {
      if (event.key === 'Escape') { event.preventDefault(); closeBindingEditor(); }
      return;
    }
    const inInput = event.target === input || Boolean(event.target.closest?.('input,textarea,select,[contenteditable="true"]'));
    if(event.repeat)return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (state.query) clearSearch();
      else if(presentation==='fullscreen')changePresentation('window',false);
      else if (state.mode !== 'actions') { clearSearch(); setMode('actions'); }
      else window.suira.quick.hide();
      return;
    }
    if (!inInput && event.key === 'F3') { event.preventDefault(); focusSearch(); return; }
    if (inInput) return; // 输入框自行处理，避免把字母解释成动作
    // 聚焦控件时保留浏览器的原生激活行为，空格不再误切换面板。
    if (event.target.closest?.('button') && (event.key === ' ' || event.key === 'Enter')) return;
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
        runCommand(state.commandIndex).catch((error) => toast(error?.message || '执行失败', 'error'));
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
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
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
  $('#mode-actions').addEventListener('click', () => { clearSearch(); setMode('actions'); });
  $('#mode-apps').addEventListener('click', () => { clearSearch(); setMode('apps'); });
  $('#capture').addEventListener('click', () => runAction('capture'));
  listen($('#open-clipboard'), 'click', openClipboardBar);
  $('#apps-prev').addEventListener('click', () => { state.appPage -= 1; renderApps(); loadAppIcons(); });
  $('#apps-next').addEventListener('click', () => { state.appPage += 1; renderApps(); loadAppIcons(); });
  listen($('#apps-retry'), 'click', loadApps);
  $('#panel-body').addEventListener('click', (event) => {
    if (event.target === $('#panel-body') && state.mode === 'actions' && !state.query) focusSearch();
  });

  $('#ocr-close').addEventListener('click', closeOcr);

  /* ---- 键位绑定编辑器 ---- */
  $('#binding-close').addEventListener('click', closeBindingEditor);
  $('#binding-back').addEventListener('click', () => showBindingView('categories'));
  $('#binding-editor').addEventListener('click', (event) => {
    if (event.target === $('#binding-editor')) closeBindingEditor();
  });
  $('#immersive-back').addEventListener('click',()=>{clearSearch();setMode(state.mode==='apps'?'actions':'apps');});
  $('#apps-grid').addEventListener('wheel',event=>{if(presentation!=='fullscreen'||state.query||event.ctrlKey||event.metaKey)return;event.preventDefault();const now=Date.now();if(now-(state.lastPageWheel||0)<300)return;state.lastPageWheel=now;const next=state.appPage+Math.sign(event.deltaY||event.deltaX);state.appPage=Math.max(0,Math.min(Math.ceil(filteredApps().length/appPageSize())-1,next));renderApps();loadAppIcons();},{passive:false});
  $('#presentation-toggle').addEventListener('click',()=>changePresentation());
  window.suira.quick.onPresentation?.(syncPresentation);
  window.suira.quick.presentation?.().then(syncPresentation).catch(()=>{});
  $('#binding-app').addEventListener('click', () => {$('#binding-app-search').value='';showBindingView('apps');});
  $('#binding-app-browse').addEventListener('click',()=>pickAndBind('app'));
  $('#binding-app-refresh').addEventListener('click',()=>refreshBindingApps(true));
  $('#binding-app-search').addEventListener('input',()=>{
    bindingAppRevision++;clearTimeout(bindingAppTimer);bindingApps=[];renderBindingApps();
    bindingAppTimer=setTimeout(()=>refreshBindingApps(),90);
  });
  $('#binding-app-search').addEventListener('keydown',event=>{
    if(event.isComposing||event.keyCode===229)return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();if(!bindingApps.length)return;
      bindingAppIndex=Math.max(0,Math.min(bindingApps.length-1,bindingAppIndex+(event.key==='ArrowDown'?1:-1)));
      $$('#binding-app-list button').forEach((button,index)=>{button.classList.toggle('is-selected',index===bindingAppIndex);button.setAttribute('aria-selected',String(index===bindingAppIndex));});
      $('#binding-app-list button.is-selected')?.scrollIntoView({block:'nearest'});
    }else if(event.key==='Enter'){event.preventDefault();bindIndexedApp(bindingAppIndex);}
  });
  $('#binding-folder').addEventListener('click', () => pickAndBind('folder'));
  $('#binding-file').addEventListener('click', () => pickAndBind('file'));
  $$('#binding-categories [data-binding-kind]').forEach(button => {
    $('.binding-kind-icon', button).innerHTML = BINDING_GLYPHS[button.dataset.bindingKind] || GLYPHS.capture;
  });
  $('#binding-tools').addEventListener('click', () => showBindingView('tools'));
  $('#binding-url').addEventListener('click', () => {
    showBindingView('url');
  });
  listen($('#binding-url-save'), 'click', async () => {
    const value = $('#binding-url-input').value.trim();
    if (!value) { toast('先粘贴要绑定的网址', 'error'); return; }
    // 不带协议的网址按 https 处理；主进程会再校验协议白名单
    let target;
    try {
      const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) || /^(?:javascript|data|file):/i.test(value) ? value : `https://${value}`);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      target = parsed.href;
    } catch { toast('请输入有效的 http 或 https 网页地址', 'error'); return; }
    await setKeyBinding({ type: 'url', target });
  });
  $('#binding-url-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); $('#binding-url-save').click(); }
    if (event.key === 'Escape') { event.preventDefault(); closeBindingEditor(); }
  });
  $('#binding-clear').addEventListener('click', () => setKeyBinding(null));

  $('#translate-close').addEventListener('click', closeTranslate);
  // 换目标语言：拿同一段原文再翻一次，不重新取词
  listen($('#translate-target'), 'change', async (event) => {
    const source = $('#translate-panel').dataset.sourceText || '';
    if (!source.trim()) return;
    const target = event.target.value;
    const revision = ++translateRevision;
    toast('正在翻译…');
    try {
      const result = await window.suira.translate.run({ text: source, target });
      if (revision !== translateRevision) return;
      if (!result?.ok) { toast(result?.error || '翻译失败', 'error'); return; }
      $('#translate-text').value = result.text;
      toast('已重新翻译');
    } catch (error) {
      if (revision === translateRevision) toast(error?.message || '翻译失败', 'error');
    }
  });
  listen($('#translate-copy'), 'click', async () => {
    const text = $('#translate-text').value;
    if (!text.trim()) { toast('没有可复制的译文', 'error'); return; }
    const saved = await window.suira.content.addText({ text, title: '译文', source: 'translate' });
    if (!saved?.ok) { toast(saved?.error || '保存失败', 'error'); return; }
    const result = await window.suira.actions.run(saved.item.id, 'output.copy');
    if (result?.ok) { toast('译文已复制'); closeTranslate(); }
    else toast(result?.error || '复制失败', 'error');
  });
  listen($('#translate-shelf'), 'click', async () => {
    const text = $('#translate-text').value;
    if (!text.trim()) { toast('没有可加入任务匣的译文', 'error'); return; }
    const saved = await window.suira.content.addText({ text, title: '译文', source: 'translate' });
    if (!saved?.ok) { toast(saved?.error || '保存失败', 'error'); return; }
    const result = await window.suira.actions.run(saved.item.id, 'output.shelf');
    if (result?.ok) { toast('译文已加入任务匣'); closeTranslate(); }
    else toast(result?.error || '加入失败', 'error');
  });
  listen($('#translate-original'), 'click', async () => {
    const itemId = $('#translate-panel').dataset.itemId || '';
    if (!itemId) { toast('找不到这张图的来源', 'error'); return; }
    const result = await window.suira.content.openOriginal(itemId);
    if (!result?.ok) toast(result?.error || '无法打开原图', 'error');
  });
  listen($('#ocr-original'), 'click', async () => {
    // 识别结果的来源图片：面板只持有 itemId，打开原图交给主进程，
    // 避免在渲染层拼 file:// 路径（之前这里没有任何 handler，点了必报错）
    const itemId = $('#ocr-panel').dataset.itemId || '';
    if (!itemId) { toast('找不到这张识别结果的来源图片', 'error'); return; }
    const result = await window.suira.content.openOriginal(itemId);
    if (!result?.ok) toast(result?.error || '无法打开原图', 'error');
  });
  listen($('#ocr-copy'), 'click', async () => {
    const text = $('#ocr-text').value;
    if (!text.trim()) { toast('没有可复制的文字', 'error'); return; }
    const saved = await window.suira.content.addText({ text, title: '识别文字', source: 'ocr' });
    if (!saved?.ok) { toast(saved?.error || '保存失败', 'error'); return; }
    const result = await window.suira.actions.run(saved.item.id, 'output.copy');
    if (result?.ok) { toast('识别文字已复制'); closeOcr(); } else toast(result?.error || '复制失败', 'error');
  });
  listen($('#ocr-merge'), 'click', async () => {
    const text = $('#ocr-text').value;
    if (!text.trim()) { toast('没有可整理的文字', 'error'); return; }
    const saved = await window.suira.content.addText({ text, title: '识别文字', source: 'ocr' });
    if (!saved?.ok) { toast(saved?.error || '保存失败', 'error'); return; }
    const result = await window.suira.actions.run(saved.item.id, 'text.merge-lines');
    if (result?.ok && result.output) { $('#ocr-text').value = result.output.text; toast('已合并换行'); }
    else toast(result?.error || '处理失败', 'error');
  });
  listen($('#ocr-shelf'), 'click', async () => {
    const text = $('#ocr-text').value;
    if (!text.trim()) { toast('没有可加入任务匣的文字', 'error'); return; }
    const saved = await window.suira.content.addText({ text, title: '识别文字', source: 'ocr' });
    if (!saved?.ok) { toast(saved?.error || '保存失败', 'error'); return; }
    const result = await window.suira.actions.run(saved.item.id, 'output.shelf');
    if (result?.ok) { toast('已加入任务匣'); closeOcr(); } else toast(result?.error || '加入失败', 'error');
  });

  window.suira.content.onChanged(() => loadRecent());
  window.suira.panel.onChanged?.(() => {
    if (!bindingState.busy && !dragState.source && !bindingEditorOpen()) loadState();
  });
  window.suira.shortcuts?.onChanged?.(() => syncShortcutChip());
  // 主进程的「面板布局轮换」快捷键：动作 / 应用 / 工具箱 之间切换
  window.suira.quick.onMode((mode) => {
    if (typeof mode !== 'string' || !mode) return;
    cancelKeyDrag();
    closeBindingEditor(false);
    clearSearch();
    setMode(mode);
  });
  window.suira.quick.onPrepare(async ({token}) => {
    await initialPanelLoad;
    closeMoreMenu(false);
    await window.suira.quick.presentation?.().then(syncPresentation).catch(()=>{});
    cancelKeyDrag();
    closeBindingEditor(false);
    clearTimeout(state.toastTimer);
    $('#toast').className = 'toast';
    clearSearch();
    setMode(presentation==='fullscreen'?state.mode:'actions');
    if(presentation==='fullscreen')loadImmersiveBackground();
    searchPointerNear = false; setSearchExpanded(false);
    closeOcr();
    closeTranslate();
    state.appPage = 0;
    await document.fonts.ready;
    await new Promise(resolve=>requestAnimationFrame(resolve));
    document.documentElement.dataset.panelPrepared=String(token);
    window.suira.quick.prepared(token);
  });
  window.suira.quick.onShown(() => showGuideIfNeeded());
}

keyMotion=window.SuiraKeycapMotion?.attach($('#key-grid'),{
  suspended:() => dragState.active || bindingState.busy || bindingEditorOpen() || state.mode !== 'actions' || Boolean(state.query)
});
installEvents();
setMode('actions');
const initialPanelLoad=Promise.all([loadState(),loadRecent()]);
