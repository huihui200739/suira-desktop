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

  async terminate() {
    this.cancelIdle();
    const worker = this.worker;
    this.worker = null;
    this.workerLangs = '';
    if (worker) await worker.terminate().catch(() => {});
  }
}

module.exports = { OcrService, ENGINE_VERSION };
