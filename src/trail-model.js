(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SuiraTrailModel=api;})(globalThis,function(){
  'use strict';
  const ACTIVE=new Set(['running','queued']);
  const ids=value=>Array.isArray(value)?[...new Set(value.filter(id=>typeof id==='string'&&id))]:[];
  function duration(execution,now=Date.now()){
    const start=Number(execution.startedAt),end=ACTIVE.has(execution.status)?now:Number(execution.finishedAt);
    return Number.isFinite(start)&&start>0&&Number.isFinite(end)&&end>=start?end-start:null;
  }
  function build(executions=[],items=[],now=Date.now()){
    const records=[...new Map(executions.filter(e=>e&&e.id).map(e=>[e.id,e])).values()];
    const itemMap=new Map(items.filter(Boolean).map(item=>[item.id,item]));
    const parent=new Map(),produced=new Set();
    const find=id=>{if(!parent.has(id))parent.set(id,id);let root=id;while(parent.get(root)!==root)root=parent.get(root);while(parent.get(id)!==id){const next=parent.get(id);parent.set(id,root);id=next;}return root;};
    const join=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent.set(b,a);};
    for(const item of items){if(!item?.id)continue;find(item.id);for(const id of ids(item.parentIds)){join(id,item.id);produced.add(item.id);}}
    for(const e of records){const input=ids(e.inputIds),output=ids(e.outputIds),all=[...input,...output];all.forEach(find);for(const id of all.slice(1))join(all[0],id);output.forEach(id=>produced.add(id));}
    const buckets=new Map();
    for(const e of records){const all=[...ids(e.inputIds),...ids(e.outputIds)],key=all.length?find(all[0]):'execution:'+e.id;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(e);}
    const members=new Map();for(const id of parent.keys()){const key=find(id);if(!members.has(key))members.set(key,[]);members.get(key).push(id);}
    const groups=[...buckets.entries()].map(([key,entries])=>{
      entries.sort((a,b)=>(Number(a.startedAt)||0)-(Number(b.startedAt)||0)||String(a.id).localeCompare(String(b.id)));
      const contentIds=members.get(key)||[];
      const candidates=contentIds.filter(id=>!produced.has(id));
      const order=(a,b)=>((Number(itemMap.get(a)?.createdAt)||Infinity)-(Number(itemMap.get(b)?.createdAt)||Infinity))||a.localeCompare(b);
      const rootId=(candidates.length?candidates:contentIds).sort(order)[0]||'';
      const root=itemMap.get(rootId)||null,steps=new Map();
      for(const e of entries){const input=ids(e.inputIds);const stepKey=JSON.stringify([e.actionId,input.slice().sort(),input.length?'':e.id]);if(!steps.has(stepKey))steps.set(stepKey,[]);steps.get(stepKey).push(e);}
      const stepList=[...steps.entries()].map(([id,attempts])=>{
        const latest=attempts[attempts.length-1],times=attempts.map(e=>duration(e,now)).filter(v=>v!==null);
        return {id,attempts,latest,status:latest.status,inputIds:ids(latest.inputIds),outputIds:ids(latest.outputIds),duration:times.length?times.reduce((a,b)=>a+b,0):null};
      });
      const status=stepList.some(s=>ACTIVE.has(s.status))?'running':stepList.some(s=>s.status==='failed')?'failed':stepList.every(s=>s.status==='cancelled')?'cancelled':'done';
      const measured=entries.map(e=>duration(e,now)).filter(v=>v!==null);
      const latest=entries[entries.length-1];
      return {id:rootId||'execution:'+latest.id,root,rootId,contentIds,entries,steps:stepList,status,title:root?.title||(rootId?'来源内容已清理':'未关联内容的操作'),updatedAt:Math.max(...entries.map(e=>Number(e.finishedAt)||Number(e.startedAt)||0)),duration:measured.length?measured.reduce((a,b)=>a+b,0):null,failedAttempts:entries.filter(e=>e.status==='failed').length};
    }).sort((a,b)=>b.updatedAt-a.updatedAt||a.id.localeCompare(b.id));
    return {groups,itemMap,total:records.length,counts:{all:groups.length,running:groups.filter(g=>g.status==='running').length,failed:groups.filter(g=>g.status==='failed').length,done:groups.filter(g=>g.status==='done').length}};
  }
  function matches(group,{status='',query='',labels={},itemMap=new Map()}={}){
    if(status&&group.status!==status)return false;
    const words=String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const haystack=[group.title,...group.entries.flatMap(e=>[labels[e.actionId]||e.actionId,e.error||'']),...group.contentIds.map(id=>itemMap.get(id)?.title||'')].join(' ').toLocaleLowerCase();
    return words.every(word=>haystack.includes(word));
  }
  function formatDuration(ms){if(ms===null||!Number.isFinite(ms))return '—';if(ms<100)return '<0.1 秒';if(ms<60000)return (ms/1000).toFixed(ms<10000?1:0)+' 秒';return Math.floor(ms/60000)+' 分 '+Math.floor(ms%60000/1000)+' 秒';}
  return {build,matches,duration,formatDuration};
});
