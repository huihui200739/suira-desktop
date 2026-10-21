'use strict';
/* 放回目标校验 + 应用搜索测试。 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  VERDICT, REFUSE_REASONS, captureTarget, validateTarget, decideCommit, ClipboardWriteLedger
} = require('./lib/return-target');
const { collectShortcuts, toCandidates, AppIndex, startMenuDirs } = require('./lib/app-index');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + ' -> ' + e.message); fail++; } };
const ta = async (n, f) => { try { await f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + ' -> ' + e.message); fail++; } };

const baseTarget = () => captureTarget({ hwnd: '0x1A2B', pid: 4242, processName: 'WINWORD.EXE', processStartedAt: 1700000000000, title: '文档1' });

(async () => {
  console.log('\n== 目标快照 ==');
  t('完整信息可构造目标', () => {
    const target = baseTarget();
    assert.strictEqual(target.hwnd, '0x1a2b');
    assert.strictEqual(target.pid, 4242);
    assert.strictEqual(target.processName, 'WINWORD.EXE');
    assert.ok(target.capturedAt > 0);
  });
  t('HWND 大小写不敏感（0x1A2B 与 0x1a2b 视为同一窗口）', () => {
    const target = captureTarget({ hwnd: '0x1A2B', pid: 42 });
    const current = { hwnd: '0x1a2b', pid: 42 };
    assert.strictEqual(validateTarget(target, current).canPaste, true);
  });
  t('HWND 为数字时也能规范化', () => {
    const target = captureTarget({ hwnd: 0x1a2b, pid: 42 });
    assert.strictEqual(target.hwnd, String(0x1a2b)); // 6699
  });
  t('缺少 hwnd 返回 null', () => assert.strictEqual(captureTarget({ pid: 1 }), null));
  t('缺少 pid 返回 null', () => assert.strictEqual(captureTarget({ hwnd: '0x1' }), null));
  t('hwnd 为 0 视为无效', () => assert.strictEqual(captureTarget({ hwnd: '0', pid: 1 }), null));
  t('记录选区获取方式与输入法状态', () => {
    const target = captureTarget({ hwnd: '0x1', pid: 1 }, { selectionMethod: 'uia', imeActive: true });
    assert.strictEqual(target.selectionMethod, 'uia');
    assert.strictEqual(target.imeActive, true);
  });

  console.log('\n== 提交前校验：可粘贴 ==');
  t('目标一致时允许粘贴', () => {
    const target = baseTarget();
    const current = { hwnd: '0x1a2b', pid: 4242, processStartedAt: 1700000000000, elevated: false };
    const r = validateTarget(target, current);
    assert.strictEqual(r.verdict, VERDICT.PASTE);
    assert.strictEqual(r.canPaste, true);
    assert.strictEqual(r.reason, '');
  });

  console.log('\n== 提交前校验：必须回退为仅复制 ==');
  t('没有目标时只复制', () => {
    const r = validateTarget(null, { hwnd: '0x1', pid: 1 });
    assert.strictEqual(r.canPaste, false);
    assert.match(r.reason, /没有记录到目标窗口/);
  });
  t('目标窗口已关闭', () => {
    const r = validateTarget(baseTarget(), { hwnd: '0x1a2b', pid: 0 });
    assert.strictEqual(r.canPaste, false);
    assert.ok(r.reason.length > 0);
  });
  t('用户切到了别的窗口', () => {
    const r = validateTarget(baseTarget(), { hwnd: '0x9F9F', pid: 999 });
    assert.strictEqual(r.canPaste, false);
    assert.match(r.reason, /不是原目标/);
  });
  t('同一句柄但 PID 变了（句柄复用）', () => {
    const r = validateTarget(baseTarget(), { hwnd: '0x1a2b', pid: 7777 });
    assert.strictEqual(r.canPaste, false);
    assert.match(r.reason, /进程实例/);
  });
  t('PID 相同但进程启动时间不同（PID 复用）', () => {
    const r = validateTarget(baseTarget(), { hwnd: '0x1a2b', pid: 4242, processStartedAt: 1800000000000 });
    assert.strictEqual(r.canPaste, false);
    assert.match(r.reason, /进程实例/);
  });
  t('目标窗口是管理员权限时拒绝注入（UIPI）', () => {
    const r = validateTarget(baseTarget(), { hwnd: '0x1a2b', pid: 4242, processStartedAt: 1700000000000, elevated: true });
    assert.strictEqual(r.canPaste, false);
    assert.match(r.reason, /权限/);
  });
  t('无法读取当前前台时保守回退', () => {
    const r = validateTarget(baseTarget(), null);
    assert.strictEqual(r.canPaste, false);
    assert.ok(r.reason.length > 0);
  });
  t('校验失败时一律给出可读原因', () => {
    const cases = [
      [null, { hwnd: '0x1', pid: 1 }],
      [baseTarget(), { hwnd: '0x2', pid: 1 }],
      [baseTarget(), { hwnd: '0x1a2b', pid: 99 }],
      [baseTarget(), null]
    ];
    for (const [target, current] of cases) {
      const r = validateTarget(target, current);
      assert.strictEqual(r.canPaste, false);
      assert.ok(r.reason && r.reason.length > 0, '缺少原因');
    }
  });

  console.log('\n== 提交决策与提示文案 ==');
  const okTarget = baseTarget();
  const okCurrent = { hwnd: '0x1a2b', pid: 4242, processStartedAt: 1700000000000, elevated: false };

  t('返回并粘贴：目标有效时粘贴', () => {
    const d = decideCommit({ target: okTarget, current: okCurrent, intent: 'return-and-paste', pasteAfterCopy: true });
    assert.strictEqual(d.canPaste, true);
    assert.match(d.message, /已粘贴/);
  });
  t('仅复制：即使目标有效也不注入', () => {
    const d = decideCommit({ target: okTarget, current: okCurrent, intent: 'copy-only' });
    assert.strictEqual(d.canPaste, false);
    assert.strictEqual(d.message, '已复制');
  });
  t('设置里关闭粘贴后，即使目标有效也只复制', () => {
    const d = decideCommit({ target: okTarget, current: okCurrent, intent: 'return-and-paste', pasteAfterCopy: false });
    assert.strictEqual(d.canPaste, false);
    assert.strictEqual(d.message, '已复制');
  });
  t('目标失效时提示「切回目标后粘贴」', () => {
    const d = decideCommit({ target: okTarget, current: { hwnd: '0x9', pid: 9 }, intent: 'return-and-paste', pasteAfterCopy: true });
    assert.strictEqual(d.canPaste, false);
    assert.match(d.message, /已复制/);
    assert.match(d.message, /切回目标后粘贴/);
  });

  console.log('\n== 剪贴板回环防护 ==');
  t('记录自身写入后，相同内容被识别为自写', () => {
    const ledger = new ClipboardWriteLedger();
    ledger.record('hello');
    assert.strictEqual(ledger.shouldIgnore('hello'), true);
  });
  t('用户覆盖内容后不再忽略', () => {
    const ledger = new ClipboardWriteLedger();
    ledger.record('hello');
    assert.strictEqual(ledger.shouldIgnore('world'), false);
  });
  t('未写入过任何内容时不忽略', () => {
    const ledger = new ClipboardWriteLedger();
    assert.strictEqual(ledger.shouldIgnore('anything'), false);
  });
  t('写入序号递增', () => {
    const ledger = new ClipboardWriteLedger();
    assert.strictEqual(ledger.record('a'), 1);
    assert.strictEqual(ledger.record('b'), 2);
  });
  t('仅当内容仍未被覆盖时才允许恢复旧内容', () => {
    const ledger = new ClipboardWriteLedger();
    const seq = ledger.record('mine');
    assert.strictEqual(ledger.canRestore(seq, 'mine'), true);
    assert.strictEqual(ledger.canRestore(seq, 'user-copied'), false);
  });
  t('过期序号不允许恢复', () => {
    const ledger = new ClipboardWriteLedger();
    ledger.record('first');
    const second = ledger.record('second');
    assert.strictEqual(ledger.canRestore(1, 'second'), false);
    assert.strictEqual(ledger.canRestore(second, 'second'), true);
  });

  console.log('\n== 应用索引：目录扫描 ==');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'suira-apps-'));
  const mk = (rel, content = '') => {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    return full;
  };
  mk('Start/微信.lnk');
  mk('Start/记事本.lnk');
  mk('Start/Microsoft Office/Word.lnk');
  mk('Start/Microsoft Office/Excel.lnk');
  mk('Start/Uninstall Tool.lnk');
  mk('Start/desktop.ini', '[.ShellClassInfo]');
  mk('Start/帮助文档.lnk');

  await ta('扫描到快捷方式', async () => {
    const found = await collectShortcuts([path.join(tmp, 'Start')]);
    assert.ok(found.length >= 4, '实际 ' + found.length);
  });
  await ta('递归进入子目录', async () => {
    const found = await collectShortcuts([path.join(tmp, 'Start')]);
    assert.ok(found.some((f) => f.name === 'Word'), '应找到子目录里的 Word');
    assert.ok(found.some((f) => f.name === 'Excel'));
  });
  await ta('过滤卸载与帮助类噪音', async () => {
    const found = await collectShortcuts([path.join(tmp, 'Start')]);
    const names = found.map((f) => f.name);
    assert.ok(!names.includes('Uninstall Tool'), '不应包含卸载项');
    assert.ok(!names.includes('帮助文档'), '不应包含帮助项');
  });
  await ta('跳过 desktop.ini 等系统文件', async () => {
    const found = await collectShortcuts([path.join(tmp, 'Start')]);
    assert.ok(!found.some((f) => /desktop\.ini/i.test(f.filePath)));
  });
  await ta('去掉扩展名作为显示名', async () => {
    const found = await collectShortcuts([path.join(tmp, 'Start')]);
    const wx = found.find((f) => f.filePath.includes('微信'));
    assert.strictEqual(wx.name, '微信');
  });
  await ta('目录不存在时安全返回空数组', async () => {
    const found = await collectShortcuts([path.join(tmp, 'NoSuchDir')]);
    assert.deepStrictEqual(found, []);
  });
  await ta('limit 生效', async () => {
    const found = await collectShortcuts([path.join(tmp, 'Start')], { limit: 2 });
    assert.strictEqual(found.length, 2);
  });

  console.log('\n== 应用索引：候选与缓存 ==');
  await ta('转成搜索候选', async () => {
    const found = await collectShortcuts([path.join(tmp, 'Start')]);
    const candidates = toCandidates(found);
    assert.ok(candidates.length > 0);
    for (const c of candidates) {
      assert.ok(c.id.startsWith('app:'));
      assert.strictEqual(c.kind, 'app');
      assert.ok(c.title.length > 0);
    }
  });
  await ta('索引缓存命中，不重复扫盘', async () => {
    const index = new AppIndex({ roots: [path.join(tmp, 'Start')] });
    const first = await index.ensure();
    const second = await index.ensure();
    assert.strictEqual(first, second, '应返回同一份缓存');
    assert.strictEqual(index.isStale(), false);
  });
  await ta('invalidate 后重新扫描', async () => {
    const index = new AppIndex({ roots: [path.join(tmp, 'Start')] });
    await index.ensure();
    index.invalidate();
    assert.strictEqual(index.isStale(), true);
  });
  await ta('并发调用只扫一次', async () => {
    const index = new AppIndex({ roots: [path.join(tmp, 'Start')] });
    const [a, b] = await Promise.all([index.ensure(), index.ensure()]);
    assert.strictEqual(a, b);
  });

  console.log('\n== 开始菜单路径 ==');
  t('包含当前用户与所有用户两个目录', () => {
    const dirs = startMenuDirs({ APPDATA: 'C:\\Users\\x\\AppData\\Roaming', ProgramData: 'C:\\ProgramData' });
    assert.strictEqual(dirs.length, 2);
    assert.ok(dirs[0].includes('Start Menu'));
    assert.ok(dirs[1].includes('Start Menu'));
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  process.exit(fail ? 1 : 0);
})();
