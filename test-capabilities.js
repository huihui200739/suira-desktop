'use strict';
/* 新增能力测试：搜索（拼音/首字母）、配方（动作链）、剪贴板守卫。 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { pinyinForms, scoreText, searchCandidates, COMMANDS, isSubsequence } = require('./lib/search');
const { RECIPES, getRecipe, listRecipes, runRecipe } = require('./lib/recipes');
const {
  readWithRetry,
  shouldExcludeCapture,
  summarizeLargeText,
  LARGE_TEXT_THRESHOLD
} = require('./lib/clipboard-guard');
const { SuiraStore } = require('./lib/store');
const { createActionRegistry } = require('./lib/actions');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + ' -> ' + e.message); fail++; } };
const ta = async (n, f) => { try { await f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + ' -> ' + e.message); fail++; } };

(async () => {
  console.log('\n== 拼音与首字母 ==');
  t('中文转全拼', () => assert.deepStrictEqual(pinyinForms('任务匣').full, 'renwuxia'));
  t('中文转首字母', () => assert.deepStrictEqual(pinyinForms('任务匣').initials, 'rwx'));
  t('纯英文不做拼音转换', () => assert.strictEqual(pinyinForms('Settings').full, ''));
  t('空串安全', () => assert.deepStrictEqual(pinyinForms(''), { full: '', initials: '', plain: '' }));
  t('子序列判定', () => {
    assert.strictEqual(isSubsequence('rwx', 'renwuxia'), true);
    assert.strictEqual(isSubsequence('xyz', 'renwuxia'), false);
  });

  console.log('\n== 搜索打分 ==');
  t('精确匹配得分最高', () => assert.ok(scoreText('任务匣', '任务匣') > scoreText('任务匣', '任务匣子')));
  t('中文子串命中', () => assert.ok(scoreText('任务', '任务匣') > 0));
  t('拼音全拼命中', () => assert.ok(scoreText('renwuxia', '任务匣') > 0));
  t('拼音前缀命中', () => assert.ok(scoreText('renwu', '任务匣') > 0));
  t('首字母命中', () => assert.ok(scoreText('rwx', '任务匣') > 0));
  t('首字母子序列命中', () => assert.ok(scoreText('rw', '任务匣') > 0));
  t('不相关返回 0', () => assert.strictEqual(scoreText('zzzzz', '任务匣'), 0));
  t('空查询返回基础分', () => assert.strictEqual(scoreText('', '任意'), 1));

  console.log('\n== 候选检索 ==');
  t('中文查询命中命令', () => {
    const r = searchCandidates('截图', COMMANDS);
    assert.ok(r.length > 0);
    assert.ok(r.some((c) => c.id === 'cmd.capture'));
  });
  t('拼音查询命中命令', () => {
    const r = searchCandidates('jietu', COMMANDS);
    assert.ok(r.some((c) => c.id === 'cmd.capture'), '实际: ' + r.map((c) => c.id).join(','));
  });
  t('首字母查询命中命令', () => {
    const r = searchCandidates('rwx', COMMANDS);
    assert.ok(r.some((c) => c.id === 'cmd.shelf'), '实际: ' + r.map((c) => c.id).join(','));
  });
  t('英文查询命中命令', () => {
    const r = searchCandidates('clipboard', COMMANDS);
    assert.ok(r.some((c) => c.id === 'cmd.clipboard'));
  });
  t('limit 生效', () => assert.ok(searchCandidates('', COMMANDS, { limit: 3 }).length <= 3));
  t('无结果返回空数组', () => assert.deepStrictEqual(searchCandidates('zzzzzz', COMMANDS), []));

  console.log('\n== 配方定义 ==');
  t('内置 3 条配方', () => assert.strictEqual(RECIPES.length, 3));
  t('每条配方都有 id/version/accepts/steps', () => {
    for (const r of RECIPES) {
      assert.ok(r.id && r.version >= 1);
      assert.ok(Array.isArray(r.accepts) && r.accepts.length);
      assert.ok(Array.isArray(r.steps) && r.steps.length);
      for (const s of r.steps) assert.ok(s.action && ['stop', 'continue'].includes(s.onError));
    }
  });
  t('按 kind 过滤配方', () => {
    const imageOnly = listRecipes('image');
    assert.ok(imageOnly.every((r) => r.accepts.includes('image')));
    assert.ok(imageOnly.some((r) => r.id === 'capture-to-clean-text'));
  });
  t('getRecipe 未知 id 返回 null', () => assert.strictEqual(getRecipe('nope'), null));

  console.log('\n== 配方执行 ==');
  const tmp = path.join(os.tmpdir(), 'suira-recipe-' + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  const store = new SuiraStore(path.join(tmp, 'd.json'));
  const written = [];
  const registry = createActionRegistry({
    store,
    ocr: { recognizeFile: async () => ({ text: '第一行\n第二行\n\n第三段', confidence: 90, blocks: [], engine: 'test', cached: false }) },
    clipboard: { writeText: async (v) => written.push(v), writeImage: async () => {} },
    shell: { showItemInFolder: () => {}, openExternal: async () => {} },
    nativeImage: { createFromBuffer: () => ({ getSize: () => ({ width: 10, height: 10 }) }) },
    openPath: async () => '', pinImage: async () => {}, broadcast: () => {}, assetPath: () => '',
    capturesDir: () => tmp, makeId: (p) => p + '-t'
  });
  const deps = { execute: (id, a) => registry.execute(id, a) };

  const img = store.addItem({ kind: 'image', title: '图', filePath: path.join(tmp, 'a.png') });
  const textItem = store.addItem({ kind: 'text', title: '文字', text: '甲\n乙\n\n丙' });

  await ta('capture-to-clean-text 跑通三步', async () => {
    const r = await runRecipe(deps, img.id, 'capture-to-clean-text');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.steps.length, 3);
    assert.ok(r.steps.every((s) => s.ok));
    assert.strictEqual(r.output.text, '第一行第二行\n\n第三段');
  });

  await ta('每步都生成新版本，不覆盖原始内容', async () => {
    const r = await runRecipe(deps, img.id, 'capture-to-clean-text');
    assert.ok(r.output.id !== img.id);
    assert.strictEqual(store.getItem(img.id).kind, 'image');
    assert.strictEqual(store.getItem(img.id).text, '');
  });

  await ta('clean-text 配方对文字可用', async () => {
    const r = await runRecipe(deps, textItem.id, 'clean-text');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.output.text, '甲乙\n\n丙');
  });

  await ta('未请求 commit 时不产生副作用', async () => {
    written.length = 0;
    const r = await runRecipe(deps, textItem.id, 'clean-text', { commit: false });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(written.length, 0, '不应写剪贴板');
  });

  await ta('显式 commit 时才执行副作用', async () => {
    written.length = 0;
    const r = await runRecipe(deps, textItem.id, 'clean-text', { commit: true });
    assert.strictEqual(r.ok, true);
    assert.ok(written.length >= 1, '应写剪贴板');
  });

  await ta('未知配方返回 ok:false', async () => {
    const r = await runRecipe(deps, textItem.id, 'ghost');
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /配方不存在/);
  });

  await ta('步骤失败且 onError=stop 时停在当前步骤', async () => {
    const bad = store.addItem({ kind: 'image', title: 'bad', filePath: '' });
    const r = await runRecipe(deps, bad.id, 'capture-to-clean-text');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.stoppedAt, 'ocr.local');
    assert.strictEqual(r.steps.length, 1);
  });

  await ta('取消后丢弃结果并标记 canceled', async () => {
    const controller = new AbortController();
    controller.abort();
    const r = await runRecipe(deps, textItem.id, 'clean-text', { signal: controller.signal });
    assert.strictEqual(r.canceled, true);
    assert.strictEqual(r.ok, false);
  });

  await ta('执行中取消不会推进后续步骤', async () => {
    const controller = new AbortController();
    const slowDeps = {
      execute: async (id, action) => {
        const res = await registry.execute(id, action);
        controller.abort();
        return res;
      }
    };
    const r = await runRecipe(slowDeps, textItem.id, 'clean-text', { signal: controller.signal });
    assert.strictEqual(r.canceled, true);
    assert.ok(r.steps.length <= 1, '实际步数 ' + r.steps.length);
  });

  console.log('\n== 剪贴板守卫：重试 ==');
  await ta('首次成功不重试', async () => {
    let calls = 0;
    const r = await readWithRetry(async () => { calls++; return 'ok'; }, (v) => !v);
    assert.strictEqual(r.value, 'ok');
    assert.strictEqual(calls, 1);
  });

  await ta('锁竞争后重试成功', async () => {
    let calls = 0;
    const r = await readWithRetry(async () => {
      calls++;
      if (calls < 3) throw new Error('clipboard locked');
      return 'recovered';
    }, (v) => !v);
    assert.strictEqual(r.value, 'recovered');
    assert.strictEqual(calls, 3);
  });

  await ta('全部失败时返回最后错误而不抛出', async () => {
    const r = await readWithRetry(async () => { throw new Error('always locked'); }, (v) => !v);
    assert.strictEqual(r.value, null);
    assert.ok(r.error);
    assert.match(r.error.message, /locked/);
  });

  console.log('\n== 剪贴板守卫：敏感排除 ==');
  t('密码管理器进程被排除', () => {
    assert.strictEqual(shouldExcludeCapture({ processName: '1Password.exe' }).excluded, true);
    assert.strictEqual(shouldExcludeCapture({ processName: 'keepassxc' }).excluded, true);
    assert.strictEqual(shouldExcludeCapture({ processName: 'bitwarden.exe' }).excluded, true);
  });
  t('敏感窗口标题被排除', () => {
    assert.strictEqual(shouldExcludeCapture({ windowTitle: '登录 - 密码管理' }).excluded, true);
    assert.strictEqual(shouldExcludeCapture({ windowTitle: 'Enter your password' }).excluded, true);
    assert.strictEqual(shouldExcludeCapture({ windowTitle: '两步验证验证码' }).excluded, true);
  });
  t('私钥与密钥形态内容被排除', () => {
    assert.strictEqual(shouldExcludeCapture({ text: '-----BEGIN RSA PRIVATE KEY-----' }).excluded, true);
    assert.strictEqual(shouldExcludeCapture({ text: 'AKIAIOSFODNN7EXAMPLE' }).excluded, true);
    assert.strictEqual(shouldExcludeCapture({ text: 'ghp_abcdefghijklmnopqrstuvwx' }).excluded, true);
  });
  t('普通内容不被误伤', () => {
    assert.strictEqual(shouldExcludeCapture({ text: '这是一段普通的会议记录' }).excluded, false);
    assert.strictEqual(shouldExcludeCapture({ text: 'https://example.com/doc' }).excluded, false);
    assert.strictEqual(shouldExcludeCapture({ processName: 'notepad.exe', text: 'hello' }).excluded, false);
  });
  t('用户关闭排除开关时不再拦截', () => {
    assert.strictEqual(shouldExcludeCapture({ processName: '1password', excludeSensitive: false }).excluded, false);
  });
  t('排除时给出可读原因', () => {
    const r = shouldExcludeCapture({ processName: '1password' });
    assert.ok(r.reason.length > 0);
  });

  console.log('\n== 剪贴板守卫：超大内容 ==');
  t('未超阈值原样返回', () => {
    const r = summarizeLargeText('short');
    assert.strictEqual(r.truncated, false);
    assert.strictEqual(r.text, 'short');
  });
  t('超阈值被截断并标注', () => {
    const big = 'x'.repeat(LARGE_TEXT_THRESHOLD + 500);
    const r = summarizeLargeText(big);
    assert.strictEqual(r.truncated, true);
    assert.ok(r.text.length < big.length);
    assert.match(r.text, /内容过长/);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  process.exit(fail ? 1 : 0);
})();
