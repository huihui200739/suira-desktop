'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { calendarICS } = require('./calendar-export');

function registerWorkspaceFileIpc({
  handle, store, workspace, markdownFiles, removalUndo, broadcast, senderWindow, dialog, createExportWindow, exportPage
}) {
  async function saveChange(result) {
    await store.save();
    broadcast('content:changed');
    return result;
  }

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
