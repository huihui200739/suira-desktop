'use strict';
const HISTORY_SOURCES = new Set(['clipboard', 'screenshot', 'scroll-capture', 'long-capture', 'ocr', 'derived', 'image-edit']);

function historyCleanup(items, tasks = []) {
  // Every record that survives cleanup must retain its source chain, not just
  // pinned/task records. parentIds is the canonical relationship; older records
  // can also carry a single originItemId in metadata.
  const referenced = new Set([
    ...tasks.flatMap(task => task.itemIds || []),
    ...items.filter(item => item.pinned || item.meta?.workspace || !HISTORY_SOURCES.has(item.source?.type)).map(item => item.id)
  ]);
  const byId = new Map(items.map(item => [item.id, item]));
  const pending = [...referenced];
  while (pending.length) {
    const item = byId.get(pending.pop());
    if (!item) continue;
    const parents = [...(item.parentIds || []), item.meta?.originItemId];
    for (const id of parents) {
      if (!id || referenced.has(id)) continue;
      referenced.add(id);
      pending.push(id);
    }
  }
  const removed = [], kept = [];
  for (const item of items) {
    if (HISTORY_SOURCES.has(item.source?.type) && !referenced.has(item.id)) removed.push(item);
    else kept.push(item);
  }
  return {
    removed,
    kept,
    protectedCount: items.filter(item => HISTORY_SOURCES.has(item.source?.type) && referenced.has(item.id)).length
  };
}
module.exports = { historyCleanup };
