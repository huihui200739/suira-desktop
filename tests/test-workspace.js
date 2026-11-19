'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SuiraStore}=require('../lib/store'),{createWorkspace,validDate}=require('../lib/workspace'),{completionUrl}=require('../lib/translate');
const vm=require('node:vm');
const renderer=fs.readFileSync(path.join(__dirname,'../src/workspace.js'),'utf8');
function rendererSection(start,end){const from=renderer.indexOf(start),to=renderer.indexOf(end,from+start.length);assert.ok(from>=0&&to>from,'Renderer test section exists');return renderer.slice(from,to);}
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function documentHarness(api,{dirty=true,external=false}={}){
  const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,disabled:false,textContent:''});return nodes.get(id);};
  $('md-title').value='Document A';$('md-editor').value=dirty?'# Edited A':'# Original A';
  const initialDocs=[{id:'a',title:'Document A',text:'# Original A',meta:external?{externalPath:'A.md'}:{}},{id:'b',title:'Document B',text:'# Document B',meta:{}}];
  const context={api,$,initialDocs,initialRevision:dirty?1:0,clearTimeout,notify(){},document:{documentElement:{classList:{toggle(){}}}}};
  vm.runInNewContext(`
    let current='a',revision=initialRevision,savedRevision=0,docs=initialDocs,richDocument=null,richText='',richKey='',timer,previewTimer,saveInFlight,viewRevision=0,renderedText,outlineItems,sourceHeadingPositions,requestedView='edit';
    const foldedHeadings=new Set(), editor=$('md-editor'), previewPane={replaceChildren(){}};
    async function checked(promise){const result=await promise;if(!result?.ok)throw Error(result?.error||'操作失败');return result;}
    function setWritingFocus(){} function documentIdentity(){} function closeDocumentFind(){} function setDocumentView(){} function preview(){} function docList(){} function syncDocumentNavigation(){}
    const savedLabel=()=> '已保存';
    ${rendererSection('  function flush() {','  async function loadDocs() {')}
    ${rendererSection('  async function saveCurrentFile(){',"  $('md-save').onclick=")}
    globalThis.ui={flush,selectDoc,saveCurrentFile,state:()=>({current,revision,savedRevision,docs}),edit:text=>{$('md-editor').value=text;revision++;$('md-status').textContent='未保存';}};
  `,context);
  return {...context.ui,$};
}
async function testDocumentSaving(){
  const started=deferred(),finish=deferred(),saves=[];
  const ui=documentHarness({save:async(_type,payload)=>{saves.push({...payload});if(saves.length===1){started.resolve();await finish.promise;}return {ok:true,item:{...payload,meta:{}}};}});
  const switching=ui.selectDoc('b');await started.promise;ui.edit('# Latest A while saving');finish.resolve();await switching;
  assert.equal(saves.at(-1).text,'# Latest A while saving','Switching must save edits made while an earlier save is pending');
  assert.equal(ui.state().docs.find(item=>item.id==='a').text,'# Latest A while saving');
  assert.equal(ui.state().current,'b');assert.equal(ui.$('md-editor').value,'# Document B');

  const fileStarted=deferred(),fileFinished=deferred();
  const external=documentHarness({saveFile:async id=>{assert.equal(id,'a');fileStarted.resolve();return fileFinished.promise;}},{dirty:false,external:true});
  const saving=external.saveCurrentFile();await fileStarted.promise;await external.selectDoc('b');
  fileFinished.resolve({ok:true,item:{id:'a',title:'Document A',text:'# Original A',meta:{externalPath:'A.md'}}});await saving;
  assert.equal(external.state().docs.find(item=>item.id==='b')?.title,'Document B','Completing a file save must not replace the newly selected document');
  assert.equal(external.$('md-status').textContent,'已保存','File save status belongs to the document that initiated it');

  const editStarted=deferred(),editFinished=deferred();
  const editing=documentHarness({saveFile:async()=>{editStarted.resolve();return editFinished.promise;}},{dirty:false,external:true});
  const writing=editing.saveCurrentFile();await editStarted.promise;editing.edit('# Newer unsaved edit');
  editFinished.resolve({ok:true,item:{id:'a',title:'Document A',text:'# Original A',meta:{externalPath:'A.md'}}});await writing;
  assert.equal(editing.$('md-status').textContent,'未保存','Finishing an older file snapshot must not mark newer edits as saved');

  const draftStarted=deferred(),draftFinished=deferred();
  const draft=documentHarness({saveFile:async()=>{draftStarted.resolve();return draftFinished.promise;},save:async(_type,payload)=>({ok:true,item:{...payload,meta:{externalPath:'A.md'}}})},{dirty:false,external:true});
  const savingOld=draft.saveCurrentFile();await draftStarted.promise;draft.edit('# Newer saved draft');await draft.flush();
  draftFinished.resolve({ok:true,item:{id:'a',title:'Document A',text:'# Original A',meta:{externalPath:'A.md',externalHash:'written-hash'}}});await savingOld;
  assert.equal(draft.state().docs.find(item=>item.id==='a').text,'# Newer saved draft','Completing a file write must preserve a newer saved draft in the document list');
  assert.equal(draft.state().docs.find(item=>item.id==='a').meta.externalHash,'written-hash');

  let attempts=0;
  const retry=documentHarness({save:async(_type,payload)=>++attempts===1?{ok:false,error:'Temporary save failure'}:{ok:true,item:{...payload,meta:{}}}});
  await assert.rejects(retry.selectDoc('b'),/Temporary save failure/);
  assert.equal(retry.state().current,'a');assert.equal(retry.$('md-editor').value,'# Edited A');assert.equal(retry.$('md-status').textContent,'保存失败，请重试');
  await retry.selectDoc('b');assert.equal(retry.state().current,'b');assert.equal(attempts,2,'A failed draft save must remain retryable');
}
async function testConcurrentDocumentSaving(){
  const firstStarted=deferred(),firstFinished=deferred(),secondStarted=deferred(),secondFinished=deferred();
  const saves=[],persisted=new Map();let active=0,maxActive=0;
  const ui=documentHarness({save:async(_type,payload)=>{
    const call=saves.push({...payload});active++;maxActive=Math.max(maxActive,active);
    try{
      if(call===1){firstStarted.resolve();await firstFinished.promise;}
      if(call===2){secondStarted.resolve();await secondFinished.promise;}
      persisted.set(payload.id,{...payload});return {ok:true,item:{...payload,meta:{}}};
    }finally{active--;}
  }});
  const first=ui.flush();await firstStarted.promise;
  const concurrent=ui.flush(),switching=ui.selectDoc('b');ui.edit('# A revision two');
  firstFinished.resolve();await secondStarted.promise;ui.edit('# A latest revision three');secondFinished.resolve();
  await Promise.all([first,concurrent,switching]);
  assert.equal(maxActive,1,'Concurrent flush callers must keep workspace saves serialized');
  assert.equal(persisted.get('a').text,'# A latest revision three','All concurrent flushes must settle with the latest draft persisted before switching');
  assert.equal(ui.state().docs.find(item=>item.id==='a').text,'# A latest revision three');
  assert.equal(ui.state().current,'b');assert.equal(ui.$('md-editor').value,'# Document B');
  assert.equal(saves.every(item=>item.id==='a'),true,'Pending saves must stay attached to the original document');
  // Reusing the same queue for the new document must not inherit the old revision.
  ui.edit('# B latest edit');await Promise.all([ui.flush(),ui.selectDoc('a')]);
  assert.equal(persisted.get('b').text,'# B latest edit');assert.equal(ui.state().current,'a');
  assert.equal(ui.$('md-editor').value,'# A latest revision three');
}
async function testCalendarSaveDate(){
  const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false});return nodes.get(id);};
  $('event-title').value='Planning';$('event-date').value='2026-11-08';
  const started=deferred(),finished=deferred();let saved;
  const context={$,api:{save:async(_type,payload)=>{saved=payload;started.resolve();await finished.promise;return {ok:true};}},loadCalendar:async()=>{},Date};
  vm.runInNewContext(`let selected='2026-11-08',month=new Date(2026,10,8),events=[],editing='',submission;
    const checked=async promise=>{const result=await promise;if(!result.ok)throw Error(result.error);return result;};
    const safe=fn=>(...args)=>(submission=Promise.resolve().then(()=>fn(...args)));
    ${rendererSection("  $('event-form').onsubmit=", "  document.querySelectorAll('[data-calendar-view]')")}
    globalThis.ui={submit:$('event-form').onsubmit,pending:()=>submission,selected:()=>selected};`,context);
  const button={disabled:false};context.ui.submit({preventDefault(){},submitter:button});await started.promise;
  $('event-date').value='2026-12-01';finished.resolve();await context.ui.pending();
  assert.equal(saved.date,'2026-11-08');assert.equal(context.ui.selected(),saved.date,'Calendar must select the saved date, not a form value edited during the save');assert.equal(button.disabled,false);
  // Programmatic submission may legitimately have no submitter button.
  context.ui.submit({preventDefault(){},submitter:null});await context.ui.pending();assert.equal(saved.date,'2026-12-01');
  $('event-form').hidden=false;context.api.save=async()=>({ok:false,error:'Temporary calendar save failure'});
  context.ui.submit({preventDefault(){},submitter:button});await assert.rejects(context.ui.pending(),/Temporary calendar save failure/);
  assert.equal(button.disabled,false);assert.equal($('event-form').hidden,false,'A failed save must leave the calendar draft available for retry');
}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'suira-workspace-'));
(async()=>{
  assert.equal(completionUrl('https://www.sub-coco.org'),'https://www.sub-coco.org/v1/chat/completions');
  for(const base of ['https://example.com/v1','https://example.com/v1/','https://example.com/v1/chat/completions'])assert.equal(completionUrl(base),'https://example.com/v1/chat/completions');
  assert.equal(completionUrl('https://example.com/api/v2'),'https://example.com/api/v2/chat/completions');
  assert.throws(()=>completionUrl('https://user:secret@example.com'));
  assert.equal(validDate('2028-02-29'),true);assert.equal(validDate('2026-02-29'),false);assert.equal(validDate('2026-13-10'),false);
  const file=path.join(dir,'data.json'),store=new SuiraStore(file),w=createWorkspace(store);
  const e=w.save('calendar',{title:'测试日程',date:'2026-10-29',time:'09:30',text:'会议备注'});
  assert.throws(()=>w.save('calendar',{id:e.id,title:'bad',date:'2026-02-30'}));
  w.save('calendar',{id:e.id,title:e.title,...e.meta,text:e.text,done:true});
  const categorized=w.save('calendar',{id:e.id,title:e.title,...e.meta,done:true,category:'study',priority:'high',location:'教室 A'});assert.equal(categorized.meta.category,'study');assert.equal(categorized.meta.priority,'high');
  const {calendarICS}=require('../lib/calendar-export');const ics=calendarICS([categorized]);assert.ok(ics.includes('BEGIN:VEVENT'));assert.ok(ics.includes('LOCATION:教室 A'));assert.ok(ics.includes('DTSTART:20261029T093000'));
  const md=w.save('markdown',{title:'测试文档',text:'# 标题\n\n**正文**'});
  assert.throws(()=>w.save('markdown',{id:e.id,title:'wrong'}));
  assert.throws(()=>w.save('markdown',{id:'missing',title:'gone'}));
  assert.throws(()=>w.save('markdown',{title:'large',text:'a'.repeat(200001)}));
  store.prune();assert.ok(store.getItem(md.id));await store.save();
  const restored=createWorkspace(new SuiraStore(file));assert.equal(restored.list('calendar')[0].meta.done,true);assert.equal(restored.list('markdown')[0].text,md.text);
  restored.remove('markdown',md.id);assert.equal(restored.list('markdown').length,0);assert.throws(()=>restored.remove('calendar',md.id));
  await testDocumentSaving();await testConcurrentDocumentSaving();await testCalendarSaveDate();
  console.log('PASS URL normalization; calendar date validation/edit/completion and async selection; Markdown CRUD, retention, reload, concurrent flush/switching, file-save status, retry and cross-type rejection');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>fs.rmSync(dir,{recursive:true,force:true}));
