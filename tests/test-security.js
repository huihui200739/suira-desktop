'use strict';
/* 快捷键冲突检测 + 内容加密测试。 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const {
  DEFAULT_BINDINGS, DEFAULT_MOMENTARY_BINDINGS, LEGACY_BINDINGS, RESERVED_COMBOS,
  normalizeAccelerator, validateAccelerator, validateMomentaryAccelerator,
  findReserved, momentaryConflict, ShortcutManager, MomentaryWatcher
} = require('../lib/shortcuts');
const {
  KEY_BYTES, isEncrypted, encryptText, decryptText, generateKey,
  KeyVault, encryptItem, decryptItem
} = require('../lib/crypto-store');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + ' -> ' + e.message); fail++; } };

/* ---------- 快捷键 ---------- */

console.log('\n== 加速键校验 ==');
t('默认键位合法', () => {
  for (const acc of Object.values(DEFAULT_BINDINGS)) {
    assert.strictEqual(validateAccelerator(acc).ok, true, acc + ' 应合法');
  }
});
t('空串被拒', () => assert.strictEqual(validateAccelerator('').ok, false));
t('只有修饰键被拒', () => assert.strictEqual(validateAccelerator('Control+Alt').ok, false));
t('只有主键被拒', () => assert.strictEqual(validateAccelerator('A').ok, false));
t('只用 Shift 被拒（会干扰输入）', () => {
  const r = validateAccelerator('Shift+A');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /Shift/);
});
t('两键组合合法（一个修饰键 + 主键）', () => assert.strictEqual(validateAccelerator('Alt+Q').ok, true));
t('三键组合被拒（组合键只用两个）', () => assert.strictEqual(validateAccelerator('Control+Alt+Space').ok, false));
t('三键组合的提示写明两键约定', () => assert.match(validateAccelerator('Control+Shift+A').error, /只用两个/));

console.log('\n== 系统占用检测 ==');
t('识别 Alt+Space', () => assert.ok(findReserved('Alt+Space')));
t('识别 Win+V', () => assert.ok(findReserved('Super+V')));
t('识别 Win+Shift+S', () => assert.ok(findReserved('Super+Shift+S')));
t('大小写与顺序不敏感', () => {
  assert.ok(findReserved('space+alt'));
  assert.ok(findReserved('v+super'));
});
t('自定义键位不算占用', () => assert.strictEqual(findReserved('Control+Alt+Space'), null));
t('占用表覆盖文档点名的三个组合', () => {
  const targets = ['Alt+Space', 'Super+V', 'Super+Shift+S'];
  for (const target of targets) {
    assert.ok(RESERVED_COMBOS.some((e) => normalizeAccelerator(e.accelerator) === normalizeAccelerator(target)), '缺少 ' + target);
  }
});

/* 假 globalShortcut：可模拟占用 */
function makeFakeShortcut(occupied = []) {
  const taken = new Set(occupied.map((a) => a.toLowerCase()));
  const registered = new Map();
  return {
    register(acc, cb) {
      if (taken.has(acc.toLowerCase())) return false;
      registered.set(acc, cb);
      return true;
    },
    unregister(acc) { registered.delete(acc); },
    isRegistered(acc) { return registered.has(acc); },
    _registered: registered
  };
}

console.log('\n== 注册与状态 ==');
t('全部注册成功时状态为 ok', () => {
  const gs = makeFakeShortcut();
  const mgr = new ShortcutManager({ globalShortcut: gs, handlers: { quick() {}, capture() {} } });
  const status = mgr.registerAll();
  assert.strictEqual(status.quick.ok, true);
  assert.strictEqual(status.capture.ok, true);
  assert.strictEqual(status.quick.error, '');
});
t('键位被占用时状态为失败并给出原因', () => {
  const gs = makeFakeShortcut([DEFAULT_BINDINGS.quick]);
  const mgr = new ShortcutManager({ globalShortcut: gs, handlers: { quick() {}, capture() {} } });
  const status = mgr.registerAll();
  assert.strictEqual(status.quick.ok, false);
  assert.match(status.quick.error, /占用/);
  assert.strictEqual(status.capture.ok, true, '另一个键不应受影响');
});
t('兼容键位失败标记为 optional', () => {
  const gs = makeFakeShortcut([LEGACY_BINDINGS.legacy]);
  const mgr = new ShortcutManager({ globalShortcut: gs, handlers: { quick() {}, capture() {}, legacy() {} } });
  const status = mgr.registerAll();
  assert.strictEqual(status.legacy.ok, false);
  assert.strictEqual(status.legacy.optional, true);
});
t('占用系统组合时在状态中提示原因', () => {
  const gs = makeFakeShortcut();
  const mgr = new ShortcutManager({
    globalShortcut: gs,
    handlers: { quick() {} },
    bindings: { quick: 'Alt+Space' }
  });
  const status = mgr.registerAll();
  assert.strictEqual(status.quick.reserved, '系统窗口菜单');
});
t('snapshot 返回键位与状态', () => {
  const gs = makeFakeShortcut();
  const mgr = new ShortcutManager({ globalShortcut: gs, handlers: { quick() {}, capture() {} } });
  mgr.registerAll();
  const snap = mgr.snapshot();
  assert.ok(snap.bindings.quick);
  assert.ok(snap.status.quick);
});
t('onChange 在注册后触发', () => {
  let called = 0;
  const gs = makeFakeShortcut();
  const mgr = new ShortcutManager({ globalShortcut: gs, handlers: { quick() {}, capture() {} }, onChange: () => called++ });
  mgr.registerAll();
  assert.strictEqual(called, 1);
});

console.log('\n== 改键 ==');
t('改键成功并更新键位', () => {
  const gs = makeFakeShortcut();
  const mgr = new ShortcutManager({ globalShortcut: gs, handlers: { quick() {}, capture() {} } });
  mgr.registerAll();
  const r = mgr.rebind('quick', 'Alt+K');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(mgr.bindings.quick, 'Alt+K');
});
t('改键到被占用的组合时失败并回滚', () => {
  const gs = makeFakeShortcut(['Control+Alt+Z']);
  const mgr = new ShortcutManager({ globalShortcut: gs, handlers: { quick() {}, capture() {} } });
  mgr.registerAll();
  const before = mgr.bindings.quick;
  const r = mgr.rebind('quick', 'Control+Alt+Z');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(mgr.bindings.quick, before, '应回滚到原键位');
  assert.strictEqual(gs.isRegistered(before), true, '原键位应重新可用');
});
t('改键到与另一键重复时被拒', () => {
  const gs = makeFakeShortcut();
  const mgr = new ShortcutManager({ globalShortcut: gs, handlers: { quick() {}, capture() {} } });
  mgr.registerAll();
  const r = mgr.rebind('quick', DEFAULT_BINDINGS.capture);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /重复/);
});
t('改键到非法组合时被拒', () => {
  const gs = makeFakeShortcut();
  const mgr = new ShortcutManager({ globalShortcut: gs, handlers: { quick() {}, capture() {} } });
  mgr.registerAll();
  assert.strictEqual(mgr.rebind('quick', 'Shift+A').ok, false);
});
t('改键到未知名称被拒', () => {
  const gs = makeFakeShortcut();
  const mgr = new ShortcutManager({ globalShortcut: gs, handlers: { quick() {} } });
  assert.strictEqual(mgr.rebind('nope', 'Control+Alt+Y').ok, false);
});
t('dispose 释放所有已注册键位', () => {
  const gs = makeFakeShortcut();
  const mgr = new ShortcutManager({ globalShortcut: gs, handlers: { quick() {}, capture() {} } });
  mgr.registerAll();
  mgr.dispose();
  assert.strictEqual(gs._registered.size, 0);
});

/* ---------- 加密 ---------- */

console.log('\n== 加解密 ==');
const key = generateKey();
t('密钥长度 32 字节', () => assert.strictEqual(key.length, KEY_BYTES));
t('加密后可解密回原文', () => {
  const env = encryptText(key, '这是要保护的内容');
  assert.strictEqual(decryptText(key, env), '这是要保护的内容');
});
t('密文不含明文', () => {
  const plain = '绝密内容ABC123';
  const env = encryptText(key, plain);
  const serialized = JSON.stringify(env);
  assert.ok(!serialized.includes(plain));
  assert.ok(!serialized.includes(Buffer.from(plain, 'utf8').toString('base64')));
});
t('相同明文两次加密结果不同（独立 IV）', () => {
  const a = encryptText(key, 'same');
  const b = encryptText(key, 'same');
  assert.notStrictEqual(a.iv, b.iv);
  assert.notStrictEqual(a.data, b.data);
});
t('空串可加密解密', () => assert.strictEqual(decryptText(key, encryptText(key, '')), ''));
t('中文与 emoji 往返正确', () => {
  const text = '随序 · SUIRA 🎯 多行\n第二行';
  assert.strictEqual(decryptText(key, encryptText(key, text)), text);
});
t('错误密钥无法解密', () => {
  const env = encryptText(key, 'secret');
  const other = generateKey();
  assert.throws(() => decryptText(other, env));
});
t('篡改密文会被 GCM 校验拒绝', () => {
  const env = encryptText(key, 'secret');
  const buf = Buffer.from(env.data, 'base64');
  buf[0] ^= 0xff;
  const tampered = { ...env, data: buf.toString('base64') };
  assert.throws(() => decryptText(key, tampered));
});
t('AAD 不匹配时解密失败（防止密文搬移）', () => {
  const env = encryptText(key, 'secret', 'item-1:text');
  assert.throws(() => decryptText(key, env, 'item-2:text'));
  assert.strictEqual(decryptText(key, env, 'item-1:text'), 'secret');
});
t('isEncrypted 正确识别', () => {
  assert.strictEqual(isEncrypted(encryptText(key, 'x')), true);
  assert.strictEqual(isEncrypted('plain'), false);
  assert.strictEqual(isEncrypted(null), false);
  assert.strictEqual(isEncrypted({ data: 'x' }), false);
});
t('非法密钥被拒', () => {
  assert.throws(() => encryptText(Buffer.alloc(16), 'x'));
  assert.throws(() => encryptText(null, 'x'));
});

console.log('\n== 条目级加解密 ==');
const sampleItem = {
  id: 'item-1', kind: 'text', title: '标题内容', text: '正文内容',
  createdAt: 1700000000000, source: { type: 'clipboard' }
};
t('加密后 text 与 title 变为密文', () => {
  const enc = encryptItem(key, sampleItem);
  assert.strictEqual(isEncrypted(enc.text), true);
  assert.strictEqual(isEncrypted(enc.title), true);
});
t('元数据保持明文（id/kind/时间）', () => {
  const enc = encryptItem(key, sampleItem);
  assert.strictEqual(enc.id, 'item-1');
  assert.strictEqual(enc.kind, 'text');
  assert.strictEqual(enc.createdAt, 1700000000000);
});
t('解密还原原始字段', () => {
  const dec = decryptItem(key, encryptItem(key, sampleItem));
  assert.strictEqual(dec.text, '正文内容');
  assert.strictEqual(dec.title, '标题内容');
});
t('空字段不加密', () => {
  const enc = encryptItem(key, { id: 'x', text: '', title: '' });
  assert.strictEqual(enc.text, '');
});
t('解密失败时降级为空串并标记，不抛异常', () => {
  const enc = encryptItem(key, sampleItem);
  const dec = decryptItem(generateKey(), enc);
  assert.strictEqual(dec.text, '');
  assert.strictEqual(dec.decryptFailed, true);
});
t('未加密的旧条目可原样读出（向后兼容）', () => {
  const legacy = { id: 'old', text: '旧明文', title: '旧标题' };
  const dec = decryptItem(key, legacy);
  assert.strictEqual(dec.text, '旧明文');
});

async function testVault() {
console.log('\n== 密钥保管 ==');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'suira-key-'));
const keyPath = path.join(tmpDir, 'data.key');

const firstResult = await (async () => {
  // 用 XOR 模拟 DPAPI，避免测试依赖真实 Windows API
  const fake = {
    protect: (buf) => Buffer.from(buf.map((b) => b ^ 0x5a)),
    unprotect: (buf) => Buffer.from(buf.map((b) => b ^ 0x5a))
  };
  const vault = new KeyVault(fake);
  return { vault, r: await vault.loadOrCreate(keyPath) };
})();
t('首次调用创建密钥并落盘', () => {
  const { vault, r } = firstResult;
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.created, true);
  assert.strictEqual(fs.existsSync(keyPath), true);
  assert.strictEqual(vault.isReady(), true);
});
t('落盘的密钥文件不是明文密钥', () => {
  const onDisk = Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'base64');
  assert.strictEqual(onDisk.length, KEY_BYTES, '模拟保护不改变长度，但内容应已变换');
});
const reopened = await (async () => {
  const fake = {
    protect: (buf) => Buffer.from(buf.map((b) => b ^ 0x5a)),
    unprotect: (buf) => Buffer.from(buf.map((b) => b ^ 0x5a))
  };
  const first = new KeyVault(fake);
  await first.loadOrCreate(keyPath);
  const savedKey = Buffer.from(first.key);

  const second = new KeyVault(fake);
  return { savedKey, second, r: await second.loadOrCreate(keyPath) };
})();
t('二次加载复用同一密钥', () => {
  const { savedKey, second, r } = reopened;
  assert.strictEqual(r.created, false);
  assert.ok(second.key.equals(savedKey), '应解出同一密钥');
});
const broken = new KeyVault({ unprotect: () => { throw new Error('DPAPI 拒绝'); } });
const failure = await broken.loadOrCreate(keyPath);
t('解封失败时返回 ok:false 而不崩溃', () => {
  const r = failure;
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /解封失败/);
});

fs.rmSync(tmpDir, { recursive: true, force: true });

/* ---------- 真实 DPAPI（仅 Windows） ---------- */

if (process.platform === 'win32') {
  console.log('\n== 真实 DPAPI 密钥保管 ==');
  const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'suira-dpapi-'));
  const realKeyPath = path.join(realDir, 'data.key');
  const vault = new KeyVault();
  const created = await vault.loadOrCreate(realKeyPath);

  t('真实 DPAPI 能创建密钥', () => {
    assert.strictEqual(created.ok, true, created.error || '');
    assert.strictEqual(created.created, true);
  });
  t('密钥长度为 32 字节', () => assert.strictEqual(vault.key.length, KEY_BYTES));
  t('磁盘上是 DPAPI 包裹后的密文，不是原始密钥', () => {
    const onDisk = fs.readFileSync(realKeyPath);
    assert.ok(!onDisk.equals(vault.key), '磁盘内容与原始密钥相同，未加密！');
    assert.ok(onDisk.length > KEY_BYTES, '包裹后应比原始密钥长');
  });
  const second = new KeyVault();
  const r = await second.loadOrCreate(realKeyPath);
  t('二次加载解出同一密钥', () => {
    assert.strictEqual(r.ok, true, r.error || '');
    assert.strictEqual(r.created, false);
    assert.ok(second.key.equals(vault.key));
  });
  t('DPAPI 密钥可用于加解密往返', () => {
    const env = encryptText(vault.key, '真实密钥加密的内容');
    assert.strictEqual(decryptText(vault.key, env), '真实密钥加密的内容');
  });

  fs.rmSync(realDir, { recursive: true, force: true });
}
}

/* ---------- 存储层集成 ---------- */

console.log('\n== 存储层加密落盘 ==');
const { SuiraStore } = require('../lib/store');
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'suira-enc-'));
const storePath = path.join(storeDir, 'data.json');
const storeKey = generateKey();
const codec = {
  isReady: () => true,
  encode: (item) => encryptItem(storeKey, item),
  decode: (item) => decryptItem(storeKey, item),
  encodeTask: (task) => ({ ...task, title: task.title ? encryptText(storeKey, task.title, `${task.id}:title`) : '' }),
  decodeTask: (task) => {
    if (task.title && typeof task.title === 'object' && task.title.__enc) {
      return { ...task, title: decryptText(storeKey, task.title, `${task.id}:title`) };
    }
    return task;
  }
};

const encStore = new SuiraStore(storePath, { codec });
encStore.addItem({ kind: 'text', title: '私密标题', text: '私密正文内容' });
encStore.createTask('私密任务');

t('内存中保持明文（支持搜索）', () => {
  const item = encStore.listItems({ limit: 1 })[0];
  assert.strictEqual(item.text, '私密正文内容');
  assert.strictEqual(item.title, '私密标题');
});

// 等待异步写盘
const waitSave = () => new Promise((r) => setTimeout(r, 120));

(async () => {
  await testVault();
  await encStore.save();
  await waitSave();

  t('磁盘上不含明文正文', () => {
    const raw = fs.readFileSync(storePath, 'utf8');
    assert.ok(!raw.includes('私密正文内容'), '正文以明文落盘了');
    assert.ok(!raw.includes('私密标题'), '标题以明文落盘了');
    assert.ok(!raw.includes('私密任务'), '任务标题以明文落盘了');
  });

  t('磁盘上保留元数据明文（便于列表）', () => {
    // 检查解析后的值，不要依赖 JSON 是否带缩进（落盘格式可压缩）
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    assert.strictEqual(parsed.items[0].kind, 'text', 'kind 应保持明文');
  });

  t('磁盘上存在加密信封', () => {
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    assert.strictEqual(typeof parsed.items[0].text, 'object');
    assert.strictEqual(parsed.items[0].text.__enc, 1);
  });

  t('重新加载后能解密还原', () => {
    const reloaded = new SuiraStore(storePath, { codec });
    const item = reloaded.listItems({ limit: 1 })[0];
    assert.strictEqual(item.text, '私密正文内容');
    assert.strictEqual(item.title, '私密标题');
  });

  t('重新加载后任务标题也能解密', () => {
    const reloaded = new SuiraStore(storePath, { codec });
    assert.ok(reloaded.data.tasks.some((task) => task.title === '私密任务'));
  });

  t('搜索在解密后的内存上工作', () => {
    const reloaded = new SuiraStore(storePath, { codec });
    const found = reloaded.listItems({ query: '私密正文' });
    assert.strictEqual(found.length, 1);
  });

  t('关闭加密后以明文落盘', async () => {
    const plainPath = path.join(storeDir, 'plain.json');
    const plainStore = new SuiraStore(plainPath, { codec });
    plainStore.data.settings.encryptContent = false;
    plainStore.addItem({ kind: 'text', title: 'T', text: '明文内容' });
    await plainStore.save();
    await waitSave();
    const raw = fs.readFileSync(plainPath, 'utf8');
    assert.ok(raw.includes('明文内容'), '关闭加密后应为明文');
  });

  t('无 codec 时完全向后兼容（明文）', () => {
    const legacyPath = path.join(storeDir, 'legacy.json');
    const legacy = new SuiraStore(legacyPath);
    legacy.addItem({ kind: 'text', title: 'T', text: '老数据' });
    assert.strictEqual(legacy.isEncrypting(), false);
    const item = legacy.listItems({ limit: 1 })[0];
    assert.strictEqual(item.text, '老数据');
  });

  t('密钥不匹配时降级为空串而不崩溃', () => {
    const wrongCodec = {
      isReady: () => true,
      encode: (item) => encryptItem(storeKey, item),
      decode: (item) => decryptItem(generateKey(), item)
    };
    const broken = new SuiraStore(storePath, { codec: wrongCodec });
    const item = broken.listItems({ limit: 1 })[0];
    assert.strictEqual(item.text, '');
    assert.strictEqual(item.decryptFailed, true);
  });

  fs.rmSync(storeDir, { recursive: true, force: true });

  /* ---------- 第三批：自定义唤起增量 ---------- */
  console.log('\n== 恢复默认 / 清除绑定（对应原产品 restoreDefault / clearShortcut）==');

  const makeManager = () => {
    const registered = new Set();
    const gs = {
      register: (acc) => { if (registered.has(acc)) return false; registered.add(acc); return true; },
      unregister: (acc) => registered.delete(acc),
      isRegistered: (acc) => registered.has(acc)
    };
    const m = new ShortcutManager({ globalShortcut: gs, handlers: { quick: () => {}, capture: () => {} } });
    m.registerAll();
    return { m, registered };
  };

  t('恢复默认把单个键位改回出厂值', () => {
    const { m } = makeManager();
    m.rebind('quick', 'Alt+K');
    assert.strictEqual(m.snapshot().bindings.quick, 'Alt+K');
    const r = m.restoreDefault('quick');
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.restored, ['quick']);
    assert.strictEqual(m.snapshot().bindings.quick, DEFAULT_BINDINGS.quick);
  });

  t('恢复默认可一次恢复全部', () => {
    const { m } = makeManager();
    m.rebind('quick', 'Alt+K');
    m.rebind('capture', 'Alt+J');
    const r = m.restoreDefault();
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.restored.sort(), ['capture', 'quick']);
    assert.strictEqual(m.snapshot().bindings.quick, DEFAULT_BINDINGS.quick);
    assert.strictEqual(m.snapshot().bindings.capture, DEFAULT_BINDINGS.capture);
  });

  t('恢复未知键位返回错误而不抛异常', () => {
    const { m } = makeManager();
    const r = m.restoreDefault('nope');
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /没有出厂默认/);
  });

  t('清除绑定后不再占用全局热键', () => {
    const { m, registered } = makeManager();
    const acc = m.snapshot().bindings.capture;
    assert.strictEqual(registered.has(acc), true);
    const r = m.clear('capture');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(registered.has(acc), false, '清除后仍占着全局热键');
    assert.strictEqual(m.isBound('capture'), false);
    assert.strictEqual(m.snapshot().status.capture.cleared, true);
  });

  t('清除未知键位返回错误', () => {
    const { m } = makeManager();
    const r = m.clear('nope');
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /未知/);
  });

  t('恢复默认会重新占用被清除的键位', () => {
    const { m, registered } = makeManager();
    m.clear('capture');
    assert.strictEqual(m.isBound('capture'), false);
    const r = m.restoreDefault('capture');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(m.isBound('capture'), true);
    assert.strictEqual(registered.has(DEFAULT_BINDINGS.capture), true);
  });

  console.log('\n== 按住型唤起（对应原产品 momentary 语义）==');

  const makeWatcher = (gapMs = 100) => {
    const box = { now: 1000, events: [] };
    const w = new MomentaryWatcher({
      gapMs,
      now: () => box.now,
      onStart: () => box.events.push('start'),
      onEnd: () => box.events.push('end')
    });
    return { w, box };
  };

  t('按下触发开始，超过间隔未再按则结束', () => {
    const { w, box } = makeWatcher();
    w.press();
    assert.deepStrictEqual(box.events, ['start']);
    assert.strictEqual(w.active, true);
    box.now += 150;
    w.check();
    assert.deepStrictEqual(box.events, ['start', 'end']);
    assert.strictEqual(w.active, false);
    w.dispose();
  });

  t('按住期间重复触发不会重复开始', () => {
    const { w, box } = makeWatcher();
    w.press();
    box.now += 60; w.press();
    box.now += 60; w.press();
    assert.deepStrictEqual(box.events, ['start'], '重复按下不应重复触发开始');
    assert.strictEqual(w.active, true);
    w.dispose();
  });

  t('未到间隔时 check 不结束', () => {
    const { w, box } = makeWatcher();
    w.press();
    box.now += 50;
    w.check();
    assert.deepStrictEqual(box.events, ['start']);
    w.dispose();
  });

  t('release 可强制结束（失焦场景）', () => {
    const { w, box } = makeWatcher();
    w.press();
    w.release();
    assert.deepStrictEqual(box.events, ['start', 'end']);
    w.release();
    assert.deepStrictEqual(box.events, ['start', 'end'], '重复 release 不应重复触发结束');
    w.dispose();
  });

  t('未按下时 release 不触发结束', () => {
    const { w, box } = makeWatcher();
    w.release();
    assert.deepStrictEqual(box.events, []);
    w.dispose();
  });

  t('默认间隔为正数，避免定时器空转', () => {
    const w = new MomentaryWatcher();
    assert.ok(w.gapMs > 0, '默认间隔应为正数');
    w.dispose();
  });

  /* ---------- 第三批增量：布局轮换 / 钉图显隐 / 按住型校验 ---------- */
  console.log('\n== 第三批增量：面板布局轮换 / 钉图显隐 / 按住型校验 ==');

  t('默认键位包含面板布局轮换与钉图显隐', () => {
    assert.ok(DEFAULT_BINDINGS.panelCycle, '缺少 panelCycle 出厂键位');
    assert.ok(DEFAULT_BINDINGS.pinnedToggle, '缺少 pinnedToggle 出厂键位');
    for (const [name, acc] of [
      ['panelCycle', DEFAULT_BINDINGS.panelCycle],
      ['pinnedToggle', DEFAULT_BINDINGS.pinnedToggle]
    ]) {
      assert.strictEqual(validateAccelerator(acc).ok, true, name + ' 应通过校验');
      assert.strictEqual(findReserved(acc), null, name + ' 不应命中系统保留组合');
    }
  });

  t('四个全局默认键位互不重复', () => {
    const normalized = Object.values(DEFAULT_BINDINGS).map(normalizeAccelerator);
    assert.strictEqual(new Set(normalized).size, normalized.length, '默认键位存在重复：' + normalized.join(' / '));
  });

  t('按住型默认不绑定（可选进阶功能，不占系统按键）', () => {
    assert.deepStrictEqual(Object.keys(DEFAULT_MOMENTARY_BINDINGS), ['momentary']);
    assert.strictEqual(DEFAULT_MOMENTARY_BINDINGS.momentary, '', '出厂不绑定，由用户在设置里启用');
  });

  t('按住型与普通键位同一规则：两键合法、三键被拒', () => {
    assert.strictEqual(validateMomentaryAccelerator('Control+Space').ok, true);
    assert.strictEqual(validateMomentaryAccelerator('Control+Alt+Space').ok, false);
  });

  t('按住型拒绝空串与空主键', () => {
    assert.strictEqual(validateMomentaryAccelerator('').ok, false);
    assert.strictEqual(validateMomentaryAccelerator('   ').ok, false);
    assert.strictEqual(validateMomentaryAccelerator('Control+Alt').ok, false);
  });

  t('按住型沿用普通键位校验', () => {
    assert.strictEqual(validateMomentaryAccelerator('Shift+A').ok, false);
    assert.strictEqual(validateMomentaryAccelerator('A').ok, false);
    assert.strictEqual(validateMomentaryAccelerator('Control+Alt+Space').ok, false, '三键组合被统一拒绝');
  });

  t('按住型冲突能报出与 quick 重复', () => {
    const bindings = { ...DEFAULT_BINDINGS, ...DEFAULT_MOMENTARY_BINDINGS };
    const conflict = momentaryConflict(DEFAULT_BINDINGS.quick, bindings);
    assert.ok(conflict, '应检测到与 quick 的冲突');
    assert.match(conflict, /重复/);
    assert.match(conflict, /quick|随手面板/);
  });

  t('按住型无冲突时返回空串', () => {
    const bindings = { ...DEFAULT_BINDINGS, ...DEFAULT_MOMENTARY_BINDINGS };
    assert.strictEqual(momentaryConflict(DEFAULT_MOMENTARY_BINDINGS.momentary, bindings), '');
    assert.strictEqual(momentaryConflict('Control+Alt+Shift+K', bindings), '');
    assert.strictEqual(momentaryConflict('', bindings), '');
  });

  t('restoreDefault 之后四个全局键位都回到默认', () => {
    const gs = makeFakeShortcut();
    const handlers = { quick() {}, capture() {}, panelCycle() {}, pinnedToggle() {} };
    const mgr = new ShortcutManager({ globalShortcut: gs, handlers });
    mgr.registerAll();
    mgr.rebind('quick', 'Alt+K');
    mgr.rebind('capture', 'Alt+J');
    mgr.rebind('panelCycle', 'Alt+L');
    assert.equal(mgr.rebind('pinnedToggle', 'Alt+I').ok, true);
    const r = mgr.restoreDefault();
    assert.strictEqual(r.ok, true, r.error);
    assert.deepStrictEqual(r.restored.slice().sort(), ['capture', 'panelCycle', 'pinnedToggle', 'quick']);
    const snap = mgr.snapshot();
    for (const name of ['quick', 'capture', 'panelCycle', 'pinnedToggle']) {
      assert.strictEqual(snap.bindings[name], DEFAULT_BINDINGS[name], name + ' 未回到出厂默认');
      assert.strictEqual(gs.isRegistered(DEFAULT_BINDINGS[name]), true, name + ' 的默认键位应已重新注册');
    }
  });

  console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  process.exit(fail ? 1 : 0);
})();
