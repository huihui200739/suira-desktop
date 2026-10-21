'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const ACTION_META = {
  'ocr.local': { glyph: '识', label: '提取文字', hint: '本地离线识别' },
  'text.merge-lines': { glyph: '↵', label: '合并换行', hint: '接成自然段' },
  'text.clean': { glyph: '✦', label: '清理文字', hint: '去多余空格' },
  'output.copy': { glyph: '⧉', label: '复制', hint: '放到剪贴板' },
  'output.shelf': { glyph: '＋', label: '加入任务匣', hint: '暂存到临时收集' },
  'image.pin': { glyph: '⌖', label: '钉在桌面', hint: '保持图片置顶' },
  'files.reveal': { glyph: '⌕', label: '定位文件', hint: '在资源管理器中显示' },
  'output.open': { glyph: '↗', label: '打开', hint: '用系统应用打开' }
};

const state = {
  items: [],
  tasks: [],
  actions: [],
  commandResults: [],
  selectedIndex: 0,
  focusIndex: 0,
  query: '',
  mode: 'content',
  returnTarget: null,
  ocrItem: null,
  ocrText: '',
  toastTimer: null,
  composing: false,
  loading: false
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}

function toast(message, type = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast is-visible ${type}`.trim();
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { el.className = 'toast'; }, 2100);
}

function relativeTime(timestamp) {
  const delta = Date.now() - Number(timestamp || 0);
  if (delta < 60000) return '刚刚';
  if (delta < 3600000) return `${Math.floor(delta / 60000)} 分钟前`;
  if (delta < 86400000) return `${Math.floor(delta / 3600000)} 小时前`;
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function kindGlyph(item) {
  if (item.kind === 'image') return '图';
  if (item.kind === 'link') return '链';
  if (item.kind === 'files') return '文';
  if (item.kind === 'collection') return '集';
  return '字';
}

function itemSummary(item) {
  if (item.kind === 'image') return item.meta?.width ? `${item.meta.width} × ${item.meta.height}` : '图片';
  if (item.kind === 'files') return item.filePath || item.text;
  return String(item.text || '').replace(/\s+/g, ' ').slice(0, 120);
}

function currentItem() {
  return state.items[state.selectedIndex] || null;
}

function filteredItems() {
  if (!state.query) return state.items;
  const query = state.query.toLowerCase();
  return state.items.filter((item) => `${item.title} ${item.text} ${item.filePath} ${item.source?.appName || ''}`.toLowerCase().includes(query));
}

function renderSource() {
  const item = currentItem();
  const card = $('#source-card');
  if (!item || state.mode === 'search') {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const labels = { text: '文字', link: '链接', image: '图片', files: '文件', collection: '集合' };
  $('#source-kind').textContent = `${labels[item.kind] || '内容'} · ${item.source?.type === 'screenshot' ? '截图' : item.source?.type === 'clipboard' ? '剪贴板' : item.source?.type === 'ocr' ? '识别结果' : '本地'}`;
  $('#source-time').textContent = relativeTime(item.createdAt);
  const body = $('#source-body');
  if (item.kind === 'image' && item.thumbnail) {
    body.innerHTML = `<img class="source-thumb" src="${escapeHtml(item.thumbnail)}" alt="">`;
  } else {
    body.innerHTML = `<p class="source-text">${escapeHtml(item.text || item.filePath || item.title)}</p>`;
  }
  const meta = [];
  if (item.parentIds?.length) meta.push('由上一项处理生成');
  if (item.pinned) meta.push('已固定');
  if (item.kind === 'image' && item.meta?.width) meta.push(`${item.meta.width} × ${item.meta.height}`);
  $('#source-meta').textContent = meta.join(' · ') || '原内容保持可追溯';
}

async function renderActions() {
  const item = currentItem();
  const list = $('#action-list');
  if (!item) {
    state.actions = [];
    $('#action-count').textContent = '';
    list.innerHTML = '';
    return;
  }
  state.actions = await window.suira.actions.list(item.id) || [];
  $('#action-count').textContent = `${state.actions.length} 个可用`;
  list.innerHTML = state.actions.map((action, index) => {
    const meta = ACTION_META[action.id] || { glyph: '·', label: action.label || action.id, hint: action.hint || '' };
    return `<button class="action-item ${index === state.focusIndex ? 'is-selected' : ''}" type="button" data-action="${escapeHtml(action.id)}" data-index="${index}">
      <span class="action-icon">${escapeHtml(meta.glyph)}</span>
      <span class="action-copy"><b>${escapeHtml(meta.label)}</b><small>${escapeHtml(meta.hint)}</small></span>
      <span class="action-key">${index + 1}</span>
    </button>`;
  }).join('');
  $$('.action-item', list).forEach((button) => {
    button.addEventListener('click', () => runAction(button.dataset.action));
  });
}

function renderContentList() {
  const list = $('#content-list');
  const items = filteredItems();
  if (!items.length) {
    list.innerHTML = `<div class="content-empty">${state.query ? '没有找到匹配的内容' : '复制文字或截图后，内容会出现在这里'}</div>`;
    return;
  }
  list.innerHTML = items.slice(0, 9).map((item, index) => {
    const realIndex = state.items.indexOf(item);
    const selected = realIndex === state.selectedIndex;
    const glyph = item.kind === 'image' && item.thumbnail
      ? `<img class="content-glyph" src="${escapeHtml(item.thumbnail)}" alt="">`
      : `<span class="content-glyph">${kindGlyph(item)}</span>`;
    return `<button class="content-item ${selected ? 'is-selected' : ''}" type="button" data-index="${realIndex}">
      ${glyph}
      <span class="content-text"><b>${escapeHtml(item.title)}</b><span>${escapeHtml(itemSummary(item))}</span></span>
      <time class="content-time">${relativeTime(item.createdAt)}</time>
    </button>`;
  }).join('');
  $$('.content-item', list).forEach((button) => {
    button.addEventListener('click', () => selectItem(Number(button.dataset.index)));
  });
}

function renderTasks() {
  const section = $('#task-section');
  const list = $('#task-list');
  section.hidden = !state.tasks.length;
  list.innerHTML = state.tasks.slice(0, 4).map((task) => `<button class="task-chip" type="button" data-id="${escapeHtml(task.id)}"><b>${escapeHtml(task.title)}</b><span>${task.itemIds?.length || 0}</span></button>`).join('');
  $$('.task-chip', list).forEach((button) => {
    button.addEventListener('click', () => window.suira.quick.showMain('shelf'));
  });
}

function renderAll() {
  const hasItems = state.items.length > 0;
  const searching = Boolean(state.query);
  $('#empty-state').hidden = hasItems || searching || state.loading;
  $('#content-section').hidden = !hasItems;
  $('#result-area').hidden = !hasItems;
  $('#source-card').hidden = !hasItems || searching;
  $('#command-section').hidden = !searching || !state.commandResults.length;
  renderSource();
  renderCommandList();
  renderContentList();
  renderTasks();
  if (hasItems) renderActions();
  renderReturnBar();
}

/** 显示「放回原处」条：只有记录到目标窗口时才出现。 */
function renderReturnBar() {
  const bar = $('#return-bar');
  if (!bar) return;
  const target = state.returnTarget;
  if (!target || !state.items.length) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const name = target.processName || '原窗口';
  const title = target.title ? ` · ${target.title.slice(0, 28)}` : '';
  $('#return-target-text').textContent = `回到 ${name}${title}`;
}

async function commitReturn() {
  const item = currentItem();
  if (!item) return;
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

function renderCommandList() {
  const section = $('#command-section');
  const list = $('#command-list');
  if (!state.commandResults.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  list.innerHTML = state.commandResults.slice(0, 6).map((entry) => {
    const glyph = entry.kind === 'command' ? '⌘' : entry.kind === 'task' ? '▤' : '字';
    return `<button class="command-item" type="button" data-id="${escapeHtml(entry.id)}" data-kind="${escapeHtml(entry.kind)}">
      <span class="command-icon">${glyph}</span>
      <span class="command-copy"><b>${escapeHtml(entry.title)}</b><small>${escapeHtml(entry.subtitle || '')}</small></span>
    </button>`;
  }).join('');
  $$('.command-item', list).forEach((button) => {
    button.addEventListener('click', () => runCommand(button.dataset.id, button.dataset.kind));
  });
}

async function runCommand(id, kind) {
  if (kind === 'content') {
    const index = state.items.findIndex((entry) => entry.id === id);
    if (index >= 0) {
      $('#search').value = '';
      state.query = '';
      selectItem(index);
    }
    return;
  }
  if (kind === 'task') {
    window.suira.quick.showMain('shelf');
    return;
  }
  if (kind === 'app') {
    // 应用条目：交给主进程用系统默认方式启动
    const result = await window.suira.quick.openApp?.(id.replace(/^app:/, ''));
    if (!result?.ok) toast(result?.error || '无法启动该应用', 'error');
    else window.suira.quick.hide();
    return;
  }
  const entry = state.commandResults.find((item) => item.id === id);
  const action = entry?.action || '';
  if (action === 'capture') { await window.suira.quick.capture(); return; }
  if (action === 'quick') { return; }
  if (action.startsWith('navigate:')) {
    window.suira.quick.showMain(action.slice('navigate:'.length));
    return;
  }
  if (action.startsWith('recipe:')) {
    const item = currentItem();
    if (!item) { toast('先选中一段内容再运行配方', 'error'); return; }
    await runRecipe(action.slice('recipe:'.length), item);
  }
}

async function runRecipe(recipeId, item) {
  try {
    const result = await window.suira.recipes.run({ itemId: item.id, recipeId, commit: false });
    if (!result?.ok) { toast(result?.error || '配方执行失败', 'error'); return; }
    const stepText = (result.steps || []).map((s) => (s.ok ? '✓' : '✕')).join(' ');
    toast(`配方完成 ${stepText}`);
    if (result.output) await loadData(result.output.id);
  } catch (error) {
    toast(error.message || '配方执行失败', 'error');
  }
}

function selectItem(index) {
  if (!state.items[index]) return;
  state.selectedIndex = index;
  state.focusIndex = 0;
  state.mode = 'content';
  renderAll();
  $('#content-list').scrollTop = Math.max(0, index * 48 - 96);
}

async function runAction(actionId) {
  const item = currentItem();
  if (!item) return;
  if (actionId === 'ocr.local') {
    await runOcr(item);
    return;
  }
  const button = $(`.action-item[data-action="${CSS.escape(actionId)}"]`);
  button?.classList.add('is-busy');
  try {
    const result = await window.suira.actions.run(item.id, actionId);
    if (!result?.ok) { toast(result?.error || '动作执行失败', 'error'); return; }
    toast(result.message || '已完成');
    if (result.output) {
      await loadData(result.output.id);
      if (actionId === 'text.merge-lines' || actionId === 'text.clean') {
        state.selectedIndex = state.items.findIndex((entry) => entry.id === result.output.id);
        state.focusIndex = 0;
        renderAll();
      }
    }
  } catch (error) {
    toast(error.message || '动作执行失败', 'error');
  } finally {
    button?.classList.remove('is-busy');
  }
}

async function runOcr(item) {
  const panel = $('#ocr-panel');
  const textarea = $('#ocr-text');
  panel.hidden = false;
  textarea.value = '';
  textarea.placeholder = '正在准备本地识别…';
  state.ocrItem = item;
  try {
    const result = await window.suira.ocr.recognizeItem(item.id);
    if (!result?.ok) throw new Error(result?.error || '识别失败');
    state.ocrText = result.output?.text || '';
    textarea.value = state.ocrText;
    textarea.placeholder = '没有识别到文字，可以换一张更清晰的图片';
    await loadData(result.output?.id);
  } catch (error) {
    textarea.placeholder = error.message || '识别失败';
    toast(error.message || '识别失败', 'error');
  }
}

function closeOcr() {
  $('#ocr-panel').hidden = true;
  state.ocrItem = null;
  state.ocrText = '';
}

async function loadData(selectId = '') {
  state.loading = true;
  $('#loading').hidden = false;
  try {
    const [items, tasks] = await Promise.all([
      window.suira.content.list({ limit: 80 }),
      window.suira.tasks.list()
    ]);
    state.items = items || [];
    state.tasks = tasks || [];
    if (selectId) {
      const index = state.items.findIndex((item) => item.id === selectId);
      if (index >= 0) state.selectedIndex = index;
    }
    if (state.selectedIndex >= state.items.length) state.selectedIndex = 0;
    state.focusIndex = Math.min(state.focusIndex, Math.max(0, (state.actions?.length || 1) - 1));
  } finally {
    state.loading = false;
    $('#loading').hidden = true;
  }
  renderAll();
  if (state.items.length) await renderActions();
}

function updateSearch(value) {
  state.query = value.trim();
  const filtered = filteredItems();
  if (filtered.length) {
    const first = state.items.indexOf(filtered[0]);
    if (first >= 0) state.selectedIndex = first;
  }
  state.mode = state.query ? 'search' : 'content';
  renderAll();
  if (state.query) refreshCommands(state.query);
  else { state.commandResults = []; renderAll(); }
}

let commandTimer = null;
function refreshCommands(query) {
  clearTimeout(commandTimer);
  commandTimer = setTimeout(async () => {
    try {
      const results = await window.suira.search.query(query);
      // 冻结顺序：只在结果返回时整体替换一次，不随输入抖动重排
      state.commandResults = Array.isArray(results) ? results : [];
    } catch {
      state.commandResults = [];
    }
    renderAll();
  }, 80);
}

function installEvents() {
  $('#search').addEventListener('input', (event) => updateSearch(event.target.value));
  $('#search').addEventListener('compositionstart', () => { state.composing = true; });
  $('#search').addEventListener('compositionend', () => { state.composing = false; });
  $('#search').addEventListener('keydown', (event) => {
    if (event.isComposing || state.composing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (state.query) { $('#search').value = ''; updateSearch(''); }
      else window.suira.quick.hide();
    }
  });

  $('#capture').addEventListener('click', async () => {
    const result = await window.suira.quick.capture();
    if (!result?.ok) toast(result?.error || '暂时无法截图', 'error');
  });
  $('#empty-capture').addEventListener('click', () => $('#capture').click());
  $('#empty-paste').addEventListener('click', async () => {
    const text = await navigator.clipboard?.readText?.().catch(() => '');
    if (!text) { toast('剪贴板里暂时没有文字', 'error'); return; }
    const result = await window.suira.content.addText({ text, source: 'clipboard' });
    if (result?.ok) await loadData(result.item.id); else toast(result?.error || '读取失败', 'error');
  });
  $('#open-main').addEventListener('click', () => window.suira.quick.openMain('shelf'));
  $('#return-commit').addEventListener('click', commitReturn);
  $('#see-all').addEventListener('click', () => window.suira.quick.openMain('library'));
  $('#open-tasks').addEventListener('click', () => window.suira.quick.openMain('shelf'));

  $('#ocr-close').addEventListener('click', closeOcr);
  $('#ocr-copy').addEventListener('click', async () => {
    const text = $('#ocr-text').value;
    if (!text.trim()) return;
    const item = await window.suira.content.addText({ text, title: '识别文字', source: 'ocr' });
    if (!item?.ok) { toast(item?.error || '保存失败', 'error'); return; }
    const result = await window.suira.actions.run(item.item.id, 'output.copy');
    if (result?.ok) { toast('识别文字已复制'); closeOcr(); } else toast(result?.error || '复制失败', 'error');
  });
  $('#ocr-merge').addEventListener('click', async () => {
    const text = $('#ocr-text').value;
    if (!text.trim()) return;
    const saved = await window.suira.content.addText({ text, title: '识别文字', source: 'ocr' });
    if (!saved?.ok) return;
    const result = await window.suira.actions.run(saved.item.id, 'text.merge-lines');
    if (result?.ok && result.output) { $('#ocr-text').value = result.output.text; toast('已合并换行'); await loadData(result.output.id); }
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
  $('#ocr-original').addEventListener('click', () => {
    if (!state.ocrItem) return;
    closeOcr();
    selectItem(state.items.findIndex((item) => item.id === state.ocrItem.id));
  });

  document.addEventListener('keydown', (event) => {
    if (event.isComposing || state.composing) return;
    if (!$('#ocr-panel').hidden) {
      if (event.key === 'Escape') { event.preventDefault(); closeOcr(); }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); window.suira.quick.hide(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (event.target === $('#search') && state.query) return;
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      if (event.target === $('#search') || state.mode === 'content') {
        const next = Math.max(0, Math.min(state.items.length - 1, state.selectedIndex + direction));
        if (next !== state.selectedIndex) selectItem(next);
      }
      return;
    }
    if (event.key === 'Tab') {
      if (!state.actions.length) return;
      event.preventDefault();
      state.focusIndex = (state.focusIndex + (event.shiftKey ? -1 : 1) + state.actions.length) % state.actions.length;
      $$('.action-item').forEach((button, index) => button.classList.toggle('is-selected', index === state.focusIndex));
      return;
    }
    if (event.key === 'Enter') {
      if (!state.actions.length) return;
      event.preventDefault();
      const action = state.actions[state.focusIndex];
      if (action) runAction(action.id);
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      $('#capture').click();
    }
  });

  window.suira.content.onChanged(() => loadData());
  window.suira.tasks.onChanged(() => loadData());
  window.suira.quick.onShown(() => {
    $('#search').value = '';
    state.query = '';
    state.mode = 'content';
    state.focusIndex = 0;
    state.selectedIndex = 0;
    closeOcr();
    // 目标窗口在面板唤起前已由主进程记录，这里只取结果
    window.suira.returnTo.target().then((target) => {
      state.returnTarget = target || null;
      renderReturnBar();
    }).catch(() => { state.returnTarget = null; });
    loadData().then(() => setTimeout(() => $('#search').focus(), 20));
  });
}

installEvents();
loadData().catch((error) => toast(error.message || '初始化失败', 'error'));