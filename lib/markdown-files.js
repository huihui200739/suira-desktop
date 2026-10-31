'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const MAX_BYTES = 800000;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const identity = value => process.platform === 'win32' ? value.toLowerCase() : value;
function markdownPaths(args, cwd = process.cwd()) {
  let literal = false;
  return [...new Set(args.flatMap(value => {
    if (value === '--') { literal = true; return []; }
    if (typeof value !== 'string' || (!literal && value.startsWith('-')) || !/\.(md|markdown)$/i.test(value) || /^\w+:\/\//.test(value)) return [];
    return [path.resolve(cwd, value)];
  }))];
}
async function readMarkdown(file) {
  const canonical = await fs.realpath(file);
  if (!/\.(md|markdown)$/i.test(canonical)) throw Error('请选择 .md 或 .markdown 文件');
  const handle = await fs.open(canonical, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES) throw Error('请选择 800 KB 以内的 Markdown 文件');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_BYTES) throw Error('Markdown 文件过大');
    const raw = buffer.subarray(0, bytesRead);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(raw).replace(/^\uFEFF/, ''); }
    catch { throw Error('此文件不是有效的 UTF-8 文本，请先转换编码后打开'); }
    if (text.includes('\0') || text.length > 200000) throw Error('文件内容不受支持或超过 20 万字符');
    return { canonical, text, sourceHash: hash(raw), textHash: hash(text), mode: stat.mode };
  } finally { await handle.close(); }
}
function createMarkdownFiles(store, workspace) {
  let saveChain = Promise.resolve();
  return {
    async open(file) {
      const loaded = await readMarkdown(file);
      const previous = workspace.list('markdown').find(item => item.meta.externalPath && identity(item.meta.externalPath) === identity(loaded.canonical));
      if (previous && hash(previous.text) !== previous.meta.externalTextHash) return { item: previous, recovered: true };
      const item = workspace.save('markdown', { id: previous?.id, title: path.basename(loaded.canonical, path.extname(loaded.canonical)), text: loaded.text });
      Object.assign(item.meta, { externalPath: loaded.canonical, externalHash: loaded.sourceHash, externalTextHash: loaded.textHash });
      await store.save(); return { item, recovered: false };
    },
    save(id) {
      const job = saveChain.catch(() => {}).then(() => saveOriginal(id));
      saveChain = job;
      return job;
    }
  };
  async function saveOriginal(id) {
      const item = store.getItem(id);
      if (item?.meta?.workspace !== 'markdown' || !item.meta.externalPath) throw Error('文档没有关联本地文件');
      const text = item.text;
      const original = await readMarkdown(item.meta.externalPath);
      if (original.sourceHash !== item.meta.externalHash) throw Error('文件已被其他程序修改，未覆盖原文件；请导出草稿副本后比较');
      const temp = path.join(path.dirname(original.canonical), '.' + path.basename(original.canonical) + '.suira-' + crypto.randomBytes(8).toString('hex') + '.tmp');
      try {
        await fs.writeFile(temp, text, { flag: 'wx', mode: original.mode });
        // Recheck immediately before replacement; keep the draft on any failure.
        if ((await readMarkdown(original.canonical)).sourceHash !== original.sourceHash) throw Error('文件刚被其他程序修改，未覆盖原文件');
        await fs.rename(temp, original.canonical);
        const current = store.getItem(id);
        if (current?.meta.externalPath === item.meta.externalPath) {
          current.meta.externalHash = hash(text); current.meta.externalTextHash = hash(text);
        }
        await store.save(); return { item: current || item };
      } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
  }
}
module.exports = { markdownPaths, readMarkdown, createMarkdownFiles };
