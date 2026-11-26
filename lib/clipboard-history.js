'use strict';

const { readWithRetry, sameBytes } = require('./clipboard-guard');
const { parseClipboardFileUris } = require('./clipboard-capture');

const FALLBACK_INTERVAL_MS = 1500;

function createClipboardHistory({ clipboard, ClipboardItem, nativeImage, hashBuffer, clipboardLedger,
  isEnabled, sequenceNumber, copyFileList, createListenerWindow, watchNative, clipboardSourceSnapshot,
  rememberClipboardText, rememberClipboardFiles, addImageToStore, onDiagnostic }) {
  let lastClipboardText = '';
  let lastClipboardImageHash = '';
  // 重复通知时按原始字节复用解码结果。
  let lastClipboardImageRaw = null;
  let lastClipboardImageKey = '';
  let lastClipboardImageType = '';
  let lastClipboardFilesKey = '';
  let clipboardWriteGuard = '';
  let captureGeneration = 0;
  let lastClipboardSequence = null;
  let selectionPollingPaused = false;
  let clipboardSeeding = null;
  let active = null;
  let status = { mode: 'off' };

  async function readClipboardText() {
    const result = await readWithRetry(
      async () => String(await clipboard.readText() || ''),
      (value) => !String(value || '').length
    );
    return result.value || '';
  }

  /** 只读 5 个 64 字节片段做指纹：剪贴板没变时就不必把整张 4K PNG 读进 JS 堆。 */
  async function imageBlobFingerprint(blob) {
    const size = blob.size;
    if (!size) return '';
    const positions = [0, Math.floor(size / 4), Math.floor(size / 2), Math.floor(size * 3 / 4), Math.max(0, size - 64)];
    const chunks = [];
    for (const start of positions) {
      chunks.push(Buffer.from(await blob.slice(start, Math.min(size, start + 64)).arrayBuffer()).toString('base64'));
    }
    return `${size}:${chunks.join('|')}`;
  }

  // 一次读完文字、文件和图片，避免反复打开系统剪贴板读出不同版本。
  async function readClipboardSnapshot() {
    const empty = { text: '', files: [], imageBuffer: null, imageType: '', imageKey: '' };
    const result = await readWithRetry(async () => {
      const items = await clipboard.read();
      if (!Array.isArray(items) || !items.length) return empty;
      const snapshot = { text: '', files: [], imageBuffer: null, imageType: '', imageKey: '' };

      const textItem = items.find((item) => item.types?.includes('text/plain'));
      if (textItem) {
        try {
          const blob = await textItem.getType('text/plain');
          snapshot.text = String(typeof blob === 'string' ? blob : await blob.text());
        } catch { /* 文本读取失败不影响图片/文件 */ }
      }

      const uriItem = items.find((item) => item.types?.includes('text/uri-list'));
      if (uriItem) {
        try {
          const blob = await uriItem.getType('text/uri-list');
          const uriText = String(typeof blob === 'string' ? blob : await blob.text());
          snapshot.files = parseClipboardFileUris(uriText);
        } catch { /* 文件列表格式异常时当作没有文件 */ }
      }

      const imageItem = items.find((item) => item.types?.some((type) => type.startsWith('image/')));
      if (imageItem) {
        try {
          const type = imageItem.types.find((value) => value.startsWith('image/'));
          const blob = await imageItem.getType(type);
          const imageKey = await imageBlobFingerprint(blob);
          snapshot.imageKey = imageKey;
          if (imageKey && imageKey === lastClipboardImageKey && lastClipboardImageRaw) {
            // 指纹一致：直接沿用上一次的原始字节，不再分配一整块 PNG Buffer
            snapshot.imageBuffer = lastClipboardImageRaw;
            snapshot.imageType = lastClipboardImageType;
          } else {
            const buffer = Buffer.from(await blob.arrayBuffer());
            // 这里只留原始字节，不在轮询里解码：解码 4K 截图要几十毫秒
            if (buffer.length) {
              snapshot.imageBuffer = buffer;
              snapshot.imageType = type;
            }
          }
        } catch { /* 图片读取失败时忽略这一项 */ }
      }
      // 兜底：read() 没暴露出图片项、但系统明确说有图片格式时，退回 readImage()。
      // 宁可多解一次图，也不能因为读法差异漏掉用户的截图。
      if (!snapshot.imageBuffer) {
        try {
          const hasImageFormat = clipboard.availableFormats().some((format) => String(format).startsWith('image/'));
          if (hasImageFormat) {
            const fallback = clipboard.readImage();
            if (fallback && !fallback.isEmpty()) {
              snapshot.imageBuffer = fallback.toPNG();
              snapshot.imageType = 'image/png';
            }
          }
        } catch { /* 读不到就当作没有图片 */ }
      }
      return snapshot;
    }, (value) => value == null);

    if (result.error) throw result.error;
    return result.value || empty;
  }

  async function writeClipboardText(text) {
    const value = String(text || '');
    clipboardWriteGuard = value;
    try {
      await clipboard.writeText(value);
      clipboardLedger.record(value);
      lastClipboardText = value;
      lastClipboardImageRaw = null;
      lastClipboardImageHash = '';
      lastClipboardImageKey = '';
      lastClipboardImageType = '';
      lastClipboardFilesKey = '';
    } finally {
      if (clipboardWriteGuard === value) clipboardWriteGuard = '';
    }
  }

  async function writeClipboardImage(image) {
    const png = image.toPNG();
    const guard = clipboardWriteGuard = await readClipboardText();
    try { await clipboard.write([new ClipboardItem({ 'image/png': png })]); }
    finally { if (clipboardWriteGuard === guard) clipboardWriteGuard = ''; }
    const recording = isEnabled();
    lastClipboardImageHash = recording ? hashBuffer(png) : '';
    // 自己的写入也记进字节缓存，下一趟轮询就不会再解一次
    lastClipboardImageRaw = recording ? png : null;
    lastClipboardImageKey = ''; // 让下一趟重新取一次指纹，不与上一张图混淆
    lastClipboardImageType = recording ? 'image/png' : '';
    lastClipboardText = await readClipboardText();
    lastClipboardFilesKey = '';
    clipboardLedger.record(lastClipboardText);
  }

  function writeClipboardFileList(win, paths) {
    copyFileList(win.getNativeWindowHandle(), paths);
    // Suppress recapture of our own file list.
    ++captureGeneration;
    lastClipboardSequence = sequenceNumber();
    lastClipboardFilesKey = paths.join('\n').toLowerCase();
    lastClipboardText = lastClipboardImageHash = lastClipboardImageKey = lastClipboardImageType = '';
    lastClipboardImageRaw = null;
  }

  let clipboardPollBusy = false;
  let clipboardUpdatePending = false;
  let clipboardUpdateScheduled = null;
  function scheduleClipboardUpdate(watcher = active) {
    if (!watcher || watcher !== active || !isEnabled()) return;
    clipboardUpdatePending = true;
    if (clipboardUpdateScheduled || clipboardPollBusy || clipboardSeeding || selectionPollingPaused || clipboardLedger.transientDepth) return;
    clipboardUpdateScheduled = setImmediate(() => {
      clipboardUpdateScheduled = null;
      if (!clipboardUpdatePending || watcher !== active || clipboardSeeding || selectionPollingPaused || clipboardLedger.transientDepth) return;
      clipboardUpdatePending = false;
      void pollClipboard();
    });
  }

  async function pollClipboard() {
    if (!active || !isEnabled() || clipboardPollBusy || clipboardSeeding || selectionPollingPaused || clipboardLedger.transientDepth) return;
    clipboardPollBusy = true;
    try {
      const sequence = sequenceNumber();
      if (sequence !== null && sequence === lastClipboardSequence) return;
      const sourceAtUpdate = clipboardSourceSnapshot('clipboard-update');
      const generation = ++captureGeneration;
      const snapshot = await readClipboardSnapshot();
      const stillCurrent = () => generation === captureGeneration && isEnabled() &&
        !selectionPollingPaused && !clipboardLedger.transientDepth &&
        (sequence === null || sequenceNumber() === sequence);
      if (!stillCurrent()) return;

      const text = snapshot.text || '';
      const filesKey = snapshot.files.length ? snapshot.files.join('\n').toLowerCase() : '';
      const rawImage = snapshot.imageBuffer;
      // 字节相同 = 图片没变：这一趟不解码、不编码、不算哈希
      // 命中指纹时复用的就是同一个 Buffer 引用，连逐字节比较都不必做
      const imageBytesChanged = Boolean(rawImage) && rawImage !== lastClipboardImageRaw && !sameBytes(lastClipboardImageRaw, rawImage);

      let image = null;
      let imageHash = lastClipboardImageHash;
      if (imageBytesChanged) {
        const decoded = nativeImage.createFromBuffer(rawImage);
        if (!decoded.isEmpty()) {
          image = decoded;
          imageHash = hashBuffer(decoded.toPNG());
        }
      }

      const textChanged = Boolean(text && text !== lastClipboardText);
      const filesChanged = Boolean(filesKey && filesKey !== lastClipboardFilesKey);
      const imageChanged = Boolean(image && imageHash !== lastClipboardImageHash);
      // 自写回环：本次变化若仍是我们刚写入的内容，不重复入库
      const ownWrite = clipboardLedger.shouldIgnore(text);
      if (textChanged && !ownWrite && text !== clipboardWriteGuard) {
        const source = await sourceAtUpdate;
        if (stillCurrent()) await rememberClipboardText(text, source);
      } else if (filesChanged) {
        const source = await sourceAtUpdate;
        if (stillCurrent()) await rememberClipboardFiles(snapshot.files, { ...source, acquisitionMethod: 'clipboard-file-update' });
      } else if (imageChanged && !text && !filesKey) {
        const source = await sourceAtUpdate;
        if (stillCurrent()) await addImageToStore(image, { ...source, acquisitionMethod: 'clipboard-image-update' });
      }

      if (!stillCurrent()) return;
      lastClipboardSequence = sequence;
      lastClipboardText = text;
      lastClipboardFilesKey = filesKey;
      // 图片被清空时同步清掉缓存，下次再遇到图片会重新解码
      lastClipboardImageRaw = rawImage || null;
      lastClipboardImageKey = rawImage ? (snapshot.imageKey || '') : '';
      lastClipboardImageType = rawImage ? snapshot.imageType : '';
      lastClipboardImageHash = rawImage ? imageHash : '';
      if (clipboardWriteGuard && text === clipboardWriteGuard) clipboardWriteGuard = '';
    } catch (error) {
      onDiagnostic('clipboard-read', error);
    } finally {
      clipboardPollBusy = false;
      if (clipboardUpdatePending) scheduleClipboardUpdate();
    }
  }

  function stop() {
    const watcher = active;
    active = null;
    status = { mode: 'off' };
    ++captureGeneration;
    clipboardSeeding = null;
    clipboardUpdatePending = false;
    clearImmediate(clipboardUpdateScheduled);
    clipboardUpdateScheduled = null;
    lastClipboardSequence = null;
    lastClipboardText = lastClipboardFilesKey = '';
    lastClipboardImageRaw = null;
    lastClipboardImageKey = lastClipboardImageType = lastClipboardImageHash = '';
    try { watcher?.dispose?.(); }
    catch (error) { onDiagnostic('clipboard-listener-stop', error); }
  }

  async function start() {
    stop();
    if (!isEnabled()) return;
    const watcher = active = {};
    const onChange = () => scheduleClipboardUpdate(watcher);
    let win;
    try {
      try {
        win = createListenerWindow();
        const unwatch = watchNative(win, onChange);
        watcher.dispose = () => {
          try { unwatch(); }
          finally { if (!win.isDestroyed()) win.destroy(); }
        };
        status = { mode: 'native' };
      } catch (error) {
        if (win && !win.isDestroyed()) win.destroy();
        const timer = setInterval(onChange, FALLBACK_INTERVAL_MS);
        timer.unref();
        watcher.dispose = () => clearInterval(timer);
        status = { mode: 'polling', error: error.message };
        onDiagnostic('clipboard-native-fallback', error);
      }
      await seedClipboardWatcher();
    } catch (error) {
      if (watcher !== active) return;
      stop();
      status = { mode: 'failed', error: error.message };
      throw error;
    }
  }

  async function seedClipboardWatcher() {
    const generation = ++captureGeneration;
    const sequence = sequenceNumber();
    const read = readClipboardSnapshot();
    clipboardSeeding = read;
    let initial;
    try { initial = await read; }
    finally {
      if (clipboardSeeding === read) {
        clipboardSeeding = null;
        if (clipboardUpdatePending) scheduleClipboardUpdate();
      }
    }
    if (generation !== captureGeneration) return;
    if (sequence !== null && sequenceNumber() !== sequence) return;
    lastClipboardSequence = sequence;
    lastClipboardText = initial.text || '';
    lastClipboardFilesKey = initial.files.length ? initial.files.join('\n').toLowerCase() : '';
    lastClipboardImageRaw = initial.imageBuffer || null;
    lastClipboardImageKey = initial.imageKey || '';
    lastClipboardImageType = initial.imageType || '';
    lastClipboardImageHash = initial.imageBuffer ? hashBuffer(nativeImage.createFromBuffer(initial.imageBuffer).toPNG()) : '';
  }

  function pause() {
    selectionPollingPaused = true;
    ++captureGeneration;
    return () => {
      ++captureGeneration;
      selectionPollingPaused = false;
      if (clipboardUpdatePending) scheduleClipboardUpdate();
    };
  }

  return { start, stop, status: () => status, pause, pollClipboard, readClipboardText,
    writeClipboardText, writeClipboardImage, writeClipboardFileList };
}

module.exports = { createClipboardHistory, FALLBACK_INTERVAL_MS };
