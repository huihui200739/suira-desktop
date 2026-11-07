'use strict';
const assert=require('node:assert/strict'),{historyCleanup}=require('../lib/history-cleanup');
const item=(id,type,extra={})=>({id,source:{type},...extra});
const plan=historyCleanup([item('clip','clipboard'),item('shot','screenshot'),item('long','screenshot'),item('ocr','ocr'),item('edit','derived'),item('pin','clipboard',{pinned:true}),item('task','screenshot'),item('doc','user'),item('parent','screenshot'),item('derived-pin','ocr',{pinned:true,meta:{originItemId:'parent'}})],[{itemIds:['task']}]);
assert.deepEqual(plan.removed.map(v=>v.id),['clip','shot','long','ocr','edit']);
assert.deepEqual(plan.kept.map(v=>v.id),['pin','task','doc','parent','derived-pin']);assert.equal(plan.protectedCount,4);
// prune() 会删除过期项并重排数组：addItem 不能再按写入前的下标返回条目，
// 否则「保存已有文档」会拿到另一条内容，界面跳到错误条目。
const {SuiraStore}=require('../lib/store'),nodePath=require('node:path'),os=require('node:os');
const indexStore=new SuiraStore(nodePath.join(os.tmpdir(),'suira-additem-index-'+require('node:crypto').randomUUID()+'.json'));
indexStore.data.settings={...indexStore.getSettings(),maxItems:100,retentionDays:3650};
const recent=Date.now();
indexStore.addItem({id:'a',text:'a',createdAt:recent});
indexStore.addItem({id:'b',text:'b',createdAt:recent});
indexStore.addItem({id:'c',text:'c',createdAt:recent-3*86400000});
assert.deepEqual(indexStore.data.items.map(item=>item.id),['c','b','a']);
indexStore.data.settings={...indexStore.getSettings(),retentionDays:1};
const updated=indexStore.addItem({id:'b',text:'updated'});
assert.equal(updated?.id,'b');assert.equal(updated?.text,'updated');
// A protected result can depend on several parents and a mixed old/new source
// chain. Keep the whole chain, regardless of its array order.
const related = [
  item('unrelated', 'clipboard'),
  item('first-source', 'screenshot'),
  item('second-source', 'clipboard'),
  item('intermediate', 'ocr', { parentIds: ['first-source'] }),
  item('task-result', 'derived', { parentIds: ['intermediate', 'second-source'] })
];
const relatedPlan = historyCleanup(related, [{ itemIds: ['task-result'] }]);
assert.deepEqual(relatedPlan.removed.map(value => value.id), ['unrelated']);
assert.deepEqual(relatedPlan.kept.map(value => value.id), ['first-source', 'second-source', 'intermediate', 'task-result']);
assert.equal(relatedPlan.protectedCount, 4);
assert.deepEqual(related[4].parentIds, ['intermediate', 'second-source'], 'cleanup planning must not mutate content');

// Documents survive history cleanup even when not pinned; their sources must
// survive too. Include workspace-tagged history records in the protected count.
const documents = historyCleanup([
  item('document-source', 'screenshot'),
  item('workspace-source', 'clipboard'),
  item('document', 'user', { meta: { originItemId: 'document-source' } }),
  item('workspace-document', 'derived', { meta: { workspace: 'markdown' }, parentIds: ['workspace-source'] }),
  item('discard', 'derived')
]);
assert.deepEqual(documents.removed.map(value => value.id), ['discard']);
assert.equal(documents.protectedCount, 3);
assert.deepEqual(documents.kept.map(value => value.id), ['document-source', 'workspace-source', 'document', 'workspace-document']);
console.log('PASS history cleanup preserves complete task, pinned and document source chains; addItem survives prune reordering');
