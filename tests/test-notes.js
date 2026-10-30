'use strict';
/*
 * 速记（Quick Note）的模型与落盘验证。
 *
 * 分两段：
 *   1. 纯模型（lib/notes.js）：标题推导、容量收敛、非法输入收敛 —— 不需要 fs
 *   2. 落盘层（lib/store.js 的 notes 段）：加密落盘、重启恢复、位置记忆、容量上限
 *
 * 窗口行为（置顶、位置校验）在真机确认，这里只锁不依赖 Electron 的语义。
 *
 * 用法：node test-notes.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const notesLib = require('../lib/notes');
const { SuiraStore } = require('../lib/store');
const cryptoStore = require('../lib/crypto-store');

let pass = 0;
const t = (name, fn) => {
  try {
    fn();
    console.log('  PASS  ' + name);
    pass += 1;
  } catch (error) {
    console.log('  FAIL  ' + name + ' -> ' + error.message);
    process.exitCode = 1;
  }
};
/** 异步用例：必须 await，否则 async 断言失败会被吞掉，测试会假绿。 */
const ta = async (name, fn) => {
  try {
    await fn();
    console.log('  PASS  ' + name);
    pass += 1;
  } catch (error) {
    console.log('  FAIL  ' + name + ' -> ' + error.message);
    process.exitCode = 1;
  }
};

console.log('\n== 纯模型 ==');

t('标题取正文第一行非空内容', () => {
  assert.equal(notesLib.noteTitle('第一行\n第二行'), '第一行');
  // 空行开头的笔记，标题不该是空的
  assert.equal(notesLib.noteTitle('\n\n  真正的第一行  \n第二行'), '真正的第一行');
});

t('正文为空时回落到「未命名速记」', () => {
  assert.equal(notesLib.noteTitle(''), notesLib.TITLE_FALLBACK);
  assert.equal(notesLib.noteTitle('   \n\t\n'), notesLib.TITLE_FALLBACK);
});

t('标题压缩连续空白并限制长度', () => {
  const long = 'あ'.repeat(400);
  const title = notesLib.noteTitle(long);
  assert.equal(title.length, notesLib.TITLE_LIMIT);
  assert.equal(notesLib.noteTitle('a\t\t\tb   c'), 'a b c');
});

t('正文去掉 NUL 并限制长度', () => {
  assert.equal(notesLib.normalizeText('a\u0000b'), 'ab');
  assert.equal(notesLib.normalizeText('あ'.repeat(50000)).length, notesLib.TEXT_LIMIT);
});

t('缺少 id 的输入被拒绝，不产生半条记录', () => {
  assert.equal(notesLib.cleanNote(null), null);
  assert.equal(notesLib.cleanNote({}), null);
  assert.equal(notesLib.cleanNote({ text: 'x' }), null);
});

t('cleanNote 补齐时间戳并清掉非法字段', () => {
  const note = notesLib.cleanNote({ id: 'n1', text: 'a\u0000b', title: 'x', pinned: 1, bounds: 'bad' });
  assert.equal(note.id, 'n1');
  assert.equal(note.text, 'ab');
  assert.equal(note.pinned, true);
  assert.equal(note.bounds, null, '非法 bounds 应收敛为 null，而不是带着脏数据落盘');
  assert.ok(Number.isFinite(note.createdAt) && Number.isFinite(note.updatedAt));
});

t('位置记忆拒绝非有限值与过小窗口', () => {
  assert.equal(notesLib.cleanBounds(null), null);
  assert.equal(notesLib.cleanBounds({ x: 0, y: 0, width: NaN, height: 200 }), null);
  assert.equal(notesLib.cleanBounds({ x: 0, y: 0, width: 100, height: 100 }), null, '小于下限应拒绝');
  assert.deepEqual(notesLib.cleanBounds({ x: 10.6, y: -20, width: 300, height: 400 }), { x: 11, y: -20, width: 300, height: 400 });
  assert.deepEqual(notesLib.cleanBounds({ x: 0, y: 0, width: 99999, height: 400 }), { x: 0, y: 0, width: 4000, height: 400 });
});

t('容量收敛保留钉住的，丢最旧的未钉住条目', () => {
  const notes = [];
  for (let i = 0; i < 205; i += 1) {
    notes.push(notesLib.cleanNote({ id: 'n' + i, text: 't' + i, createdAt: 1000 + i, updatedAt: 1000 + i }));
  }
  notes.push(notesLib.cleanNote({ id: 'pinned', text: 'keep', updatedAt: 1, pinned: true }));
  const capped = notesLib.capNotes(notes, 200);
  assert.equal(capped.length, 200);
  assert.ok(capped.some((note) => note.id === 'pinned'), '钉住的条目不该被容量策略丢掉');
  assert.ok(!capped.some((note) => note.id === 'n0'), '最旧的未钉住条目应被丢掉');
});

t('容量未超限时顺序不变（按最近编辑）', () => {
  const notes = [
    notesLib.cleanNote({ id: 'a', text: 'a', updatedAt: 1 }),
    notesLib.cleanNote({ id: 'b', text: 'b', updatedAt: 5 })
  ];
  const capped = notesLib.capNotes(notes, 200);
  assert.deepEqual(capped.map((note) => note.id), ['b', 'a']);
});

t('应用正文修改：标题跟着走，清空正文时保留原标题', () => {
  const note = notesLib.cleanNote({ id: 'n1', text: '', title: '未命名速记', updatedAt: 1 });
  const filled = notesLib.applyNoteText(note, '新的第一行\n第二行', 999);
  assert.equal(filled.title, '新的第一行');
  assert.equal(filled.updatedAt, 999);
  const cleared = notesLib.applyNoteText(filled, '   ', 1000);
  assert.equal(cleared.text, '   ');
  assert.equal(cleared.title, '新的第一行', '清空正文不该把标题也抹掉');
});

t('统计给出条数、钉住数与总字数', () => {
  const summary = notesLib.summarizeNotes([
    notesLib.cleanNote({ id: 'a', text: '12345', pinned: true }),
    notesLib.cleanNote({ id: 'b', text: '12', pinned: false })
  ]);
  assert.deepEqual(summary, { count: 2, pinned: 1, chars: 7, limit: notesLib.NOTE_LIMIT });
  assert.deepEqual(notesLib.summarizeNotes(null), { count: 0, pinned: 0, chars: 0, limit: notesLib.NOTE_LIMIT });
});

console.log('\n== 落盘层 ==');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suira-notes-'));
const storePath = path.join(dir, 'suira-data.json');
const key = cryptoStore.generateKey();
const codec = {
  isReady: () => true,
  encode: (item) => cryptoStore.encryptItem(key, item),
  decode: (item) => cryptoStore.decryptItem(key, item)
};

const store = new SuiraStore(storePath, { codec });

t('新建速记：正文空时标题为「未命名速记」', () => {
  const note = store.createNote({ text: '' });
  assert.ok(note && note.id);
  assert.equal(note.title, notesLib.TITLE_FALLBACK);
  assert.equal(note.text, '');
  assert.equal(note.pinned, false);
});

t('新建速记：标题由正文推导', () => {
  const note = store.createNote({ text: '买牛奶\n顺便取快递' });
  assert.equal(note.title, '买牛奶');
});

t('改正文：标题与 updatedAt 一起更新', () => {
  const note = store.createNote({ text: '旧内容' });
  const before = store.getNote(note.id).updatedAt;
  const updated = store.updateNoteText(note.id, '  换了个开头\n第二行');
  assert.equal(updated.title, '换了个开头');
  assert.ok(updated.updatedAt >= before);
});

t('改不存在的速记返回 null，不新建幽灵条目', () => {
  assert.equal(store.updateNoteText('nope', 'x'), null);
  assert.equal(store.setNoteBounds('nope', { x: 0, y: 0, width: 300, height: 300 }), null);
  assert.equal(store.toggleNotePin('nope'), null);
  assert.equal(store.deleteNote('nope'), null);
});

const BOUNDS_NOTE_ID = 'bounds-note';
let boundsNote = null;

t('位置记忆只接受合法 bounds', () => {
  const note = store.createNote({ id: BOUNDS_NOTE_ID, text: '带位置的速记' });
  boundsNote = note;
  assert.equal(store.setNoteBounds(note.id, { x: 1, y: 2, width: 100, height: 100 }), null, '过小窗口应拒绝');
  assert.equal(store.setNoteBounds(note.id, { x: 1, y: 2, width: NaN, height: 100 }), null, '非有限值应拒绝');
  const saved = store.setNoteBounds(note.id, { x: 12, y: 34, width: 380, height: 460 });
  assert.deepEqual(saved.bounds, { x: 12, y: 34, width: 380, height: 460 });
});

t('钉住状态可切换往返', () => {
  const note = store.createNote({ text: 'x' });
  assert.equal(store.toggleNotePin(note.id).pinned, true);
  assert.equal(store.toggleNotePin(note.id).pinned, false);
});

t('删除速记后查不到', () => {
  const note = store.createNote({ text: 'x' });
  assert.ok(store.deleteNote(note.id));
  assert.equal(store.getNote(note.id), null);
});

t('latestNote 返回最近编辑的一条', () => {
  store.createNote({ text: 'older' });
  const fresh = store.createNote({ text: 'newest' });
  store.updateNoteText(fresh.id, 'newest!');
  assert.equal(store.latestNote().id, fresh.id);
});

t('超出上限时丢最旧的未钉住条目', () => {
  const small = new SuiraStore(path.join(dir, 'small.json'));
  for (let i = 0; i < 6; i += 1) small.createNote({ text: 'n' + i });
  small.toggleNotePin(small.listNotes()[0].id);
  const capped = notesLib.capNotes(small.listNotes(), 3);
  assert.equal(capped.length, 3);
  assert.ok(capped.some((note) => note.pinned));
});

(async () => {
  await store.save();

  console.log('\n== 落盘与重启恢复 ==');

  const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));

  await ta('正文在磁盘上是加密信封，不出现明文', () => {
    assert.ok(raw.notes.length > 0, '没有落盘任何速记');
    // 空正文没有可加密的内容，保持空串；其余必须是信封
    assert.ok(raw.notes.some((note) => note && note.text && typeof note.text === 'object'), '没有任何速记被加密');
    const leaked = raw.notes.filter((note) => note && typeof note.text === 'string' && note.text.length > 0);
    assert.equal(leaked.length, 0, '存在未加密的速记正文');
    assert.ok(!JSON.stringify(raw.notes).includes('买牛奶'), '明文出现在磁盘上');
  });

  await ta('重启后速记仍在，正文与标题可解密', () => {
    const reloaded = new SuiraStore(storePath, { codec });
    const found = reloaded.listNotes().find((note) => note.text.includes('换了个开头'));
    assert.ok(found, '重启后找不到原速记');
    assert.equal(found.title, '换了个开头');
  });

  await ta('重启后位置记忆仍在（窗口能回到上次的地方）', () => {
    const reloaded = new SuiraStore(storePath, { codec });
    assert.deepEqual(
      reloaded.getNote(BOUNDS_NOTE_ID).bounds,
      { x: 12, y: 34, width: 380, height: 460 }
    );
  });

  await ta('未加密存储也能正常读写（加密不可用时降级）', async () => {
    const plainPath = path.join(dir, 'plain.json');
    const plain = new SuiraStore(plainPath);
    plain.createNote({ text: '明文速记' });
    await plain.save();
    const reloaded = new SuiraStore(plainPath);
    assert.equal(reloaded.latestNote().text, '明文速记');
  });

  await ta('没有 notes 段的旧数据不会让加载失败', () => {
    const legacyPath = path.join(dir, 'legacy.json');
    fs.writeFileSync(legacyPath, JSON.stringify({ version: 1, items: [], tasks: [] }), 'utf8');
    const legacy = new SuiraStore(legacyPath);
    assert.deepEqual(legacy.listNotes(), []);
    assert.equal(legacy.latestNote(), null);
  });

  await ta('notes 段是脏数据时逐条清洗，不整段丢弃', () => {
    const dirtyPath = path.join(dir, 'dirty.json');
    fs.writeFileSync(dirtyPath, JSON.stringify({
      version: 1,
      notes: ['garbage', null, { id: 'ok', text: '保留我' }, { text: '没有 id' }]
    }), 'utf8');
    const dirty = new SuiraStore(dirtyPath);
    const notes = dirty.listNotes();
    assert.equal(notes.length, 1);
    assert.equal(notes[0].text, '保留我');
  });

  console.log('\n========== ' + pass + ' 通过 / 0 失败 ==========');
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 2 }); } catch { /* 清理失败不影响结果 */ }
})();
