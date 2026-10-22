'use strict';
/*
 * 验证 --diag 自检的字段逻辑（不启动 Electron）。
 *
 * 自检代码跑在 main.js 里，依赖 Electron API，本机无法真跑。
 * 这里把自检里「取数据 → 拼报告」的部分抽出来，用真实的 store 和
 * 真实的 ShortcutManager 跑一遍，确保：
 *   1. 不会因为字段名写错而抛异常
 *   2. 报告里确实包含排查真机问题需要的信息
 *
 * 用法：node test-diagnostics.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SuiraStore } = require('./lib/store');
const { ShortcutManager } = require('./lib/shortcuts');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + ' -> ' + e.message); fail++; } };

console.log('\n== 自检报告的取数逻辑 ==');

// 复刻 main.js 里 collectDiagnostics 的取数方式，验证 API 契约。
// 若 main.js 里字段名写错，这里会失败。
const storeDir = path.join(os.tmpdir(), 'suira-diag-' + process.pid);
fs.mkdirSync(storeDir, { recursive: true });
const storePath = path.join(storeDir, 'diag.json');

const store = new SuiraStore(storePath);
store.addItem({ kind: 'text', title: '测试标题', text: '测试正文' });

t('store.getSettings 返回对象（自检会遍历它的键）', () => {
  const settings = store.getSettings();
  assert.strictEqual(typeof settings, 'object');
  assert.ok(settings !== null);
  // 自检用 JSON.stringify 逐个输出，必须可序列化
  for (const key of Object.keys(settings)) {
    assert.doesNotThrow(() => JSON.stringify(settings[key]), '设置项不可序列化: ' + key);
  }
});

t('store.listItems 支持 limit 且返回数组', () => {
  const items = store.listItems({ limit: 3 });
  assert.ok(Array.isArray(items));
  assert.ok(items.length <= 3);
});

t('内容项具备自检要打印的 kind 与 title 字段', () => {
  const item = store.listItems({ limit: 1 })[0];
  assert.ok(item, '没有内容项');
  assert.ok('kind' in item, '缺少 kind');
  assert.ok('title' in item, '缺少 title');
  assert.doesNotThrow(() => String(item.title || '').slice(0, 24));
});

t('ShortcutManager.snapshot 结构符合自检假设', () => {
  const registered = new Set();
  const gs = {
    register: (a) => { if (registered.has(a)) return false; registered.add(a); return true; },
    unregister: (a) => registered.delete(a),
    isRegistered: (a) => registered.has(a)
  };
  const m = new ShortcutManager({ globalShortcut: gs, handlers: { quick: () => {}, capture: () => {} } });
  m.registerAll();
  const snap = m.snapshot();
  assert.ok(snap.bindings && typeof snap.bindings === 'object');
  assert.ok(snap.status && typeof snap.status === 'object');
  // 自检遍历 bindings 并读 status[name].ok
  for (const name of Object.keys(snap.bindings)) {
    const entry = snap.status[name] || {};
    assert.ok('ok' in entry, '缺少 ok 字段: ' + name);
  }
});

t('清除后的键位在自检里能显示为未绑定而不是崩溃', () => {
  const registered = new Set();
  const gs = {
    register: (a) => { if (registered.has(a)) return false; registered.add(a); return true; },
    unregister: (a) => registered.delete(a),
    isRegistered: (a) => registered.has(a)
  };
  const m = new ShortcutManager({ globalShortcut: gs, handlers: { quick: () => {}, capture: () => {} } });
  m.registerAll();
  m.clear('capture');
  const snap = m.snapshot();
  // 自检的表达式：!accelerator ? '未绑定' : ...
  const accelerator = snap.bindings.capture;
  assert.strictEqual(!accelerator, true, '清除后应无 accelerator');
  assert.strictEqual(snap.status.capture.cleared, true);
});

t('报告包含排查真机问题所必需的字段', () => {
  // 直接从 main.js 源码确认自检确实报告这些项，防止以后被删掉
  const mainJs = fs.readFileSync('main.js', 'utf8');
  const start = mainJs.indexOf('async function collectDiagnostics(');
  assert.ok(start > 0, 'main.js 里找不到 collectDiagnostics');
  const body = mainJs.slice(start, mainJs.indexOf('\n}', start));
  for (const required of [
    '数据目录', '数据目录可写', 'Electron', '屏幕数量', '显示器',
    'OCR 引擎', '剪贴板监听', '托盘', '快捷键', '窗口状态记忆', '剪贴板采集范围', '剪贴板历史条'
  ]) {
    assert.ok(body.includes(required), '自检缺少字段：' + required);
  }
});

t('自检包含第三批新增能力的可观测字段', () => {
  const mainJs = fs.readFileSync('main.js', 'utf8');
  const start = mainJs.indexOf('async function collectDiagnostics(');
  const body = mainJs.slice(start, mainJs.indexOf('\n}', start));
  for (const required of ['浮引岛', '按住型唤起', '暂存条目', '拖入策略']) {
    assert.ok(body.includes(required), '自检缺少字段：' + required);
  }
});

t('自检是只读的，不改设置也不写用户数据', () => {
  const mainJs = fs.readFileSync('main.js', 'utf8');
  const start = mainJs.indexOf('async function collectDiagnostics(');
  const body = mainJs.slice(start, mainJs.indexOf('\n}', start));
  assert.ok(!body.includes('updateSettings'), '自检不应修改设置');
  assert.ok(!body.includes('addItem'), '自检不应写入内容');
  assert.ok(!body.includes('deleteItem'), '自检不应删除内容');
});

t('--diag 开关已接在启动流程上', () => {
  const mainJs = fs.readFileSync('main.js', 'utf8');
  assert.ok(mainJs.includes("process.argv.includes('--diag')"), '未识别 --diag');
  assert.ok(mainJs.includes('diag-report.txt'), '未写出报告文件');
});

t('package.json 提供诊断入口', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.ok(pkg.scripts.diag, '缺少 npm run diag');
  assert.ok(pkg.scripts.diag.includes('--diag'), 'diag 脚本未传 --diag');
});

fs.rmSync(storeDir, { recursive: true, force: true });
console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
process.exit(fail ? 1 : 0);
