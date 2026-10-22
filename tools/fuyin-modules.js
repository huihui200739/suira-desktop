'use strict';
/*
 * 从仓库内保存的浮引 6.0.1 arm64 切片的类/方法索引里，提取第三批各模块的
 * 静态证据：类、实例方法、类方法、实例字段、Swift vtable 槽位。
 *
 * 数据来源：Suira-Windows-Docs/.../research/function-analysis/objc-methods.json
 * 由 otool -ov 解析而来，静态只读，不执行原程序。
 *
 * 重要边界：Swift 类的方法多走直接派发，otool 看不到（instance_methods 为空）。
 * 这类类只能拿到「类存在 + 实例字段名 + vtable 槽位数」，不能据此宣称
 * 已还原其行为。脚本会把这两种证据强度分开标注。
 *
 * 用法：node tools/fuyin-modules.js [模块id...]
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(
  ROOT, 'Suira-Windows-Docs', 'Suira-Windows-Docs',
  'research', 'function-analysis', 'objc-methods.json'
);

if (!fs.existsSync(INDEX)) {
  console.error('找不到方法索引: ' + INDEX);
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const classes = data.classes || [];

/** 去掉 Swift 名字修饰。 */
function shortName(raw) {
  return String(raw)
    .replace(/^_TtC\d+/, '')
    .replace(/^_TtV\d+/, '')
    .replace(/^_TtP\d+_/, '')
    .replace(/^P33_[A-Z0-9]+/, '')
    .replace(/^\d+/, '');
}

const MODULES = [
  { id: 'files-relay', label: '文件中转（浮引岛）', pattern: /FloatingIsland|ShelfState|ShelfStore/i },
  { id: 'edge-entry', label: '边缘入口', pattern: /ScreenEdge|EdgePull|EdgeActivation/i },
  { id: 'right-click', label: '右键入口', pattern: /RightClick|ContextMenu|ServiceMenu/i },
  { id: 'long-capture', label: '长截图', pattern: /LongCapture/i },
  { id: 'record', label: '录屏', pattern: /ScreenRecording|RecordingFeature|RecordingController/i },
  { id: 'note', label: '速记', pattern: /QuickNote|NotesPanel/i },
  { id: 'translate', label: '翻译', pattern: /Translat/i },
  { id: 'custom-hotkey', label: '自定义唤起', pattern: /HotKey|Hotkey|ShortcutRecorder|KeyboardMonitor/i }
];

function analyze(module) {
  const matched = classes.filter((c) => module.pattern.test(String(c.class || '')));
  let objcMethods = 0;
  const methodList = [];
  const ivars = new Set();
  let vtableSlots = 0;
  for (const cls of matched) {
    const name = shortName(cls.class);
    const im = cls.instance_methods || [];
    const cm = cls.class_methods || [];
    objcMethods += im.length + cm.length;
    for (const m of im) methodList.push({ className: name, selector: m.selector || m.name || '', imp: m.imp || m.implementation || '' });
    for (const m of cm) methodList.push({ className: name, selector: '+' + (m.selector || m.name || ''), imp: m.imp || m.implementation || '' });
    for (const v of cls.ivars || []) ivars.add(String(v));
    vtableSlots += (cls.swift_vtable_slots || []).length;
  }
  return { matched, objcMethods, methodList, ivars, vtableSlots };
}

const only = process.argv.slice(2);
const targets = only.length ? MODULES.filter((m) => only.includes(m.id)) : MODULES;

console.log('\n浮引 6.0.1 类索引：' + classes.length + ' 个类 / ' + (data.method_count || '?') + ' 个 Objective-C 方法');
console.log('（otool -ov 静态解析；Swift 类多为直接派发，otool 不可见）\n');

const summary = [];
for (const module of targets) {
  const r = analyze(module);
  console.log('='.repeat(80));
  console.log(module.label + '  [' + module.id + ']');
  console.log('  命中类 ' + r.matched.length + ' · OC 可见方法 ' + r.objcMethods + ' · vtable 槽 ' + r.vtableSlots + ' · 字段 ' + r.ivars.size);
  if (!r.matched.length) {
    console.log('  → 该切片类列表里没有匹配的类：无证据');
    summary.push([module.label, 0, 0, 0, '无类']);
    console.log('');
    continue;
  }
  // 证据强度：有 OC 方法 > 只有字段/vtable
  const strength = r.objcMethods > 0 ? '有方法级证据' : (r.ivars.size || r.vtableSlots ? '仅类与字段级证据' : '仅类名');
  summary.push([module.label, r.matched.length, r.objcMethods, r.ivars.size, strength]);
  console.log('  证据强度: ' + strength);
  console.log('  类:');
  for (const cls of r.matched) {
    const im = (cls.instance_methods || []).length;
    const cm = (cls.class_methods || []).length;
    const vt = (cls.swift_vtable_slots || []).length;
    const iv = (cls.ivars || []).length;
    const tag = im + cm > 0 ? 'OC方法' + (im + cm) : (iv || vt ? 'Swift(字段' + iv + '/槽' + vt + ')' : '空');
    console.log('    - ' + shortName(cls.class).padEnd(46) + tag);
  }
  if (r.methodList.length) {
    console.log('  方法（最多 20 个）:');
    for (const m of r.methodList.slice(0, 20)) console.log('    ' + m.className + ' → ' + m.selector);
  }
  if (r.ivars.size) {
    const list = [...r.ivars];
    console.log('  实例字段（最多 20 个，可推测职责）:');
    console.log('    ' + list.slice(0, 20).join(', '));
  }
  console.log('');
}

console.log('='.repeat(80));
console.log('汇总\n');
console.log('模块'.padEnd(20) + '类数'.padEnd(8) + 'OC方法'.padEnd(9) + '字段'.padEnd(8) + '证据强度');
for (const [label, c, m, i, s] of summary) {
  console.log(label.padEnd(18) + String(c).padEnd(8) + String(m).padEnd(9) + String(i).padEnd(8) + s);
}
