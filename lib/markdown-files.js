'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { validatePngBuffer } = require('./ocr');
const { localImageReference, matchesImageType, maxLocalImageBytes, maxLocalImageReferences } = require('../vendor/miaoyan-windows/lib/preview.mjs');
const MAX_BYTES = 800000;
const MAX_IMG_DIM = 16384;
const MAX_IMG_PIXELS = 40_000_000;
const MAX_FOLDER_DEPTH = 3;
const MAX_FOLDER_FILES = 200;
const MAX_MOUNTED_FOLDERS = 12;
const SKIP_DIRS = new Set(['node_modules', 'assets', '.git', '.svn', '.hg', '.obsidian', '.vscode']);
const IMAGE_MIMES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const RESERVED_WIN_NAME = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const identity = value => process.platform === 'win32' ? value.toLowerCase() : value;
function checkImageDims(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > MAX_IMG_DIM || height > MAX_IMG_DIM || width * height > MAX_IMG_PIXELS) {
    throw Error('图片尺寸超出上限或无效');
  }
}
function validateJpegBuffer(buffer) {
  if (buffer.length < 20 || buffer[0] !== 0xff || buffer[1] !== 0xd8) throw Error('JPEG 图片头无效');
  let offset = 2, sawSof = false, sawSos = false, sawEoi = false, width = 0, height = 0;
  while (offset + 1 < buffer.length) {
    if (buffer[offset] !== 0xff) throw Error('JPEG 数据结构已损坏');
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) break;
    const marker = buffer[offset++];
    if (marker === 0xd9) { sawEoi = true; break; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > buffer.length) throw Error('JPEG 数据段已截断');
    const segLen = buffer.readUInt16BE(offset);
    if (segLen < 2 || offset + segLen > buffer.length) throw Error('JPEG 数据段长度无效');
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (segLen < 7) throw Error('JPEG 帧头无效');
      width = buffer.readUInt16BE(offset + 5);
      height = buffer.readUInt16BE(offset + 3);
      checkImageDims(width, height);
      sawSof = true;
    }
    if (marker === 0xda) {
      sawSos = true;
      // Scan entropy-coded payload until unescaped EOI (FF D9)
      offset += segLen;
      while (offset + 1 < buffer.length) {
        if (buffer[offset] === 0xff && buffer[offset + 1] === 0xd9) { sawEoi = true; break; }
        offset += 1;
      }
      break;
    }
    offset += segLen;
  }
  if (!sawSof || !sawSos || !sawEoi) throw Error('JPEG 图片数据不完整');
  return { width, height };
}
function validateGifLzw(stream, minCodeSize, expectedPixels) {
  if (minCodeSize < 2 || minCodeSize > 8) throw Error('GIF 压缩参数无效');
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  let prevCode = -1;
  let bitPos = 0;
  const totalBits = stream.length * 8;
  const codeLengths = new Uint32Array(4096);
  for (let i = 0; i < clearCode; i += 1) codeLengths[i] = 1;
  let pixelCount = 0;
  let sawEoi = false;
  while (bitPos + codeSize <= totalBits) {
    let code = 0;
    for (let b = 0; b < codeSize; b += 1) {
      const idx = bitPos + b;
      if ((stream[idx >> 3] >> (idx & 7)) & 1) code |= 1 << b;
    }
    bitPos += codeSize;
    if (code === clearCode) {
      codeSize = minCodeSize + 1;
      nextCode = eoiCode + 1;
      prevCode = -1;
      continue;
    }
    if (code === eoiCode) {
      sawEoi = true;
      break;
    }
    if (code > nextCode || (code === nextCode && prevCode < 0)) {
      throw Error('GIF 压缩数据已损坏');
    }
    const len = code < nextCode ? codeLengths[code] : codeLengths[prevCode] + 1;
    if (!len) throw Error('GIF 压缩数据已损坏');
    pixelCount += len;
    if (pixelCount > expectedPixels) throw Error('GIF 像素数据溢出');
    if (prevCode >= 0 && nextCode < 4096) {
      codeLengths[nextCode] = codeLengths[prevCode] + 1;
      nextCode += 1;
      if (nextCode === (1 << codeSize) && codeSize < 12) codeSize += 1;
    }
    prevCode = code;
  }
  if (!sawEoi || pixelCount < expectedPixels) throw Error('GIF 压缩数据不完整或已损坏');
}
function validateGifBuffer(buffer) {
  if (buffer.length < 26) throw Error('GIF 图片数据不完整');
  const header = buffer.toString('latin1', 0, 6);
  if (header !== 'GIF87a' && header !== 'GIF89a') throw Error('GIF 文件头无效');
  const width = buffer.readUInt16LE(6), height = buffer.readUInt16LE(8);
  checkImageDims(width, height);
  let offset = 13;
  const packed = buffer[10];
  if (packed & 0x80) offset += 3 * (1 << ((packed & 7) + 1));
  if (offset >= buffer.length) throw Error('GIF 调色板已截断');
  let sawImage = false, sawTrailer = false;
  const readSubBlocks = (collect = false) => {
    const chunks = collect ? [] : null;
    let total = 0;
    while (offset < buffer.length) {
      const size = buffer[offset++];
      if (size === 0) return collect ? Buffer.concat(chunks, total) : total;
      if (offset + size > buffer.length) throw Error('GIF 数据子块已截断');
      if (collect) chunks.push(buffer.subarray(offset, offset + size));
      offset += size;
      total += size;
    }
    throw Error('GIF 数据子块缺少终止符');
  };
  while (offset < buffer.length) {
    const intro = buffer[offset++];
    if (intro === 0x3b) { sawTrailer = true; break; }
    if (intro === 0x21) {
      if (offset >= buffer.length) throw Error('GIF 扩展块已截断');
      offset += 1;
      readSubBlocks(false);
    } else if (intro === 0x2c) {
      if (offset + 9 > buffer.length) throw Error('GIF 图像描述块已截断');
      const frameW = buffer.readUInt16LE(offset + 4);
      const frameH = buffer.readUInt16LE(offset + 6);
      checkImageDims(frameW, frameH);
      const lctPacked = buffer[offset + 8];
      offset += 9;
      if (lctPacked & 0x80) offset += 3 * (1 << ((lctPacked & 7) + 1));
      if (offset >= buffer.length) throw Error('GIF 图像数据已截断');
      const lzwMin = buffer[offset++];
      const lzwStream = readSubBlocks(true);
      if (lzwStream.length < 1) throw Error('GIF 图像数据为空');
      validateGifLzw(lzwStream, lzwMin, frameW * frameH);
      sawImage = true;
    } else {
      throw Error('GIF 块标识无效');
    }
  }
  if (!sawImage || !sawTrailer) throw Error('GIF 图片缺少有效图像数据');
  return { width, height };
}
function validateWebpVp8(buffer, dataStart, chunkSize) {
  if (chunkSize <= 10) throw Error('WebP VP8 缺少图像数据');
  const frameTag = buffer[dataStart] | (buffer[dataStart + 1] << 8) | (buffer[dataStart + 2] << 16);
  const version = (frameTag >> 1) & 7;
  const firstPartSize = frameTag >>> 5;
  if ((frameTag & 1) !== 0 || version > 3 || buffer[dataStart + 3] !== 0x9d || buffer[dataStart + 4] !== 0x01 || buffer[dataStart + 5] !== 0x2a) {
    throw Error('WebP VP8 关键帧签名无效');
  }
  if (firstPartSize < 2 || 10 + firstPartSize > chunkSize) {
    throw Error('WebP VP8 帧分区数据不完整');
  }
  const width = buffer.readUInt16LE(dataStart + 6) & 0x3fff;
  const height = buffer.readUInt16LE(dataStart + 8) & 0x3fff;
  checkImageDims(width, height);
  return { width, height };
}
function validateWebpVp8l(buffer, dataStart, chunkSize) {
  if (chunkSize <= 5 || buffer[dataStart] !== 0x2f) throw Error('WebP VP8L 帧数据无效或缺少图像数据');
  const bits = buffer.readUInt32LE(dataStart + 1);
  if ((bits >>> 29) !== 0) throw Error('WebP VP8L 帧版本无效');
  const width = (bits & 0x3fff) + 1;
  const height = ((bits >>> 14) & 0x3fff) + 1;
  checkImageDims(width, height);
  return { width, height };
}
function validateWebpBuffer(buffer) {
  if (buffer.length < 24 || buffer.toString('latin1', 0, 4) !== 'RIFF' || buffer.toString('latin1', 8, 12) !== 'WEBP') {
    throw Error('WebP 文件头无效');
  }
  const riffSize = buffer.readUInt32LE(4);
  if (riffSize + 8 !== buffer.length) throw Error('WebP 文件长度不匹配');
  let offset = 12, sawCanvas = false, sawFrame = false, width = 0, height = 0;
  while (offset + 8 <= buffer.length) {
    const fourcc = buffer.toString('latin1', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const next = dataStart + chunkSize + (chunkSize & 1);
    if (dataStart + chunkSize > buffer.length) throw Error('WebP 数据块已截断');
    if (fourcc === 'VP8 ') {
      const dims = validateWebpVp8(buffer, dataStart, chunkSize);
      width = dims.width; height = dims.height;
      sawCanvas = sawFrame = true;
    } else if (fourcc === 'VP8L') {
      const dims = validateWebpVp8l(buffer, dataStart, chunkSize);
      width = dims.width; height = dims.height;
      sawCanvas = sawFrame = true;
    } else if (fourcc === 'VP8X') {
      if (chunkSize !== 10) throw Error('WebP VP8X 头长度无效');
      width = (buffer[dataStart + 4] | (buffer[dataStart + 5] << 8) | (buffer[dataStart + 6] << 16)) + 1;
      height = (buffer[dataStart + 7] | (buffer[dataStart + 8] << 8) | (buffer[dataStart + 9] << 16)) + 1;
      checkImageDims(width, height);
      sawCanvas = true;
    } else if (fourcc === 'ANMF') {
      if (chunkSize <= 24) throw Error('WebP 动画帧缺少图像数据');
      let sub = dataStart + 16;
      const subEnd = dataStart + chunkSize;
      let frameValid = false;
      while (sub + 8 <= subEnd) {
        const subFourcc = buffer.toString('latin1', sub, sub + 4);
        const subSize = buffer.readUInt32LE(sub + 4);
        const subData = sub + 8;
        if (subData + subSize > subEnd) throw Error('WebP 动画子块已截断');
        if (subFourcc === 'VP8 ') { validateWebpVp8(buffer, subData, subSize); frameValid = true; }
        else if (subFourcc === 'VP8L') { validateWebpVp8l(buffer, subData, subSize); frameValid = true; }
        sub = subData + subSize + (subSize & 1);
      }
      if (!frameValid) throw Error('WebP 动画帧缺少有效图像数据');
      sawFrame = true;
    }
    offset = next;
  }
  if (!sawCanvas || !sawFrame) throw Error('WebP 图片缺少有效图像数据');
  return { width, height };
}
function validateImageBuffer(buffer, ext) {
  const normalizedExt = String(ext || 'png').toLowerCase().replace(/^\./, '');
  const mime = IMAGE_MIMES[normalizedExt];
  if (!mime) throw Error('不支持的图片格式');
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.length > maxLocalImageBytes) {
    throw Error('图片大小需在 3 MB 以内');
  }
  if (!matchesImageType(buffer, mime)) throw Error('图片内容与格式不匹配');
  let dims;
  if (normalizedExt === 'png') {
    validatePngBuffer(buffer);
    dims = { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  } else if (normalizedExt === 'jpg' || normalizedExt === 'jpeg') dims = validateJpegBuffer(buffer);
  else if (normalizedExt === 'gif') dims = validateGifBuffer(buffer);
  else if (normalizedExt === 'webp') dims = validateWebpBuffer(buffer);
  return { normalizedExt, mime, ...dims };
}
function isSubpath(root, target) {
  const rel = path.relative(root, target);
  return Boolean(rel && !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep));
}
function sanitizeDocFilename(rawTitle) {
  const cleaned = String(rawTitle || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80);
  if (!cleaned || RESERVED_WIN_NAME.test(cleaned)) return '未命名文档';
  return cleaned;
}
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
  const createdAssets = new Map();
  function mountedFolders() {
    const raw = Array.isArray(store.data?.settings?.markdownFolders) ? store.data.settings.markdownFolders : [];
    const seen = new Set();
    const out = [];
    for (const entry of raw) {
      if (typeof entry !== 'string' || !entry.trim() || entry.startsWith('\\\\')) continue;
      const key = identity(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(entry);
      if (out.length >= MAX_MOUNTED_FOLDERS) break;
    }
    return out;
  }
  function setMountedFolders(list) {
    if (!store.data.settings) store.data.settings = {};
    store.data.settings.markdownFolders = list.slice(0, MAX_MOUNTED_FOLDERS);
  }
  async function open(file, { persist = true } = {}) {
    const loaded = await readMarkdown(file);
    const previous = workspace.list('markdown').find(item => item.meta.externalPath && identity(item.meta.externalPath) === identity(loaded.canonical));
    if (previous && hash(previous.text) !== previous.meta.externalTextHash) return { item: previous, recovered: true, diskHash: loaded.sourceHash };
    const item = workspace.save('markdown', { id: previous?.id, title: path.basename(loaded.canonical, path.extname(loaded.canonical)), text: loaded.text });
    Object.assign(item.meta, { externalPath: loaded.canonical, externalHash: loaded.sourceHash, externalTextHash: loaded.textHash });
    if (persist) await store.save();
    return { item, recovered: false, diskHash: loaded.sourceHash };
  }
  async function scanMarkdownDir(root, dir, depth, out) {
    if (depth > MAX_FOLDER_DEPTH || out.length >= MAX_FOLDER_FILES) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    for (const entry of entries) {
      if (out.length >= MAX_FOLDER_FILES) break;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name.toLowerCase())) continue;
        await scanMarkdownDir(root, full, depth + 1, out);
      } else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
        const real = await fs.realpath(full).catch(() => '');
        if (real && isSubpath(root, real)) out.push(real);
      }
    }
  }
  async function openFolder(folderPath, { expectedRealPath = '' } = {}) {
    if (typeof folderPath !== 'string' || !folderPath.trim()) throw Error('请选择有效的本地文件夹');
    if (expectedRealPath) {
      const linkStat = await fs.lstat(folderPath);
      if (linkStat.isSymbolicLink()) throw Error('已挂载目录已被符号链接替换，已拒绝刷新');
    }
    const root = await fs.realpath(folderPath);
    if (expectedRealPath && identity(root) !== identity(expectedRealPath)) {
      throw Error('已挂载目录实际位置已改变，请重新选择文件夹');
    }
    if (root.startsWith('\\\\')) throw Error('不支持网络共享路径作为本地文档目录');
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) throw Error('请选择文件夹而非单个文件');
    const found = [];
    await scanMarkdownDir(root, root, 0, found);
    const foundKeys = new Set(found.map(identity));
    const items = [];
    const diskHashes = {};
    let skipped = 0;
    for (const file of found) {
      try {
        const res = await open(file, { persist: false });
        items.push(res.item);
        if (res.item?.id && res.diskHash) diskHashes[res.item.id] = res.diskHash;
      } catch {
        skipped += 1;
      }
    }
    // Prune stale entries for files deleted on disk inside this folder, keeping any unsaved drafts intact.
    for (const doc of workspace.list('markdown')) {
      const extPath = doc.meta?.externalPath;
      if (!extPath || !isSubpath(root, extPath) || foundKeys.has(identity(extPath))) continue;
      if (hash(doc.text) !== doc.meta.externalTextHash) continue;
      const stillThere = await fs.stat(extPath).then(s => s.isFile()).catch(() => false);
      if (!stillThere) workspace.remove('markdown', doc.id);
    }
    const existing = mountedFolders().filter(dir => identity(dir) !== identity(root));
    setMountedFolders([root, ...existing]);
    await store.save();
    return { folder: root, opened: items.length, skipped, items, diskHashes, folders: mountedFolders() };
  }
  async function unmountFolder(folderPath) {
    if (typeof folderPath !== 'string' || !folderPath.trim()) return { folders: mountedFolders() };
    const key = identity(folderPath.replaceAll('/', path.sep));
    const next = mountedFolders().filter(dir => identity(dir) !== key);
    setMountedFolders(next);
    await store.save();
    return { folders: mountedFolders() };
  }
  async function createInFolder(folderPath, rawTitle = '未命名文档') {
    if (typeof folderPath !== 'string' || !folderPath.trim()) throw Error('未指定目标文件夹');
    const root = await fs.realpath(folderPath);
    if (root.startsWith('\\\\') || !(await fs.stat(root)).isDirectory()) throw Error('目标文件夹无效');
    const knownFolders = new Set([
      ...mountedFolders().map(identity),
      ...workspace.list('markdown').map(d => d.meta?.externalPath ? identity(path.dirname(d.meta.externalPath)) : '').filter(Boolean)
    ]);
    if (!knownFolders.has(identity(root))) throw Error('只能向已打开的本地文件夹新建文档');
    const base = sanitizeDocFilename(rawTitle);
    const displayTitle = String(rawTitle || '').trim().slice(0, 120) || base;
    for (let i = 1; i <= 100; i += 1) {
      const name = i === 1 ? `${base}.md` : `${base} ${i}.md`;
      const target = path.join(root, name);
      try {
        await fs.writeFile(target, `# ${displayTitle}\n\n`, { flag: 'wx', encoding: 'utf8' });
        const opened = await open(target);
        return { item: opened.item, filePath: target };
      } catch (error) {
        if (error?.code === 'EEXIST') continue;
        throw error;
      }
    }
    throw Error('该目录下同名文件过多，请更换标题');
  }
  async function saveAssetImage(id, buffer, ext = 'png') {
    const item = store.getItem(id);
    if (item?.meta?.workspace !== 'markdown' || !item.meta.externalPath) throw Error('当前文档未关联本地文件');
    const { normalizedExt } = validateImageBuffer(buffer, ext);
    const docDir = path.dirname(item.meta.externalPath);
    if (docDir.startsWith('\\\\') || identity(await fs.realpath(docDir).catch(() => '')) !== identity(docDir)) {
      throw Error('文档所在目录不可用');
    }
    const assetsDir = path.join(docDir, 'assets');
    const existingStat = await fs.lstat(assetsDir).catch(() => null);
    if (existingStat) {
      if (existingStat.isSymbolicLink() || !existingStat.isDirectory()) throw Error('assets 目录不是有效的本地文件夹');
    } else {
      await fs.mkdir(assetsDir, { recursive: false });
    }
    const realAssets = await fs.realpath(assetsDir);
    if (path.relative(docDir, realAssets) !== 'assets') throw Error('assets 目录路径越界');
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '-',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0')
    ].join('');
    const fileExt = normalizedExt === 'jpeg' ? 'jpg' : normalizedExt;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const filename = `img-${stamp}-${crypto.randomBytes(2).toString('hex')}.${fileExt}`;
      const target = path.join(realAssets, filename);
      try {
        await fs.writeFile(target, buffer, { flag: 'wx' });
        const relativePath = `assets/${filename}`;
        createdAssets.set(`${id}:${relativePath}`, target);
        if (createdAssets.size > 128) createdAssets.delete(createdAssets.keys().next().value);
        return { relativePath, fullPath: target };
      } catch (error) {
        if (error?.code === 'EEXIST') continue;
        throw error;
      }
    }
    throw Error('图片写入失败，请重试');
  }
  async function discardAssetImage(id, relativePath) {
    const key = `${id}:${String(relativePath || '')}`;
    const target = createdAssets.get(key);
    if (!target) return { discarded: false };
    createdAssets.delete(key);
    await fs.rm(target, { force: true }).catch(() => {});
    return { discarded: true };
  }
  return {
    open,
    mountedFolders,
    openFolder,
    unmountFolder,
    createInFolder,
    saveAssetImage,
    discardAssetImage,
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
module.exports = { markdownPaths, readMarkdown, createMarkdownFiles, validateImageBuffer };
