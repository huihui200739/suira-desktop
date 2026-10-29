'use strict';
(() => {
  const $=id=>document.getElementById(id), api=window.suira.workspace;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dateKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  let calendarView='month';
  let month=new Date(), selected=dateKey(month), events=[], editing='', docs=[], current='', revision=0, savedRevision=0, timer, chain=Promise.resolve();
  const notify=message=>{const el=$('global-toast');el.textContent=message;el.classList.add('is-visible');setTimeout(()=>el.classList.remove('is-visible'),2600);};
  async function checked(promise){const result=await promise;if(!result?.ok)throw Error(result?.error||'操作失败');return result;}
  const safe=fn=>(...args)=>Promise.resolve().then(()=>fn(...args)).catch(error=>notify(error.message));
  function calendar() {
    $('calendar-month').textContent=`${month.getFullYear()} 年 ${month.getMonth()+1} 月`;
    const search=$('calendar-search').value.trim().toLowerCase(), category=$('calendar-category').value;
    const visible=events.filter(e=>(!search||(e.title+' '+e.text+' '+(e.meta.location||'')).toLowerCase().includes(search))&&(!category||(e.meta.category||'work')===category)&&(!$('calendar-hide-done').checked||!e.meta.done));
    const monthPrefix=dateKey(month).slice(0,7),today=dateKey(new Date()),weekEnd=new Date();weekEnd.setDate(weekEnd.getDate()+7);
    $('calendar-stats').innerHTML=[['本月日程',events.filter(e=>e.meta.date.startsWith(monthPrefix)).length],['今天待办',events.filter(e=>e.meta.date===today&&!e.meta.done).length],['未来七天',events.filter(e=>!e.meta.done&&e.meta.date>=today&&e.meta.date<dateKey(weekEnd)).length]].map(([label,count])=>`<div><span>${label}</span><b>${count}</b></div>`).join('');
    const first=calendarView==='week'?new Date(selected+'T12:00:00'):new Date(month.getFullYear(),month.getMonth(),1), offset=(first.getDay()+6)%7;
    if(calendarView==='week')first.setDate(first.getDate()-offset);
    document.querySelector('.calendar-layout').dataset.view=calendarView;
    document.querySelector('.calendar-week').hidden=calendarView==='agenda';$('calendar-grid').hidden=calendarView==='agenda';$('calendar-agenda').hidden=calendarView!=='agenda';
    $('calendar-agenda').innerHTML=visible.filter(e=>e.meta.date.startsWith(monthPrefix)).sort((a,b)=>(a.meta.date+(a.meta.time||'')).localeCompare(b.meta.date+(b.meta.time||''))).map(e=>`<button class="calendar-agenda-row" data-event-id="${esc(e.id)}"><time>${esc(e.meta.date.slice(5))} ${esc(e.meta.time||'全天')}</time><b>${esc(e.title)}</b><small>${esc(e.meta.location||({work:'工作',personal:'生活',study:'学习'}[e.meta.category||'work']))}</small></button>`).join('')||'<div class="workspace-empty">这个月没有匹配的日程</div>';
    $('calendar-agenda').querySelectorAll('[data-event-id]').forEach(b=>b.onclick=()=>{const item=events.find(e=>e.id===b.dataset.eventId);selected=item.meta.date;editEvent(item);});
    $('calendar-grid').innerHTML=Array.from({length:calendarView==='week'?7:42},(_,i)=>{
      const day=calendarView==='week'?new Date(first.getFullYear(),first.getMonth(),first.getDate()+i):new Date(month.getFullYear(),month.getMonth(),i-offset+1), key=dateKey(day), items=visible.filter(e=>e.meta.date===key);
      return `<button class="calendar-day ${day.getMonth()!==month.getMonth()?'outside':''} ${key===dateKey(new Date())?'today':''} ${key===selected?'selected':''}" data-date="${key}" aria-pressed="${key===selected}"><span>${day.getDate()}</span>${items.slice(0,calendarView==='week'?8:2).map(e=>`<small class="category-${e.meta.category||'work'} ${e.meta.done?'done':''}">${e.meta.priority==='high'?'! ':''}${esc(e.title)}</small>`).join('')}${items.length>2?`<em>还有 ${items.length-2} 项</em>`:''}</button>`;
    }).join('');
    $('calendar-grid').querySelectorAll('[data-date]').forEach(button=>button.onclick=()=>{selected=button.dataset.date;$('event-form').hidden=true;calendar();});
    $('agenda-date').textContent=new Date(selected+'T12:00:00').toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});
    const entries=visible.filter(e=>e.meta.date===selected).sort((a,b)=>(a.meta.time||'').localeCompare(b.meta.time||''));
    $('agenda-count').textContent=`${entries.filter(e=>!e.meta.done).length} 项待办`;
    $('agenda-list').innerHTML=entries.length?entries.map(e=>`<div class="agenda-item ${e.meta.done?'done':''}"><button class="agenda-check" data-done="${e.id}" aria-label="${e.meta.done?'重新打开':'标记完成'}">${e.meta.done?'✓':'○'}</button><button class="agenda-content" data-event="${e.id}"><small>${esc(e.meta.time||'全天')} ${e.meta.priority==='high'?' · 重要':''}</small><b>${esc(e.title)}</b><p>${esc(e.text)}</p><small>${esc(e.meta.location||'')}</small></button><button class="agenda-remove" data-remove="${e.id}" aria-label="删除日程">×</button></div>`).join(''):'<div class="workspace-empty"><b>这一天，留给你安排</b><p>添加日程，或给自己留一点空闲。</p></div>';
    $('agenda-list').querySelectorAll('[data-event]').forEach(b=>b.onclick=()=>editEvent(events.find(e=>e.id===b.dataset.event)));
    $('agenda-list').querySelectorAll('[data-done]').forEach(b=>b.onclick=safe(async()=>{const e=events.find(e=>e.id===b.dataset.done);await checked(api.save('calendar',{id:e.id,title:e.title,text:e.text,...e.meta,done:!e.meta.done}));await loadCalendar();}));
    $('agenda-list').querySelectorAll('[data-remove]').forEach(b=>b.onclick=safe(async()=>{if(!confirm('删除这条日程？'))return;await checked(api.remove('calendar',b.dataset.remove));await loadCalendar();}));
  }
  async function loadCalendar(){events=await api.list('calendar');calendar();}
  function editEvent(item){editing=item?.id||'';$('event-form').hidden=false;$('event-title').value=item?.title||'';$('event-notes').value=item?.text||'';$('event-date').value=item?.meta.date||selected;$('event-time').value=item?.meta.time||'';$('event-category').value=item?.meta.category||'work';$('event-priority').value=item?.meta.priority||'normal';$('event-location').value=item?.meta.location||'';$('event-title').focus();}
  $('calendar-prev').onclick=()=>{if(calendarView==='week'){const day=new Date(selected+'T12:00:00');day.setDate(day.getDate()-7);selected=dateKey(day);month=day;calendar();return;}month=new Date(month.getFullYear(),month.getMonth()-1,1);calendar();};
  $('calendar-next').onclick=()=>{if(calendarView==='week'){const day=new Date(selected+'T12:00:00');day.setDate(day.getDate()+7);selected=dateKey(day);month=day;calendar();return;}month=new Date(month.getFullYear(),month.getMonth()+1,1);calendar();};
  $('calendar-today').onclick=()=>{month=new Date();selected=dateKey(month);calendar();};
  $('calendar-new').onclick=()=>editEvent();$('event-cancel').onclick=()=>{$('event-form').hidden=true;};
  $('event-form').onsubmit=event=>{event.preventDefault();safe(async()=>{const button=event.submitter;button.disabled=true;try{await checked(api.save('calendar',{id:editing,title:$('event-title').value,text:$('event-notes').value,date:$('event-date').value,time:$('event-time').value,category:$('event-category').value,priority:$('event-priority').value,location:$('event-location').value,done:events.find(e=>e.id===editing)?.meta.done||false}));selected=$('event-date').value;month=new Date(selected+'T12:00:00');$('event-form').hidden=true;await loadCalendar();}finally{button.disabled=false;}})();};
  document.querySelectorAll('[data-calendar-view]').forEach(button=>button.onclick=()=>{calendarView=button.dataset.calendarView;document.querySelectorAll('[data-calendar-view]').forEach(b=>{b.classList.toggle('is-active',b===button);b.setAttribute('aria-pressed',String(b===button));});calendar();});
  for(const id of ['calendar-search','calendar-category','calendar-hide-done'])$(id).addEventListener(id==='calendar-search'?'input':'change',calendar);
  $('calendar-export').onclick=safe(async()=>{const result=await api.calendarExport();if(result.canceled)return;await checked(Promise.resolve(result));notify('日历已导出');});
  function preview(){
    const text=$('md-editor').value;
    const html=window.marked.parse(text,{gfm:true,breaks:false});
    $('md-preview').innerHTML=window.DOMPurify.sanitize(html,{USE_PROFILES:{html:true},FORBID_TAGS:['img','style','form','video','audio','iframe'],FORBID_ATTR:['style','id','name']});
    $('md-preview').querySelectorAll('input').forEach(input=>{if(input.type!=='checkbox'){input.remove();return;}input.disabled=true;});
    $('md-preview').querySelectorAll('a').forEach(link=>{link.removeAttribute('target');link.onclick=event=>{event.preventDefault();const url=link.getAttribute('href');if(/^https?:\/\//i.test(url||''))safe(()=>checked(api.openLink(url)))();};});
    const headings=[...$('md-preview').querySelectorAll('h1,h2,h3')];$('md-outline').innerHTML=headings.map((h,i)=>{h.id='md-heading-'+i;return `<button data-heading="${i}" title="${esc(h.textContent)}">${esc(h.textContent)}</button>`;}).join('');$('md-outline').querySelectorAll('button').forEach(b=>b.onclick=()=>headings[+b.dataset.heading].scrollIntoView({block:'start'}));
    $('md-words').textContent=`${text.length.toLocaleString()} 字符 · ${text.split('\n').length} 行`;
  }
  function docList(){const query=$('md-search').value.trim().toLowerCase();$('md-list').innerHTML=docs.filter(d=>(d.title+' '+d.text).toLowerCase().includes(query)).map(d=>`<button class="document-row ${d.id===current?'is-active':''}" data-document="${d.id}"><span>Md</span><div><b>${esc(d.title)}</b><small>${new Date(d.updatedAt).toLocaleDateString('zh-CN')}</small></div></button>`).join('')||'<div class="workspace-empty">没有匹配的文档</div>';$('md-list').querySelectorAll('[data-document]').forEach(b=>b.onclick=safe(()=>selectDoc(b.dataset.document)));}
  function flush(){
    clearTimeout(timer);if(!current||revision===savedRevision)return chain;
    const id=current, version=revision, payload={id,title:$('md-title').value.trim()||'未命名文档',text:$('md-editor').value};
    $('md-status').textContent='保存中…';
    const job=chain.catch(()=>{}).then(async()=>{const result=await checked(api.save('markdown',payload));const index=docs.findIndex(d=>d.id===id);if(index>=0)docs[index]=result.item;if(current===id){savedRevision=Math.max(savedRevision,version);$('md-status').textContent=revision===savedRevision?'已保存':'有未保存的修改';docList();}});
    chain=job.catch(error=>{if(current===id)$('md-status').textContent='保存失败，请重试';throw error;});
    // Callers can await rejection, while the background save also has an observer.
    chain.catch(()=>{});return chain;
  }
  async function selectDoc(id){await flush();current=id;revision=savedRevision=0;const item=docs.find(d=>d.id===id);$('md-body').hidden=!item;$('md-empty').hidden=Boolean(item);if(item){$('md-title').value=item.title;$('md-editor').value=item.text;$('md-status').textContent='已保存';preview();}docList();}
  async function loadDocs(){docs=await api.list('markdown');await selectDoc(docs.some(d=>d.id===current)?current:docs[0]?.id||'');}
  function dirty(){revision++;$('md-status').textContent='未保存';preview();clearTimeout(timer);timer=setTimeout(()=>flush().catch(error=>notify(error.message)),400);}
  $('md-editor').oninput=dirty;$('md-title').oninput=dirty;$('md-search').oninput=docList;
  $('md-new').onclick=safe(async()=>{await flush();const result=await checked(api.save('markdown',{title:'未命名文档',text:'# 新的想法\n\n'}));docs.unshift(result.item);await selectDoc(result.item.id);$('md-title').focus();$('md-title').select();});
  $('md-import').onclick=safe(async()=>{await flush();const result=await api.import();if(result.canceled)return;await checked(Promise.resolve(result));docs.unshift(result.item);await selectDoc(result.item.id);});
  $('md-export').onclick=safe(async()=>{await flush();const result=await api.export(current,$('md-export-format').value);if(result.canceled)return;await checked(Promise.resolve(result));notify('文档已导出');});
  $('md-delete').onclick=safe(async()=>{if(!confirm('删除这篇文档？'))return;await flush();await checked(api.remove('markdown',current));current='';revision=savedRevision=0;await loadDocs();});
  function setDocumentView(view){$('md-split').dataset.view=view;document.querySelectorAll('[data-md-view]').forEach(b=>{b.classList.toggle('is-active',b.dataset.mdView===view);b.setAttribute('aria-pressed',String(b.dataset.mdView===view));});}
  document.querySelectorAll('[data-md-view]').forEach(b=>b.onclick=()=>setDocumentView(b.dataset.mdView));
  $('md-save').onclick=safe(async()=>{await flush();notify('已保存在本地');});
  let syncing=false;
  function syncScroll(source,target){if(syncing||!$('md-sync-scroll').checked||$('md-split').dataset.view!=='split')return;syncing=true;const range=source.scrollHeight-source.clientHeight;target.scrollTop=range>0?source.scrollTop/range*(target.scrollHeight-target.clientHeight):0;requestAnimationFrame(()=>syncing=false);}
  $('md-editor').addEventListener('scroll',()=>syncScroll($('md-editor'),$('md-preview')));
  $('md-preview').addEventListener('scroll',()=>syncScroll($('md-preview'),$('md-editor')));
  const syntax={italic:['*','*'],quote:['> ',''],link:['[','](https://example.com)'],table:['| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |',''],rule:['\n---\n',''],heading:['## ',''],bold:['**','**'],list:['- ',''],task:['- [ ] ',''],code:['```\n','\n```']};
  document.querySelectorAll('[data-md]').forEach(button=>button.onclick=()=>{const editor=$('md-editor'),[left,right]=syntax[button.dataset.md],start=editor.selectionStart,end=editor.selectionEnd;const insertion=left+editor.value.slice(start,end)+right;editor.focus();editor.setSelectionRange(start,end);if(!document.execCommand('insertText',false,insertion))editor.setRangeText(insertion,start,end,'end');dirty();});
  document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&document.querySelector('#page-markdown.is-active')){const views={'1':'edit','2':'split','3':'preview'};if(views[event.key]){event.preventDefault();setDocumentView(views[event.key]);return;}}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'&&document.querySelector('#page-markdown.is-active')){event.preventDefault();flush().catch(error=>notify(error.message));}});
  api.onClosing?.(safe(async()=>{await flush();await api.closeReady();}));
  window.addEventListener('blur',()=>flush().catch(()=>{}));
  // Preserve every original settings control and listener while changing the layout.
  const categories=['storage','general','translation','storage','shortcuts','about'];
  document.querySelectorAll('.settings-grid > .setting-card').forEach((card,index)=>card.dataset.category=categories[index]);
  function settingTab(value){document.querySelectorAll('[data-setting-tab]').forEach(b=>{b.classList.toggle('is-active',b.dataset.settingTab===value);b.setAttribute('aria-pressed',String(b.dataset.settingTab===value));});document.querySelectorAll('[data-category]').forEach(card=>card.hidden=card.dataset.category!==value);}
  document.querySelectorAll('[data-setting-tab]').forEach(button=>button.onclick=()=>settingTab(button.dataset.settingTab));settingTab('general');
  window.WorkspaceUI={open:safe(async type=>{if(type==='calendar')await loadCalendar();else await loadDocs();}),flush,
    shortcuts(snapshot){const rows=Object.entries(snapshot.bindings||{}).filter(([name,acc])=>name.startsWith('panelKey:')&&acc);$('all-shortcut-status').innerHTML=rows.map(([name,acc])=>`<div><kbd>${esc(acc.replace('+',' + '))}</kbd><small class="${snapshot.status?.[name]?.ok?'is-ok':'is-error'}">${snapshot.status?.[name]?.ok?'已生效':esc(snapshot.status?.[name]?.error||'未注册')}</small></div>`).join('');}
  };
})();
