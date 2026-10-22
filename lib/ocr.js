'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { createWorker } = require('tesseract.js');

const ENGINE_VERSION = 'tesseract.js@5.1.1+tessdata-4.0.0_best_int';

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
    if (this.worker && this.workerLangs === langs) return this.worker;
    if (this.worker) {
      const old = this.worker;
      this.worker = null;
      await old.terminate().catch(() => {});
    }
    // 必须先预热语言缓存：Electron 主进程里 tesseract.js 会把本地 langPath 当 URL
    this.prepareLanguageCache(langs);
    this.workerLangs = langs;
    this.worker = await createWorker(langs, 1, {
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
    return this.enqueue(async () => {
      const key = `${await hashFile(filePath)}|${langs}|${ENGINE_VERSION}`;
      if (this.resultCache.has(key)) return { ...this.resultCache.get(key), cached: true };
      const worker = await this.ensureWorker(langs);
      const result = await worker.recognize(filePath);
      const data = result?.data || {};
      const payload = {
        text: String(data.text || '').trim(),
        confidence: Number(data.confidence) || 0,
        blocks: (data.blocks || []).map((block) => ({
          text: String(block.text || '').trim(),
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
  }

  async terminate() {
    const worker = this.worker;
    this.worker = null;
    this.workerLangs = '';
    if (worker) await worker.terminate().catch(() => {});
  }
}

module.exports = { OcrService, ENGINE_VERSION };