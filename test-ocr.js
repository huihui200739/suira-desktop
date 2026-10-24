'use strict';
/*
 * OCR 语言缓存预热测试（不启动 Electron、不跑真正识别）。
 *
 * 背景：tesseract.js 用 is-electron 判断环境，在 Electron 主进程里会把本地
 * langPath 当成 URL 去 fetch，报 "Only absolute URLs are supported" 并让
 * createWorker 永远等不到就绪（截图提字一直转圈）。OcrService 现在先把
 * 随应用附带的 .traineddata.gz 解压进 cachePath，缓存命中就不会再走 fetch。
 *
 * 用法：node test-ocr.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const { OcrService, ENGINE_VERSION } = require('./lib/ocr');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  PASS  ' + name); pass++; }
  catch (e) { console.log('  FAIL  ' + name + ' -> ' + e.message); fail++; }
};

const tmp = path.join(os.tmpdir(), 'suira-ocr-' + process.pid + '-' + Date.now());
const langDir = path.join(tmp, 'assets');
const cacheDir = path.join(tmp, 'cache');
fs.mkdirSync(langDir, { recursive: true });
fs.mkdirSync(cacheDir, { recursive: true });
fs.writeFileSync(path.join(langDir, 'eng.traineddata.gz'), zlib.gzipSync(Buffer.from('fake-dict-eng')));
fs.writeFileSync(path.join(langDir, 'chi_sim.traineddata.gz'), zlib.gzipSync(Buffer.from('fake-dict-chi')));

const service = new OcrService({ langPath: langDir, cachePath: cacheDir });

console.log('\n== 语言缓存预热 ==');
t('首次预热把 .gz 解压成 tesseract 认的缓存文件', () => {
  const prepared = service.prepareLanguageCache('eng');
  assert.deepStrictEqual(prepared, ['eng']);
  assert.strictEqual(fs.readFileSync(path.join(cacheDir, 'eng.traineddata'), 'utf8'), 'fake-dict-eng');
});
t('多语言（chi_sim+eng）都预热', () => {
  const prepared = service.prepareLanguageCache('chi_sim+eng');
  assert.deepStrictEqual(prepared.sort(), ['chi_sim', 'eng']);
  assert.strictEqual(fs.readFileSync(path.join(cacheDir, 'chi_sim.traineddata'), 'utf8'), 'fake-dict-chi');
});
t('缓存命中后不重复解压（源文件变了也不覆盖）', () => {
  fs.writeFileSync(path.join(langDir, 'eng.traineddata.gz'), zlib.gzipSync(Buffer.from('changed-dict')));
  service.prepareLanguageCache('eng');
  assert.strictEqual(fs.readFileSync(path.join(cacheDir, 'eng.traineddata'), 'utf8'), 'fake-dict-eng');
});
t('缓存文件为空时按未命中重建', () => {
  fs.writeFileSync(path.join(cacheDir, 'eng.traineddata'), '');
  fs.writeFileSync(path.join(langDir, 'eng.traineddata.gz'), zlib.gzipSync(Buffer.from('rebuilt-dict')));
  service.prepareLanguageCache('eng');
  assert.strictEqual(fs.readFileSync(path.join(cacheDir, 'eng.traineddata'), 'utf8'), 'rebuilt-dict');
});
t('缺少语言包时给出可读错误', () => {
  assert.throws(() => service.prepareLanguageCache('jpn'), /缺少离线语言包 jpn/);
});
t('空语言参数报错', () => {
  assert.throws(() => service.prepareLanguageCache(''), /没有指定 OCR 语言/);
});
t('未配置语言包目录时报错', () => {
  assert.throws(() => new OcrService({}).prepareLanguageCache('eng'), /未配置/);
});
t('损坏的 gz 不会被静默吞掉', () => {
  fs.writeFileSync(path.join(langDir, 'bad.traineddata.gz'), Buffer.from('not-gzip'));
  assert.throws(() => service.prepareLanguageCache('bad'));
});

console.log('\n== 随应用附带的真实语言包 ==');
for (const lang of ['chi_sim', 'eng']) {
  t(`assets/tessdata/${lang}.traineddata.gz 存在且是 gzip`, () => {
    const file = path.join(__dirname, 'assets', 'tessdata', `${lang}.traineddata.gz`);
    assert.ok(fs.existsSync(file), '缺少 ' + file);
    const size = fs.statSync(file).size;
    assert.ok(size > 1024 * 1024, `${lang} 语言包过小：${size}`);
    const head = fs.readFileSync(file).subarray(0, 2);
    assert.strictEqual(head[0], 0x1f);
    assert.strictEqual(head[1], 0x8b);
  });
}
t('ENGINE_VERSION 标明引擎与语言包版本', () => {
  assert.match(ENGINE_VERSION, /tesseract\.js@\d/);
  assert.match(ENGINE_VERSION, /tessdata/);
});

/* ---------- 识别引擎闲置回收（后台内存：worker 不能永久占住几百 MB） ---------- */
async function idleTests() {
  console.log('\n== 识别引擎闲置回收 ==');

  const fakeWorker = { terminated: false, async terminate() { this.terminated = true; } };
  const idle = new OcrService({ langPath: langDir, cachePath: cacheDir, idleMs: 60 });
  idle.worker = fakeWorker;
  idle.workerLangs = 'eng';
  idle.scheduleIdle();
  await new Promise((resolve) => setTimeout(resolve, 150));
  t('闲置到点后 worker 被 terminate（把 ~230MB 还回去）', () => {
    assert.strictEqual(fakeWorker.terminated, true);
  });
  t('terminate 后 worker 引用清空，下次识别会重建', () => {
    assert.strictEqual(idle.worker, null);
    assert.strictEqual(idle.workerLangs, '');
  });

  const busyWorker = { terminated: false, async terminate() { this.terminated = true; } };
  const busy = new OcrService({ langPath: langDir, cachePath: cacheDir, idleMs: 60 });
  busy.worker = busyWorker;
  busy.workerLangs = 'eng';
  busy.pending = 1; // 队列里还有识别任务
  busy.scheduleIdle();
  await new Promise((resolve) => setTimeout(resolve, 150));
  t('仍有识别在排队（pending>0）时不回收', () => {
    assert.strictEqual(busyWorker.terminated, false);
  });

  t('cancelIdle 能取消尚未触发的计时', () => {
    const service2 = new OcrService({ langPath: langDir, cachePath: cacheDir, idleMs: 60 });
    service2.worker = { terminate: async () => {} };
    service2.workerLangs = 'eng';
    service2.scheduleIdle();
    assert.ok(service2.idleTimer, '应当已有计时器');
    service2.cancelIdle();
    assert.strictEqual(service2.idleTimer, null);
  });

  t('idleMs=0 表示不自动回收（显式关闭）', () => {
    const service3 = new OcrService({ langPath: langDir, cachePath: cacheDir, idleMs: 0 });
    service3.worker = { terminate: async () => {} };
    service3.workerLangs = 'eng';
    service3.scheduleIdle();
    assert.strictEqual(service3.idleTimer, null);
  });
}

idleTests().then(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  process.exit(fail ? 1 : 0);
}).catch((error) => {
  console.error('FAIL ' + (error && error.stack ? error.stack : error));
  process.exit(1);
});
