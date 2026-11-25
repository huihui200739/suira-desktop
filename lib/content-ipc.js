'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { historyCleanup } = require('./history-cleanup');

function registerContentIpc({ handle, store, removalUndo, broadcast, classifyText, thumbnailFor, nativeImage, shell }) {
  handle('content:undo-remove', ({ sender }, token) => removalUndo.undo(sender, token));
  handle('content:list', async (_event, options) => {
    const items = store.listItems(options || {});
    // 图片条目若缺缩略图（旧数据或生成失败），按需补齐，避免列表出现空白卡
    for (const item of items) {
      if (item.kind === 'image' && !item.thumbnail && item.filePath) {
        const thumbnail = thumbnailFor(item.filePath);
        if (thumbnail) item.thumbnail = thumbnail;
      }
    }
    if (options?.cardDetails === true) {
      // 补齐旧条目的原图信息，进程内缓存成功结果，无需迁移或写盘。
      await Promise.all(items.filter(item => item.kind === 'image' && item.filePath &&
        (!Number.isFinite(item.meta?.byteSize) || !item.meta?.width || !item.meta?.height)).map(async item => {
        const original = await fsp.stat(item.filePath).catch(() => null);
        if (!original?.isFile()) return;
        item.meta.byteSize = original.size;
        if (!item.meta.width || !item.meta.height) {
          const image = nativeImage.createFromPath(item.filePath);
          if (!image.isEmpty()) Object.assign(item.meta, image.getSize());
        }
      }));
    }
    return items;
  });
  handle('content:get', (_event, id) => store.getItem(String(id || '')));
  handle('content:add-text', async (_event, payload) => {
    const value = String(payload?.text || '').trim();
    if (!value) return { ok: false, error: '文字为空' };
    const item = store.addItem({
      kind: classifyText(value),
      title: payload?.title || value.slice(0, 42),
      text: value,
      source: { type: payload?.source || 'user', acquisitionMethod: 'manual', confidence: 'certain' }
    });
    await store.save();
    broadcast('content:changed', { itemId: item.id });
    return { ok: true, item };
  });
  handle('content:remove', async ({ sender }, id) => {
    const key = String(id || '');
    if (store.getItem(key)?.meta?.workspace) return { ok: false, error: '请在原工具中删除' };
    return removalUndo.remove(sender, key);
  });
  handle('content:toggle-pin', async (_event, id) => {
    const item = store.getItem(String(id || ''));
    if (!item) return { ok: false };
    item.pinned = !item.pinned;
    await store.save();
    broadcast('content:changed');
    return { ok: true, pinned: item.pinned };
  });

  /**
   * 打开某条内容的来源原图。
   * 识别结果（kind=text, meta.originItemId）指向它由哪张图片生成；
   * 图片本身没有 originItemId，直接开自己。
   */
  handle('content:open-original', async (_event, id) => {
    const item = store.getItem(String(id || ''));
    if (!item) return { ok: false, error: '内容不存在或已被清理' };
    const sourceId = item.meta?.originItemId || '';
    const source = sourceId ? store.getItem(sourceId) : item;
    const target = source || item;
    if (!target.filePath) return { ok: false, error: '这条内容没有来源图片' };
    if (!fs.existsSync(target.filePath)) return { ok: false, error: '原图文件已被移动或删除' };
    // 优先交给系统默认看图程序；失败再退到资源管理器定位
    const error = await shell.openPath(target.filePath);
    if (error) {
      shell.showItemInFolder(target.filePath);
      return { ok: true, fallback: true, message: '无法用默认程序打开，已在资源管理器中定位' };
    }
    return { ok: true };
  });

  // 清空剪贴板来源的内容（保留固定项与任务内引用）
  handle('content:clear-clipboard', async () => {
    const plan = historyCleanup(store.data.items, store.data.tasks);
    const items=plan.removed;
    const snapshots = items.map(item => store.detachItem(item.id)).filter(Boolean);
    try { await store.save(); }
    catch (error) {
      for (const snapshot of snapshots) store.restoreDetachedItem(snapshot);
      throw error;
    }
    broadcast('content:changed');
    return { ok: true, removed: items.length, protected: plan.protectedCount };
  });
}

module.exports = { registerContentIpc };
