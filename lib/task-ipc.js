'use strict';

const path = require('node:path');
const { writeFile } = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

function registerTaskIpc({ handle, store, onChange, copyText, chooseExportPath, documentsPath }) {
  const findTask = id => store.getTask(String(id || ''));
  const taskItems = task => task.itemIds.map(id => store.getItem(id)).filter(Boolean);
  const saveChange = async result => {
    await store.save();
    onChange();
    return result;
  };

  handle('tasks:list', (_event, options) => store.listTasks(options || {}));
  handle('tasks:status', (_event, payload) => {
    const task = store.updateTask(String(payload?.id || ''), { progress: payload?.done ? 'done' : 'idle' });
    return saveChange({ ok: Boolean(task) });
  });
  handle('tasks:create', (_event, title) => {
    const task = store.createTask(String(title || '临时收集').trim().slice(0, 120) || '临时收集');
    return saveChange({ ok: true, task });
  });
  handle('tasks:rename', (_event, payload) => {
    const task = store.updateTask(String(payload?.id || ''), { title: payload?.title });
    return saveChange({ ok: Boolean(task), task });
  });
  handle('tasks:delete', (_event, id) => {
    const task = store.deleteTask(String(id || ''));
    return saveChange({ ok: Boolean(task) });
  });
  handle('tasks:add-item', (_event, payload) => {
    const task = store.addItemToTask(String(payload?.taskId || ''), String(payload?.itemId || ''));
    return saveChange({ ok: Boolean(task), task });
  });
  handle('tasks:remove-item', (_event, payload) => {
    const task = store.removeItemFromTask(String(payload?.taskId || ''), String(payload?.itemId || ''));
    return saveChange({ ok: Boolean(task), task });
  });
  handle('tasks:copy-text', async (_event, taskId) => {
    const task = findTask(taskId);
    if (!task) return { ok: false, error: '任务不存在' };
    const text = taskItems(task).map(item => item.text || item.filePath || item.title).join('\n\n');
    if (!text.trim()) return { ok: false, error: '任务里没有可复制的文字' };
    await copyText(text);
    return { ok: true, text };
  });
  handle('tasks:export', async (_event, taskId) => {
    const task = findTask(taskId);
    if (!task) return { ok: false, error: '任务不存在' };
    const result = await chooseExportPath({
      title: '导出任务匣',
      defaultPath: path.join(documentsPath(), `随序任务-${task.title.replace(/[\\/:*?"<>|]/g, '_')}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const lines = [`# ${task.title}`, '', `导出时间：${new Date().toLocaleString('zh-CN')}`, ''];
    for (const item of taskItems(task)) {
      lines.push(`## ${item.title}`, '');
      if (item.text) lines.push(item.text, '');
      if (item.filePath) lines.push(`文件：${item.filePath}`, '');
      if (item.kind === 'image' && item.filePath) lines.push(`![${item.title}](${pathToFileURL(item.filePath).href})`, '');
    }
    await writeFile(result.filePath, lines.join('\n'), 'utf8');
    return { ok: true, filePath: result.filePath };
  });
}

module.exports = { registerTaskIpc };
