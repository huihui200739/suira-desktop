'use strict';

const { randomUUID } = require('node:crypto');

const UNDO_MS = 30000;
const MAX_PER_SENDER = 10;

function createRemovalUndo({ store, onChange, onSaveError }) {
  const removed = new WeakMap();

  function expire(entries, entry) {
    if (!entries.delete(entry.token)) return;
    clearTimeout(entry.timer);
    entry.release();
    if (store.hasPendingImageCleanup()) store.save().catch(onSaveError);
  }

  function scheduleExpiration(entries, entry) {
    entry.timer = setTimeout(() => expire(entries, entry), Math.max(0, entry.expiresAt - Date.now()));
    entry.timer.unref();
  }

  async function remove(sender, id) {
    const snapshot = store.detachItem(id);
    if (!snapshot) return { ok: false, error: '内容不存在或已被清理' };
    const release = store.holdImage(snapshot.item);
    try {
      await store.save();
    } catch (error) {
      store.restoreDetachedItem(snapshot);
      release();
      throw error;
    }
    const entry = { token: randomUUID(), snapshot, expiresAt: Date.now() + UNDO_MS, release };
    const entries = removed.get(sender) || new Map();
    entries.set(entry.token, entry);
    removed.set(sender, entries);
    scheduleExpiration(entries, entry);
    if (entries.size > MAX_PER_SENDER) {
      const oldest = [...entries.values()].find(value => !value.restoring && value !== entry);
      if (oldest) expire(entries, oldest);
    }
    onChange();
    return { ok: true, token: entry.token, expiresAt: entry.expiresAt, taskCount: snapshot.memberships.length };
  }

  async function undo(sender, token) {
    const entries = removed.get(sender);
    const entry = entries?.get(token);
    if (!entry || entry.expiresAt <= Date.now()) return { ok: false, expired: true, error: '已超过撤销时间' };
    if (entry.restoring) return { ok: false, error: '正在恢复' };
    if (!store.restoreDetachedItem(entry.snapshot)) {
      expire(entries, entry);
      return { ok: false, expired: true, error: '这条内容已恢复' };
    }
    entry.restoring = true;
    clearTimeout(entry.timer);
    try {
      await store.save();
    } catch (error) {
      store.removeItem(entry.snapshot.item.id);
      entry.restoring = false;
      scheduleExpiration(entries, entry);
      throw error;
    }
    expire(entries, entry);
    onChange();
    return { ok: true };
  }

  return { remove, undo };
}

module.exports = { createRemovalUndo };
