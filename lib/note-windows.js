'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { sanitizeWindowBounds } = require('./display-geometry');
const { RICH_TEXT_LIMIT } = require('./notes');

const ROOT = path.resolve(__dirname, '..');
const SAVE_DEBOUNCE_MS = 700;
const BOUNDS_DEBOUNCE_MS = 500;

function createNoteWindows({ windowIpc, BrowserWindow, screen, dialog, shell,
  getStore, isQuitting, prepareFloatingSurface, broadcast, assetPath, onSaveError }) {
  const windows = new Map();
  let saveTimer = null;

  const broadcastNotes = () => broadcast('notes:changed', getStore()?.listNotes() ?? []);
  const activeWindows = () => Array.from(windows.values(), ({ win }) => win).filter(win => !win.isDestroyed());
  const owner = event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return activeWindows().includes(win) ? win : null;
  };

  function scheduleNoteSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      getStore()?.save().catch(onSaveError);
    }, SAVE_DEBOUNCE_MS);
    saveTimer.unref();
  }

  // The caller saves the shared store after flushing all window state.
  function flushBounds() {
    clearTimeout(saveTimer);
    saveTimer = null;
    for (const entry of windows.values()) entry.flushBounds();
  }

  function create(note) {
    const bounds = sanitizeWindowBounds(note.bounds, screen.getAllDisplays(), {
      width: 760, height: 550, minVisibleWidth: 160, minVisibleHeight: 120
    });
    const win = windowIpc.create('notes', {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      minWidth: 240,
      minHeight: 200,
      show: false,
      frame: false,
      thickFrame: false,
      hasShadow: false,
      alwaysOnTop: Boolean(note.pinned),
      transparent: true,
      backgroundColor: '#00000000',
      title: '随序 · 速记',
      icon: assetPath('suira-icon-runtime.png'),
      roundedCorners: true,
      skipTaskbar: false,
      webPreferences: {
        preload: path.join(ROOT, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false
      }
    });

    let currentNoteId = note.id;
    let boundsTimer = null;
    const flushBounds = () => {
      clearTimeout(boundsTimer);
      boundsTimer = null;
      if (!win.isDestroyed() && currentNoteId) getStore()?.setNoteBounds(currentNoteId, win.getBounds());
    };
    const rememberBounds = () => {
      clearTimeout(boundsTimer);
      boundsTimer = setTimeout(() => {
        if (win.isDestroyed() || isQuitting()) return;
        flushBounds();
        scheduleNoteSave();
      }, BOUNDS_DEBOUNCE_MS);
      boundsTimer.unref();
    };
    const entry = {
      win,
      flushBounds,
      getNoteId: () => currentNoteId,
      switchNote: (nextNote) => {
        if (!nextNote || win.isDestroyed()) return;
        flushBounds();
        if (windows.get(currentNoteId) === entry) windows.delete(currentNoteId);
        currentNoteId = nextNote.id;
        windows.set(currentNoteId, entry);
        win.setAlwaysOnTop(Boolean(nextNote.pinned), 'floating');
      }
    };
    prepareFloatingSurface(win, 22);
    windows.set(currentNoteId, entry);
    win.on('resize', rememberBounds);
    win.on('move', rememberBounds);
    win.on('close', () => {
      if (win.isDestroyed() || isQuitting()) return; // Already captured by the quit/update preflight.
      flushBounds();
      getStore()?.save().catch(onSaveError);
    });
    let revealed = false;
    const reveal = () => {
      if (revealed || win.isDestroyed()) return;
      revealed = true;
      clearTimeout(revealTimer);
      win.show();
      win.focus();
    };
    const revealTimer = setTimeout(reveal, 2500);
    revealTimer.unref();
    win.once('ready-to-show', reveal);
    win.on('closed', () => {
      clearTimeout(revealTimer);
      clearTimeout(boundsTimer);
      if (windows.get(currentNoteId) === entry) windows.delete(currentNoteId);
      if (!isQuitting()) scheduleNoteSave();
      broadcastNotes();
    });
    win.setMenuBarVisibility(false);
    win.webContents.once('did-finish-load', () => win.webContents.send('notes:opened', { id: currentNoteId }));
    win.loadFile(path.join(ROOT, 'src', 'notes.html'));
    return win;
  }

  function findEntryByWin(win) {
    if (!win || win.isDestroyed()) return null;
    for (const entry of windows.values()) {
      if (entry.win === win) return entry;
    }
    return null;
  }

  function open(noteId, senderWin = null) {
    const store = getStore();
    if (!store) return { ok: false, error: '数据未就绪' };
    const note = store.getNote(noteId);
    if (!note) return { ok: false, error: '这条速记已不存在' };
    const existing = windows.get(noteId)?.win;
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return { ok: true, id: noteId, note, inPlace: existing === senderWin };
    }
    const senderEntry = findEntryByWin(senderWin);
    if (senderEntry) {
      senderEntry.switchNote(note);
      return { ok: true, id: noteId, note, inPlace: true };
    }
    const reusable = Array.from(windows.values()).find(({ win }) => !win.isDestroyed());
    if (reusable) {
      reusable.switchNote(note);
      if (reusable.win.isMinimized()) reusable.win.restore();
      reusable.win.show();
      reusable.win.focus();
      reusable.win.webContents.send('notes:opened', { id: note.id });
      return { ok: true, id: noteId, note, inPlace: true };
    }
    create(note);
    return { ok: true, id: noteId, note, inPlace: false };
  }

  async function createAndOpen(senderWin = null) {
    const store = getStore();
    if (!store) return { ok: false, error: '数据未就绪' };
    const note = store.createNote({ text: '' });
    if (!note) return { ok: false, error: '速记创建失败' };
    await store.save();
    broadcastNotes();
    return open(note.id, senderWin);
  }

  function openLatest() {
    const existing = Array.from(windows.values()).find(({ win }) => !win.isDestroyed());
    if (existing) {
      if (existing.win.isMinimized()) existing.win.restore();
      existing.win.show();
      existing.win.focus();
      return { ok: true, id: existing.getNoteId(), inPlace: true };
    }
    const latest = getStore()?.latestNote();
    return latest ? open(latest.id) : createAndOpen();
  }

  function registerIpc() {
    const { handle } = windowIpc;
    handle('notes:list', () => getStore()?.listNotes() ?? []);
    handle('notes:get', (_event, id) => getStore()?.getNote(String(id || '')) ?? null);
    handle('notes:open', (event, id) => open(String(id || ''), owner(event)));
    handle('notes:open-latest', openLatest);
    handle('notes:create', (event) => createAndOpen(owner(event)));
    handle('notes:update', async (_event, payload) => {
      const store = getStore();
      const id = String(payload?.id || '');
      if (!store || !id) return { ok: false, error: '参数不完整' };
      if (typeof payload?.richText === 'string' && payload.richText.length > RICH_TEXT_LIMIT) {
        return {ok:false, error:'格式内容超过速记容量，请删减后保存。'};
      }
      const prev = store.getNote(id);
      if (!prev) return { ok: false, error: '这条速记已不存在' };
      const snapshot = { ...prev };
      const note = store.updateNoteText(id, payload?.text, payload?.title, payload?.richText);
      if (!note) return { ok: false, error: '这条速记已不存在' };
      clearTimeout(saveTimer);
      saveTimer = null;
      try {
        await store.save();
      } catch (error) {
        const list = store.data?.notes;
        const idx = Array.isArray(list) ? list.findIndex((entry) => entry.id === id) : -1;
        if (idx >= 0) list[idx] = snapshot;
        onSaveError?.(error);
        return { ok: false, error: error?.message || '保存失败' };
      }
      // 同屏开着多个速记窗口时，列表与其它窗口也要看到最新正文
      broadcastNotes();
      return { ok: true, note };
    });
    handle('notes:pick-file', async (event) => {
      const win = owner(event);
      if (!win) return null;
      const result = await dialog.showOpenDialog(win, {title:'引用本地文件', properties:['openFile']});
      return result.canceled ? null : result.filePaths[0];
    });
    handle('notes:reveal-file', async (event, file) => {
      const win = owner(event);
      // Only reveal local drive paths. Network shares and device paths are excluded.
      if (!win || typeof file !== 'string' || !/^[a-z]:[\\/]/i.test(file)) {
        return {ok:false, error:'无法定位该本地文件。'};
      }
      const stat = await fs.stat(file).catch(() => null);
      if (!stat?.isFile()) return {ok:false, error:'找不到原文件，它可能已被移动。'};
      shell.showItemInFolder(file);
      return {ok:true};
    });
    handle('notes:toggle-pin', async (_event, id) => {
      const noteId = String(id || '');
      const store = getStore();
      if (!store) return { ok: false, error: '数据未就绪' };
      const note = store.toggleNotePin(noteId);
      if (!note) return { ok: false, error: '这条速记已不存在' };
      const win = windows.get(noteId)?.win;
      if (win && !win.isDestroyed()) {
        win.setAlwaysOnTop(Boolean(note.pinned), 'floating');
        if (note.pinned) { win.show(); win.focus(); }
      }
      await store.save();
      broadcastNotes();
      return { ok: true, note };
    });
    handle('notes:delete', async (event, id) => {
      const noteId = String(id || '');
      const store = getStore();
      if (!store) return { ok: false, error: '数据未就绪' };
      const entry = windows.get(noteId);
      const removed = store.deleteNote(noteId);
      await store.save();
      const remaining = store.listNotes();
      const next = remaining[0] || null;
      const senderWin = owner(event);
      if (entry && !entry.win.isDestroyed()) {
        if (next && entry.win === senderWin) {
          entry.switchNote(next);
        } else {
          entry.win.close();
        }
      }
      broadcastNotes();
      return { ok: Boolean(removed), nextId: next?.id || '', nextNote: next };
    });
    handle('notes:hide-window', (event) => {
      const win = owner(event);
      if (win && !win.isDestroyed()) win.close();
      return { ok: true };
    });
    handle('notes:minimize-window', (event) => {
      const win = owner(event);
      if (win && !win.isDestroyed()) win.minimize();
      return { ok: true };
    });
  }

  return { activeWindows, flushBounds, openLatest, registerIpc };
}

module.exports = { createNoteWindows };
