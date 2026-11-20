'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { localImageReference, matchesImageType, maxLocalImageBytes, maxLocalImageReferences } = require('../vendor/miaoyan-windows/lib/preview.mjs');
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
    async previewImages(id, references) {
      const item = store.getItem(id);
      if (item?.meta?.workspace !== 'markdown' || !item.meta.externalPath || !Array.isArray(references)) return [];
      const root = path.dirname(item.meta.externalPath);
      if (root.startsWith('\\\\') || identity(await fs.realpath(root).catch(() => '')) !== identity(root)) return [];
      const images = [];
      let remaining = maxLocalImageBytes * 4;
      for (const url of new Set(references.slice(0, maxLocalImageReferences))) {
        if (remaining < 12) break;
        const reference = localImageReference(url);
        if (!reference) continue;
        try {
          const target = await fs.realpath(path.join(root, ...reference.parts));
          const relative = path.relative(root, target);
          if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) continue;
          const stat = await fs.stat(target);
          if (!stat.isFile() || stat.size < 12 || stat.size > Math.min(maxLocalImageBytes, remaining)) continue;
          const handle = await fs.open(target, 'r');
          try {
            const buffer = Buffer.alloc(stat.size);
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
            if (bytesRead !== stat.size || !matchesImageType(buffer, reference.type)) continue;
            remaining -= bytesRead;
            images.push({ url, data: `data:${reference.type};base64,${buffer.toString('base64')}` });
          } finally { await handle.close(); }
        } catch {
          // A missing or moved image leaves its alt text in place.
        }
      }
      return images;
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
