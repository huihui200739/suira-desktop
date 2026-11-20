'use strict';
/*
 * 速记窗口。
 *
 * 正文保存有防抖，关窗时补保存。标题可留空，由正文首行派生。
 * 已开的速记按各自 ID 保存，列表可进入另一条速记。
 */

const $ = (selector) => document.querySelector(selector);

const state = {
  id: '',
  pinned: false,
  saving: false,
  dirty: false,
  error: ''
};

function setSaved(text, kind = '') {
  const el = $('#note-saved');
  el.textContent = text;
  el.dataset.state = kind;
}

function showError(message) {
  const el = $('#note-error');
  el.textContent = message || '';
  el.hidden = Boolean(!message);
}

function renderCount(text) {
  $('#note-count').textContent = `${(text || '').length} 字`;
}

function renderNote(note) {
  if (!note) return;
  state.id = note.id;
  state.pinned = Boolean(note.pinned);
  document.title = `随序 ${note.title || '速记'}`;
  $('#note-title').textContent = note.text || note.customTitle ? (note.title || '速记') : '随序速记';
  $('#note-page-title').value = note.customTitle || '';
  // 只在内容真的不同时覆盖：否则每次广播都会把光标弹到末尾
  const body = $('#note-body');
  if (body.value !== (note.text || '')) body.value = note.text || '';
  renderCount(body.value);
  $('#note').dataset.pinned = String(state.pinned);
  $('#note').dataset.state = 'ready';
  $('#note-pin').setAttribute('aria-pressed', String(state.pinned));
  $('#note-pin').setAttribute('title',state.pinned?'取消置顶':'钉在桌面上');
}

/* ---------- 写入 ---------- */

let saveTimer = null;
let saveInFlight = null;
let titleDirty = false;
let indexNotes = [];
let indexRevision = 0;

function noteDraft() {
  return {id:state.id, text:$('#note-body').value, ...(titleDirty ? {title:$('#note-page-title').value} : {})};
}

async function pushText() {
  if (saveInFlight) await saveInFlight;
  if (!state.id || !state.dirty) return true;
  const draft = noteDraft();
  state.dirty = false;
  titleDirty = false;
  setSaved('正在保存…', 'saving');
  const save = (async () => {
    try {
      const result = await window.suira.notes.update(draft);
      if (!result?.ok) throw new Error(result?.error || '保存失败');
      if (!state.dirty) setSaved('已保存');
      showError('');
      return true;
    } catch (error) {
      state.dirty = true;
      titleDirty ||= Object.hasOwn(draft, 'title');
      setSaved('未保存', 'error');
      showError(error.message || '保存失败');
      return false;
    }
  })();
  saveInFlight = save;
  try { return await save; }
  finally { if (saveInFlight === save) saveInFlight = null; }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  setSaved('未保存', 'saving');
  saveTimer = setTimeout(pushText, 400);
}

/* ---------- 启动 ---------- */

async function boot() {
  const body = $('#note-body');

  const title = $('#note-page-title');
  const update = () => {
    state.dirty = true;
    renderCount(body.value);
    const first = body.value.split(/\r?\n/).find(line => line.trim())?.trim();
    $('#note-title').textContent = (title.value.trim() || first || '随序速记').slice(0, 120);
    scheduleSave();
  };
  body.addEventListener('input', update);
  title.addEventListener('input', () => { titleDirty = true; update(); });
  title.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); body.focus(); }
  });
  $('#note-checklist').addEventListener('click', () => {
    const start = body.selectionStart;
    const prefix = start && body.value[start-1] !== '\n' ? '\n- [ ] ' : '- [ ] ';
    body.setRangeText(prefix, start, start, 'end');
    body.focus();
    update();
  });
  $('#note-search').addEventListener('input', renderIndex);
  $('#note-pages').addEventListener('click', async event => {
    const button = event.target.closest('[data-id]');
    if (!button || !(await pushText())) return;
    if (innerWidth < 581) closeIndex();
    try {
      const result = await window.suira.notes.open(button.dataset.id);
      if (!result?.ok) throw new Error(result?.error || '打开失败');
    } catch (error) { showError(error.message || '打开失败'); }
  });

  // Esc 逐级返回：先收「全部速记」浮层，再收窗口。
  // 收窗前会补一次保存，不会丢掉刚敲进去的字。
  // 挂 document 而不是 textarea：打开「全部速记」后焦点仍在按钮上，
  // 只监听 textarea 会让 Esc 完全失效。
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    if (!$('#note-index').hidden) closeIndex();
    else closeWindow();
  });

  $('#note-index-btn').addEventListener('click', () => toggleIndex());

  $('#note-close').addEventListener('click', closeWindow);
  $('#note-min').addEventListener('click', () => window.suira.notes.minimizeWindow());

  $('#note-pin').addEventListener('click', async () => {
    try {
      const result = await window.suira.notes.togglePin(state.id);
      if (!result || result.ok === false) throw new Error((result && result.error) || '切换失败');
      state.pinned = Boolean(result.note && result.note.pinned);
      $('#note').dataset.pinned = String(state.pinned);
      $('#note-pin').setAttribute('aria-pressed', String(state.pinned));
      $('#note-pin').setAttribute('title',state.pinned?'取消置顶':'钉在桌面上');
    } catch (error) {
      showError(error.message || '切换失败');
    }
  });

  const createPage = async () => {
    if (!(await pushText())) return;
    try {
      const result = await window.suira.notes.create();
      if (result?.ok === false) throw new Error(result.error || '新建失败');
    } catch (error) {
      showError(error.message || '新建失败');
    }
  };
  $('#note-new').addEventListener('click', createPage);
  $('#note-new-page').addEventListener('click', createPage);

  $('#note-delete').addEventListener('click', async () => {
    // 删除不可撤销：先确认，再删除（速记没有回收站）
    if (!window.confirm('删除这条速记？删除后无法恢复。')) return;
    try {
      const result = await window.suira.notes.remove(state.id);
      if (!result || result.ok === false) throw new Error((result && result.error) || '删除失败');
      closeWindow();
    } catch (error) {
      showError(error.message || '删除失败');
    }
  });

  // 主进程建好窗口后把 noteId 送过来，才知道自己是哪一条
  window.suira.notes.onOpened(async (payload) => {
    const id = payload && payload.id;
    if (!id) { showError('未拿到速记编号'); return; }
    state.id = id;
    try {
      const note = await window.suira.notes.get(id);
      renderNote(note);
      if (innerWidth >= 620) await openIndex();
      body.focus();
      // 光标放到末尾：接着上次的写，而不是从开头插入
      body.setSelectionRange(body.value.length, body.value.length);
    } catch (error) {
      showError(error.message || '读取速记失败');
    }
  });

  // 别的窗口改了同一条时同步过来，但不打断正在输入的光标
  window.suira.notes.onChanged((notes) => {
    if (!state.id) return;
    const mine = (notes || []).find((note) => note.id === state.id);
    if (!mine) return;
    state.pinned = Boolean(mine.pinned);
    $('#note').dataset.pinned = String(state.pinned);
    $('#note-pin').setAttribute('aria-pressed', String(state.pinned));
    $('#note-pin').setAttribute('title',state.pinned?'取消置顶':'钉在桌面上');
    if (!state.dirty && !saveInFlight && ![body,title].includes(document.activeElement)) renderNote(mine);
    if (!$('#note-index').hidden) { indexNotes = notes || []; renderIndex(); }
  });
}

/* ---------- 全部速记 ---------- */

function closeIndex() {
  indexRevision++;
  $('#note-index').hidden = true;
  $('#note').classList.remove('with-index');
  $('#note-index-btn').setAttribute('aria-expanded', 'false');
}

function renderIndex() {
  const query = $('#note-search').value.trim().toLocaleLowerCase();
  const notes = indexNotes.map((note,index) => ({note,page:index+1}))
    .filter(({note}) => !query || `${note.title} ${note.text}`.toLocaleLowerCase().includes(query));
  const list = $('#note-pages');
  const scroll = list.scrollTop;
  const focusedId = list.contains(document.activeElement) ? document.activeElement.dataset.id : '';
  list.innerHTML = notes.length ? notes.map(({note,page}) => {
    const text = (note.text || '').trim();
    const preview = (note.customTitle ? text : text.split(/\r?\n/).slice(1).join(' ')).trim();
    return `<button type="button" data-id="${escapeHtml(note.id)}" aria-current="${note.id === state.id}">
      <small>第 ${page} 页${note.pinned ? ' · 已置顶' : ''}</small>
      <b>${escapeHtml(text || note.customTitle ? note.title : '新页面')}</b>
      <span>${escapeHtml((preview || (text ? '无摘要' : '空白页面')).slice(0, 100))}</span>
    </button>`;
  }).join('') : `<p class="note-index-empty">${query ? '没有匹配的速记' : '还没有速记'}</p>`;
  list.scrollTop = scroll;
  if (focusedId) [...list.querySelectorAll('[data-id]')].find(button => button.dataset.id === focusedId)?.focus({preventScroll:true});
}

async function openIndex() {
  const revision = ++indexRevision;
  try {
    const notes = await window.suira.notes.list();
    if (revision !== indexRevision) return;
    indexNotes = notes;
    renderIndex();
    $('#note-index').hidden = false;
    $('#note').classList.add('with-index');
    $('#note-index-btn').setAttribute('aria-expanded', 'true');
  } catch (error) { showError(error.message || '读取速记列表失败'); }
}

async function toggleIndex() {
  if (!$('#note-index').hidden) { closeIndex(); return; }
  if (await pushText()) await openIndex();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

async function closeWindow() {
  // 关窗前补一次保存：防抖窗口里的最后一次输入不能丢
  clearTimeout(saveTimer);
  if (await pushText()) window.suira.notes.hideWindow();
}

window.addEventListener('beforeunload', () => {
  clearTimeout(saveTimer);
  if (state.id && state.dirty) window.suira.notes.update(noteDraft());
});

window.NoteUI={flush:async()=>{ clearTimeout(saveTimer); if (!(await pushText())) throw Error('速记保存失败'); }};
boot();
