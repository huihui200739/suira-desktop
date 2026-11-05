/* Original Suira UI, informed by affectUI's documented inbox / tool-call patterns.
   No Pro component source or React runtime is bundled. */
(function(root){
 'use strict';
 function create(options){
  const {element,escapeHtml:h,labels,relativeTime,compactText,onPreview,onRetry,onTranslate,onConfigure,notify}=options;
  const model=root.SuiraTrailModel,$=selector=>element.querySelector(selector),list=$('.trail-list');
  let data={groups:[],itemMap:new Map(),counts:{}},records=[],items=[],contentId='';
  const opened=new Set(),stepsOpen=new Set(),timings=new Set(),busy=new Set();
  const statusText={done:'已完成',failed:'需处理',running:'进行中',queued:'排队中',cancelled:'已取消'};
  const domId=(type,id)=>'trace-'+type+'-'+encodeURIComponent(id);
  const icon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h10l4 4v12H5zM14 4v5h5M9 13h6M9 16h4"/></svg>';
  const chevron='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6"/></svg>';
  const itemTitle=id=>data.itemMap.get(id)?.title||'内容已清理';
  function flow(group){
    let previous=[group.rootId];
    return `<span>${h(group.root?.kind==='image'?'原始图片':'来源内容')}</span>`+group.steps.map(step=>{
      const linked=step.inputIds.some(id=>previous.includes(id));
      previous=step.attempts.flatMap(attempt=>attempt.outputIds||[]);
      const source=step.inputIds.map(itemTitle).join('、');
      return `<span aria-hidden="true">${linked?'→':'↳'}</span>${!linked&&source?`<span class="trace-branch" title="${h(source)}">从${h(source)}</span><span aria-hidden="true">→</span>`:''}<span class="${h(step.status)}" title="原内容：${h(source||'未关联内容')}">${h(labels[step.latest.actionId]||step.latest.actionId)}</span>`;
    }).join('');
  }
  function contentCard(id){
    const item=data.itemMap.get(id);if(!item)return '<div class="trace-content is-missing">内容已清理，保留这次处理记录</div>';
    const thumbnail=typeof item.thumbnail==='string'&&/^data:image\/(png|jpeg|webp|gif);base64,/.test(item.thumbnail)?`<img src="${h(item.thumbnail)}" alt="">`:icon;
    return `<button class="trace-content" type="button" data-trace-preview="${h(id)}"><span class="trace-content-icon">${thumbnail}</span><span><b>${h(item.title||'未命名内容')}</b><small>${h(compactText(item.text||'').slice(0,220)||(item.kind==='image'?'查看图片':item.kind==='files'?'查看文件':'查看内容'))}</small></span><span class="trace-content-open">查看</span></button>`;
  }
  function recovery(step){
    const e=step.latest;if(e.status!=='failed')return '';
    const input=data.itemMap.get(step.inputIds[0]),available=Boolean(input),working=busy.has(e.id);
    return `<div class="trace-error" role="note"><b>这一步没有完成</b><p>${h(e.error||'处理未完成，请重试')}</p><div>${available?`<button type="button" class="quiet-btn" data-trace-retry="${h(e.id)}" ${working?'disabled':''}>${working?'重试中…':'重试这一步'}</button>`:'<span>原内容已清理，无法重试</span>'}${e.actionId==='text.translate'&&input?.text?`<button class="quiet-btn" type="button" data-trace-translate="${h(input.id)}">调整翻译</button><button class="trace-link" type="button" data-trace-configure>翻译服务设置</button>`:''}</div></div>`;
  }
  function stepCard(step){
    const e=step.latest,key=e.id,expanded=stepsOpen.has(key),name=labels[e.actionId]||e.actionId;
    const previous=step.attempts.slice(0,-1).reverse();
    const body=`${recovery(step)}<div class="trace-io"><section><h4>原内容</h4>${step.inputIds.length?step.inputIds.map(contentCard).join(''):'<p class="trace-muted">这次操作未关联内容</p>'}</section><section><h4>处理结果</h4>${step.outputIds.length?step.outputIds.map(contentCard).join(''):`<p class="trace-muted">${h(e.status==='done'?(e.actionId==='output.copy'?'已复制到剪贴板':e.actionId==='output.shelf'?'已加入任务匣':'这次操作没有生成新内容'):e.status==='failed'?'未生成结果':e.status==='cancelled'?'操作已取消':'处理完成后会出现在这里')}</p>`}</section></div>${previous.length?`<details class="trace-attempts"><summary>之前的 ${previous.length} 次尝试</summary>${previous.map(a=>`<div><span class="trace-status ${h(a.status)}">${h(statusText[a.status]||a.status)}</span><time>${h(relativeTime(a.startedAt))}</time><span>${h(a.error||'处理完成')}</span><small class="trace-duration">${h(model.formatDuration(model.duration(a)))}</small></div>`).join('')}</details>`:''}`;
    return `<details class="trace-step" data-step-id="${h(key)}" ${expanded?'open':''}><summary><span class="trace-step-dot ${h(e.status)}" aria-hidden="true"></span><b>${h(name)}</b><span class="trace-attempt-count">${step.attempts.length>1?step.attempts.length+' 次尝试':''}</span><span class="trace-status ${h(e.status)}">${h(statusText[e.status]||e.status)}</span><span class="trace-duration" data-duration-exec="${h(e.id)}">${h(model.formatDuration(model.duration(e)))}</span>${chevron}</summary><div class="trace-step-body">${body}</div></details>`;
  }
  function groupCard(group){
    const expanded=opened.has(group.id),bodyId=domId('body',group.id),latestError=[...group.steps].reverse().find(s=>s.status==='failed')?.latest.error;
    const max=Math.max(1,...group.steps.map(s=>s.duration||0));
    return `<article class="trace-group ${timings.has(group.id)?'show-timings':''} ${group.status==='failed'?'is-failed':''}" data-group-id="${h(group.id)}"><button class="trace-group-toggle" type="button" aria-expanded="${expanded}" aria-controls="${bodyId}" data-trace-toggle="${h(group.id)}"><span class="trace-source-icon">${icon}</span><span class="trace-group-title"><b>${h(group.title)}</b><small>${group.steps.length} 个步骤 · ${group.entries.length} 次处理${latestError?' · '+h(latestError):''}</small></span><span class="trace-group-meta"><span class="trace-status ${h(group.status)}">${h(statusText[group.status]||group.status)}</span><span class="trace-duration" data-duration-group="${h(group.id)}">${h(model.formatDuration(group.duration))}</span><time title="${h(new Date(group.updatedAt||Date.now()).toLocaleString())}">${h(relativeTime(group.updatedAt))}</time></span>${chevron}</button><div class="trace-group-body" id="${bodyId}" ${expanded?'':'hidden'}><div class="trace-flow" aria-label="处理概览与分支来源">${flow(group)}</div><div class="trace-group-tools"><span>按首次处理时间排列，分支标注来源，重试收进同一步骤</span><button class="trace-link" type="button" aria-pressed="${timings.has(group.id)}" data-trace-timing="${h(group.id)}">步骤用时</button></div><div class="trace-timings" ${timings.has(group.id)?'':'hidden'}><p>处理用时，不含操作间隔；包含重试</p>${group.steps.map(s=>`<div><span>${h(labels[s.latest.actionId]||s.latest.actionId)}</span><i aria-hidden="true"><i style="width:${s.duration===null?0:Math.max(1,s.duration/max*100)}%"></i></i><span>${h(model.formatDuration(s.duration))}</span></div>`).join('')}</div><div class="trace-steps">${group.steps.map(stepCard).join('')}</div></div></article>`;
  }
  function render(nextRecords=records,nextItems=items,itemId=contentId){
    list.querySelectorAll('.trace-step').forEach(details=>{if(details.open)stepsOpen.add(details.dataset.stepId);else stepsOpen.delete(details.dataset.stepId);});
    const active=document.activeElement,restore=list.contains(active),focusStep=active?.closest('.trace-step')?.dataset.stepId;
    records=nextRecords;items=nextItems;data=model.build(records,items);
    const filtered=data.groups.filter(group=>group.contentIds.includes(itemId));
    if(contentId!==itemId){opened.clear();filtered.forEach(group=>opened.add(group.id));contentId=itemId;}
    list.innerHTML=filtered.length?filtered.map(groupCard).join(''):'<p class="trace-empty">这份内容还没有处理记录</p>';
    list.querySelectorAll('.trace-step').forEach(details=>details.addEventListener('toggle',()=>{if(!details.isConnected)return;if(details.open)stepsOpen.add(details.dataset.stepId);else stepsOpen.delete(details.dataset.stepId);}));
    if(restore)[...list.querySelectorAll('.trace-step')].find(e=>e.dataset.stepId===focusStep)?.querySelector('summary')?.focus({preventScroll:true});
  }
  element.addEventListener('click',async event=>{
    const target=event.target.closest('button');if(!target)return;
    if(target.hasAttribute('data-trace-toggle')){const id=target.dataset.traceToggle,open=!opened.has(id);if(open)opened.add(id);else opened.delete(id);target.setAttribute('aria-expanded',String(open));element.querySelector('#'+CSS.escape(target.getAttribute('aria-controls'))).hidden=!open;return;}
    if(target.hasAttribute('data-trace-timing')){const id=target.dataset.traceTiming,open=!timings.has(id);if(open)timings.add(id);else timings.delete(id);target.setAttribute('aria-pressed',String(open));target.closest('.trace-group').classList.toggle('show-timings',open);target.closest('.trace-group-body').querySelector('.trace-timings').hidden=!open;return;}
    if(target.hasAttribute('data-trace-preview')){onPreview(target.dataset.tracePreview);return;}
    if(target.hasAttribute('data-trace-configure')){onConfigure();return;}
    if(target.hasAttribute('data-trace-translate')){try{await onTranslate(data.itemMap.get(target.dataset.traceTranslate));}catch(e){notify(e.message,'error');}return;}
    if(target.hasAttribute('data-trace-retry')){const id=target.dataset.traceRetry;if(busy.has(id))return;busy.add(id);target.disabled=true;target.textContent='重试中…';try{await onRetry(id);}catch(e){notify(e.message||'重试失败','error');}finally{busy.delete(id);render();}}
  });
  const timer=setInterval(()=>{
    if(document.hidden||element.closest('[hidden]')||!element.closest('details')?.open||!timings.size)return;
    list.querySelectorAll('[data-duration-exec]').forEach(el=>{const e=records.find(e=>e.id===el.dataset.durationExec);if(e&&['running','queued'].includes(e.status))el.textContent=model.formatDuration(model.duration(e));});
    list.querySelectorAll('[data-duration-group]').forEach(el=>{const group=data.groups.find(g=>g.id===el.dataset.durationGroup);if(group?.status==='running'){const times=group.entries.map(e=>model.duration(e)).filter(v=>v!==null);el.textContent=model.formatDuration(times.length?times.reduce((a,b)=>a+b,0):null);}});
  },1000);
  root.addEventListener('unload',()=>clearInterval(timer),{once:true});
  return {render};
 }
 root.SuiraTrailView={create};
})(window);
