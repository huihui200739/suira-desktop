'use strict';
/* 输入注入：脚本内容、可用性、调用协议、失败处理。 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { InputInjector, PS_SCRIPT, INJECT_TIMEOUT } = require('../lib/input-injector');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + ' -> ' + e.message); fail++; } };
const ta = async (n, f) => { try { await f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + ' -> ' + e.message); fail++; } };

console.log('\n== 脚本内容 ==');
t('脚本调用 SendInput', () => {
  assert.ok(PS_SCRIPT.includes('SendInput'), '未调用 SendInput');
  assert.ok(PS_SCRIPT.includes('user32.dll'), '未声明 user32');
});
t('使用扫描码方式（兼容性更好）', () => {
  assert.ok(PS_SCRIPT.includes('KEYEVENTF_SCANCODE'), '未使用扫描码');
  assert.ok(PS_SCRIPT.includes('MapVirtualKey'), '未映射扫描码');
});
t('粘贴是 Ctrl+V 四个事件（按下/抬起成对）', () => {
  assert.ok(PS_SCRIPT.includes('VK_CONTROL'), '缺少 Ctrl');
  assert.ok(PS_SCRIPT.includes('VK_V'), '缺少 V');
  assert.ok(PS_SCRIPT.includes('new INPUT[4]'), '应为 4 个事件');
});
t('按键抬起标志存在（否则会卡住修饰键）', () => {
  assert.ok(PS_SCRIPT.includes('KEYEVENTF_KEYUP'), '缺少抬起标志');
});
t('返回结构化 JSON 而非纯文本', () => {
  assert.ok(PS_SCRIPT.includes('ConvertTo-Json'), '未输出 JSON');
  assert.ok(PS_SCRIPT.includes('ok ='), '未包含 ok 字段');
});
t('支持 paste 与 enter 两种模式', () => {
  assert.ok(PS_SCRIPT.includes("$mode -eq 'paste'"));
  assert.ok(PS_SCRIPT.includes("$mode -eq 'enter'"));
});
t('脚本为纯 ASCII（避免 PS 5.1 按 ANSI 解析出错）', () => {
  for (let i = 0; i < PS_SCRIPT.length; i++) {
    const code = PS_SCRIPT.charCodeAt(i);
    if (code > 127) throw new Error('脚本含非 ASCII 字符：' + PS_SCRIPT[i]);
  }
});

console.log('\n== 可用性 ==');
t('非 Windows 平台不可用', () => {
  const inj = new InputInjector();
  if (process.platform !== 'win32') assert.strictEqual(inj.isAvailable(), false);
});
t('脚本路径存在时 Windows 上可用', () => {
  const inj = new InputInjector();
  if (process.platform === 'win32') {
    assert.ok(inj.scriptPath, '脚本路径为空');
    assert.strictEqual(inj.isAvailable(), true);
  }
});
t('脚本已落盘', () => {
  const inj = new InputInjector();
  if (inj.scriptPath) assert.strictEqual(fs.existsSync(inj.scriptPath), true);
});

console.log('\n== 调用协议 ==');
const mkSpawn = (behavior) => {
  const calls = [];
  const impl = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const { EventEmitter } = require('node:events');
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setTimeout(() => behavior(child), 5);
    return child;
  };
  impl.calls = calls;
  return impl;
};

(async () => {
  await ta('成功时返回 ok:true', async () => {
    const spawn = mkSpawn((child) => {
      child.stdout.emit('data', Buffer.from('{"ok":true}'));
      child.emit('close', 0);
    });
    const inj = new InputInjector({ spawn });
    const r = await inj.paste();
    assert.strictEqual(r.ok, true);
  });

  await ta('失败时返回 ok:false 并带原因', async () => {
    const spawn = mkSpawn((child) => {
      child.stdout.emit('data', Buffer.from('{"ok":false,"error":"UIPI 阻止"}'));
      child.emit('close', 0);
    });
    const inj = new InputInjector({ spawn });
    const r = await inj.paste();
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /UIPI/);
  });

  await ta('无输出时不崩溃', async () => {
    const spawn = mkSpawn((child) => { child.emit('close', 1); });
    const inj = new InputInjector({ spawn });
    const r = await inj.paste();
    assert.strictEqual(r.ok, false);
  });

  await ta('输出不是 JSON 时不崩溃', async () => {
    const spawn = mkSpawn((child) => {
      child.stdout.emit('data', Buffer.from('garbage output'));
      child.emit('close', 0);
    });
    const inj = new InputInjector({ spawn });
    const r = await inj.paste();
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /无法解析/);
  });

  await ta('进程报错时返回失败', async () => {
    const spawn = mkSpawn((child) => { child.emit('error', new Error('spawn 失败')); });
    const inj = new InputInjector({ spawn });
    const r = await inj.paste();
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /spawn 失败/);
  });

  await ta('传给 PowerShell 的参数正确', async () => {
    const spawn = mkSpawn((child) => {
      child.stdout.emit('data', Buffer.from('{"ok":true}'));
      child.emit('close', 0);
    });
    const inj = new InputInjector({ spawn });
    await inj.paste();
    const call = spawn.calls[0];
    assert.strictEqual(call.cmd, 'powershell.exe');
    assert.ok(call.args.includes('-NoProfile'));
    assert.ok(call.args.includes('-NonInteractive'));
    assert.ok(call.args.includes('-File'));
    assert.ok(call.args.includes('paste'));
    assert.strictEqual(call.opts.windowsHide, true);
  });

  await ta('enter 模式传对应参数', async () => {
    const spawn = mkSpawn((child) => {
      child.stdout.emit('data', Buffer.from('{"ok":true}'));
      child.emit('close', 0);
    });
    const inj = new InputInjector({ spawn });
    await inj.enter();
    assert.ok(spawn.calls[0].args.includes('enter'));
  });

  await ta('dispose 后拒绝执行', async () => {
    const spawn = mkSpawn((child) => { child.emit('close', 0); });
    const inj = new InputInjector({ spawn });
    inj.dispose();
    const r = await inj.paste();
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /已释放/);
  });

  await ta('超时常量合理（不会让用户等太久）', async () => {
    assert.ok(INJECT_TIMEOUT > 0 && INJECT_TIMEOUT <= 10000, 'INJECT_TIMEOUT=' + INJECT_TIMEOUT);
  });

  /* 真实粘贴由 verify:latency 在独立输入框中验证；默认回归不能向当前应用注入。 */
  if (process.platform === 'win32' && process.env.SUIRA_TEST_INPUT_INJECTION === '1') {
    console.log('\n== 真实 SendInput（Windows） ==');
    await ta('真实调用能完成且返回布尔结果', async () => {
      const inj = new InputInjector();
      if (!inj.isAvailable()) { console.log('    跳过：脚本不可用'); return; }
      const r = await inj.paste();
      // 真实环境里可能因焦点/权限失败，但必须返回明确布尔而非抛异常
      assert.strictEqual(typeof r.ok, 'boolean', 'ok 应为布尔');
      if (!r.ok) assert.ok(typeof r.error === 'string', '失败时应带 error');
      inj.dispose();
    });
  }

  console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  process.exit(fail ? 1 : 0);
})();
