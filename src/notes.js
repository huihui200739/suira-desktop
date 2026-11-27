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
  dirty: false,
  source: null
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

function noteToneIndex(id) {
  const value = String(id || '');
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash % 5;
}

function formatNoteTime(timestamp) {
  if (!timestamp || !Number.isFinite(Number(timestamp))) return '';
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  if (sameDay) return `今天 ${hh}:${mm}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${hh}:${mm}`;
}

function syncActiveMeta(note) {
  if (!note) return;
  const tone = noteToneIndex(note.id);
  $('#note').dataset.tone = String(tone);
  const idx = indexNotes.findIndex((entry) => entry.id === note.id);
  $('#note-meta-page').textContent = `第 ${idx >= 0 ? idx + 1 : 1} 页`;
  $('#note-meta-time').textContent = formatNoteTime(note.updatedAt || note.createdAt || Date.now());
  $('#note-meta-pin').hidden = !state.pinned;
}

function renderNote(note) {
  if (!note) return;
  state.id = note.id;
  state.pinned = Boolean(note.pinned);
  document.title = `随序 ${note.title || '速记'}`;
  $('#note-title').textContent = note.text || note.customTitle ? (note.title || '速记') : '随序速记';
  $('#note-page-title').value = note.customTitle || '';
  if (state.source?.id !== note.id || state.source.text !== note.text || state.source.richText !== note.richText) {
    const rich = note.richText && DOMPurify.sanitize(note.richText, {
      ALLOWED_TAGS:['p','h1','h2','strong','em','u','s','ul','li','label','input','div','span','br'],
      ALLOWED_ATTR:['data-type','data-checked','data-note-file','type','checked'],
      ADD_URI_SAFE_ATTR:['data-note-file'], ALLOW_DATA_ATTR:false, ALLOW_ARIA_ATTR:false
    });
    editor.load(note.text || '', rich);
    state.source = note;
  }
  renderCount(editor.text());
  renderFormats();
  $('#note').dataset.pinned = String(state.pinned);
  $('#note').dataset.state = 'ready';
  $('#note-pin').setAttribute('aria-pressed', String(state.pinned));
  $('#note-pin').setAttribute('title',state.pinned?'取消置顶':'钉在桌面上');
  syncActiveMeta(note);
}

/* ---------- 写入 ---------- */

let saveTimer = null;
let saveInFlight = null;
let titleDirty = false;
let bodyDirty = false;
let editVersion = 0;
let switchRevision = 0;
let indexNotes = [];
let indexRevision = 0;

function noteDraft() {
  return {id:state.id,
    ...(bodyDirty ? {text:editor.text(), richText:editor.html()} : {}),
    ...(titleDirty ? {title:$('#note-page-title').value} : {})};
}

async function pushText() {
  if (saveInFlight) await saveInFlight;
  if (!state.id || !state.dirty) return true;
  const draft = noteDraft();
  state.dirty = false;
  titleDirty = bodyDirty = false;
  setSaved('正在保存…', 'saving');
  const save = (async () => {
    try {
      const result = await window.suira.notes.update(draft);
      if (!result?.ok) throw new Error(result?.error || '保存失败');
      state.source = result.note || {...state.source, ...draft};
      if (!state.dirty) setSaved('已保存');
      showError('');
      return true;
    } catch (error) {
      state.dirty = true;
      titleDirty ||= Object.hasOwn(draft, 'title');
      bodyDirty ||= Object.hasOwn(draft, 'text');
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

const formats = [...document.querySelectorAll('[data-format]')];
let editor;
function renderFormats() {
  if (!editor) return;
  const styles = {large:['heading',{level:1}], small:['heading',{level:2}], body:['paragraph']};
  for (const button of formats) {
    const type = button.dataset.format;
    button.setAttribute('aria-pressed', String(editor.active(...(styles[type] || [type]))));
  }
}

async function boot() {
  const body = $('#note-body');
  const title = $('#note-page-title');
  const update = () => {
    editVersion += 1;
    state.dirty = true;
    const text = editor.text();
    renderCount(text);
    const first = text.split(/\r?\n/).find(line => line.trim())?.trim();
    $('#note-title').textContent = (title.value.trim() || first || '随序速记').slice(0, 120);
    scheduleSave();
  };
  editor = window.SuiraNoteEditor({element:body, onSelection:renderFormats,
    onChange:() => {
      bodyDirty = true;
      update();
      body.dispatchEvent(new Event('note-input'));
    },
    onLimit:() => showError('速记正文最多 2 万字，请删减内容后再试。')});
  title.addEventListener('input', () => { titleDirty = true; update(); });
  title.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); editor.focusEnd(); }
  });
  // Mouse clicks keep the selected text. Tab and Enter can also reach each tool.
  $('.note-format').addEventListener('mousedown', event => {
    if (event.target.closest('button')) event.preventDefault();
  });
  for (const button of formats) button.addEventListener('click', () => editor.command(button.dataset.format));
  $('#note-attach').addEventListener('click', async () => {
    const button = $('#note-attach');
    button.disabled = true;
    try {
      const file = await window.suira.notes.pickFile();
      if (file) {
        if (file.length <= 4096 && /^[a-z]:[\\/]/i.test(file)) editor.attach(file);
        else showError('请选择本机磁盘上的文件。');
      }
    } catch { showError('无法选择附件。'); }
    finally { button.disabled = false; }
  });
  body.addEventListener('note-file-error', event => showError(event.detail));
  const ledger = $('#note-ledger-dialog');
  const form = $('#note-ledger-form');
  $('#note-ledger').addEventListener('click', () => { form.reset(); ledger.showModal(); });
  $('#note-ledger-cancel').addEventListener('click', () => ledger.close());
  form.addEventListener('submit', event => {
    event.preventDefault();
    const fields = new FormData(form);
    const memo = String(fields.get('memo') || '').trim();
    const date = new Date().toLocaleDateString('zh-CN');
    const amount = Number(fields.get('amount')).toFixed(2);
    ledger.close();
    editor.ledger(`${date} · ${fields.get('kind')} ¥${amount}${memo ? ` · ${memo}` : ''}`);
  });
  async function flushBeforeSwitch() {
    while (state.dirty || saveInFlight) {
      clearTimeout(saveTimer);
      if (saveInFlight) {
        const ok = await saveInFlight;
        if (!ok) return false;
        continue;
      }
      if (!(await pushText())) return false;
    }
    return true;
  }
  async function switchToNote(noteOrId, { focus = true, token = ++switchRevision, autoIndex = false } = {}) {
    const fromId = state.id;
    const versionBefore = editVersion;
    const targetId = typeof noteOrId === 'string' ? noteOrId : noteOrId?.id;
    const finishSameNote = async () => {
      if (!$('#note-index').hidden) {
        try { indexNotes = await window.suira.notes.list(); } catch {}
        if (token === switchRevision) renderIndex();
      }
      const active = document.activeElement;
      const inEditor = active === $('#note-page-title') || $('#note-body')?.contains(active);
      if (focus && token === switchRevision && !inEditor) editor.focusEnd();
      return true;
    };
    if (fromId && targetId && fromId === targetId && (state.dirty || saveInFlight)) {
      return finishSameNote();
    }
    const note = typeof noteOrId === 'string'
      ? await window.suira.notes.get(noteOrId)
      : noteOrId;
    if (token !== switchRevision) return false;
    if (!note) throw new Error('这条速记已不存在');
    if (state.id && state.id === note.id && (state.dirty || saveInFlight || editVersion !== versionBefore)) {
      return finishSameNote();
    }
    // Flush any edits typed into the old note while the open/get IPC was in flight.
    if (state.id && state.id !== note.id && (state.dirty || saveInFlight)) {
      const flushed = await flushBeforeSwitch();
      if (token !== switchRevision) return false;
      if (!flushed) {
        window.suira.notes.open?.(state.id).catch?.(() => {});
        return false;
      }
    }
    if (token !== switchRevision) return false;
    clearTimeout(saveTimer);
    state.dirty = false;
    titleDirty = bodyDirty = false;
    renderNote(note);
    setSaved('已保存');
    showError('');
    if (autoIndex && innerWidth >= 620) {
      await openIndex();
    } else if (!$('#note-index').hidden) {
      try {
        indexNotes = await window.suira.notes.list();
      } catch {}
      if (token === switchRevision) renderIndex();
    }
    if (focus && token === switchRevision) editor.focusEnd();
    return true;
  }
  $('#note-search').addEventListener('input', renderIndex);
  $('#note-pages').addEventListener('click', async event => {
    const button = event.target.closest('[data-id]');
    if (!button) return;
    const token = ++switchRevision;
    const fromId = state.id;
    const targetId = button.dataset.id;
    if (!(await flushBeforeSwitch()) || token !== switchRevision) return;
    const versionBefore = editVersion;
    if (innerWidth < 581) closeIndex();
    try {
      const result = await window.suira.notes.open(targetId);
      if (token !== switchRevision) return;
      if (!result?.ok) throw new Error(result?.error || '打开失败');
      if (targetId !== fromId) {
        if (editVersion !== versionBefore || state.dirty) {
          if (!(await flushBeforeSwitch()) || token !== switchRevision) {
            if (fromId) window.suira.notes.open?.(fromId).catch?.(() => {});
            return;
          }
        }
        await switchToNote(result.note || targetId, { token });
      } else {
        editor.focusEnd();
      }
    } catch (error) { showError(error.message || '打开失败'); }
  });

  // Esc 逐级返回：先收「全部速记」浮层，再收窗口。
  // 收窗前会补一次保存，不会丢掉刚敲进去的字。
  // 挂 document 而不是 textarea：打开「全部速记」后焦点仍在按钮上，
  // 只监听 textarea 会让 Esc 完全失效。
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (event.isComposing || ledger.open) return;
    event.preventDefault();
    if (!$('#note-index').hidden) closeIndex();
    else closeWindow();
  });

  $('#note-index-btn').addEventListener('click', () => toggleIndex());
  matchMedia('(max-width: 580px)').addEventListener('change', ({matches}) => {
    if (matches && !$('#note-index').hidden) closeIndex();
  });

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
      $('#note-meta-pin').hidden = !state.pinned;
    } catch (error) {
      showError(error.message || '切换失败');
    }
  });

  const createPage = async () => {
    const token = ++switchRevision;
    const fromId = state.id;
    if (!(await flushBeforeSwitch()) || token !== switchRevision) return;
    const versionBefore = editVersion;
    try {
      const result = await window.suira.notes.create();
      if (token !== switchRevision) return;
      if (result?.ok === false) throw new Error(result.error || '新建失败');
      const created = result?.note || (result?.id && result.id !== fromId ? result.id : null);
      if (created) {
        if (editVersion !== versionBefore || state.dirty) {
          if (!(await flushBeforeSwitch()) || token !== switchRevision) {
            if (fromId) window.suira.notes.open?.(fromId).catch?.(() => {});
            return;
          }
        }
        await switchToNote(created, { token });
      }
    } catch (error) {
      showError(error.message || '新建失败');
    }
  };
  $('#note-new').addEventListener('click', createPage);
  $('#note-new-page').addEventListener('click', createPage);

  $('#note-delete').addEventListener('click', async () => {
    // 删除不可撤销：先确认，再删除（速记没有回收站）
    if (!window.confirm('删除这条速记？删除后无法恢复。')) return;
    const token = ++switchRevision;
    try {
      const result = await window.suira.notes.remove(state.id);
      if (!result || result.ok === false) throw new Error((result && result.error) || '删除失败');
      clearTimeout(saveTimer);
      state.dirty = false;
      titleDirty = bodyDirty = false;
      if (result.nextNote || result.nextId) {
        await switchToNote(result.nextNote || result.nextId, { token });
      } else {
        await window.suira.notes.hideWindow();
      }
    } catch (error) {
      showError(error.message || '删除失败');
    }
  });

  // 主进程建好窗口或复用窗口切页时把 noteId 送过来，切页前必须先落盘当前草稿
  window.suira.notes.onOpened(async (payload) => {
    const id = payload && payload.id;
    if (!id) { showError('未拿到速记编号'); return; }
    const token = ++switchRevision;
    const fromId = state.id;
    if (fromId && fromId !== id && (state.dirty || saveInFlight)) {
      const flushed = await flushBeforeSwitch();
      if (token !== switchRevision) return;
      if (!flushed) {
        window.suira.notes.open?.(fromId).catch?.(() => {});
        return;
      }
    }
    try {
      await switchToNote(id, { token, autoIndex: !fromId });
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
    if (!state.dirty && !saveInFlight && (mine.text !== state.source?.text || mine.richText !== state.source?.richText || mine.customTitle !== state.source?.customTitle)) renderNote(mine);
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
  $('#note-index-count').textContent = String(indexNotes.length);
  const activeIdx = indexNotes.findIndex((entry) => entry.id === state.id);
  if (activeIdx >= 0) $('#note-meta-page').textContent = `第 ${activeIdx + 1} 页`;
  const list = $('#note-pages');
  const scroll = list.scrollTop;
  const focusedId = list.contains(document.activeElement) ? document.activeElement.dataset.id : '';
  list.innerHTML = notes.length ? notes.map(({note,page}) => {
    const text = (note.text || '').trim();
    const preview = (note.customTitle ? text : text.split(/\r?\n/).slice(1).join(' ')).trim();
    const tone = noteToneIndex(note.id);
    const metaLabel = text.length ? `${text.length} 字` : '空白';
    return `<button type="button" data-id="${escapeHtml(note.id)}" data-tone="${tone}" aria-current="${note.id === state.id}">
      <div class="note-page-top">
        <span class="note-page-pill">第 ${page} 页${note.pinned ? ' · 置顶' : ''}</span>
        <span class="note-page-chars">${escapeHtml(metaLabel)}</span>
      </div>
      <b>${escapeHtml(text || note.customTitle ? note.title : '新页面')}</b>
      <span class="note-page-preview">${escapeHtml((preview || (text ? '无摘要' : '空白页面')).slice(0, 100))}</span>
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

window.NoteUI={text:()=>editor.text(), flush:async()=>{ clearTimeout(saveTimer); if (!(await pushText())) throw Error('速记保存失败'); }};
boot();
