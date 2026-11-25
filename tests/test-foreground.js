'use strict';
const PROJECT_ROOT = require('node:path').resolve(__dirname, '..');

/* 前台窗口探测客户端测试。 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { once } = require('node:events');
const { createHook } = require('node:async_hooks');

const { ForegroundProbe, resolveScriptPath } = require('../lib/foreground-probe');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + ' -> ' + e.message); fail++; } };
const ta = async (n, f) => { try { await f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + ' -> ' + e.message); fail++; } };

(async () => {
  console.log('\n== 可用性判定 ==');
  t('脚本存在且为 Windows 时可用', () => {
    const probe = new ForegroundProbe();
    assert.strictEqual(probe.isAvailable(), process.platform === 'win32' && fs.existsSync(probe.scriptPath));
  });
  t('脚本路径解析到真实文件', () => {
    assert.strictEqual(fs.existsSync(resolveScriptPath()), true);
  });
  t('非 asar 环境原样返回路径', () => {
    assert.ok(!resolveScriptPath().includes('app.asar'));
  });
  t('脚本缺失时不可用', () => {
    const probe = new ForegroundProbe({ scriptPath: path.join(os.tmpdir(), 'nope-xyz.ps1') });
    assert.strictEqual(probe.isAvailable(), false);
  });
  t('isReady 在未启动时为 false（剪贴板来源标注据此避免拉起 80MB 助手）', () => {
    const probe = new ForegroundProbe();
    assert.strictEqual(probe.isReady(), false);
  });
  t('isReady 需要 ready 且有子进程两个条件同时成立', () => {
    const probe = new ForegroundProbe();
    probe.ready = true;
    assert.strictEqual(probe.isReady(), false, '只有 ready 标记不算就绪');
    probe.child = { pid: 1 };
    assert.strictEqual(probe.isReady(), true);
    probe.ready = false;
    assert.strictEqual(probe.isReady(), false, '进程没了但 ready 残留也不算就绪');
  });
  ta('不可用时 query 直接返回 null', async () => {
    const probe = new ForegroundProbe({ scriptPath: path.join(os.tmpdir(), 'nope-xyz.ps1') });
    assert.strictEqual(await probe.query(), null);
  });
  ta('不可用时 start 返回 false', async () => {
    const probe = new ForegroundProbe({ scriptPath: path.join(os.tmpdir(), 'nope-xyz.ps1') });
    assert.strictEqual(await probe.start(), false);
  });
  await ta('PowerShell 兼容路径也发送按物理坐标命中命令并保留窗口边界', async () => {
    const probe = new ForegroundProbe();
    probe.isAvailable = () => true; probe.ready = true;
    let command;
    probe.child = { stdin: { writable: true, write: value => {
      command = value;
      queueMicrotask(() => probe.handleData(JSON.stringify({ok:true,hwnd:'42',pid:2,processStartedAt:10,bounds:{x:-600,y:0,width:600,height:700}})+'\n'));
    } } };
    const result = await probe.queryAt({x:-300,y:100});
    assert.equal(command,'at -300 100\n');
    assert.deepEqual(result.bounds,{x:-600,y:0,width:600,height:700});
    assert.equal(await probe.queryAt({x:1.5,y:0}),null);
  });

  console.log('\n== 真实查询（Windows） ==');
  if (process.platform === 'win32' && fs.existsSync(new ForegroundProbe().scriptPath)) {
    const probe = new ForegroundProbe();
    const started = await probe.start();
    t('助手进程启动成功', () => assert.strictEqual(started, true));

    const snapshot = await probe.query();
    t('能读到前台窗口快照', () => assert.ok(snapshot && snapshot.ok !== false));
    t('快照含 hwnd 与 pid', () => {
      assert.ok(snapshot.hwnd && snapshot.hwnd.length > 0, 'hwnd=' + snapshot.hwnd);
      assert.ok(Number.isFinite(snapshot.pid) && snapshot.pid > 0, 'pid=' + snapshot.pid);
    });
    t('hwnd 为十进制数字字符串', () => assert.match(snapshot.hwnd, /^\d+$/));
    t('快照含进程名', () => assert.ok(snapshot.processName.length > 0));

    await ta('常驻进程后续查询明显更快', async () => {
      const t0 = Date.now();
      await probe.query();
      const first = Date.now() - t0;
      const t1 = Date.now();
      await probe.query();
      const second = Date.now() - t1;
      assert.ok(second < 400, `第二次查询 ${second}ms 过慢（首次 ${first}ms）`);
    });

    await ta('并发查询都能拿到结果', async () => {
      const results = await Promise.all([probe.query(), probe.query(), probe.query()]);
      assert.strictEqual(results.length, 3);
      assert.ok(results.every((r) => r && r.hwnd), '存在空结果');
    });

    await ta('stop() 放掉常驻进程后，下一次查询会重新拉起', async () => {
      probe.stop();
      assert.strictEqual(probe.ready, false, 'stop 之后应标记为未就绪');
      const again = await probe.query();
      assert.ok(again && again.hwnd, '闲置释放后应能重新拉起并查回结果');
    });

    await ta('dispose 后不再返回结果', async () => {
      probe.dispose();
      assert.strictEqual(await probe.query(), null);
    });
  } else {
    console.log('  跳过：当前平台无 Windows 辅助脚本');
  }

  console.log('\n== 超时与异常处理 ==');
  if (process.platform === 'win32') {
    await ta('原生助手快速启动、按句柄校验，并拒绝失效目标', async () => {
      const { ensureNativeHost } = require('../lib/key-watch');
      const sourcePath = path.join(PROJECT_ROOT, 'assets/foreground-host.cs');
      const hash = require('crypto').createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex').slice(0, 12);
      const nativeHost = await ensureNativeHost({ sourcePath, targetPath: path.join(os.tmpdir(), `suira-foreground-test-${hash}.exe`), references: ['System.Web.Extensions.dll'] });
      assert.ok(nativeHost, '原生助手应成功编译');
      const probe = new ForegroundProbe({ nativeHost });
      try {
        const started = Date.now();
        assert.ok(await probe.start());
        assert.ok(Date.now() - started < 1500, '不得固定等待 4 秒');
        await new Promise(resolve => setTimeout(resolve, 2200));
        assert.equal(probe.isReady(), true, 'parent watchdog must keep the native host alive');
        const snapshot = await probe.query();
        assert.ok(snapshot?.hwnd);
        const checked = await probe.query(snapshot.hwnd);
        assert.equal(checked.pid, snapshot.pid);
        assert.equal(checked.title, snapshot.title, 'UTF-8 窗口标题必须完整返回');
        const refused = await probe.pasteTo({ ...snapshot, processStartedAt: snapshot.processStartedAt + 1 });
        assert.equal(refused.ok, false, '目标进程实例改变时不得注入');
        assert.equal(await probe.query('0'), null);
        assert.equal(await probe.query('1; echo unsafe'), null);
        assert.ok(await probe.query(), '非法句柄请求不得破坏后续查询');
      } finally { probe.dispose(); }
    });
  }
  await ta('助手无响应时 query 在超时内返回 null', async () => {
    const tmp = path.join(os.tmpdir(), 'suira-hang-' + Date.now() + '.ps1');
    // 一个只读 stdin 但从不回话的脚本
    fs.writeFileSync(tmp, 'while ($true) { $l = [Console]::In.ReadLine(); if ($null -eq $l) { break } }\n');
    const probe = new ForegroundProbe({ scriptPath: tmp });
    const t0 = Date.now();
    const result = await probe.query();
    const elapsed = Date.now() - t0;
    probe.dispose();
    fs.rmSync(tmp, { force: true });
    assert.strictEqual(result, null);
    assert.ok(elapsed < 12000, `耗时 ${elapsed}ms 过长`);
  });

  console.log('\n== dispose 清理 ==');
  if (process.platform === 'win32') await ta('dispose 结束实际子进程并关闭管道，不留下延迟强杀任务', async () => {
    const probe = new ForegroundProbe();
    assert.ok(await probe.start());
    const child = probe.child;
    const closed = once(child, 'close', { signal: AbortSignal.timeout(3000) });
    let scheduled = 0;
    const hook = createHook({ init(_id, type) { if (type === 'Timeout') scheduled++; } }).enable();
    try { probe.dispose(); } finally { hook.disable(); }
    await closed;
    assert.strictEqual(scheduled, 0, 'child disposal must not schedule a delayed PID kill');
    assert.ok(child.stdin.destroyed && child.stdout.destroyed && child.stderr.destroyed);
    assert.strictEqual(probe.isReady(), false);
  });

  console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  process.exit(fail ? 1 : 0);
})();
