'use strict';
// Production renderer functions with ordinary synthetic API responses. No native
// windows, clipboard, service calls or real profile files are involved.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
const nodes = new Map(), timers = [];
function node(id) {
  if (!nodes.has(id)) nodes.set(id, { hidden: true, value: '', disabled: false, textContent: '', className: '', focus() {}, classList: { remove() {}, add() {} } });
  return nodes.get(id);
}
const context = vm.createContext({
  URLSearchParams, location: { search: '' }, console,
  document: { querySelector: node, querySelectorAll: () => [] },
  setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {}, requestAnimationFrame: fn => fn(),
  window: { suira: {}, SuiraUI: { notify() {}, openDialog() {} } }
});
vm.runInContext(source.slice(0, source.lastIndexOf('\ninit().catch')), context);
const run = expression => vm.runInContext(expression, context);
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
(async () => {
  run('renderTaskList=()=>{}; renderTaskDetail=()=>{}; renderLibrary=()=>{}');
  const old = deferred(), fresh = deferred(); let calls = 0;
  context.window.suira.tasks = { list: () => (++calls === 1 ? old.promise : fresh.promise) };
  context.window.suira.content = { list: async () => [] };
  context.window.suira.executions = { list: async () => [] };
  const a = run('refreshShelf()'), b = run('refreshShelf()');
  fresh.resolve([{ id: 'new', title: 'New' }]); await b;
  old.resolve([{ id: 'old', title: 'Old' }]); await a;
  assert.equal(run('state.tasks[0].id'), 'new', 'Late shelf response cannot overwrite newer data');
  const libOld = deferred(), libNew = deferred(); calls = 0;
  context.window.suira.content.list = () => (++calls === 1 ? libOld.promise : libNew.promise);
  const l1 = run('refreshLibrary()'), l2 = run('refreshLibrary()');
  libNew.resolve([{ id: 'new' }]); await l2; libOld.resolve([{ id: 'old' }]); await l1;
  assert.equal(run('state.items[0].id'), 'new');
  const shelfLate = deferred();
  context.window.suira.tasks.list = () => shelfLate.promise;
  context.window.suira.content.list = async () => [{ id: 'shelf-old' }];
  const crossPage = run('refreshShelf()');
  context.window.suira.content.list = async () => [{ id: 'library-new' }];
  await run('refreshLibrary()'); shelfLate.resolve([]); await crossPage;
  assert.equal(run('state.items[0].id'), 'library-new', 'Shelf and library share content response ordering');
  const searchOld = deferred(), searchNew = deferred(); calls = 0;
  context.window.suira.search = { query: () => (++calls === 1 ? searchOld.promise : searchNew.promise) };
  run('state.pinyinMatches.add("previous"); refreshPinyinMatches("a")');
  assert.equal(run('state.pinyinMatches.size'), 0, 'Changing query clears old matches immediately');
  const s1 = timers.pop()(); run('refreshPinyinMatches("ab")'); const s2 = timers.pop()();
  searchNew.resolve([{ kind: 'content', id: 'new' }]); await s2;
  searchOld.resolve([{ kind: 'content', id: 'old' }]); await s1;
  assert.equal(run('state.pinyinMatches.has("new") && !state.pinyinMatches.has("old")'), true);
  const clearPending = deferred(); context.window.suira.search.query = () => clearPending.promise;
  run('refreshPinyinMatches("abc")'); const s3 = timers.pop()(); run('refreshPinyinMatches("")');
  clearPending.resolve([{ kind: 'content', id: 'stale' }]); await s3;
  assert.equal(run('state.pinyinMatches.size'), 0, 'Clearing query invalidates in-flight search');
  const save = deferred(); context.confirm = () => save.promise;
  run('openModal("New task", "", confirm)');
  assert.equal(node('#modal-confirm').disabled, true, 'Empty form cannot submit');
  node('#modal-input').value = 'Draft title'; node('#modal-input').oninput();
  const submitted = node('#modal-confirm').onclick();
  assert.equal(node('#modal-confirm').disabled, true);
  node('#modal-input').oninput(); assert.equal(node('#modal-confirm').disabled, true, 'Editing during submission cannot unlock duplicate submit');
  save.reject(Error('Temporary save failure')); await submitted;
  assert.equal(node('#modal').hidden, false); assert.equal(node('#modal-input').value, 'Draft title');
  assert.equal(node('#modal-confirm').disabled, false, 'Failed operation can retry');
  const late = deferred(); context.confirm = () => late.promise;
  run('openModal("Old modal", "", confirm)'); node('#modal-input').value = 'Old title'; node('#modal-input').oninput();
  const pending = node('#modal-confirm').onclick();
  run('closeModal(); openModal("New modal", "", async()=>{})');
  late.resolve(); await pending;
  assert.equal(node('#modal').hidden, false, 'Late completion cannot close a different dialog');
  assert.equal(node('#modal-title').textContent, 'New modal');
  run('closeModal()');
  let writes = 0; context.confirm = async () => { writes++; await run('refreshAfterChange(async()=>{throw Error("Read failed after successful write")})'); };
  run('openModal("Create once", "", confirm)'); node('#modal-input').value = 'Saved title'; node('#modal-input').oninput();
  await node('#modal-confirm').onclick();
  assert.equal(writes, 1); assert.equal(node('#modal').hidden, true, 'Successful mutation closes even if its follow-up refresh fails');
  console.log('PASS renderer cross-page refresh/search ordering, empty form, submission guard, retry, stale modal completion and successful-write/failed-refresh distinction');
})().catch(error => { console.error(error); process.exitCode = 1; });
