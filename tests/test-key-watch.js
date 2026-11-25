'use strict';
const PROJECT_ROOT = require('node:path').resolve(__dirname, '..');


/**
 * lib/key-watch.js + assets/key-watch.ps1 的测试。
 *
 * 与 test-core.js 相同的 t() 写法（PASS/FAIL 逐条输出、末尾汇总、失败退出码 1），
 * 区别只在于 t() 是 async 的，因为状态机与真实子进程都要等异步事件。
 *
 * 覆盖四块：
 *   1. parseAcceleratorToVk 的键位映射与非法输入；
 *   2. 用 EventEmitter + PassThrough 伪造子进程，覆盖 READY/边沿/去重/ERROR/异常退出；
 *   3. stop() / update() 的生命周期；
 *   4. 一条（实为两条）真实 PowerShell 集成用例——不 mock，证明脚本语法与协议正确。
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { spawn } = require('node:child_process');
const { parseAcceleratorToVk, KeyWatchProbe, resolveScriptPath, findCsc, ensureNativeHost, NATIVE_HOST_NAME } = require('../lib/key-watch');

const POWERSHELL = 'powershell.exe';
const SCRIPT_PATH = path.join(PROJECT_ROOT, 'assets', 'key-watch.ps1');

let pass = 0;
let fail = 0;

async function t(name, fn) {
  try {
    await fn();
    console.log('  PASS  ' + name);
    pass++;
  } catch (e) {
    console.log('  FAIL  ' + name + ' -> ' + (e && e.message ? e.message : e));
    fail++;
  }
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function waitFor(predicate, timeoutMs, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('等待超时: ' + label);
}

// ---------------------------------------------------------------------------
// 伪造子进程：EventEmitter + PassThrough。spawnImpl 注入后，KeyWatchProbe 会
// 把它完全当真实 ChildProcess 用（stdout/stderr/stdin/on/once/kill）。
// ---------------------------------------------------------------------------

function createFakeChild() {
  const child = new (require('node:events').EventEmitter)();
  const { PassThrough } = require('node:stream');
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.pid = 4242;
  child.killed = false;
  child.killSignal = '';
  child.stdinEnded = false;

  const realEnd = child.stdin.end.bind(child.stdin);
  child.stdin.end = (...args) => {
    child.stdinEnded = true;
    return realEnd(...args);
  };

  child.kill = (signal) => {
    child.killed = true;
    child.killSignal = signal || 'SIGTERM';
    setImmediate(() => child.emit('exit', 0, child.killSignal));
    return true;
  };

  return child;
}

function makeSpawner() {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    const child = createFakeChild();
    calls.push({ command, args, options, child });
    return child;
  };
  return { calls, spawnImpl };
}

async function feed(child, text) {
  child.stdout.write(text);
  await tick();
}

async function startFake(probe, calls) {
  const starting = probe.start();
  assert.strictEqual(probe.status, 'starting');
  const child = calls[0].child;
  await feed(child, 'READY\n');
  const result = await starting;
  assert.deepStrictEqual(result, { ok: true, error: '' });
  assert.strictEqual(probe.status, 'watching');
  return child;
}

// ---------------------------------------------------------------------------
// 真实 PowerShell 集成：-SelfTest 回放协议，不读真实键盘，不需要人按键。
// ---------------------------------------------------------------------------

function runSelfTestRaw() {
  return new Promise((resolve, reject) => {
    const child = spawn(POWERSHELL, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT_PATH, '-SelfTest', '-PollMs', '25'
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

    const lines = [];
    let buffer = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      reject(new Error('10 秒内未收到 DONE，已收到: [' + lines.join(',') + ']'));
    }, 10000);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        lines.push(line);
        if (line === 'DONE') {
          settled = true;
          clearTimeout(timer);
          resolve({ child, lines });
          return;
        }
      }
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('助手提前退出 code=' + code + '，已收到: [' + lines.join(',') + ']'));
    });
  });
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

(async () => {
  console.log('\n== parseAcceleratorToVk：修饰键 ==');
  await t('CommandOrControl+Alt+Space 映射为 0x11/0x12/0x20', () => {
    assert.deepStrictEqual(parseAcceleratorToVk('CommandOrControl+Alt+Space'),
      { ok: true, error: '', vks: [0x11, 0x12, 0x20] });
  });
  await t('Control+Alt+Space 与 Ctrl 别名结果一致', () => {
    assert.deepStrictEqual(parseAcceleratorToVk('Control+Alt+Space').vks, [0x11, 0x12, 0x20]);
    assert.deepStrictEqual(parseAcceleratorToVk('Ctrl+Alt+Space').vks, [0x11, 0x12, 0x20]);
  });
  await t('不区分大小写且容忍空白：control + ALT + space', () => {
    assert.deepStrictEqual(parseAcceleratorToVk('  control + ALT + space  ').vks, [0x11, 0x12, 0x20]);
  });
  await t('Shift/Super 映射为 0x10/0x5B', () => {
    assert.deepStrictEqual(parseAcceleratorToVk('Shift+Super+Tab').vks, [0x10, 0x5b, 0x09]);
  });
  await t('Command/Cmd/Meta 在 win32 上按 Super 处理', () => {
    assert.deepStrictEqual(parseAcceleratorToVk('Command+A').vks, [0x5b, 0x41]);
    assert.deepStrictEqual(parseAcceleratorToVk('Cmd+A').vks, [0x5b, 0x41]);
    assert.deepStrictEqual(parseAcceleratorToVk('Meta+A').vks, [0x5b, 0x41]);
  });
  await t('重复修饰键去重', () => {
    assert.deepStrictEqual(parseAcceleratorToVk('Control+Control+Alt+Space').vks, [0x11, 0x12, 0x20]);
  });
  await t('修饰键顺序保持出现顺序', () => {
    assert.deepStrictEqual(parseAcceleratorToVk('Alt+Control+Space').vks, [0x12, 0x11, 0x20]);
  });

  console.log('\n== parseAcceleratorToVk：主键 ==');
  await t('A-Z 全部映射到 0x41-0x5A', () => {
    for (let i = 0; i < 26; i++) {
      const letter = String.fromCharCode(65 + i);
      assert.deepStrictEqual(parseAcceleratorToVk('Control+' + letter).vks, [0x11, 0x41 + i], letter);
      assert.deepStrictEqual(parseAcceleratorToVk('Control+' + letter.toLowerCase()).vks, [0x11, 0x41 + i], letter.toLowerCase());
    }
  });
  await t('0-9 全部映射到 0x30-0x39', () => {
    for (let i = 0; i < 10; i++) {
      assert.deepStrictEqual(parseAcceleratorToVk('Control+' + i).vks, [0x11, 0x30 + i], String(i));
    }
  });
  await t('F1/F12/F24 映射到 0x70 起', () => {
    assert.deepStrictEqual(parseAcceleratorToVk('Control+F1').vks, [0x11, 0x70]);
    assert.deepStrictEqual(parseAcceleratorToVk('Control+F12').vks, [0x11, 0x7b]);
    assert.deepStrictEqual(parseAcceleratorToVk('Control+F24').vks, [0x11, 0x87]);
  });
  await t('F25/F0 不属于 F1-F24，返回不支持', () => {
    assert.strictEqual(parseAcceleratorToVk('Control+F25').ok, false);
    assert.strictEqual(parseAcceleratorToVk('Control+F0').ok, false);
    assert.ok(parseAcceleratorToVk('Control+F25').error.indexOf('不支持的按键') === 0);
  });
  await t('Space/Tab/Enter/Esc（含别名）映射正确', () => {
    assert.deepStrictEqual(parseAcceleratorToVk('Control+Space').vks, [0x11, 0x20]);
    assert.deepStrictEqual(parseAcceleratorToVk('Control+Tab').vks, [0x11, 0x09]);
    assert.deepStrictEqual(parseAcceleratorToVk('Control+Enter').vks, [0x11, 0x0d]);
    assert.deepStrictEqual(parseAcceleratorToVk('Control+Return').vks, [0x11, 0x0d]);
    assert.deepStrictEqual(parseAcceleratorToVk('Control+Esc').vks, [0x11, 0x1b]);
    assert.deepStrictEqual(parseAcceleratorToVk('Control+Escape').vks, [0x11, 0x1b]);
  });
  await t('方向键（含 Arrow 别名）映射正确', () => {
    assert.deepStrictEqual(parseAcceleratorToVk('Control+Up').vks, [0x11, 0x26]);
    assert.deepStrictEqual(parseAcceleratorToVk('Control+ArrowDown').vks, [0x11, 0x28]);
    assert.deepStrictEqual(parseAcceleratorToVk('Control+Left').vks, [0x11, 0x25]);
    assert.deepStrictEqual(parseAcceleratorToVk('Control+ArrowRight').vks, [0x11, 0x27]);
  });
  await t('常用符号 - = , . / ; \' [ \\ ] ` 映射到 VK_OEM', () => {
    const expected = {
      '-': 0xbd, '=': 0xbb, ',': 0xbc, '.': 0xbe, '/': 0xbf, ';': 0xba,
      "'": 0xde, '[': 0xdb, '\\': 0xdc, ']': 0xdd, '`': 0xc0
    };
    for (const [symbol, vk] of Object.entries(expected)) {
      assert.deepStrictEqual(parseAcceleratorToVk('Control+' + symbol).vks, [0x11, vk], symbol);
    }
  });
  await t('扩展命名键 Backspace/Delete/Home/End/PageUp/PageDown', () => {
    assert.deepStrictEqual(parseAcceleratorToVk('Control+Backspace').vks, [0x11, 0x08]);
    assert.deepStrictEqual(parseAcceleratorToVk('Control+Delete').vks, [0x11, 0x2e]);
    assert.deepStrictEqual(parseAcceleratorToVk('Control+Home').vks, [0x11, 0x24]);
    assert.deepStrictEqual(parseAcceleratorToVk('Control+End').vks, [0x11, 0x23]);
    assert.deepStrictEqual(parseAcceleratorToVk('Control+PageUp').vks, [0x11, 0x21]);
    assert.deepStrictEqual(parseAcceleratorToVk('Control+PageDown').vks, [0x11, 0x22]);
  });

  console.log('\n== parseAcceleratorToVk：非法输入 ==');
  await t('空字符串/纯空白返回「快捷键不能为空」', () => {
    assert.strictEqual(parseAcceleratorToVk('').error, '快捷键不能为空');
    assert.strictEqual(parseAcceleratorToVk('   ').error, '快捷键不能为空');
    assert.strictEqual(parseAcceleratorToVk(null).error, '快捷键不能为空');
  });
  await t('少于一个修饰键返回错误', () => {
    const result = parseAcceleratorToVk('Space');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, '快捷键至少需要一个修饰键');
    assert.deepStrictEqual(result.vks, []);
  });
  await t('只有修饰键、缺主键返回错误', () => {
    assert.strictEqual(parseAcceleratorToVk('Control+Alt').error, '快捷键缺少主键');
    assert.strictEqual(parseAcceleratorToVk('Control').ok, false);
  });
  await t('未知按键返回「不支持的按键 <名字>」', () => {
    const result = parseAcceleratorToVk('Control+Alt+Bogus');
    assert.strictEqual(result.ok, false);
    assert.ok(result.error.indexOf('不支持的按键') === 0, result.error);
    assert.ok(result.error.indexOf('Bogus') > 0, result.error);
  });
  await t('两个主键返回「只支持一个主键」', () => {
    assert.strictEqual(parseAcceleratorToVk('Control+A+B').error, '只支持一个主键');
  });

  console.log('\n== KeyWatchProbe：启动与 READY ==');
  await t('初始状态 idle，start() 后 starting，READY 后 watching', async () => {
    const { calls, spawnImpl } = makeSpawner();
    const probe = new KeyWatchProbe({ accelerator: 'Control+Alt+Space', spawnImpl });
    assert.strictEqual(probe.status, 'idle');
    const starting = probe.start();
    assert.strictEqual(probe.status, 'starting');
    assert.strictEqual(calls.length, 1);
    await feed(calls[0].child, 'READY\n');
    assert.deepStrictEqual(await starting, { ok: true, error: '' });
    assert.strictEqual(probe.status, 'watching');
  });
  await t('spawn 参数符合协议：windowsHide、-VkCodes、-PollMs', async () => {
    const { calls, spawnImpl } = makeSpawner();
    const probe = new KeyWatchProbe({ accelerator: 'Control+Alt+Space', pollMs: 30, spawnImpl });
    const starting = probe.start();
    await feed(calls[0].child, 'READY\n');
    await starting;
    const call = calls[0];
    assert.strictEqual(call.command, 'powershell.exe');
    assert.deepStrictEqual(call.args, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', probe.scriptPath,
      '-VkCodes', '17,18,32',
      '-PollMs', '30'
    ]);
    assert.strictEqual(call.options.windowsHide, true);
    assert.deepStrictEqual(call.options.stdio, ['pipe', 'pipe', 'pipe']);
  });
  await t('已 watching 时重复 start() 幂等，不重复 spawn', async () => {
    const { calls, spawnImpl } = makeSpawner();
    const probe = new KeyWatchProbe({ accelerator: 'Control+Alt+Space', spawnImpl });
    const starting = probe.start();
    await feed(calls[0].child, 'READY\n');
    await starting;
    assert.deepStrictEqual(await probe.start(), { ok: true, error: '' });
    assert.strictEqual(calls.length, 1);
  });

  console.log('\n== 轻量原生宿主（替代常驻 PowerShell，省 ~67MB）==');
  await t('提供 nativeHost 时直接 spawn 它，参数只剩 -VkCodes / -PollMs', async () => {
    const { calls, spawnImpl } = makeSpawner();
    const probe = new KeyWatchProbe({
      accelerator: 'Control+Alt+Space',
      pollMs: 25,
      nativeHost: 'C:\\fake\\key-watch-host.exe',
      spawnImpl
    });
    const starting = probe.start();
    await feed(calls[0].child, 'READY\n');
    assert.deepStrictEqual(await starting, { ok: true, error: '' });
    assert.strictEqual(calls[0].command, 'C:\\fake\\key-watch-host.exe');
    assert.deepStrictEqual(calls[0].args, ['-VkCodes', '17,18,32', '-PollMs', '25']);
    assert.strictEqual(calls[0].options.windowsHide, true);
  });
  await t('原生宿主起不来时自动回退 PowerShell，功能不丢', async () => {
    const calls = [];
    const spawnImpl = (command, args, options) => {
      const child = createFakeChild();
      calls.push({ command, args, options, child });
      if (command !== 'powershell.exe') throw new Error('blocked by antivirus');
      return child;
    };
    const probe = new KeyWatchProbe({
      accelerator: 'Control+Alt+Space',
      nativeHost: 'C:\\fake\\blocked.exe',
      spawnImpl
    });
    const starting = probe.start();
    // 第一次原生启动同步失败 → 立即重试 PowerShell
    await waitFor(() => calls.length === 2, 1000, '回退到 PowerShell');
    await feed(calls[1].child, 'READY\n');
    assert.deepStrictEqual(await starting, { ok: true, error: '' });
    assert.strictEqual(calls[0].command, 'C:\\fake\\blocked.exe');
    assert.strictEqual(calls[1].command, 'powershell.exe');
    assert.ok(calls[1].args.includes('-File'), '应带 -File 走 ps1 兜底');
    assert.strictEqual(probe.nativeHost, '');
  });
  await t('findCsc 找不到编译器时返回空串，不抛错', () => {
    const fakeFs = { existsSync: () => false };
    assert.strictEqual(findCsc({ WINDIR: 'C:\\Windows' }, fakeFs), '');
  });
  await t('findCsc 优先 Framework64 的 csc.exe', () => {
    const seen = [];
    const fakeFs = { existsSync: (p) => { seen.push(p); return p.endsWith('Framework64\\v4.0.30319\\csc.exe'); } };
    const found = findCsc({ WINDIR: 'C:\\Windows' }, fakeFs);
    assert.ok(found.endsWith('Framework64\\v4.0.30319\\csc.exe'), found);
    assert.ok(seen[0].includes('Framework64'));
  });
  await t('原生宿主按源码复用缓存，源码修改后替换缓存', async () => {
    if (!findCsc()) return;
    const owner = path.resolve(require('node:os').tmpdir());
    const dir = fs.mkdtempSync(path.join(owner, 'suira-keywatch-cache-'));
    const sourcePath = path.join(dir, 'fixture.cs');
    const targetPath = path.join(dir, 'fixture.exe');
    try {
      const options = { sourcePath, targetPath, onError: message => { throw Error(message); } };
      fs.writeFileSync(sourcePath, 'class Fixture { static void Main() {} }');
      const first = await ensureNativeHost(options);
      assert.notEqual(first, targetPath);
      assert.equal(await ensureNativeHost(options), first);
      fs.appendFileSync(sourcePath, '\n// updated');
      const second = await ensureNativeHost(options);
      assert.notEqual(first, second);
      assert.ok(fs.existsSync(second));
      assert.equal(fs.existsSync(first), false);
    } finally {
      assert.equal(path.dirname(path.resolve(dir)), owner);
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
    assert.strictEqual(NATIVE_HOST_NAME, 'key-watch-host.exe');
  });
  await t('ensureNativeHost 参数缺失时返回 null', async () => {
    assert.strictEqual(await ensureNativeHost({}), null);
    assert.strictEqual(await ensureNativeHost({ sourcePath: __filename }), null);
  });
  await t('READY 被拆成多块到达也能正确拼行', async () => {
    const { calls, spawnImpl } = makeSpawner();
    const probe = new KeyWatchProbe({ accelerator: 'Control+Alt+Space', spawnImpl });
    const starting = probe.start();
    await feed(calls[0].child, 'REA');
    assert.strictEqual(probe.status, 'starting');
    await feed(calls[0].child, 'DY\n');
    assert.deepStrictEqual(await starting, { ok: true, error: '' });
    assert.strictEqual(probe.status, 'watching');
  });

  console.log('\n== KeyWatchProbe：边沿与去重 ==');
  await t('DOWN 重复行只触发一次 onDown', async () => {
    const { calls, spawnImpl } = makeSpawner();
    let downs = 0;
    const probe = new KeyWatchProbe({ accelerator: 'Control+Alt+Space', spawnImpl, onDown: () => downs++ });
    await startFake(probe, calls);
    await feed(calls[0].child, 'DOWN\nDOWN\nDOWN\n');
    assert.strictEqual(downs, 1);
    assert.strictEqual(probe.status, 'watching');
  });
  await t('UP 重复行只触发一次 onUp', async () => {
    const { calls, spawnImpl } = makeSpawner();
    let ups = 0;
    const probe = new KeyWatchProbe({ accelerator: 'Control+Alt+Space', spawnImpl, onUp: () => ups++ });
    const starting = probe.start();
    await feed(calls[0].child, 'READY\n');
    await starting;
    await feed(calls[0].child, 'UP\nUP\n');
    assert.strictEqual(ups, 0, '没有按下就不该有 UP');
    await feed(calls[0].child, 'DOWN\n');
    assert.strictEqual(ups, 0);
    await feed(calls[0].child, 'UP\nUP\n');
    assert.strictEqual(ups, 1);
  });
  await t('完整边沿序列 DOWN/UP/DOWN 回调次数正确', async () => {
    const { calls, spawnImpl } = makeSpawner();
    let downs = 0;
    let ups = 0;
    const probe = new KeyWatchProbe({ accelerator: 'Control+Alt+Space', spawnImpl, onDown: () => downs++, onUp: () => ups++ });
    await startFake(probe, calls);
    await feed(calls[0].child, 'DOWN\nUP\nDOWN\n');
    assert.deepStrictEqual([downs, ups], [2, 1]);
  });
  await t('未知行（PowerShell 欢迎信息、空行）被忽略', async () => {
    const { calls, spawnImpl } = makeSpawner();
    let downs = 0;
    let ups = 0;
    let errors = 0;
    const probe = new KeyWatchProbe({ accelerator: 'Control+Alt+Space', spawnImpl, onDown: () => downs++, onUp: () => ups++, onError: () => errors++ });
    await startFake(probe, calls);
    await feed(calls[0].child, 'Windows PowerShell\r\nCopyright (C) Microsoft Corporation.\r\n\r\nsome random line\r\n');
    assert.strictEqual(probe.status, 'watching');
    assert.deepStrictEqual([downs, ups, errors], [0, 0, 0]);
  });
  await t('DOWN 被拆成多块到达也能正确识别', async () => {
    const { calls, spawnImpl } = makeSpawner();
    let downs = 0;
    const probe = new KeyWatchProbe({ accelerator: 'Control+Alt+Space', spawnImpl, onDown: () => downs++ });
    await startFake(probe, calls);
    await feed(calls[0].child, 'DO');
    assert.strictEqual(downs, 0);
    await feed(calls[0].child, 'WN\n');
    assert.strictEqual(downs, 1);
  });

  console.log('\n== KeyWatchProbe：错误路径 ==');
  await t('ERROR 行：status=error、onError 收到原因、子进程被结束', async () => {
    const { calls, spawnImpl } = makeSpawner();
    const errors = [];
    const probe = new KeyWatchProbe({ accelerator: 'Control+Alt+Space', spawnImpl, onError: (m) => errors.push(m) });
    await startFake(probe, calls);
    const child = calls[0].child;
    await feed(child, 'ERROR add-type 编译失败\n');
    assert.strictEqual(probe.status, 'error');
    assert.deepStrictEqual(errors, ['add-type 编译失败']);
    assert.strictEqual(child.killed, true);
    await feed(child, 'DOWN\n');
    assert.strictEqual(probe.child, null);
  });
  await t('子进程 error 事件：status=error 且 onError 被调', async () => {
    const { calls, spawnImpl } = makeSpawner();
    const errors = [];
    const probe = new KeyWatchProbe({ accelerator: 'Control+Alt+Space', spawnImpl, onError: (m) => errors.push(m) });
    const starting = probe.start();
    await feed(calls[0].child, 'READY\n');
    await starting;
    calls[0].child.emit('error', new Error('spawn exploded'));
    await tick();
    assert.strictEqual(probe.status, 'error');
    assert.ok(errors.length === 1 && errors[0].includes('spawn exploded'), JSON.stringify(errors));
  });
  await t('子进程异常退出：status=error 且 onError 被调', async () => {
    const { calls, spawnImpl } = makeSpawner();
    const errors = [];
    const probe = new KeyWatchProbe({ accelerator: 'Control+Alt+Space', spawnImpl, onError: (m) => errors.push(m) });
    await startFake(probe, calls);
    calls[0].child.emit('exit', 3, null);
    await tick();
    assert.strictEqual(probe.status, 'error');
    assert.strictEqual(probe.child, null);
    assert.ok(errors.length === 1 && errors[0].includes('退出'), JSON.stringify(errors));
  });
  await t('按住期间异常退出会补发 onUp，避免面板卡在显示态', async () => {
    const { calls, spawnImpl } = makeSpawner();
    let downs = 0;
    let ups = 0;
    const probe = new KeyWatchProbe({ accelerator: 'Control+Alt+Space', spawnImpl, onDown: () => downs++, onUp: () => ups++ });
    await startFake(probe, calls);
    await feed(calls[0].child, 'DOWN\n');
    assert.deepStrictEqual([downs, ups], [1, 0]);
    calls[0].child.emit('exit', 1, null);
    await tick();
    assert.deepStrictEqual([downs, ups], [1, 1]);
    assert.strictEqual(probe.status, 'error');
  });
  await t('5 秒内收不到 READY：status=error、start 返回失败、子进程被结束', async () => {
    const { calls, spawnImpl } = makeSpawner();
    const errors = [];
    const probe = new KeyWatchProbe({ accelerator: 'Control+Alt+Space', spawnImpl, readyTimeoutMs: 40, onError: (m) => errors.push(m) });
    const starting = probe.start();
    assert.strictEqual(probe.status, 'starting');
    const result = await starting;
    assert.strictEqual(result.ok, false);
    assert.ok(result.error.includes('启动超时'), result.error);
    assert.strictEqual(probe.status, 'error');
    assert.strictEqual(calls[0].child.killed, true);
    assert.strictEqual(errors.length, 1);
  });
  await t('spawn 同步抛错：start 返回失败且 status=error', async () => {
    const spawnImpl = () => { throw new Error('powershell missing'); };
    const errors = [];
    const probe = new KeyWatchProbe({ accelerator: 'Control+Alt+Space', spawnImpl, onError: (m) => errors.push(m) });
    const result = await probe.start();
    assert.strictEqual(result.ok, false);
    assert.ok(result.error.includes('powershell missing'), result.error);
    assert.strictEqual(probe.status, 'error');
    assert.strictEqual(errors.length, 1);
  });
  await t('非法加速键：start 失败、不 spawn、status=error', async () => {
    const { calls, spawnImpl } = makeSpawner();
    const errors = [];
    const probe = new KeyWatchProbe({ accelerator: 'Space', spawnImpl, onError: (m) => errors.push(m) });
    const result = await probe.start();
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, '快捷键至少需要一个修饰键');
    assert.strictEqual(probe.status, 'error');
    assert.strictEqual(calls.length, 0);
    assert.deepStrictEqual(errors, ['快捷键至少需要一个修饰键']);
  });
  await t('stderr 转发到 onError 但不改变 watching 状态', async () => {
    const { calls, spawnImpl } = makeSpawner();
    const errors = [];
    const probe = new KeyWatchProbe({ accelerator: 'Control+Alt+Space', spawnImpl, onError: (m) => errors.push(m) });
    await startFake(probe, calls);
    calls[0].child.stderr.write('a warning on stderr\n');
    await tick();
    assert.deepStrictEqual(errors, ['a warning on stderr']);
    assert.strictEqual(probe.status, 'watching');
  });
  await t('回调抛错不会拖垮侦测状态机', async () => {
    const { calls, spawnImpl } = makeSpawner();
    const reported = [];
    const downError = new Error('synchronous callback failure');
    const upError = new Error('asynchronous callback failure');
    const probe = new KeyWatchProbe({
      accelerator: 'Control+Alt+Space',
      spawnImpl,
      onDown: () => { throw downError; },
      onUp: async () => { throw upError; },
      onDiagnostic: (event, error) => reported.push([event, error])
    });
    await startFake(probe, calls);
    await feed(calls[0].child, 'DOWN\nUP\n');
    assert.strictEqual(probe.status, 'watching');
    assert.deepStrictEqual(reported, [['key-watch-callback', downError], ['key-watch-callback', upError]]);
    await probe.stop();
    assert.strictEqual(reported.length, 2, 'Normal shutdown should not report an error');
  });

  console.log('\n== KeyWatchProbe：stop() 与 update() ==');
  await t('stop() 关闭 stdin、结束子进程，status=stopped', async () => {
    const { calls, spawnImpl } = makeSpawner();
    const probe = new KeyWatchProbe({ accelerator: 'Control+Alt+Space', spawnImpl });
    await startFake(probe, calls);
    const child = calls[0].child;
    await probe.stop();
    assert.strictEqual(probe.status, 'stopped');
    assert.strictEqual(child.stdinEnded, true);
    assert.strictEqual(child.killed, true);
    assert.strictEqual(probe.child, null);
  });
  await t('stop() 之后不再触发 onDown/onUp', async () => {
    const { calls, spawnImpl } = makeSpawner();
    let downs = 0;
    let ups = 0;
    const probe = new KeyWatchProbe({ accelerator: 'Control+Alt+Space', spawnImpl, onDown: () => downs++, onUp: () => ups++ });
    await startFake(probe, calls);
    await feed(calls[0].child, 'DOWN\n');
    await probe.stop();
    await feed(calls[0].child, 'UP\nDOWN\n');
    assert.deepStrictEqual([downs, ups], [1, 0]);
    assert.strictEqual(probe.status, 'stopped');
  });
  await t('stop() 可重复调用且不抛错', async () => {
    const { calls, spawnImpl } = makeSpawner();
    const probe = new KeyWatchProbe({ accelerator: 'Control+Alt+Space', spawnImpl });
    await startFake(probe, calls);
    await probe.stop();
    await probe.stop();
    assert.strictEqual(probe.status, 'stopped');
  });
  await t('update() 用新键重启：旧进程结束、新 VkCodes 生效', async () => {
    const { calls, spawnImpl } = makeSpawner();
    const probe = new KeyWatchProbe({ accelerator: 'Control+Alt+Space', spawnImpl });
    await startFake(probe, calls);
    const oldChild = calls[0].child;

    const updating = probe.update('Alt+Shift+X');
    await waitFor(() => calls.length === 2, 1000, '新助手 spawn');
    assert.strictEqual(oldChild.killed, true, '旧助手必须结束');
    await feed(calls[1].child, 'READY\n');
    const result = await updating;

    assert.deepStrictEqual(result, { ok: true, error: '' });
    assert.strictEqual(probe.status, 'watching');
    assert.strictEqual(probe.accelerator, 'Alt+Shift+X');
    const vkIndex = calls[1].args.indexOf('-VkCodes');
    assert.strictEqual(calls[1].args[vkIndex + 1], '18,16,88');
  });
  await t('update() 非法键：不动正在运行的助手', async () => {
    const { calls, spawnImpl } = makeSpawner();
    const probe = new KeyWatchProbe({ accelerator: 'Control+Alt+Space', spawnImpl });
    await startFake(probe, calls);
    const child = calls[0].child;
    const result = await probe.update('Space');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, '快捷键至少需要一个修饰键');
    assert.strictEqual(probe.status, 'watching');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(child.killed, false);
  });

  console.log('\n== 真实 PowerShell 集成（不 mock）==');
  await t('助手脚本存在且默认路径解析到 assets/key-watch.ps1', () => {
    assert.ok(fs.existsSync(SCRIPT_PATH), SCRIPT_PATH);
    assert.strictEqual(resolveScriptPath(), SCRIPT_PATH);
  });
  await t('真实 -SelfTest：READY/DOWN/UP/DOWN/UP/DONE，关 stdin 后退出码 0', async () => {
    const { child, lines } = await runSelfTestRaw();
    assert.deepStrictEqual(lines, ['READY', 'DOWN', 'UP', 'DOWN', 'UP', 'DONE']);
    const exitInfo = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('关 stdin 后 3 秒助手仍未退出')), 3000);
      child.once('exit', (code) => {
        clearTimeout(timer);
        resolve({ code });
      });
      try { child.stdin.end(); } catch (error) { reject(error); }
    });
    assert.strictEqual(exitInfo.code, 0);
  });
  await t('真实 PowerShell + KeyWatchProbe(-SelfTest)：回调次数正确且 stop() 能停下', async () => {
    let downs = 0;
    let ups = 0;
    const errors = [];
    const probe = new KeyWatchProbe({
      accelerator: 'Control+Alt+Space',
      extraArgs: ['-SelfTest'],
      pollMs: 20,
      onDown: () => downs++,
      onUp: () => ups++,
      onError: (message) => errors.push(message)
    });

    assert.deepStrictEqual(await probe.start(), { ok: true, error: '' });
    assert.strictEqual(probe.status, 'watching');
    await waitFor(() => downs === 2 && ups === 2, 8000, 'SelfTest 的两次 DOWN/UP');
    assert.strictEqual(probe.status, 'watching');
    assert.deepStrictEqual(errors, []);

    await probe.stop();
    assert.strictEqual(probe.status, 'stopped');
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepStrictEqual([downs, ups], [2, 2]);
  });

  console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.log('  FAIL  测试主流程异常 -> ' + (error && error.stack ? error.stack : error));
  console.log('\n========== ' + pass + ' 通过 / ' + (fail + 1) + ' 失败 ==========');
  process.exit(1);
});
