'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const KIND_LABELS = { text: '文字', link: '链接', image: '图片', files: '文件', collection: '集合' };
const SOURCE_LABELS = { screenshot: '截图', clipboard: '剪贴板', ocr: '识别', user: '手动', derived: '整理', shelf: '任务匣' };
const ACTION_LABELS = {
  'output.copy': '复制',
  'ai.summarize':'AI 总结','ai.rewrite':'AI 改写','ai.explain':'AI 解释','ai.reply':'AI 写回复','qr.open':'打开二维码链接',
  'text.merge-lines': '合并换行',
  'text.clean': '清理文字',
  'text.translate': '翻译',
  'ocr.local': '提取文字',
  'image.pin': '钉在桌面',
  'files.reveal': '定位文件',
  'output.open': '打开',
  'output.shelf': '加入任务匣'
};

const state = {
  page: 'shelf',
  tasks: [],
  selectedTaskId: '',
  taskQuery: '',
  taskFilter: 'all',
  items: [],
  executions: [],
  filter: 'all',
  query: '',
  settings: null,
  toastTimer: null,
  ocrBusy: new Set(),
  pinyinMatches: new Set(),
  previewId: ''
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function relativeTime(timestamp) {
  const delta = Date.now() - Number(timestamp || 0);
  if (delta < 60000) return '刚刚';
  if (delta < 3600000) return `${Math.floor(delta / 60000)} 分钟前`;
  if (delta < 86400000) return `${Math.floor(delta / 3600000)} 小时前`;
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function showGlobalToast(message, type = '') {
  const el = $('#global-toast');
  if (window.SuiraUI) {
    state.toastTimer = window.SuiraUI.notify(el,message,{error:type === 'error'});
    return;
  }
  el.textContent = message;
  el.className = `global-toast is-visible ${type}`.trim();
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2200);
}

function selectedTask() {
  return state.tasks.find((task) => task.id === state.selectedTaskId) || null;
}

function derivedChildren(itemId) {
  return state.items.filter((item) => (item.parentIds || []).includes(itemId));
}

/* ---------- navigation ---------- */

const workspaceType=new URLSearchParams(location.search).get('tool');
const standaloneTool=['calendar','markdown'].includes(workspaceType)?workspaceType:'';
if(standaloneTool){document.documentElement.classList.add('tool-window');document.documentElement.dataset.tool=standaloneTool;document.querySelector('.brand b').textContent=standaloneTool==='markdown'?'Markdown':'日历';document.getElementById('close').setAttribute('aria-label','关闭窗口');}
function navigate(page) {
  if(page==='trail')page='library';
  if(!standaloneTool && ['calendar','markdown'].includes(page)){
    window.suira.workspace.open(page).then(result=>{if(result?.ok===false)showGlobalToast(result.error||'打开窗口失败','error');}).catch(error=>showGlobalToast(error.message||'打开窗口失败','error'));
    return;
  }
  window.WorkspaceUI?.flush().catch(error=>showGlobalToast(error.message,'error'));
  state.page = page;
  $$('.page').forEach((el) => el.classList.toggle('is-active', el.id === `page-${page}`));
  $$('.nav-item').forEach((el) => {
    const active = el.dataset.page === page;
    el.classList.toggle('is-active', active);
    if (active) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  $('#main-scroll').scrollTo({ top: 0 });
  if (page === 'shelf') refreshShelf();
  if (page === 'library') refreshLibrary();

  if (page === 'settings') refreshSettings();
  if (page === 'calendar' || page === 'markdown') window.WorkspaceUI.open(page);
}

/* ---------- shelf / task shelf ---------- */

let shelfRefreshVersion = 0;
let contentRefreshVersion = 0;
async function refreshShelf() {
  const version = ++shelfRefreshVersion;
  const contentVersion = ++contentRefreshVersion;
  const [tasks, items, executions] = await Promise.all([
    window.suira.tasks.list(),
    window.suira.content.list({ limit: 300 }),
    window.suira.executions.list(200)
  ]);
  if (version !== shelfRefreshVersion) return;
  state.tasks = tasks || [];
  if (contentVersion === contentRefreshVersion) {
    state.items = items || [];
    if (state.page === 'library') renderLibrary();
  }
  state.executions = executions || [];
  if (!state.tasks.find((task) => task.id === state.selectedTaskId)) {
    state.selectedTaskId = state.tasks[0]?.id || '';
  }
  renderTaskList();
  renderTaskDetail();
}

function renderTaskList() {
  const list = $('#task-list');
  $('#task-count').textContent = `${state.tasks.length} 个`;
  const visible=state.tasks.filter(task=>(state.taskFilter==='all'||(task.progress==='done')===(state.taskFilter==='done'))&&task.title.toLowerCase().includes(state.taskQuery.toLowerCase()));
  if(!visible.some(task=>task.id===state.selectedTaskId))state.selectedTaskId=visible[0]?.id||'';
  if (!state.tasks.length) {
    list.innerHTML = '<div class="task-list-empty">还没有任务，点「新建任务」开始收集。</div>';
    return;
  }
  if(!visible.length){list.innerHTML='<div class="task-list-empty">没有匹配的任务</div>';return;}
  list.innerHTML = visible.map((task) => `
    <button class="task-row ${task.id === state.selectedTaskId ? 'is-active' : ''}" type="button" data-id="${escapeHtml(task.id)}">
      <span class="task-row-mark ${task.progress==='done'?'is-done':''}" aria-label="${task.progress==='done'?'已完成':'进行中'}"></span>
      <span class="task-row-body"><b>${escapeHtml(task.title)}</b><small>${task.progress==='done'?'已完成 · ':''}${task.items.length} 项 · ${relativeTime(task.updatedAt)}</small></span>
    </button>
  `).join('');
  $$('.task-row', list).forEach((row) => {
    row.addEventListener('click', () => {
      state.selectedTaskId = row.dataset.id;
      renderTaskList();
      renderTaskDetail();
    });
  });
}

function taskStepChips(task) {
  const related = new Set(task.items.map((item) => item.id));
  const steps = state.executions
    .filter((execution) => execution.inputIds.some((id) => related.has(id)))
    .sort((a, b) => a.startedAt - b.startedAt)
    .slice(-6);
  if (!steps.length) return task.items.length ? ['接住内容'] : [];
  const labels = [];
  for (const step of steps) {
    const label = ACTION_LABELS[step.actionId] || step.actionId;
    if (labels[labels.length - 1] !== label) labels.push(label);
  }
  return ['接住内容', ...labels];
}

function renderTaskDetail() {
  const task = selectedTask();
  const empty = $('#task-empty');
  const body = $('#task-body');
  if (!task) {
    empty.hidden = false;
    body.hidden = true;
    $('#task-empty b').textContent=state.tasks.length?'没有匹配的任务':'从一件事开始收集';
    $('#task-empty p').textContent=state.tasks.length?'试试其他关键词，或切换任务状态':'截图、文字和链接，可以在这里接成一件完整的事';
    return;
  }
  empty.hidden = true;
  body.hidden = false;
  $('#task-title').textContent = task.title;
  $('#task-done').textContent=task.progress==='done'?'重新打开':'标记完成';
  $('#task-subtitle').innerHTML = `<span class="task-state ${task.progress==='done'?'is-done':''}">${task.progress==='done'?'已完成':'进行中'}</span><span>更新于 ${escapeHtml(relativeTime(task.updatedAt))}</span>`;
  $('#task-content-count').textContent = `${task.items.length} 项`;
  $('#task-detail').dataset.empty=String(!task.items.length);

  const chips = taskStepChips(task);
  $('#task-timeline').innerHTML = chips.length ? chips.map((chip, index) => `
    <span class="trail-step"><b>${index + 1}</b>${escapeHtml(chip)}</span>
  `).join('<span class="trail-arrow">→</span>') : '';
  $('#task-timeline').hidden=!chips.length;

  const container = $('#task-items');
  if (!task.items.length) {
    container.innerHTML = '<div class="collection-start"><span class="collection-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M7 5h13l5 5v17H7zM20 5v6h5M12 17h8M12 22h5"/></svg></span><h3>先收集，再整理</h3><p>把这件事需要的截图、文字和链接放在一起</p><div><button type="button" class="primary-btn" data-collect-clipboard>加入剪贴板内容</button><button type="button" class="quiet-btn" data-collect-library>去内容库挑选</button></div><small>内容会保留顺序，随时复制或导出 Markdown</small></div>';
    container.querySelector('[data-collect-clipboard]').onclick=()=>$('#shelf-import').click();
    container.querySelector('[data-collect-library]').onclick=()=>navigate('library');
  } else {
    container.innerHTML = task.items.map((item) => taskItemCard(item)).join('');
    bindItemCardActions(container, task);
  }
}

function taskItemCard(item) {
  const children = derivedChildren(item.id);
  const childHtml = children.map((child) => `
    <div class="derived-card">
      <span class="derived-tag">${escapeHtml(SOURCE_LABELS[child.source?.type] || '整理')}</span>
      <p>${escapeHtml(SuiraTextSpacing.compactCapture(child.text || child.title || '').slice(0, 220))}</p>
      <div class="derived-actions">
        <button type="button" data-copy="${escapeHtml(child.id)}">复制</button><button type="button" data-preview-item="${escapeHtml(child.id)}">查看详情</button>
      </div>
    </div>
  `).join('');
  return `
    <article class="shelf-card ${item.kind === 'image' ? 'is-image' : ''}" data-id="${escapeHtml(item.id)}">
      <header class="shelf-card-head">
        <span class="kind-tag ${escapeHtml(item.kind)}">${KIND_LABELS[item.kind] || '内容'}</span>
        <b title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</b>
        <time>${relativeTime(item.createdAt)}</time>
      </header>
      ${item.kind === 'image' && item.thumbnail
        ? `<img class="shelf-thumb" src="${escapeHtml(item.thumbnail)}" alt="">`
        : `<p class="shelf-text">${escapeHtml(SuiraTextSpacing.compactCapture(item.text || item.filePath || '').slice(0, 300))}</p>`}
      ${childHtml ? `<div class="derived-wrap">${childHtml}</div>` : ''}
      <footer class="shelf-card-actions"><button type="button" data-preview-item="${escapeHtml(item.id)}">查看详情</button>
        <button type="button" data-copy="${escapeHtml(item.id)}">复制</button>
        ${item.kind === 'image' ? `<button type="button" data-edit-image="${escapeHtml(item.id)}">编辑图片</button>` : ''}
        ${item.kind === 'image' && !children.length ? `<button type="button" data-ocr="${escapeHtml(item.id)}">${state.ocrBusy.has(item.id) ? '识别中…' : '提取文字'}</button>` : ''}
        ${item.kind === 'image' && children.length ? `<button type="button" data-recipe="clean-text" data-recipe-item="${escapeHtml(children[children.length - 1].id)}">整理文字</button>` : ''}
        ${(item.kind === 'text' || item.kind === 'link') ? `<button type="button" data-recipe="clean-text" data-recipe-item="${escapeHtml(item.id)}">整理文字</button>` : ''}
        ${item.kind === 'files' || item.kind === 'link' ? `<button type="button" data-open="${escapeHtml(item.id)}">打开</button>` : ''}
        <button type="button" class="is-danger" data-remove="${escapeHtml(item.id)}">移出任务</button>
      </footer>
    </article>
  `;
}

function bindImageEditorButtons(root) {
  $$('[data-edit-image]', root).forEach(button=>button.addEventListener('click',async()=>{
    try {
      const result=await window.suira.imageEditor.open({itemId:button.dataset.editImage});
      if(!result?.ok)showGlobalToast(result?.error||'打开图片失败','error');
    } catch(error){showGlobalToast(error.message||'打开图片失败','error');}
  }));
}

function bindItemCardActions(root, task) {
  bindImageEditorButtons(root);
  $$('[data-preview-item]',root).forEach(button=>button.addEventListener('click',()=>openPreview(button.dataset.previewItem)));
  $$('[data-copy]', root).forEach((button) => {
    button.addEventListener('click', async () => {
      const result = await window.suira.actions.run(button.dataset.copy, 'output.copy');
      if (result?.ok) showGlobalToast('已复制', 'success');
      else showGlobalToast(result?.error || '复制失败', 'error');
    });
  });
  $$('[data-ocr]', root).forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.ocr;
      state.ocrBusy.add(id);
      button.textContent = '识别中…';
      try {
        const result = await window.suira.ocr.recognizeItem(id);
        if (!result?.ok) throw new Error(result?.error || '识别失败');
        showGlobalToast('识别完成，结果已保留在内容下方', 'success');
      } catch (error) {
        showGlobalToast(error.message || '识别失败', 'error');
      } finally {
        state.ocrBusy.delete(id);
        await refreshShelf();
      }
    });
  });
  $$('[data-recipe]', root).forEach((button) => {
    button.addEventListener('click', async () => {
      const itemId = button.dataset.recipeItem;
      const recipeId = button.dataset.recipe;
      if (!itemId) return;
      button.disabled = true;
      const label = button.textContent;
      button.textContent = '整理中…';
      try {
        const result = await window.suira.recipes.run({ itemId, recipeId, commit: false });
        if (!result?.ok) throw new Error(result?.error || '整理失败');
        const marks = (result.steps || []).map((step) => (step.ok ? '✓' : '✕')).join('');
        showGlobalToast(`整理完成 ${marks}`, 'success');
      } catch (error) {
        showGlobalToast(error.message || '整理失败', 'error');
      } finally {
        button.disabled = false;
        button.textContent = label;
        await refreshShelf();
      }
    });
  });
  $$('[data-open]', root).forEach((button) => {
    button.addEventListener('click', async () => {
      const result = await window.suira.actions.run(button.dataset.open, 'output.open');
      if (!result?.ok) showGlobalToast(result?.error || '打开失败', 'error');
    });
  });
  $$('[data-remove]', root).forEach((button) => {
    button.addEventListener('click', async () => {
      await window.suira.tasks.removeItem({ taskId: task.id, itemId: button.dataset.remove });
      await refreshShelf();
    });
  });
}

/* ---------- library ---------- */

let pinyinTimer = null;
let pinyinSearchVersion = 0;
// 一次按键可能同时触发文本渲染与 90ms 后的拼音结果渲染；合并到同一帧只建一次 DOM。
let libraryRenderQueued = false;
function scheduleRenderLibrary() {
  if (libraryRenderQueued) return;
  libraryRenderQueued = true;
  requestAnimationFrame(() => { libraryRenderQueued = false; renderLibrary(); });
}
function refreshPinyinMatches(query) {
  const version = ++pinyinSearchVersion;
  clearTimeout(pinyinTimer);
  // Matches belong to one query only. Clear them immediately, not after the
  // next request, and ignore older responses that arrive out of order.
  if (state.pinyinMatches.size) {
    state.pinyinMatches.clear();
    scheduleRenderLibrary();
  }
  if (!query) return;
  pinyinTimer = setTimeout(async () => {
    try {
      const results = await window.suira.search.query(query);
      if (version !== pinyinSearchVersion) return;
      const next = new Set((results || []).filter((r) => r.kind === 'content').map((r) => r.id));
      const changed = next.size !== state.pinyinMatches.size || [...next].some((id) => !state.pinyinMatches.has(id));
      state.pinyinMatches = next;
      if (changed) scheduleRenderLibrary();
    } catch {
      // 搜索失败时退化为纯文本匹配
    }
  }, 90);
}

let libraryRefreshVersion = 0;
async function refreshLibrary() {
  const version = ++libraryRefreshVersion;
  const contentVersion = ++contentRefreshVersion;
  const items = await window.suira.content.list({ limit: 300 });
  if (version !== libraryRefreshVersion || contentVersion !== contentRefreshVersion) return;
  state.items = items || [];
  renderLibrary();
}

function getVisibleItems() {
  return state.items.filter((item) => {
    if (state.filter !== 'all' && item.kind !== state.filter) return false;
    if (!state.query) return true;
    const haystack = `${item.title} ${item.text || ''} ${item.filePath || ''} ${item.source?.appName || ''}`.toLowerCase();
    if (haystack.includes(state.query)) return true;
    // 拼音与首字母匹配（由主进程 search:query 统一实现）
    return state.pinyinMatches.has(item.id);
  });
}

function renderLibrary() {
  const grid = $('#library-grid');
  const items = getVisibleItems();
  if (!items.length) {
    grid.innerHTML = `<div class="library-empty">${state.query ? '没有找到匹配的内容' : '还没有内容。截图、复制文字，或从随手面板开始。'}</div>`;
    return;
  }
  grid.innerHTML = items.map((item) => {
    const derived = derivedChildren(item.id);
    return `
    <article class="library-card" data-id="${escapeHtml(item.id)}" data-preview="${escapeHtml(item.id)}">
      <header class="shelf-card-head">
        <span class="kind-tag ${escapeHtml(item.kind)}">${KIND_LABELS[item.kind] || '内容'}</span>
        <b title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</b>
        ${item.pinned ? '<span class="pin-mark" title="已固定，不会被自动清理">固定</span>' : ''}
        <time>${relativeTime(item.createdAt)}</time>
      </header>
      ${item.kind === 'image' && item.thumbnail
        ? `<img class="shelf-thumb" src="${escapeHtml(item.thumbnail)}" alt="">`
        : `<p class="shelf-text">${escapeHtml(SuiraTextSpacing.compactCapture(item.text || item.filePath || '').slice(0, 220) || '（无文字内容）')}</p>`}
      ${derived.length ? `<div class="derived-note">${derived.length} 个处理结果</div>` : ''}
      <footer class="shelf-card-actions">
        <button type="button" data-copy="${escapeHtml(item.id)}">复制</button>
        <button type="button" data-paste="${escapeHtml(item.id)}">粘贴</button>
        ${item.kind === 'image' ? `<button type="button" data-edit-image="${escapeHtml(item.id)}">编辑图片</button>` : ''}
        ${item.kind === 'image' ? `<button type="button" data-ocr="${escapeHtml(item.id)}">${state.ocrBusy.has(item.id) ? '识别中…' : '提取文字'}</button>` : ''}
        ${item.kind === 'image' ? `<button type="button" data-pin="${escapeHtml(item.id)}">钉住</button>` : ''}
        ${item.kind === 'files' || item.kind === 'link' ? `<button type="button" data-open="${escapeHtml(item.id)}">打开</button>` : ''}
        ${item.kind === 'files' ? `<button type="button" data-reveal="${escapeHtml(item.id)}">所在文件夹</button>` : ''}
        <button type="button" data-shelf="${escapeHtml(item.id)}">入匣</button>
        <button type="button" data-fix="${escapeHtml(item.id)}">${item.pinned ? '取消固定' : '固定'}</button>
        <button type="button" class="is-danger" data-delete="${escapeHtml(item.id)}">删除</button>
      </footer>
    </article>`;
  }).join('');

  $$('[data-preview]', grid).forEach((card) => card.addEventListener('click', (event) => {
    // 卡片主体打开预览；底部动作按钮有自己的语义，不触发预览
    if (event.target.closest('button')) return;
    openPreview(card.dataset.preview);
  }));
  bindImageEditorButtons(grid);
  $$('[data-paste]', grid).forEach((button) => button.addEventListener('click', () => pasteItemToTarget(button.dataset.paste)));
  $$('[data-reveal]', grid).forEach((button) => button.addEventListener('click', async () => {
    const result = await window.suira.actions.run(button.dataset.reveal, 'files.reveal');
    if (result?.ok) showGlobalToast(result.message || '已在资源管理器中定位', 'success');
    else showGlobalToast(result?.error || '定位失败', 'error');
  }));

  $$('[data-copy]', grid).forEach((button) => button.addEventListener('click', async () => {
    const result = await window.suira.actions.run(button.dataset.copy, 'output.copy');
    if (result?.ok) showGlobalToast('已复制', 'success');
    else showGlobalToast(result?.error || '复制失败', 'error');
  }));
  $$('[data-ocr]', grid).forEach((button) => button.addEventListener('click', async () => {
    const id = button.dataset.ocr;
    state.ocrBusy.add(id);
    button.textContent = '识别中…';
    try {
      const result = await window.suira.ocr.recognizeItem(id);
      if (!result?.ok) throw new Error(result?.error || '识别失败');
      showGlobalToast('识别完成', 'success');
    } catch (error) {
      showGlobalToast(error.message || '识别失败', 'error');
    } finally {
      state.ocrBusy.delete(id);
      await refreshLibrary();
    }
  }));
  $$('[data-pin]', grid).forEach((button) => button.addEventListener('click', async () => {
    const result = await window.suira.actions.run(button.dataset.pin, 'image.pin');
    if (result?.ok) showGlobalToast('已钉在桌面', 'success');
    else showGlobalToast(result?.error || '钉图失败', 'error');
  }));
  $$('[data-open]', grid).forEach((button) => button.addEventListener('click', async () => {
    const result = await window.suira.actions.run(button.dataset.open, 'output.open');
    if (!result?.ok) showGlobalToast(result?.error || '打开失败', 'error');
  }));
  $$('[data-shelf]', grid).forEach((button) => button.addEventListener('click', async () => {
    const result = await window.suira.actions.run(button.dataset.shelf, 'output.shelf');
    if (result?.ok) showGlobalToast('已加入任务匣', 'success');
    else showGlobalToast(result?.error || '加入失败', 'error');
  }));
  $$('[data-fix]', grid).forEach((button) => button.addEventListener('click', async () => {
    const result = await window.suira.content.togglePin(button.dataset.fix);
    if (result?.ok) {
      showGlobalToast(result.pinned ? '已固定，不会被自动清理' : '已取消固定', 'success');
      await refreshLibrary();
    } else {
      showGlobalToast(result?.error || '操作失败', 'error');
    }
  }));
  $$('[data-delete]', grid).forEach((button) => button.addEventListener('click', async () => {
    await window.suira.content.remove(button.dataset.delete);
    showGlobalToast('已删除');
    await refreshLibrary();
  }));
}

/* ---------- preview ---------- */

/** 图片预览优先用缩略图（已内联，必定可读），没有再回落到本地文件路径。 */
function previewImageSource(item) {
  const filePath = String(item?.filePath || '').trim();
  if (!filePath) return item?.thumbnail || '';
  // Windows 路径转 file:// URL：逐段转义（空格、#、? 等），保留盘符的冒号
  const encoded = filePath
    .replace(/\\/g, '/')
    .split('/')
    .map((part, index) => (index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)))
    .join('/');
  return `file:///${encoded}`;
}

/** 文件条目可能是多行路径（剪贴板里复制的路径列表），统一拆成路径数组。 */
function previewFilePaths(item) {
  const paths = [];
  const push = (value) => {
    const text = String(value || '').trim();
    if (text && !paths.includes(text)) paths.push(text);
  };
  String(item?.text || '').split(/\r?\n/).forEach(push);
  push(item?.filePath);
  return paths;
}

function previewPlaceholder(message) {
  const el = document.createElement('div');
  el.className = 'preview-empty';
  el.textContent = message;
  return el;
}

function openPreview(itemId) {
  const item = state.items.find((entry) => entry.id === itemId);
  const preview = $('#preview');
  if (!preview) return;
  if (!item) {
    showGlobalToast('内容不存在或已被清理', 'error');
    return;
  }
  state.previewId = item.id;
  const kind = $('#preview-kind');
  kind.textContent = KIND_LABELS[item.kind] || '内容';
  kind.className = `kind-tag ${item.kind}`;
  $('#preview-title').textContent = item.title || '未命名内容';
  $('#preview-title').title = item.title || '';
  $('#preview-time').textContent = relativeTime(item.createdAt);

  const body = $('#preview-body');
  body.replaceChildren();
  body.classList.remove('is-pixel-mode');
  const pixels=$('#preview-pixels');
  pixels.hidden=item.kind!=='image';pixels.disabled=!item.filePath;
  pixels.textContent=item.filePath?'原始像素':'缩略图';pixels.setAttribute('aria-pressed','false');
  if (item.kind === 'image') {
    const source = previewImageSource(item);
    if (source) {
      const image = document.createElement('img');
      image.className = 'preview-image';
      image.alt = item.title || '图片预览';
      image.onerror=()=>{
        image.onerror=null;
        if(item.thumbnail&&image.src!==item.thumbnail){image.src=item.thumbnail;pixels.disabled=true;pixels.textContent='原图不可用';showGlobalToast('原图无法读取，正在显示缩略图','error');}
        else body.replaceChildren(previewPlaceholder('原图无法读取'));
      };
      image.src = source;
      body.appendChild(image);
    } else {
      body.appendChild(previewPlaceholder('这张图片没有可读取的文件'));
    }
  } else if (item.kind === 'files') {
    const paths = previewFilePaths(item);
    if (!paths.length) {
      body.appendChild(previewPlaceholder('没有可显示的文件路径'));
    } else {
      const list = document.createElement('ul');
      list.className = 'preview-file-list';
      for (const filePath of paths) {
        const row = document.createElement('li');
        row.textContent = filePath;
        list.appendChild(row);
      }
      body.appendChild(list);
    }
  } else {
    const text = String(item.text || '');
    if (!text.trim()) {
      body.appendChild(previewPlaceholder('（无文字内容）'));
    } else {
      // 只读、可选中复制的全文区；内容用 textContent 写入，不拼 innerHTML
      const content = document.createElement('div');
      content.className = 'preview-text';
      content.textContent = SuiraTextSpacing.compactCapture(text);
      body.appendChild(content);
    }
  }

  const cleanup=$('#preview-clean-spacing');cleanup.hidden=!['text','link'].includes(item.kind);cleanup.textContent='紧凑复制';$('#preview-copy').textContent=cleanup.hidden?'复制':'复制原文';cleanup.onclick=async()=>{try{const result=await window.suira.textTools.transform(String(item.text||''),'compact');if(!result?.ok)throw Error(result?.error||'整理失败');const saved=await window.suira.content.addText({text:result.text,title:'整理间距后的文字',source:'derived'});if(!saved?.ok)throw Error(saved?.error||'保存失败');const copied=await window.suira.actions.run(saved.item.id,'output.copy');if(!copied?.ok)throw Error(copied?.error||'复制失败');const content=$('.preview-text');if(content)content.textContent=result.text;showGlobalToast('已清理间距并复制，原文保持不变');}catch(error){showGlobalToast(error.message,'error');}};
  $('#preview-trail').open=false;
  renderTrail();
  preview.hidden = false;
  if (window.SuiraUI) window.SuiraUI.openDialog(preview, { close: closePreview });
  const closeButton = $('#preview-close');
  if (closeButton) closeButton.focus({ preventScroll: true });
}

/** 关闭预览层；返回本次是否真的关闭了（供 Esc 判断要不要拦截）。 */
function closePreview() {
  const preview = $('#preview');
  if (!preview || preview.hidden) return false;
  preview.hidden = true;
  preview._dialogCleanup?.();
  state.previewId = '';
  const body = $('#preview-body');
  if (body) body.replaceChildren();
  return true;
}

function togglePreviewPixels() {
  const image=$('#preview-body .preview-image'),button=$('#preview-pixels');
  if(!image?.naturalWidth)return;
  const enabled=button.getAttribute('aria-pressed')!=='true';
  button.setAttribute('aria-pressed',String(enabled));button.textContent=enabled?'适应窗口':'原始像素';
  $('#preview-body').classList.toggle('is-pixel-mode',enabled);
  image.style.width=enabled?`${image.naturalWidth/(window.devicePixelRatio||1)}px`:'';
}

/** 复制内容并尝试直接粘回打开随序之前所在的应用。 */
async function pasteItemToTarget(itemId) {
  const id = String(itemId || '');
  if (!id) return;
  try {
    const result = await window.suira.returnTo.commit({ itemId: id, intent: 'return-and-paste' });
    if (result?.ok) showGlobalToast(result.message || '已复制', 'success');
    else showGlobalToast(result?.error || '粘贴失败', 'error');
  } catch (error) {
    showGlobalToast(error.message || '粘贴失败', 'error');
  }
}

/* ---------- trail ---------- */

let trailView,trailRevision=0;
async function refreshTrail() {
  const revision=++trailRevision,itemId=state.previewId;
  try {
    const [executions,items]=await Promise.all([window.suira.executions.list(500),window.suira.content.list({limit:500})]);
    if(revision!==trailRevision||itemId!==state.previewId)return;
    state.executions=executions||[];state.items=items||[];renderTrail();
  } catch(error){showGlobalToast(error.message||'处理轨迹暂时无法加载','error');}
}
function renderTrail() {
  if(!trailView)trailView=window.SuiraTrailView.create({
    element:$('#content-trail'),escapeHtml,labels:ACTION_LABELS,relativeTime,compactText:window.SuiraTextSpacing.compactCapture,
    onPreview:openPreview,notify:showGlobalToast,
    onConfigure:()=>{closePreview();navigate('settings');document.querySelector('[data-setting-tab="translation"]')?.click();},
    onTranslate:async item=>{const result=await window.suira.textTools.open({mode:'translate',text:item.text});if(!result?.ok)throw Error(result?.error||'无法打开翻译');},
    onRetry:async id=>{const result=await window.suira.executions.retry(id);await refreshTrail();if(!result?.ok)throw Error(result?.error||'重试失败');showGlobalToast('这一步已重新处理','success');}
  });
  trailView.render(state.executions,state.items,state.previewId);
}

/* ---------- settings ---------- */

async function refreshSettings() {
  const info = await window.suira.app.info();
  $('#app-version').textContent = `版本 ${info?.version || '—'}`;
  $('#side-version').textContent = info?.version || '—';
  $('#user-data-path').textContent = info?.dataPath || info?.userData || '';
  const settings = await window.suira.settings.get();
  state.settings = settings;
  $('#setting-record').checked = Boolean(settings.recordClipboard);
  $('#setting-sensitive').checked = Boolean(settings.pauseSensitive);
  $('#setting-paste').checked = Boolean(settings.pasteAfterCopy);
  $('#setting-encrypt').checked = settings.encryptContent !== false;
  $('#setting-days').value = settings.retentionDays;
  $('#setting-max').value = settings.maxItems;
  $('#setting-langs').value = settings.ocrLangs;
  $('#setting-theme').value = settings.theme || 'light';
  $('#setting-panel-compact').checked=settings.panelCompact===true;
  $('#setting-panel-recent').checked=settings.panelRecent!==false;$('#setting-selection').checked=settings.selectionEnabled===true;$('#setting-selection-exclusions').value=(settings.selectionExcludedApps||[]).join('\n');
  $('#setting-global-shortcuts').checked=settings.globalShortcutsEnabled===true;
  applyTranslateSettings(settings);
  await refreshShortcuts();
}

function bindSettings() {
  $('#setting-panel-recent').onchange=event=>window.suira.settings.update({panelRecent:event.target.checked});
  $('#setting-selection').onchange=event=>window.suira.settings.update({selectionEnabled:event.target.checked});
  $('#save-selection-exclusions').onclick=async()=>{try{const result=await window.suira.settings.update({selectionExcludedApps:$('#setting-selection-exclusions').value.split(/[\n,;，；]+/)});if(!result?.ok)throw Error(result?.error||'保存失败');$('#setting-selection-exclusions').value=result.settings.selectionExcludedApps.join('\n');$('#selection-settings-status').textContent='名单已保存';}catch(error){$('#selection-settings-status').textContent=error.message;}};
  $('#reset-window-size')?.addEventListener('click',async()=>{try{const result=await window.suira.window.reset();if(!result.ok)throw Error('无法调整当前窗口');}catch(error){showGlobalToast(error.message,'error');}});
  $('#setting-panel-compact').addEventListener('change', event => window.suira.settings.update({panelCompact:event.target.checked}));
  $('#setting-record').addEventListener('change', (event) => window.suira.settings.update({ recordClipboard: event.target.checked }));
  $('#setting-sensitive').addEventListener('change', (event) => window.suira.settings.update({ pauseSensitive: event.target.checked }));
  $('#setting-paste').addEventListener('change', (event) => window.suira.settings.update({ pasteAfterCopy: event.target.checked }));
  $('#setting-encrypt').addEventListener('change', (event) => window.suira.settings.update({ encryptContent: event.target.checked }));
  $('#setting-days').addEventListener('change', (event) => window.suira.settings.update({ retentionDays: Number(event.target.value) }));
  $('#setting-max').addEventListener('change', (event) => window.suira.settings.update({ maxItems: Number(event.target.value) }));
  $('#setting-langs').addEventListener('change', (event) => window.suira.settings.update({ ocrLangs: event.target.value }));
  // 换肤走 nativeTheme：主进程改一次，所有窗口的 prefers-color-scheme 同时生效
  $('#setting-theme').addEventListener('change', (event) => window.suira.settings.update({ theme: event.target.value, themeChosen: true }));
  $('#setting-global-shortcuts').addEventListener('change', async event => {
    const input=event.target, enabled=input.checked;
    if(enabled && !confirm('开启后，随序会在其他应用中响应已注册的组合键，Alt+字母可能覆盖它们的菜单快捷键。已被系统或其他程序占用的按键不会被抢占。是否开启？')){input.checked=false;return;}
    input.disabled=true;
    try{const result=await window.suira.settings.update({globalShortcutsEnabled:enabled});if(!result.ok)throw Error(result.error||'设置失败');await refreshShortcuts();}
    catch(error){input.checked=!enabled;showGlobalToast(error.message,'error');}finally{input.disabled=false;}
  });
  $('#shortcut-check').addEventListener('click',async event=>{
    const button=event.target;button.disabled=true;
    try{const snapshot=await window.suira.shortcuts.get();if(snapshot.globalEnabled){await window.suira.shortcuts.retry();await refreshShortcuts();}const report=await window.suira.shortcuts.check();renderShortcutCheck(report.entries);}
    catch(error){showGlobalToast(error.message,'error');}finally{button.disabled=false;}
  });
  $('#setup-shortcuts')?.addEventListener('click',async()=>{await navigate('settings');document.querySelector('[data-setting-tab="shortcuts"]')?.click();$('#setting-global-shortcuts')?.scrollIntoView({block:'center'});$('#shortcut-check')?.click();});
  bindTranslateSettings();
  bindShortcutEditors();
}

/* ---------- 翻译设置 ---------- */

/** 只显示当前引擎需要的字段：OpenAI 兼容要 Base URL/模型，微软要区域。 */
function syncTranslateRows(provider) {
  $$('[data-translate-row]').forEach((row) => {
    row.hidden = row.dataset.translateRow !== provider;
  });
  const keyRow = $('#setting-translate-key');
  if (keyRow) keyRow.disabled = provider === 'none';
}

function applyTranslateSettings(settings) {
  const provider = settings.translateProvider || 'none';
  $('#setting-translate-provider').value = provider;
  $('#setting-translate-base').value = settings.translateBaseUrl || '';
  $('#setting-translate-model').value = settings.translateModel || '';
  $('#setting-translate-region').value = settings.translateRegion || '';
  $('#setting-translate-target').value = settings.translateTarget || 'zh';
  $('#setting-translate-key').value = '';
  syncTranslateRows(provider);
  const hint = $('#setting-translate-keyhint');
  const status = $('#setting-translate-status');
  if (settings.translateApiKeySet) {
    hint.textContent = '已保存（加密存储）；留空表示不修改';
    status.textContent = provider === 'none' ? '未配置引擎' : '密钥已保存';
    status.className = 'setting-hint is-ok';
  } else {
    hint.textContent = '尚未保存；粘贴后离开输入框即保存';
    status.textContent = provider === 'none' ? '未配置引擎，翻译会提示去设置' : '还缺密钥';
    status.className = 'setting-hint';
  }
  $('#setting-voice-provider').value = settings.voiceProvider || 'deepseek';
  $('#setting-voice-base').value = settings.voiceBaseUrl || '';
  $('#setting-voice-model').value = settings.voiceModel || '';
  $('#setting-voice-key').value = '';
  const voiceProvider = settings.voiceProvider || 'deepseek';
  $$('[data-voice-row]').forEach(row => { row.hidden = row.dataset.voiceRow !== voiceProvider; });
  if (settings.voiceApiKeySet) {
    $('#setting-voice-keyhint').textContent = '已单独加密保存；留空表示不修改';
    $('#setting-voice-status').textContent = 'ASR 密钥已保存';
    $('#setting-voice-status').className = 'setting-hint is-ok';
  } else if (settings.voiceCanReuseTranslateKey) {
    $('#setting-voice-keyhint').textContent = '当前同源 OpenAI 兼容服务可复用已加密的翻译密钥';
    $('#setting-voice-status').textContent = '可复用同源翻译密钥';
    $('#setting-voice-status').className = 'setting-hint is-ok';
  } else {
    $('#setting-voice-keyhint').textContent = '单独加密保存；只有同源 OpenAI 兼容地址才能复用翻译密钥';
    $('#setting-voice-status').textContent = '请配置 ASR 服务和密钥';
    $('#setting-voice-status').className = 'setting-hint';
  }
}

function bindTranslateSettings() {
  $('#setting-voice-provider').addEventListener('change', async event => {
    await window.suira.settings.update({ voiceProvider: event.target.value });
    applyTranslateSettings(await window.suira.settings.get());
  });
  for (const [id, key] of [['#setting-voice-base', 'voiceBaseUrl'], ['#setting-voice-model', 'voiceModel']]) {
    $(id).addEventListener('change', async event => {
      await window.suira.settings.update({ [key]: event.target.value });
      applyTranslateSettings(await window.suira.settings.get());
    });
  }
  $('#setting-voice-key').addEventListener('change', async event => {
    const value = String(event.target.value || '').trim();
    if (!value) return;
    const result = await window.suira.settings.update({ voiceApiKey: value });
    if (!result?.ok) { showGlobalToast(result?.error || 'ASR 密钥保存失败', 'error'); return; }
    applyTranslateSettings(result.settings);
    showGlobalToast('ASR 密钥已加密保存', 'success');
  });
  $('#setting-voice-clear').addEventListener('click', async () => {
    const result = await window.suira.settings.update({ voiceApiKey: null });
    if (!result?.ok) { showGlobalToast(result?.error || '清除失败', 'error'); return; }
    applyTranslateSettings(result.settings);
    showGlobalToast('已清除单独保存的 ASR 密钥', 'success');
  });
  $('#setting-translate-models').addEventListener('click',async()=>{
    const button=$('#setting-translate-models'),status=$('#setting-translate-status');button.disabled=true;status.textContent='正在获取模型…';
    try{const patch={translateProvider:$('#setting-translate-provider').value,translateBaseUrl:$('#setting-translate-base').value};if($('#setting-translate-key').value.trim())patch.translateApiKey=$('#setting-translate-key').value.trim();
      const saved=await window.suira.settings.update(patch);if(!saved?.ok)throw Error(saved?.error||'保存失败');$('#setting-translate-key').value='';
      const result=await window.suira.translate.models();if(!result.ok)throw Error(result.error);
      $('#translate-models').replaceChildren(...result.models.map(model=>{const option=document.createElement('option');option.value=model;return option;}));
      const input=$('#setting-translate-model'),slug=input.value.trim().replace(/\s+/g,'-').toLowerCase(),match=result.models.find(model=>model.toLowerCase()===slug);
      if(match&&input.value!==match){input.value=match;await window.suira.settings.update({translateModel:match});}
      status.className='setting-hint is-ok';status.textContent=`已获取 ${result.models.length} 个模型，请从模型输入框的列表中选择`;input.focus();
    }catch(error){status.className='setting-hint is-error';status.textContent=error.message;}finally{button.disabled=false;}
  });
  $('#setting-translate-provider').addEventListener('change', async (event) => {
    const provider = event.target.value;
    syncTranslateRows(provider);
    await window.suira.settings.update({ translateProvider: provider });
    const settings = await window.suira.settings.get();
    applyTranslateSettings(settings);
  });
  for (const [id, key] of [
    ['#setting-translate-base', 'translateBaseUrl'],
    ['#setting-translate-model', 'translateModel'],
    ['#setting-translate-region', 'translateRegion']
  ]) {
    $(id).addEventListener('change', (event) => window.suira.settings.update({ [key]: event.target.value }));
  }
  $('#setting-translate-target').addEventListener('change', async (event) => {
    await window.suira.settings.update({ translateTarget: event.target.value });
    showGlobalToast('目标语言已更新');
  });
  // 密钥：失焦即保存，空值表示不修改；要清除用下面的按钮
  $('#setting-translate-key').addEventListener('change', async (event) => {
    const value = String(event.target.value || '').trim();
    if (!value) return;
    const result = await window.suira.settings.update({ translateApiKey: value });
    if (!result?.ok) { showGlobalToast(result?.error || '保存失败', 'error'); return; }
    event.target.value = '';
    applyTranslateSettings(result.settings);
    showGlobalToast('密钥已加密保存', 'success');
  });
  $('#setting-translate-clear').addEventListener('click', async () => {
    const result = await window.suira.settings.update({ translateApiKey: null });
    if (!result?.ok) { showGlobalToast(result?.error || '清除失败', 'error'); return; }
    applyTranslateSettings(result.settings);
    showGlobalToast('已清除密钥', 'success');
  });
  $('#setting-translate-test').addEventListener('click', async () => {
    const status = $('#setting-translate-status');
    status.textContent = '正在测试…';
    status.className = 'setting-hint';
    const button=$('#setting-translate-test');button.disabled=true;
    let result;
    try {
      const patch={translateProvider:$('#setting-translate-provider').value,translateBaseUrl:$('#setting-translate-base').value,translateModel:$('#setting-translate-model').value,translateRegion:$('#setting-translate-region').value,translateTarget:$('#setting-translate-target').value};
      if($('#setting-translate-key').value.trim())patch.translateApiKey=$('#setting-translate-key').value.trim();
      const saved=await window.suira.settings.update(patch);
      if(!saved?.ok)throw Error(saved?.error||'保存失败');
      $('#setting-translate-key').value='';
      result=await window.suira.translate.test();
    }catch(error){result={ok:false,error:error.message};}finally{button.disabled=false;}
    if (!result?.ok) {
      status.textContent = result?.error || '测试失败';
      status.className = 'setting-hint is-error';
      return;
    }
    status.textContent = `可用：${result.sample || result.text}`;
    status.className = 'setting-hint is-ok';
  });
}

/* ---------- 快捷键改键 ---------- */

const KEY_LABELS = {
  ' ': 'Space', arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right',
  escape: 'Esc', enter: 'Enter', tab: 'Tab', backspace: 'Backspace', delete: 'Delete'
};

/** 把键盘事件转成 Electron 加速键字符串。 */
function toAccelerator(event) {
  const modifiers = [];
  if (event.ctrlKey) modifiers.push('Control');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (event.metaKey) modifiers.push('Super');

  const raw = String(event.key || '');
  const lower = raw.toLowerCase();
  if (['control', 'alt', 'shift', 'meta'].includes(lower)) return ''; // 只按了修饰键
  const main = KEY_LABELS[lower] || (raw.length === 1 ? raw.toUpperCase() : raw);
  if (!main) return '';
  if (!modifiers.length) return ''; // 至少需要一个修饰键
  return [...modifiers, main].join('+');
}

/** 把加速键字符串渲染成更易读的形式。 */
function prettyAccelerator(accelerator) {
  return String(accelerator || '')
    .replace(/CommandOrControl/gi, 'Ctrl')
    .replace(/Control/gi, 'Ctrl')
    .replace(/Super/gi, 'Win')
    .split('+')
    .join(' + ');
}

/**
 * 按住型唤起不再有额外的本地校验：主进程与普通快捷键同一套规则
 * （一个修饰键 + 一个主键），录制结果直接交给 `shortcuts:set` 校验。
 */

function bindShortcutEditors() {
  const editors = [
    { name: 'quick', input: $('#setting-key-quick'), status: $('#status-quick') },
    { name: 'longCapture', input: $('#setting-key-longCapture'), status: $('#status-longCapture') },
    { name: 'capture', input: $('#setting-key-capture'), status: $('#status-capture') },
    { name: 'momentary', input: $('#setting-key-momentary'), status: $('#status-momentary') },
    { name: 'panelCycle', input: $('#setting-key-panelCycle'), status: $('#status-panelCycle') },
    { name: 'pinnedToggle', input: $('#setting-key-pinnedToggle'), status: $('#status-pinnedToggle') },
    { name: 'voice', input: $('#setting-key-voice'), status: $('#status-voice') },
    { name: 'clipboardBar', input: $('#setting-key-clipboardBar'), status: $('#status-clipboardBar') }
  ];

  for (const editor of editors) {
    const input = editor.input;
    if (!input) continue;
    let captureReady = Promise.resolve();
    let captureActive = false;
    let captureStarting = false;
    let deferBlurRelease = false;
    let focusRequest = 0;
    let valueBeforeCapture = '';
    let captureSaved = false;
    const prepareCapture = () => {
      if (captureActive) return Promise.resolve({ ok: true });
      if (captureStarting) return captureReady;
      captureStarting = true;
      editor.status.textContent = '正在暂停其他快捷键…';
      editor.status.className = 'shortcut-status is-warn';
      captureReady = window.suira.shortcuts.capture(true).then(result => {
        captureActive = result?.ok === true;
        if (!captureActive) {
          editor.status.textContent = result?.error || '无法暂停其他快捷键';
          editor.status.className = 'shortcut-status is-error';
        }
        return result;
      }).catch(error => {
        editor.status.textContent = error?.message || '无法暂停其他快捷键';
        editor.status.className = 'shortcut-status is-error';
        return { ok: false };
      }).finally(() => { captureStarting = false; });
      return captureReady;
    };
    const focusAfterCapture = async () => {
      const request = ++focusRequest;
      const result = await prepareCapture();
      if (result?.ok && request === focusRequest && input.isConnected && document.activeElement !== input) input.focus();
    };
    input.addEventListener('pointerdown', event => {
      if (captureActive) return;
      // Do not let the browser focus the recorder until the main process has
      // released old OS shortcuts; otherwise a fast Alt+C can still capture.
      event.preventDefault();
      focusAfterCapture();
    });
    input.addEventListener('keydown', async (event) => {
      event.preventDefault();
      if (event.repeat || event.isComposing) return;
      if (event.key === 'Escape') { input.blur(); return; }
      const accelerator = toAccelerator(event);
      if (!accelerator) {
        editor.status.textContent = '请按下「修饰键 + 主键」的组合';
        editor.status.className = 'shortcut-status is-warn';
        return;
      }
      await captureReady.catch(() => {});
      const result = await window.suira.shortcuts.set({ name: editor.name, accelerator });
      if (result?.ok) {
        captureSaved = true;
        input.value = prettyAccelerator(accelerator);
        editor.status.textContent = '已更新';
        editor.status.className = 'shortcut-status is-ok';
        input.blur();
      } else {
        editor.status.textContent = result?.error || '改键失败';
        editor.status.className = 'shortcut-status is-error';
      }
    });
    input.addEventListener('focus', () => {
      if (!captureActive) {
        // Keyboard navigation can focus the readonly input without pointerdown.
        // Blur it until the main process confirms the shortcut pause, then focus again.
        deferBlurRelease = true;
        input.blur();
        focusAfterCapture().finally(() => { deferBlurRelease = false; });
        return;
      }
      valueBeforeCapture = input.value;
      captureSaved = false;
      input.value = '';
      input.placeholder = '请按下组合键…';
      editor.status.textContent = '录入期间会暂时暂停其他快捷键';
      editor.status.className = 'shortcut-status is-warn';
    });
    input.addEventListener('blur', () => {
      if (deferBlurRelease) return;
      const saved = captureSaved;
      captureSaved = false;
      if (!saved) input.value = valueBeforeCapture;
      captureActive = false;
      focusRequest++;
      const pending = captureReady;
      captureReady = Promise.resolve();
      pending.finally(() => window.suira.shortcuts.capture(false)).catch(() => {});
    });
    window.addEventListener('blur', () => {
      if (!captureActive && !captureStarting) return;
      captureActive = false;
      captureStarting = false;
      captureReady = Promise.resolve();
      focusRequest++;
      if (!captureSaved) input.value = valueBeforeCapture;
    });
    window.addEventListener('focus', () => {
      if (document.activeElement === input) focusAfterCapture();
    });
  }

  // 清除绑定：解绑后该快捷键不再响应，条目保留以便重新绑定
  for (const button of document.querySelectorAll('[data-shortcut-clear]')) {
    button.addEventListener('click', async () => {
      const name = button.dataset.shortcutClear;
      const entry = editors.find((item) => item.name === name);
      const result = await window.suira.shortcuts.clear({ name });
      if (result?.ok) {
        if (entry) {
          entry.status.textContent = '已清除，该快捷键不再响应';
          entry.status.className = 'shortcut-status is-warn';
        }
        await refreshShortcuts();
      } else if (entry) {
        entry.status.textContent = result?.error || '清除失败';
        entry.status.className = 'shortcut-status is-error';
      }
    });
  }

  // 恢复默认：全部快捷键都回到出厂值
  const restoreButton = $('#shortcut-restore');
  if (restoreButton) {
    restoreButton.addEventListener('click', async () => {
      const result = await window.suira.shortcuts.restoreDefault();
      await refreshShortcuts();
      if (!result?.ok) {
        const status = $('#status-quick');
        if (status) {
          status.textContent = result?.error || '恢复默认失败';
          status.className = 'shortcut-status is-error';
        }
      }
    });
  }
}

/** 从主进程拉取当前键位与注册状态并渲染。 */
function renderShortcutCheck(entries) {
  const target=$('#shortcut-check-result');
  const labels={registered:'已由随序注册',available:'当前可注册',conflict:'已被占用',protected:'系统或编辑保留',duplicate:'配置重复',watching:'后台按键侦测中',paused:'已暂停'};
  if(target && Array.isArray(entries))target.innerHTML=entries.map(entry=>'<div><kbd>'+escapeHtml(entry.accelerator)+'</kbd><small>'+escapeHtml((labels[entry.state]||'状态未知')+(entry.reason?'：'+entry.reason:''))+'</small></div>').join('');
}
async function refreshShortcuts() {
  try {
    const snapshot = await window.suira.shortcuts.get();
    renderShortcutCheck(snapshot.startupCheck);
    if($('#shortcut-check'))$('#shortcut-check').textContent=snapshot.globalEnabled?'检查并重试快捷键':'检查本软件的快捷键';
    if($('#setting-global-shortcuts'))$('#setting-global-shortcuts').checked=snapshot.globalEnabled===true;
    if($('#shortcut-policy-status'))$('#shortcut-policy-status').textContent=snapshot.globalEnabled===true?'全局模式：只响应成功注册的组合键，冲突不会被绕过。':'面板模式：没有接管系统热键，可点击工具或在面板内按字母。';
    const render = (name, inputId, statusId) => {
      const input = $(inputId);
      const status = $(statusId);
      if (!input || !status) return;
      const accelerator = snapshot?.bindings?.[name] || '';
      const entry = snapshot?.status?.[name];
      input.value = prettyAccelerator(accelerator);
      input.placeholder = '点击后按下组合键';
      if (!accelerator && entry?.cleared) {
        status.textContent = '未绑定，点击输入框可重新设置';
        status.className = 'shortcut-status is-warn';
      } else if(entry?.recording){
        status.textContent='快捷键录入中，其他全局快捷键暂时暂停';status.className='shortcut-status is-warn';
      } else if(entry?.localOnly){
        status.textContent='仅面板内，未启用全局组合键';status.className='shortcut-status is-warn';
      } else if (entry && !entry.ok) {
        status.textContent = (entry.error || '注册失败')+'。点击输入框更换组合键'+(name==='longCapture'?'；仍可从随手面板点击长截图。':'。');
        status.className = 'shortcut-status is-error';
      } else if (entry?.fallback && entry?.ok) {
        status.textContent = '已生效（兼容按键监听）';
        status.className = 'shortcut-status is-ok';
      } else if (entry?.reserved) {
        status.textContent = `注意：${entry.reserved} 已被系统占用`;
        status.className = 'shortcut-status is-warn';
      } else if (entry?.ok) {
        status.textContent = '已生效';
        status.className = 'shortcut-status is-ok';
      } else {
        status.textContent = '';
        status.className = 'shortcut-status';
      }
    };
    render('quick', '#setting-key-quick', '#status-quick');
    render('capture', '#setting-key-capture', '#status-capture');
    render('longCapture', '#setting-key-longCapture', '#status-longCapture');
    window.WorkspaceUI?.shortcuts(snapshot);
    render('panelCycle', '#setting-key-panelCycle', '#status-panelCycle');
    render('pinnedToggle', '#setting-key-pinnedToggle', '#status-pinnedToggle');
    render('voice', '#setting-key-voice', '#status-voice');
    render('clipboardBar', '#setting-key-clipboardBar', '#status-clipboardBar');

    // 按住型：状态来自 snapshot.status.momentary，除了注册结果还多一个 watching
    // （按住/松手侦测是否在运行）。不能用上面的通用渲染，文案与样式都不同。
    const momentaryInput = $('#setting-key-momentary');
    const momentaryStatus = $('#status-momentary');
    if (momentaryInput && momentaryStatus) {
      const accelerator = snapshot?.bindings?.momentary || '';
      const entry = snapshot?.status?.momentary;
      momentaryInput.value = prettyAccelerator(accelerator);
      momentaryInput.placeholder = '点击后按下组合键';
      if (!accelerator && entry?.cleared) {
        momentaryStatus.textContent = '未绑定，点击输入框可重新设置';
        momentaryStatus.className = 'shortcut-status is-warn';
      } else if(entry?.recording){
        momentaryStatus.textContent='快捷键录入中，按住型侦测暂时暂停';momentaryStatus.className='shortcut-status is-warn';
      } else if(entry?.localOnly){
        momentaryStatus.textContent='全局快捷键未启用，按住型侦测已暂停';momentaryStatus.className='shortcut-status is-warn';
      } else if (entry && entry.watching === false) {
        // 侦测没跑起来时「按住显示、松手收起」无法兑现，必须如实告知。
        // 主进程的 error 可能已经是「按住型侦测未运行」本身，避免拼出重复文案；
        // 主进程没给具体原因时，按 helper 未启动来表述。
        const reason = String(entry.error || '').trim();
        const detail = reason && !reason.includes('按住型侦测未运行') ? reason : '按键侦测助手没有启动';
        momentaryStatus.textContent = `按住型侦测未运行：${detail}`;
        momentaryStatus.className = entry.ok ? 'shortcut-status is-warn' : 'shortcut-status is-error';
      } else if (entry && !entry.ok) {
        momentaryStatus.textContent = entry.error || '注册失败';
        momentaryStatus.className = 'shortcut-status is-error';
      } else if (entry?.fallback && entry?.ok) {
        momentaryStatus.textContent = '已生效';
        momentaryStatus.className = 'shortcut-status is-ok';
      } else if (entry?.reserved) {
        momentaryStatus.textContent = `注意：${entry.reserved} 已被系统占用`;
        momentaryStatus.className = 'shortcut-status is-warn';
      } else if (entry?.ok) {
        momentaryStatus.textContent = '按住生效，松手收起';
        momentaryStatus.className = 'shortcut-status is-ok';
      } else {
        momentaryStatus.textContent = '';
        momentaryStatus.className = 'shortcut-status';
      }
    }
  } catch {
    // 快捷键信息不可用时不阻塞设置页
  }
}

/* A successful write and a failed refresh are different outcomes. Never leave
   a create/delete dialog retryable merely because its follow-up read failed. */
async function refreshAfterChange(refresh) {
  try { await refresh(); }
  catch (error) { showGlobalToast(`操作已保存，但列表刷新失败：${error?.message || '请重新打开页面'}`, 'error'); }
}

/* ---------- modal ---------- */

/** 同步最大化按钮图标与提示（还原 / 最大化）。 */
function syncMaximizeIcon(maximized) {
  const button = $('#maximize');
  if (!button) return;
  const isMax = Boolean(maximized);
  button.setAttribute('aria-label', isMax ? '还原' : '最大化');
  button.title = isMax ? '还原' : '最大化';
  button.dataset.maximized = isMax ? '1' : '0';
  button.innerHTML = isMax
    ? '<svg viewBox="0 0 16 16"><rect x="3.5" y="5.5" width="7" height="7" rx="1"/><path d="M5.5 5.5V3.5h7v7h-2"/></svg>'
    : '<svg viewBox="0 0 16 16"><rect x="3.5" y="3.5" width="9" height="9" rx="1"/></svg>';
}
let modalVersion = 0;
function openModal(title, placeholder, onConfirm, options = {}) {
  const version = ++modalVersion;
  $('#modal').hidden = false;
  $('#modal-title').textContent = title;
  const input = $('#modal-input');
  input.value = '';
  input.placeholder = placeholder || '';
  if (window.SuiraUI) window.SuiraUI.openDialog($('#modal'), { close: closeModal });
  else input.focus();

  // expect：必须逐字输入确认词才允许提交。之前只判断「非空」，
  // 输入任意一个字符都能删任务或清空剪贴板。
  const expect = String(options.expect || '');
  const confirmBtn = $('#modal-confirm');
  // 上一次弹窗可能把按钮改成「删除」，每次打开都要恢复，否则标签与动作长期不符
  confirmBtn.textContent = options.confirmLabel || '创建';
  const hint = $('#modal-hint');
  let submitting = false;
  const sync = () => {
    const ok = !expect || input.value.trim() === expect;
    confirmBtn.disabled = submitting || !ok || !input.value.trim();
    if (hint) {
      hint.hidden = !expect;
      hint.textContent = expect ? (ok ? `已确认：${expect}` : `请输入「${expect}」以继续`) : '';
      hint.className = `modal-hint ${ok ? 'is-ok' : ''}`.trim();
    }
    return ok;
  };
  input.oninput = sync;
  sync();

  confirmBtn.onclick = async () => {
    const value = input.value.trim();
    if (!value) return;
    if (!sync()) {
      input.focus();
      return;
    }
    if (submitting) return;
    submitting = true;
    confirmBtn.disabled = true;
    try {
      await onConfirm(value);
      if (version === modalVersion) closeModal();
    } catch (error) {
      // Keep the entered title/confirmation so a recoverable failure can retry.
      showGlobalToast(error?.message || '操作失败，请重试', 'error');
    } finally {
      submitting = false;
      if (version === modalVersion && !$('#modal').hidden) sync();
    }
  };
}

function closeModal() {
  ++modalVersion;
  $('#modal').hidden = true;
  $('#modal')._dialogCleanup?.();
  const input = $('#modal-input');
  input.oninput = null;
  $('#modal-confirm').disabled = false;
}

/* ---------- events ---------- */

function installEvents() {
  $$('.nav-item').forEach((item) => item.addEventListener('click', () => navigate(item.dataset.page)));

  $('#shelf-first').addEventListener('click',()=>$('#shelf-new').click());
  window.suira.textTools?.onConfigure?.(()=>{document.querySelector('[data-page=settings]').click();document.querySelector('[data-setting-tab=translation]').click();});
  $('#task-search').addEventListener('input',event=>{state.taskQuery=event.target.value;renderTaskList();renderTaskDetail();});
  $$('[data-task-filter]').forEach(button=>button.onclick=()=>{state.taskFilter=button.dataset.taskFilter;$$('[data-task-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));renderTaskList();renderTaskDetail();});
  const taskMenu=$('#task-more'),taskMore=$('#task-more-toggle');
  taskMenu.addEventListener('beforetoggle',event=>{const open=event.newState==='open';taskMore.setAttribute('aria-expanded',String(open));if(open){const r=taskMore.getBoundingClientRect();taskMenu.style.left=Math.max(8,Math.min(r.right-196,innerWidth-204))+'px';taskMenu.style.top=Math.min(r.bottom+6,innerHeight-196)+'px';}});
  taskMenu.addEventListener('click',event=>{if(event.target.closest('button'))taskMenu.hidePopover();});
  taskMenu.addEventListener('keydown',event=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();const buttons=$$('button',taskMenu),index=buttons.indexOf(document.activeElement);buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();});
  $('#minimize').addEventListener('click', () => window.suira.window.minimize());
  $('#maximize').addEventListener('click', async () => {
    const maximized = await window.suira.window.maximize();
    syncMaximizeIcon(maximized);
  });
  $('#close').addEventListener('click', async () => {try{await window.WorkspaceUI.flush();await window.suira.window.close();}catch(error){showGlobalToast(error.message,'error');}});

  $('#shelf-new').addEventListener('click', () => openModal('新建任务', '例如：竞品研究', async (title) => {
    const result = await window.suira.tasks.create(title);
    if (result?.ok) {
      state.selectedTaskId = result.task.id;
      state.taskFilter='all';state.taskQuery='';$('#task-search').value='';$$('[data-task-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.taskFilter==='all')));
      showGlobalToast('任务已创建', 'success');
      await refreshAfterChange(refreshShelf);
    } else throw new Error(result?.error || '创建任务失败');
  }));
  $('#shelf-import').addEventListener('click', async () => {
    const button = $('#shelf-import');
    if (button.disabled) return;
    // Capture the destination before clipboard/IPC awaits. Switching tasks while
    // a read is pending must not silently send content into a different task.
    const taskId = selectedTask()?.id;
    if (!taskId) { showGlobalToast('请先选择一个任务', 'error'); return; }
    button.disabled = true;
    try {
      let text;
      try { text = await navigator.clipboard.readText(); }
      catch { throw new Error('无法读取剪贴板，请检查权限后重试'); }
      if (!text.trim()) throw new Error('剪贴板里暂时没有文字');
      const result = await window.suira.content.addText({ text, source: 'clipboard' });
      if (!result?.ok) throw new Error(result?.error || '读取失败');
      const added = await window.suira.tasks.addItem({ taskId, itemId: result.item.id });
      if (!added?.ok) throw new Error(added?.error || '未能加入任务，内容已保留在内容库');
      showGlobalToast('剪贴板内容已加入任务匣', 'success');
      await refreshShelf();
    } catch (error) { showGlobalToast(error.message || '加入失败', 'error'); }
    finally { button.disabled = false; }
  });
  $('#task-done').addEventListener('click',async()=>{
    const task=selectedTask(),button=$('#task-done');if(!task||button.disabled)return;
    button.disabled=true;
    try{const result=await window.suira.tasks.status({id:task.id,done:task.progress!=='done'});if(!result?.ok)throw new Error(result?.error||'更新任务状态失败');await refreshShelf();}
    catch(error){showGlobalToast(error.message||'更新任务状态失败','error');}
    finally{button.disabled=false;}
  });
  $('#task-rename').addEventListener('click',()=>{const task=selectedTask();if(!task)return;openModal('重命名任务',task.title,async title=>{const result=await window.suira.tasks.rename({id:task.id,title});if(!result?.ok)throw new Error(result?.error||'重命名失败');await refreshAfterChange(refreshShelf);});});
  $('#task-copy').addEventListener('click', async () => {
    const task = selectedTask();
    if (!task) return;
    const result = await window.suira.tasks.copyText(task.id);
    if (result?.ok) showGlobalToast('任务文字已按顺序复制', 'success');
    else showGlobalToast(result?.error || '复制失败', 'error');
  });
  $('#task-export').addEventListener('click', async () => {
    const task = selectedTask();
    if (!task) return;
    const result = await window.suira.tasks.export(task.id);
    if (result?.ok) showGlobalToast(`已导出到 ${result.filePath}`, 'success');
    else if (!result?.canceled) showGlobalToast(result?.error || '导出失败', 'error');
  });
  $('#task-delete').addEventListener('click', async () => {
    const task = selectedTask();
    if (!task) return;
    openModal('删除任务', `输入「${task.title}」确认删除`, async () => {
      const result = await window.suira.tasks.remove(task.id);
      if (!result?.ok) throw new Error(result?.error || '删除失败');
      state.selectedTaskId = '';
      showGlobalToast('任务已删除');
      await refreshAfterChange(refreshShelf);
    }, { expect: task.title, confirmLabel: '删除' });
  });

  $('#library-capture').addEventListener('click', async () => {
    const result = await window.suira.capture.start();
    if (!result?.ok) showGlobalToast(result?.error || '暂时无法开始截图', 'error');
  });
  $('#library-clear').addEventListener('click', () => {
    openModal('清理历史记录', '清理剪贴板、截图与派生记录，保留固定项、任务引用和文档。输入「清空」以确认', async (value) => {
      if (value !== '清空') { showGlobalToast('已取消', 'error'); return; }
      const result = await window.suira.content.clearClipboard();
      if (result?.ok) {
        showGlobalToast(`已清理 ${result.removed || 0} 条历史记录${result.protected?'，保留 '+result.protected+' 条固定或任务引用内容':''}`, 'success');
        await refreshAfterChange(refreshLibrary);
      } else {
        throw new Error(result?.error || '清空失败');
      }
    }, { expect: '清空' });
  });
  $('#library-search').addEventListener('input', (event) => {
    state.query = event.target.value.trim().toLowerCase();
    scheduleRenderLibrary();
    refreshPinyinMatches(state.query);
  });
  $$('#library-filters .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.filter = chip.dataset.filter;
      $$('#library-filters .chip').forEach((el) => el.classList.toggle('is-active', el === chip));
      renderLibrary();
    });
  });

  $('#preview-trail').addEventListener('toggle',()=>{if($('#preview-trail').open)refreshTrail();});

  $('#open-data').addEventListener('click', () => window.suira.app.openDataDir());
  $('#open-font-license').addEventListener('click', event => { event.preventDefault(); window.suira.app.openFontLicense(); });
  $('#restart-app').addEventListener('click', async () => {
    try { await window.suira.app.restart(); }
    catch (error) { showGlobalToast(error?.message || '重启失败，请从托盘退出后重新打开', 'error'); }
  });
  bindSettings();

  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-cancel').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (event) => {
    if (event.target === $('#modal')) closeModal();
  });
  $('#modal-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); $('#modal-confirm').click(); }
    if (event.key === 'Escape') closeModal();
  });

  // 预览层：关闭按钮 / 点遮罩 / 底部的复制与粘贴
  $('#preview-close').addEventListener('click', closePreview);
  $('#preview').addEventListener('click', (event) => {
    if (event.target === $('#preview')) closePreview();
  });
  $('#preview-copy').addEventListener('click', async () => {
    const id = state.previewId;
    if (!id) return;
    const result = await window.suira.actions.run(id, 'output.copy');
    if (result?.ok) showGlobalToast('已复制', 'success');
    else showGlobalToast(result?.error || '复制失败', 'error');
  });
  $('#preview-paste').addEventListener('click', () => pasteItemToTarget(state.previewId));
  $('#preview-pixels').addEventListener('click',togglePreviewPixels);

  document.addEventListener('keydown', (event) => {
    // 预览层打开时，Esc 只关预览层，不再落到弹窗或输入框逻辑
    if (event.key === 'Escape' && closePreview()) {
      event.preventDefault();
      return;
    }
    if (!$('#modal').hidden) {
      if (event.key === 'Escape') closeModal();
      return;
    }
    if (event.key === 'Escape' && event.target?.matches?.('input, textarea')) event.target.blur();
  });

  window.suira.content.onChanged(() => {
    if (state.page === 'shelf') refreshShelf();
    if (state.page === 'library') refreshLibrary();
    if (!$('#preview').hidden && $('#preview-trail').open) refreshTrail();
  });
  window.suira.tasks.onChanged(() => {
    if (state.page === 'shelf') refreshShelf();
  });
  window.suira.executions.onChanged(() => {
    if (!$('#preview').hidden && $('#preview-trail').open) refreshTrail();
    if (state.page === 'shelf') refreshShelf();
  });
  window.suira.app.onToast((payload) => showGlobalToast(payload.message || '', payload.type || ''));
  window.suira.app.onNavigate((page) => {if(['settings:shortcuts','settings:tools'].includes(page)){navigate('settings');document.querySelector('[data-setting-tab="'+page.split(':')[1]+'"]')?.click();}else navigate(page);});
  // 外部改键同步到设置页。
  window.suira.shortcuts.onChanged(() => { refreshShortcuts(); });
  window.suira.ocr.onProgress((payload) => {
    if (payload?.status === 'recognizing text') {
      showGlobalToast(`正在识别文字 ${Math.round((payload.progress || 0) * 100)}%`);
    }
  });
}

/* ---------- init ---------- */

async function init() {
  installEvents();
  if (standaloneTool) { navigate(standaloneTool); return; }
  const info = await window.suira.app.info();
  if (info?.version) {
    $('#app-version').textContent = `版本 ${info.version}`;
    $('#side-version').textContent = info.version;
  }
  state.executions = (await window.suira.executions.list(200)) || [];
  navigate(standaloneTool || 'shelf');
}

init().catch((error) => {
  console.error(error);
  showGlobalToast(`初始化失败：${error.message}`, 'error');
});
