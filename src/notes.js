'use strict';
/*
 * 速记窗口。
 *
 * 边界与取舍：
 * - 只做纯文本。富文本/Markdown 是另一个量级，不做半成品（见 BATCH3-GAP-ANALYSIS 速记一节）。
 * - 标题由正文第一行推导，不另设输入框：速记的价值是「少一次决定」。
 * - 逐字落盘会重写整个数据文件，所以输入是防抖的；关窗与 Esc 前补一次同步。
 * - 窗口位置由主进程记住（store.setNoteBounds），这里不重复实现，也不自己算屏幕。
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
  $('#note-title').textContent = note.title || '速记';
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

async function pushText() {
  if (!state.id || !state.dirty) return;
  state.dirty = false;
  setSaved('正在保存…', 'saving');
  try {
    const result = await window.suira.notes.update({ id: state.id, text: $('#note-body').value });
    if (!result || result.ok === false) throw new Error((result && result.error) || '保存失败');
    setSaved('已保存');
    showError('');
  } catch (error) {
    state.dirty = true;
    setSaved('未保存', 'error');
    showError(error.message || '保存失败');
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  setSaved('未保存', 'saving');
  saveTimer = setTimeout(pushText, 400);
}

/* ---------- 启动 ---------- */

async function boot() {
  const body = $('#note-body');

  body.addEventListener('input', () => {
    state.dirty = true;
    renderCount(body.value);
    // 标题随正文一起长出来，不等保存回来
    const first = body.value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
    $('#note-title').textContent = first ? first.slice(0, 120) : '速记';
    scheduleSave();
  });

  // Esc 逐级返回：先收「全部速记」浮层，再收窗口。
  // 收窗前会补一次保存，不会丢掉刚敲进去的字。
  body.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!$('#note-index').hidden) closeIndex();
      else closeWindow();
    }
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

  $('#note-new').addEventListener('click', async () => {
    await pushText();
    try {
      await window.suira.notes.create();
    } catch (error) {
      showError(error.message || '新建失败');
    }
  });

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
    if (!state.dirty && document.activeElement !== body) renderNote(mine);
  });
}

/* ---------- 全部速记 ---------- */

function closeIndex() {
  $('#note-index').hidden = true;
  $('#note-index-btn').setAttribute('aria-expanded', 'false');
}

async function toggleIndex() {
  const panel = $('#note-index');
  if (!panel.hidden) { closeIndex(); return; }
  await pushText();
  let notes = [];
  try {
    notes = await window.suira.notes.list();
  } catch (error) {
    showError(error.message || '读取速记列表失败');
    return;
  }
  panel.innerHTML = notes.length
    ? notes.map((note) => `
        <button type="button" data-id="${escapeHtml(note.id)}" aria-current="${note.id === state.id}">
          ${escapeHtml(note.title || '未命名速记')}<small>${(note.text || '').length} 字${note.pinned ? '，已钉' : ''}</small>
        </button>`).join('')
    : '<p class="note-index-empty">还没有其它速记</p>';
  panel.hidden = false;
  $('#note-index-btn').setAttribute('aria-expanded', 'true');
  panel.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', async () => {
      closeIndex();
      // 切到已开着的窗口由主进程置前；没开就新开一个
      const result = await window.suira.notes.open(button.dataset.id);
      if (!result || result.ok === false) showError((result && result.error) || '打开失败');
    });
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

async function closeWindow() {
  // 关窗前补一次保存：防抖窗口里的最后一次输入不能丢
  clearTimeout(saveTimer);
  try { await pushText(); } catch { /* 保存失败也要关得了窗；错误已显示在窗口里 */ }
  window.suira.notes.hideWindow();
}

window.addEventListener('beforeunload', () => {
  clearTimeout(saveTimer);
  if (state.id && state.dirty) window.suira.notes.update({ id: state.id, text: $('#note-body').value });
});

window.NoteUI={flush:async()=>{clearTimeout(saveTimer);if(!state.id||!state.dirty)return;const result=await window.suira.notes.update({id:state.id,text:$('#note-body').value});if(!result?.ok)throw Error(result?.error||'速记保存失败');state.dirty=false;}};
boot();
