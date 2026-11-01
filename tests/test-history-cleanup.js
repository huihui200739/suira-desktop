'use strict';
const assert=require('node:assert/strict'),{historyCleanup}=require('../lib/history-cleanup');
const item=(id,type,extra={})=>({id,source:{type},...extra});
const plan=historyCleanup([item('clip','clipboard'),item('shot','screenshot'),item('long','screenshot'),item('ocr','ocr'),item('edit','derived'),item('pin','clipboard',{pinned:true}),item('task','screenshot'),item('doc','user'),item('parent','screenshot'),item('derived-pin','ocr',{pinned:true,meta:{originItemId:'parent'}})],[{itemIds:['task']}]);
assert.deepEqual(plan.removed.map(v=>v.id),['clip','shot','long','ocr','edit']);
assert.deepEqual(plan.kept.map(v=>v.id),['pin','task','doc','parent','derived-pin']);assert.equal(plan.protectedCount,4);
console.log('PASS history cleanup includes captures and derived records, preserves pins, task references, documents and referenced originals');
