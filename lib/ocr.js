'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const {compactCapture}=require('../src/text-spacing');
/*
 * tesseract.js 只在真正要识别时才需要，而它是个很重的依赖（wasm + worker 胶水）。
 * 顶层 require 会让主进程一启动就把它整个读进来，白白吃掉几十 MB 常驻内存；
 * 改成用到再加载，截图提字的功能完全不变。
 */
let tesseractModule = null;
function loadTesseract() {
  if (!tesseractModule) tesseractModule = require('tesseract.js');
  return tesseractModule;
}

const ENGINE_VERSION = 'tesseract.js@5.1.1+tessdata-4.0.0_best_int';
/**
 * tesseract worker 闲置多久后终止。
 *
 * worker 是重资源：chi_sim+eng 真实识别一次后主进程 RSS 会多出约 260MB
 * （wasm 堆 + 语言包 + worker 线程），而这个进程只有「再识别一张图」时才用得上。
 * 5 分钟没人用就 terminate，把这块内存还回去；下次识别重建约 1s，
 * 有「正在识别」进度提示，用户可接受。
 */
const DEFAULT_IDLE_MS = 5 * 60 * 1000;

function hashFile(filePath) {
  return fsp.readFile(filePath).then((buffer) => crypto.createHash('sha1').update(buffer).digest('hex'));
}

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_OCR_DIM = 16384;
const MAX_OCR_PIXELS = 40_000_000;
const PNG_CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const PNG_DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const ADAM7_PASSES = [
  { x0: 0, y0: 0, dx: 8, dy: 8 },
  { x0: 4, y0: 0, dx: 8, dy: 8 },
  { x0: 0, y0: 4, dx: 4, dy: 8 },
  { x0: 2, y0: 0, dx: 4, dy: 4 },
  { x0: 0, y0: 2, dx: 2, dy: 4 },
  { x0: 1, y0: 0, dx: 2, dy: 2 },
  { x0: 0, y0: 1, dx: 1, dy: 2 }
];
const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function pngCrc32(buf, start, end) {
  let c = 0xffffffff;
  for (let i = start; i < end; i += 1) c = PNG_CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function validatePngBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error('图片不是有效的 PNG 格式');
  }
  let offset = 8, sawIhdr = false, sawPlte = false, sawIdatEnd = false, sawIend = false;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idatChunks = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    if (length > 0x7fffffff) throw new Error('PNG 数据块长度无效');
    for (let i = 0; i < 4; i += 1) {
      const b = buffer[offset + 4 + i];
      if (!((b >= 65 && b <= 90) || (b >= 97 && b <= 122))) throw new Error('PNG 数据块类型无效');
    }
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const next = offset + 12 + length;
    if (next > buffer.length) throw new Error('PNG 图片数据已截断');
    if (pngCrc32(buffer, offset + 4, offset + 8 + length) !== buffer.readUInt32BE(offset + 8 + length)) {
      throw new Error('PNG 数据块校验失败');
    }
    if (idatChunks.length > 0 && type !== 'IDAT') sawIdatEnd = true;
    if (type === 'IHDR') {
      if (offset !== 8 || sawIhdr || length !== 13) throw new Error('PNG 文件头无效');
      width = buffer.readUInt32BE(offset + 8);
      height = buffer.readUInt32BE(offset + 12);
      bitDepth = buffer[offset + 16];
      colorType = buffer[offset + 17];
      const compression = buffer[offset + 18], filter = buffer[offset + 19];
      interlace = buffer[offset + 20];
      if (width < 1 || height < 1 || width > MAX_OCR_DIM || height > MAX_OCR_DIM || width * height > MAX_OCR_PIXELS) {
        throw new Error('图片尺寸超出识别上限');
      }
      if (!PNG_DEPTHS[colorType]?.includes(bitDepth) || compression !== 0 || filter !== 0 || (interlace !== 0 && interlace !== 1)) {
        throw new Error('PNG 编码参数无效');
      }
      sawIhdr = true;
    } else if (!sawIhdr) {
      throw new Error('PNG 文件头缺失');
    } else if (type === 'PLTE') {
      if (sawPlte || idatChunks.length > 0 || colorType === 0 || colorType === 4) {
        throw new Error('PNG 调色板块位置或类型无效');
      }
      const entries = length / 3;
      const maxEntries = colorType === 3 ? (1 << bitDepth) : 256;
      if (length === 0 || length % 3 !== 0 || entries > maxEntries) {
        throw new Error('PNG 调色板条目数无效');
      }
      sawPlte = true;
    } else if (type === 'IDAT') {
      if (sawIdatEnd) throw new Error('PNG 图像数据块不连续');
      idatChunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    } else if (type === 'IEND') {
      if (length !== 0 || next !== buffer.length) throw new Error('PNG 结束块无效或存在尾部多余数据');
      sawIend = true;
      offset = next;
      break;
    } else if ((buffer[offset + 4] & 0x20) === 0) {
      throw new Error('PNG 包含未知关键数据块');
    }
    offset = next;
  }
  if (!sawIhdr || !idatChunks.length || !sawIend || (colorType === 3 && !sawPlte)) {
    throw new Error('PNG 图片结构不完整');
  }
  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(idatChunks));
  } catch {
    throw new Error('PNG 图像压缩数据已损坏');
  }
  const channels = PNG_CHANNELS[colorType];
  if (interlace === 0) {
    const rowBytes = 1 + Math.ceil((width * channels * bitDepth) / 8);
    if (raw.length !== height * rowBytes) throw new Error('PNG 像素数据长度不匹配');
    for (let y = 0; y < height; y += 1) {
      if (raw[y * rowBytes] > 4) throw new Error('PNG 扫描行滤镜字节无效');
    }
  } else {
    let pos = 0;
    for (const pass of ADAM7_PASSES) {
      if (width <= pass.x0 || height <= pass.y0) continue;
      const passW = Math.ceil((width - pass.x0) / pass.dx);
      const passH = Math.ceil((height - pass.y0) / pass.dy);
      const rowBytes = 1 + Math.ceil((passW * channels * bitDepth) / 8);
      for (let y = 0; y < passH; y += 1) {
        if (pos + rowBytes > raw.length) throw new Error('PNG 交错像素数据长度不匹配');
        if (raw[pos] > 4) throw new Error('PNG 扫描行滤镜字节无效');
        pos += rowBytes;
      }
    }
    if (pos !== raw.length) throw new Error('PNG 交错像素数据长度不匹配');
  }
}

class OcrService {
  constructor(options = {}) {
    this.langPath = options.langPath;
    this.cachePath = options.cachePath;
    this.logger = options.logger || (() => {});
    this.worker = null;
    this.workerLangs = '';
    this.queue = Promise.resolve();
    this.resultCache = new Map();
    this.idleMs = Number.isFinite(options.idleMs) ? Math.max(0, Number(options.idleMs)) : DEFAULT_IDLE_MS;
    this.idleTimer = null;
    this.pending = 0;
  }

  /** 取消闲置回收计时（有识别任务进来或正在建 worker 时）。 */
  cancelIdle() {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  /** 安排一次闲置回收：只在没有排队/进行中的识别时终止 worker。 */
  scheduleIdle() {
    this.cancelIdle();
    if (!this.worker || this.idleMs <= 0) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.pending > 0) return;
      console.log('[OCR] worker 闲置 ' + Math.round(this.idleMs / 1000) + 's，释放识别引擎');
      this.terminate().catch(() => {});
    }, this.idleMs);
    if (this.idleTimer.unref) this.idleTimer.unref();
  }

  /**
   * 把随应用附带的 .traineddata.gz 预热成 tesseract.js 认的缓存文件。
   *
   * 为什么必须自己做：tesseract.js 用 is-electron 判断运行环境，
   * 在 Electron 主进程里 env 会被认成 'electron' 而不是 'node'，
   * 于是它把本地 langPath 当 URL 去 fetch，抛
   *   TypeError: Only absolute URLs are supported
   * 且 createWorker 永远等不到就绪消息（表现为「截图提字一直转圈」）。
   * 缓存命中时它不会走 fetch 分支，所以只要提前把解压好的 traineddata
   * 写进 cachePath 即可，完全离线。
   *
   * @returns {string[]} 本次确认可用的语言
   */
  prepareLanguageCache(langs) {
    const langsArr = String(langs || '').split('+').map((item) => item.trim()).filter(Boolean);
    if (!langsArr.length) throw new Error('没有指定 OCR 语言');
    if (!this.langPath || !this.cachePath) throw new Error('OCR 语言包或缓存目录未配置');
    const prepared = [];
    for (const lang of langsArr) {
      const target = path.join(this.cachePath, `${lang}.traineddata`);
      try {
        if (fs.existsSync(target) && fs.statSync(target).size > 0) {
          prepared.push(lang);
          continue;
        }
      } catch { /* 缓存损坏时按未命中处理 */ }
      const gzPath = path.join(this.langPath, `${lang}.traineddata.gz`);
      if (!fs.existsSync(gzPath)) throw new Error(`缺少离线语言包 ${lang}.traineddata.gz`);
      fs.mkdirSync(this.cachePath, { recursive: true });
      const buffer = zlib.gunzipSync(fs.readFileSync(gzPath));
      if (!buffer.length) throw new Error(`语言包 ${lang} 解压为空，文件可能已损坏`);
      fs.writeFileSync(target, buffer);
      prepared.push(lang);
    }
    return prepared;
  }

  async ensureWorker(langs) {
    this.cancelIdle();
    if (this.worker && this.workerLangs === langs) return this.worker;
    if (this.worker) {
      const old = this.worker;
      this.worker = null;
      await old.terminate().catch(() => {});
    }
    // 必须先预热语言缓存：Electron 主进程里 tesseract.js 会把本地 langPath 当 URL
    this.prepareLanguageCache(langs);
    this.workerLangs = langs;
    this.worker = await loadTesseract().createWorker(langs, 1, {
      langPath: this.langPath,
      gzip: true,
      cachePath: this.cachePath,
      logger: (message) => this.logger(message)
    });
    return this.worker;
  }

  enqueue(task) {
    const run = this.queue.catch(() => {}).then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  async recognizeFile(filePath, langs = 'chi_sim+eng') {
    this.cancelIdle();
    this.pending += 1;
    try {
      return await this.enqueue(async () => {
        const key = `${await hashFile(filePath)}|${langs}|${ENGINE_VERSION}`;
        if (this.resultCache.has(key)) return { ...this.resultCache.get(key), cached: true };
        const worker = await this.ensureWorker(langs);
        const result = await worker.recognize(filePath);
        const data = result?.data || {};
        const payload = {
          text: compactCapture(data.text),
          confidence: Number(data.confidence) || 0,
          blocks: (data.blocks || []).map((block) => ({
            text: compactCapture(block.text),
            confidence: Number(block.confidence) || 0,
            bbox: block.bbox || null
          })).filter((block) => block.text),
          engine: ENGINE_VERSION,
          langs,
          cached: false
        };
        this.resultCache.set(key, payload);
        if (this.resultCache.size > 80) this.resultCache.delete(this.resultCache.keys().next().value);
        return payload;
      });
    } finally {
      this.pending = Math.max(0, this.pending - 1);
      // 整个队列空了才开始计闲置：连续识别多张时不会被中途回收
      if (this.pending === 0) this.scheduleIdle();
    }
  }

  async recognizeBuffer(buffer, langs = 'chi_sim+eng') {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('图片数据为空');
    validatePngBuffer(buffer);
    this.cancelIdle();
    this.pending += 1;
    try {
      return await this.enqueue(async () => {
        const hash = crypto.createHash('sha1').update(buffer).digest('hex');
        const key = `${hash}|${langs}|${ENGINE_VERSION}`;
        if (this.resultCache.has(key)) return { ...this.resultCache.get(key), cached: true };
        const worker = await this.ensureWorker(langs);
        const result = await worker.recognize(buffer);
        const data = result?.data || {};
        const payload = {
          text: compactCapture(data.text),
          confidence: Number(data.confidence) || 0,
          blocks: (data.blocks || []).map((block) => ({
            text: compactCapture(block.text),
            confidence: Number(block.confidence) || 0,
            bbox: block.bbox || null
          })).filter((block) => block.text),
          engine: ENGINE_VERSION,
          langs,
          cached: false
        };
        this.resultCache.set(key, payload);
        if (this.resultCache.size > 80) this.resultCache.delete(this.resultCache.keys().next().value);
        return payload;
      });
    } finally {
      this.pending = Math.max(0, this.pending - 1);
      if (this.pending === 0) this.scheduleIdle();
    }
  }

  async terminate() {
    this.cancelIdle();
    const worker = this.worker;
    this.worker = null;
    this.workerLangs = '';
    if (worker) await worker.terminate().catch(() => {});
  }
}

module.exports = { OcrService, ENGINE_VERSION, validatePngBuffer };
