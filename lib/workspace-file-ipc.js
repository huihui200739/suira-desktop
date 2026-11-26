'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { calendarICS } = require('./calendar-export');
const { validateImageBuffer } = require('./markdown-files');

function registerWorkspaceFileIpc({
  handle, store, workspace, markdownFiles, removalUndo, broadcast, senderWindow, dialog, createExportWindow, exportPage,
  clipboard, nativeImage, addImageToStore, addImageBufferToStore, activeDocuments
}) {
  async function saveChange(result) {
    await store.save();
    broadcast('content:changed');
    return result;
  }

  handle('workspace:folders', () => markdownFiles.mountedFolders());
  handle('workspace:open-folder', async (event, options = {}) => {
    try {
      let target = '';
      let expectedRealPath = '';
      if (options && options.refresh && typeof options.folder === 'string') {
        const mounted = markdownFiles.mountedFolders();
        const match = mounted.find(dir => dir.toLowerCase() === options.folder.replaceAll('/', path.sep).toLowerCase());
        if (!match) return { ok: false, error: '该文件夹尚未挂载' };
        target = match;
        expectedRealPath = match;
      } else {
        const picked = await dialog.showOpenDialog(senderWindow(event), {
          title: '打开本地 Markdown 文件夹',
          properties: ['openDirectory']
        });
        if (picked.canceled || !picked.filePaths?.length) return { ok: false, canceled: true };
        target = picked.filePaths[0];
      }
      const res = await markdownFiles.openFolder(target, { expectedRealPath });
      broadcast('content:changed');
      return { ok: true, ...res };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  handle('workspace:unmount-folder', async (_event, folderPath) => {
    try {
      return { ok: true, ...(await markdownFiles.unmountFolder(String(folderPath || ''))) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  handle('workspace:create-in-folder', async (_event, payload = {}) => {
    try {
      const res = await markdownFiles.createInFolder(String(payload.folder || ''), String(payload.title || '未命名文档'));
      broadcast('content:changed');
      return { ok: true, ...res };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  handle('workspace:paste-image', async (event, payload = {}) => {
    try {
      const id = String(payload?.id || '');
      if (typeof payload?.discardRelativePath === 'string' && payload.discardRelativePath) {
        const res = typeof markdownFiles.discardAssetImage === 'function'
          ? await markdownFiles.discardAssetImage(id, payload.discardRelativePath)
          : { discarded: false };
        return { ok: true, ...res };
      }
      const item = store.getItem(id);
      if (item?.meta?.workspace !== 'markdown') return { ok: false, error: '请先打开 Markdown 文档' };
      const active = activeDocuments?.get(event.sender.id);
      if (active && active.id && active.id !== id) return { ok: false, error: '当前文档已切换，请重试' };
      let buffer = null;
      let ext = 'png';
      let info = null;
      let nativeImg = null;
      if (typeof payload?.dataUrl === 'string' && payload.dataUrl.startsWith('data:image/')) {
        const match = payload.dataUrl.match(/^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/);
        if (!match) return { ok: false, error: '不支持的图片粘贴格式' };
        ext = match[1] === 'jpeg' ? 'jpg' : match[1];
        if (match[2].length > 4.2 * 1024 * 1024) return { ok: false, error: '图片过大（需在 3 MB 以内）' };
        buffer = Buffer.from(match[2], 'base64');
        info = validateImageBuffer(buffer, ext);
        if (nativeImage?.createFromBuffer && ['png', 'jpg'].includes(ext)) {
          nativeImg = nativeImage.createFromBuffer(buffer);
          if (nativeImg.isEmpty()) return { ok: false, error: '粘贴的图片数据已损坏' };
          const sz = nativeImg.getSize();
          if (sz.width < 1 || sz.height < 1 || sz.width > 16384 || sz.height > 16384 || sz.width * sz.height > 40_000_000) {
            return { ok: false, error: '图片尺寸超出上限' };
          }
        }
      } else if (clipboard?.readImage) {
        const img = clipboard.readImage();
        if (!img || img.isEmpty()) return { ok: false, empty: true, error: '剪贴板里没有图片' };
        const sz = img.getSize();
        if (sz.width < 1 || sz.height < 1 || sz.width > 16384 || sz.height > 16384 || sz.width * sz.height > 40_000_000) {
          return { ok: false, error: '图片尺寸超出上限' };
        }
        nativeImg = img;
        buffer = img.toPNG();
        ext = 'png';
        info = validateImageBuffer(buffer, ext);
      } else {
        return { ok: false, empty: true, error: '当前环境不支持读取图片剪贴板' };
      }
      const alt = String(payload?.alt || '图片').replace(/[\r\n\]\\]/g, '').trim().slice(0, 60) || '图片';
      if (item.meta.externalPath) {
        const saved = await markdownFiles.saveAssetImage(id, buffer, ext);
        return { ok: true, markdown: `![${alt}](${saved.relativePath})`, url: saved.relativePath, relativePath: saved.relativePath, alt, savedTo: 'assets' };
      }
      const srcMeta = { type: 'clipboard', acquisitionMethod: 'markdown-paste', confidence: 'certain' };
      let stored = null;
      if (nativeImg && typeof addImageToStore === 'function') {
        stored = await addImageToStore(nativeImg, srcMeta, alt);
      } else if (typeof addImageBufferToStore === 'function') {
        stored = await addImageBufferToStore(buffer, ext, info, srcMeta, alt);
      } else {
        return { ok: false, error: '打开本地 Markdown 文件后可自动保存图片到 assets/' };
      }
      if (!stored) return { ok: false, error: '图片保存失败' };
      const url = `suira-image://${stored.id}`;
      return { ok: true, markdown: `![${alt}](${url})`, url, alt, savedTo: 'suira' };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  handle('workspace:save', async (_event, type, payload) => {
    try {
      const item = workspace.save(type, payload);
      return await saveChange({ ok: true, item });
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  handle('workspace:remove', async ({ sender }, type, id) => {
    try {
      if (type === 'calendar') {
        if (store.getItem(id)?.meta?.workspace !== type) throw Error('日程不存在');
        return await removalUndo.remove(sender, id);
      }
      workspace.remove(type, id);
      return await saveChange({ ok: true });
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  handle('workspace:import', async event => {
    const result = await dialog.showOpenDialog(senderWindow(event), {
      title: '打开 Markdown',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
      properties: ['openFile']
    });
    if (result.canceled) return { ok: false, canceled: true };
    try {
      const file = result.filePaths[0];
      if (/\.(md|markdown)$/i.test(file)) {
        const opened = await markdownFiles.open(file);
        broadcast('content:changed');
        return { ok: true, ...opened };
      }
      if ((await fsp.stat(file)).size > 800000) throw Error('文件过大，请选择 800 KB 以内的文档');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await fsp.readFile(file));
      const item = workspace.save('markdown', { title: path.basename(file, path.extname(file)), text });
      return await saveChange({ ok: true, item });
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  handle('workspace:export', async (event, id, format = 'md') => {
    const item = store.getItem(String(id));
    if (item?.meta?.workspace !== 'markdown') return { ok: false, error: '文档不存在' };
    if (!['md', 'html', 'pdf'].includes(format)) return { ok: false, error: '不支持的导出格式' };
    const result = await dialog.showSaveDialog(senderWindow(event), {
      title: '导出文档',
      defaultPath: `${item.title.replace(/[\\/:*?"<>|]/g, '_')}.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }]
    });
    if (result.canceled) return { ok: false, canceled: true };
    let render;
    try {
      let data = item.text;
      if (format !== 'md') {
        render = createExportWindow();
        await render.loadFile(exportPage);
        const document = JSON.stringify({ title: item.title, text: item.text });
        const html = await render.webContents.executeJavaScript(`window.renderExport(${document})`);
        data = format === 'pdf' ? await render.webContents.printToPDF({ printBackground: true, pageSize: 'A4' }) : html;
      }
      await fsp.writeFile(result.filePath, data);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    } finally {
      if (render && !render.isDestroyed()) render.destroy();
    }
  });
  handle('workspace:calendar-export', async event => {
    const result = await dialog.showSaveDialog(senderWindow(event), {
      title: '导出日历',
      defaultPath: '随序日历.ics',
      filters: [{ name: 'iCalendar', extensions: ['ics'] }]
    });
    if (result.canceled) return { ok: false, canceled: true };
    try {
      await fsp.writeFile(result.filePath, calendarICS(workspace.list('calendar')), 'utf8');
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
}

module.exports = { registerWorkspaceFileIpc };
