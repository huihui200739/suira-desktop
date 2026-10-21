'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
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

  async ensureWorker(langs) {
    if (this.worker && this.workerLangs === langs) return this.worker;
    if (this.worker) {
      const old = this.worker;
      this.worker = null;
      await old.terminate().catch(() => {});
    }
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