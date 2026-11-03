'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function mergeLines(text) {
  const source = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!source) return '';
  const paragraphs = source.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return paragraphs.map((paragraph) => {
    const lines = paragraph.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return '';
    let result = lines[0];
    for (let index = 1; index < lines.length; index += 1) {
      const line = lines[index];
      const previous = result.slice(-1);
      const isCjk = /[\u3000-\u9fff\uff00-\uffef]/.test(previous + line[0]);
      const needsSpace = !isCjk && /[A-Za-z0-9,.;:!?)]$/.test(previous) && /^[A-Za-z0-9(]/.test(line);
      result += needsSpace ? ` ${line}` : line;
    }
    return result;
  }).join('\n\n');
}

function cleanText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeForCompare(text) {
  return String(text || '').replace(/\s+/g, '').toLowerCase();
}

function sha1(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

function safeTitle(text, fallback = '文字') {
  const first = String(text || '').split('\n').find((line) => line.trim()) || fallback;
  return first.trim().slice(0, 42) || fallback;
}

function createActionRegistry({ store, ocr, translate, clipboard, shell, nativeImage, openPath, pinImage, broadcast, assetPath, capturesDir, makeId }) {
  const actions = new Map();

  function register(id, definition) {
    actions.set(id, { id, ...definition });
  }

  function listForItem(item) {
    if (!item) return [];
    const common = [];
    if (item.kind === 'text' || item.kind === 'link') {
      common.push('output.copy', 'text.translate', 'text.merge-lines', 'text.clean', 'output.shelf');
    } else if (item.kind === 'image') {
      // 图片也能直接翻：先离线取词，再交给翻译引擎（图片取词翻译）
      common.push('ocr.local', 'text.translate', 'image.pin', 'output.copy', 'output.shelf');
    } else if (item.kind === 'files') {
      common.push('files.reveal', 'output.copy', 'output.shelf');
    }
    return common;
  }

  async function addTextItem(text, source = {}, extra = {}) {
    const value = String(text || '').trim();
    if (!value) throw new Error('没有可用的文字');
    const item = store.addItem({
      kind: extra.kind || 'text',
      title: extra.title || safeTitle(value),
      text: value,
      source,
      parentIds: extra.parentIds || [],
      meta: extra.meta || {}
    });
    await store.save();
    return item;
  }

  async function addImageItem(filePath, source = {}, extra = {}) {
    const buffer = await fsp.readFile(filePath);
    const hash = sha1(buffer);
    const existing = store.data.items.find((item) => item.kind === 'image' && item.meta?.hash === hash && item.filePath === filePath);
    if (existing) return existing;
    const image = nativeImage.createFromBuffer(buffer);
    const size = image.getSize();
    const item = store.addItem({
      kind: 'image',
      title: extra.title || '图片',
      filePath,
      source,
      parentIds: extra.parentIds || [],
      meta: { hash, width: size.width, height: size.height, ...(extra.meta || {}) }
    });
    await store.save();
    return item;
  }

  async function execute(itemId, actionId) {
    const item = store.getItem(itemId);
    if (!item) return { ok: false, error: '内容不存在或已被清理', execution: null };
    const startedAt = Date.now();
    const execution = store.recordExecution({
      jobId: makeId('job'),
      actionId,
      inputIds: [item.id],
      status: 'running',
      startedAt
    });
    broadcast?.('executions:changed');
    try {
      let output = null;
      let message = '';
      if (actionId === 'output.copy') {
        if (item.kind === 'image' && item.filePath) {
          const image = nativeImage.createFromPath(item.filePath);
          if (image.isEmpty()) throw new Error('图片读取失败');
          await clipboard.writeImage(image);
        } else {
          await clipboard.writeText(item.text || item.filePath || '');
        }
        message = '已复制';
      } else if (actionId === 'text.merge-lines') {
        const text = mergeLines(item.text);
        output = await addTextItem(text, { type: 'derived', acquisitionMethod: 'merge-lines' }, {
          title: '合并换行后的文字',
          parentIds: [item.id],
          meta: { derivedBy: 'text.merge-lines', originItemId: item.id }
        });
        message = '已生成合并换行版本';
      } else if (actionId === 'text.clean') {
        const text = cleanText(item.text);
        output = await addTextItem(text, { type: 'derived', acquisitionMethod: 'clean-text' }, {
          title: '清理后的文字',
          parentIds: [item.id],
          meta: { derivedBy: 'text.clean', originItemId: item.id }
        });
        message = '已生成清理版本';
      } else if (actionId === 'text.translate') {
        // 图片走「取词 → 翻译」两段：OCR 结果先落一条内容，译文再挂在这条内容下面，
        // 这样处理轨迹里能看出"译文来自哪张图、识别成了什么"
        let sourceText = String(item.text || '');
        let originId = item.id;
        let ocrMeta = null;
        if (item.kind === 'image') {
          if (!item.filePath) throw new Error('这张图片没有可读取的文件');
          const recognized = await ocr.recognizeFile(item.filePath, store.getSettings().ocrLangs);
          if (!recognized.text) throw new Error('没有从这张图片里识别到文字');
          const ocrItem = await addTextItem(recognized.text, { type: 'ocr', acquisitionMethod: 'offline-ocr', confidence: 'certain' }, {
            title: '截图文字',
            parentIds: [item.id],
            meta: { derivedBy: 'ocr.local', originItemId: item.id, engine: recognized.engine, cached: recognized.cached }
          });
          sourceText = recognized.text;
          originId = ocrItem.id;
          ocrMeta = { clientSideOcrItemId: ocrItem.id };
        }
        if (!sourceText.trim()) throw new Error('这条内容没有可翻译的文字');
        if (typeof translate !== 'function') throw new Error('翻译引擎未接入');
        const translated = await translate(sourceText);
        if (!translated?.ok) throw new Error(translated?.error || '翻译失败');
        output = await addTextItem(translated.text, { type: 'derived', acquisitionMethod: 'translate' }, {
          title: `译文 · ${safeTitle(translated.text)}`,
          parentIds: [originId],
          meta: {
            derivedBy: 'text.translate',
            originItemId: originId,
            translateProvider: translated.provider,
            from: translated.from,
            to: translated.to,
            // 只留一段用于对照展示，避免把整篇原文再存一遍
            sourceText: sourceText.slice(0, 2000),
            ...(ocrMeta || {})
          }
        });
        message = `已翻译为${translated.to === 'zh' ? '中文' : translated.to === 'en' ? '英文' : translated.to}`;
      } else if (actionId === 'ocr.local') {
        if (!item.filePath) throw new Error('这张图片没有可读取的文件');
        const result = await ocr.recognizeFile(item.filePath, store.getSettings().ocrLangs);
        if (!result.text) throw new Error('没有识别到文字');
        output = await addTextItem(result.text, { type: 'ocr', acquisitionMethod: 'offline-ocr', confidence: 'certain' }, {
          title: '截图文字',
          parentIds: [item.id],
          meta: { derivedBy: 'ocr.local', originItemId: item.id, confidence: result.confidence, blocks: result.blocks, engine: result.engine, cached: result.cached }
        });
        message = result.cached ? '已复用识别结果' : '识别完成';
      } else if (actionId === 'image.pin') {
        if (!item.filePath) throw new Error('图片文件不存在');
        await pinImage(item.filePath, item.meta?.width, item.meta?.height);
        message = '已钉在桌面';
      } else if (actionId === 'files.reveal') {
        if (!item.filePath) throw new Error('文件路径不存在');
        shell.showItemInFolder(item.filePath);
        message = '已在资源管理器中定位';
      } else if (actionId === 'output.open') {
        if (item.kind === 'link') {
          await shell.openExternal(item.text);
        } else if (item.filePath) {
          const error = await openPath(item.filePath);
          if (error) throw new Error(error);
        } else {
          throw new Error('这个内容没有可打开的地址');
        }
        message = '已打开';
      } else if (actionId === 'output.shelf') {
        let task = store.data.tasks.find((entry) => !entry.archived && entry.title === '临时收集');
        if (!task) task = store.createTask('临时收集');
        store.addItemToTask(task.id, item.id);
        await store.save();
        message = '已加入任务匣';
      } else {
        throw new Error('未知动作');
      }
      execution.status = 'done';
      execution.finishedAt = Date.now();
      execution.outputIds = output ? [output.id] : [];
      await store.save();
      broadcast?.('content:changed', { itemId: item.id, outputId: output?.id || '' });
      broadcast?.('tasks:changed');
      broadcast?.('executions:changed');
      return { ok: true, message, item, output, execution };
    } catch (error) {
      execution.status = 'failed';
      execution.error = error.message || '执行失败';
      execution.finishedAt = Date.now();
      await store.save();
      broadcast?.('executions:changed');
      return { ok: false, error: execution.error, execution };
    }
  }

  register('output.copy', { label: '复制', hint: '复制到剪贴板', execute });
  register('text.merge-lines', { label: '合并换行', hint: '把断行接成自然段', execute });
  register('text.clean', { label: '清理文字', hint: '去掉多余空格和空行', execute });
  register('text.translate', { label: '翻译', hint: '图片先取词再翻译，文字直接翻', execute });
  register('ocr.local', { label: '提取文字', hint: '本地离线 OCR', execute });
  register('image.pin', { label: '钉在桌面', hint: '保持图片置顶', execute });
  register('files.reveal', { label: '定位文件', hint: '在资源管理器中显示', execute });
  register('output.open', { label: '打开', hint: '用系统应用打开', execute });
  register('output.shelf', { label: '加入任务匣', hint: '暂存到临时收集', execute });

  return { actions, register, listForItem, execute, mergeLines, cleanText, normalizeForCompare, safeTitle };
}

module.exports = { createActionRegistry, mergeLines, cleanText, normalizeForCompare, safeTitle };
