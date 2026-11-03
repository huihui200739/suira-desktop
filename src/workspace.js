'use strict';
(() => {
  const $=id=>document.getElementById(id), api=window.suira.workspace;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const toolEmpty=(id,title,hint='')=>'<div class="workspace-empty"><span class="tool-emblem" aria-hidden="true">'+(window.SuiraToolArt?.render(id)||'')+'</span><b>'+esc(title)+'</b>'+(hint?'<p>'+esc(hint)+'</p>':'')+'</div>';
  const dateKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const lunarFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese',{day:'numeric'});
  const lunarDays = ['初一','初二','初三','初四','初五','初六','初七','初八','初九','初十','十一','十二','十三','十四','十五','十六','十七','十八','十九','二十','廿一','廿二','廿三','廿四','廿五','廿六','廿七','廿八','廿九','三十'];
  const lunar = day => lunarDays[Number(lunarFormatter.formatToParts(day).find(p=>p.type==='day')?.value)-1] || lunarFormatter.format(day);
  let previewTimer, richDocument=null, sourceDocument=null, richText='', richKey='', requestedView='write';
  let allDocuments=false, outlineCollapsed=false, outlineItems=[], activeHeading=-1;
  const foldedHeadings=new Set();
  function documentIdentity(item) {
    if(document.documentElement.dataset.tool!=='markdown')return;
    document.querySelector('.brand b').textContent=item?item.title+'.md':'未打开 Markdown';
    document.querySelector('.brand b').hidden=Boolean(item);
    $('md-title').hidden=!item;
  }
  let agendaMode='countdown', countdownFilter='all', upcomingDays=[];
  let calendarView='month';
  let month=new Date(), selected=dateKey(month), events=[], editing='', docs=[], current='', revision=0, savedRevision=0, timer, chain=Promise.resolve();
  const notify=message=>{const el=$('global-toast');el.textContent=message;el.classList.add('is-visible');setTimeout(()=>el.classList.remove('is-visible'),2600);};
  async function checked(promise){const result=await promise;if(!result?.ok)throw Error(result?.error||'操作失败');return result;}
  const safe=fn=>(...args)=>Promise.resolve().then(()=>fn(...args)).catch(error=>notify(error.message));
  function calendar() {
    $('calendar-month').textContent=`${month.getFullYear()} 年 ${month.getMonth()+1} 月`;
    if($('calendar-jump'))$('calendar-jump').value=dateKey(month).slice(0,7);
    const search=$('calendar-search').value.trim().toLowerCase(), category=$('calendar-category').value;
    const visible=events.filter(e=>(!search||(e.title+' '+e.text+' '+(e.meta.location||'')).toLowerCase().includes(search))&&(!category||(e.meta.category||'work')===category)&&(!$('calendar-hide-done').checked||!e.meta.done));
    const monthPrefix=dateKey(month).slice(0,7),today=dateKey(new Date()),weekEnd=new Date();weekEnd.setDate(weekEnd.getDate()+7);
    $('calendar-stats').innerHTML=[['本月日程',events.filter(e=>e.meta.date.startsWith(monthPrefix)).length],['今天待办',events.filter(e=>e.meta.date===today&&!e.meta.done).length],['未来七天',events.filter(e=>!e.meta.done&&e.meta.date>=today&&e.meta.date<dateKey(weekEnd)).length]].map(([label,count])=>`<div><span>${label}</span><b>${count}</b></div>`).join('');
    const byDate=new Map();for(const item of visible){const key=item.meta.date;if(!byDate.has(key))byDate.set(key,[]);byDate.get(key).push(item);}
    const first=calendarView==='week'?new Date(selected+'T12:00:00'):new Date(month.getFullYear(),month.getMonth(),1), offset=(first.getDay()+6)%7;
    if(calendarView==='week')first.setDate(first.getDate()-offset);
    document.querySelector('.calendar-layout').dataset.view=calendarView;
    document.querySelector('.calendar-week').hidden=calendarView==='agenda';$('calendar-grid').hidden=calendarView==='agenda';$('calendar-agenda').hidden=calendarView!=='agenda';
    $('calendar-agenda').innerHTML=visible.filter(e=>e.meta.date.startsWith(monthPrefix)).sort((a,b)=>(a.meta.date+(a.meta.time||'')).localeCompare(b.meta.date+(b.meta.time||''))).map(e=>`<button class="calendar-agenda-row" data-event-id="${esc(e.id)}"><time>${esc(e.meta.date.slice(5))} ${esc(e.meta.time||'全天')}</time><b>${esc(e.title)}</b><small>${esc(e.meta.location||({work:'工作',personal:'生活',study:'学习'}[e.meta.category||'work']))}</small></button>`).join('')||'<div class="workspace-empty">这个月没有匹配的日程</div>';
    $('calendar-agenda').querySelectorAll('[data-event-id]').forEach(b=>b.onclick=()=>{const item=events.find(e=>e.id===b.dataset.eventId);selected=item.meta.date;editEvent(item);});
    $('calendar-grid').innerHTML=Array.from({length:calendarView==='week'?7:42},(_,i)=>{
      const day=calendarView==='week'?new Date(first.getFullYear(),first.getMonth(),first.getDate()+i):new Date(month.getFullYear(),month.getMonth(),i-offset+1), key=dateKey(day), items=byDate.get(key)||[], info=window.CalendarData.day(day);
      const badge=info.term||info.festival;
      return `<button class="calendar-day ${i%7>=5?'weekend':''} ${day.getMonth()!==month.getMonth()?'outside':''} ${key===dateKey(new Date())?'today':''} ${key===selected?'selected':''}" data-date="${key}" aria-pressed="${key===selected}"><span class="day-number">${day.getDate()}${info.work!==null?`<i class="work-badge ${info.work?'work':'rest'}">${info.work?'班':'休'}</i>`:''}</span><label class="lunar-day">${badge?`<span class="date-badge ${info.term?'term':'holiday'}">${esc(badge)}</span>`:info.lunar}</label>${items.slice(0,calendarView==='week'?8:2).map(e=>`<small class="category-${e.meta.category||'work'} ${e.meta.done?'done':''}">${e.meta.priority==='high'?'! ':''}${esc(e.title)}</small>`).join('')}${items.length>2?`<em>还有 ${items.length-2} 项</em>`:''}</button>`;
    }).join('');
    $('calendar-grid').querySelectorAll('[data-date]').forEach(button=>button.onclick=()=>{selected=button.dataset.date;$('event-form').hidden=true;calendar();});
    if($('calendar-week-numbers')){const start=calendarView==='week'?first:new Date(month.getFullYear(),month.getMonth(),1-offset);$('calendar-week-numbers').innerHTML=Array.from({length:calendarView==='week'?1:6},(_,i)=>`<span>${window.CalendarData.week(new Date(start.getFullYear(),start.getMonth(),start.getDate()+i*7))}</span>`).join('');}
    if($('calendar-selected')){const d=new Date(selected+'T12:00:00'),v=window.CalendarData.day(d);$('calendar-selected').textContent=d.toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'short'})+' '+v.month+v.lunar;}
    $('agenda-date').textContent=new Date(selected+'T12:00:00').toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});
    const entries=visible.filter(e=>e.meta.date===selected).sort((a,b)=>(a.meta.time||'').localeCompare(b.meta.time||''));
    $('agenda-count').textContent=`${entries.filter(e=>!e.meta.done).length} 项待办`;
    $('agenda-list').innerHTML=entries.length?entries.map(e=>`<div class="agenda-item ${e.meta.done?'done':''}"><button class="agenda-check" data-done="${e.id}" aria-label="${e.meta.done?'重新打开':'标记完成'}">${e.meta.done?'✓':'○'}</button><div class="agenda-entry"><button class="agenda-content" data-event="${e.id}"><small>${esc(e.meta.time||'全天')} ${e.meta.priority==='high'?' · 重要':''}</small><b>${esc(e.title)}</b><small>${esc(e.meta.location||'')}</small></button>${e.text?`<details class="agenda-notes"><summary>备注</summary><p>${esc(e.text)}</p></details>`:''}</div><button class="agenda-remove" data-remove="${e.id}" aria-label="删除日程">×</button></div>`).join(''):toolEmpty('calendar','这一天，留给你安排','添加日程，或给自己留一点空闲。');
    if(agendaMode==='countdown'){
      const todayUTC=Date.UTC(new Date().getFullYear(),new Date().getMonth(),new Date().getDate());
      const builtins=upcomingDays.filter(e=>(countdownFilter==='all'||countdownFilter===e.kind)&&(!search||e.title.toLowerCase().includes(search))).map(e=>({title:e.title,meta:{date:e.date},builtin:e.kind}));
      const custom=['all','custom'].includes(countdownFilter)?visible.filter(e=>!e.meta.done&&e.meta.date>=today):[];
      const upcoming=[...builtins,...custom].sort((a,b)=>a.meta.date.localeCompare(b.meta.date));
      $('agenda-list').innerHTML=upcoming.map(e=>{const days=Math.round((Date.parse(e.meta.date+'T00:00:00Z')-todayUTC)/86400000);return `<button class="countdown-row" ${e.builtin?`data-builtin-date="${e.meta.date}"`:`data-event="${esc(e.id)}"`}><div><b>${esc(e.title)}</b><small>${e.builtin==='term'?'节气 · ':e.builtin==='holiday'?'节日 · ':'自定义 · '}${esc(e.meta.date)}</small></div><strong>${days}</strong><small>天后</small></button>`;}).join('')||toolEmpty('calendar','还没有即将到来的日程');
    }
    $('countdown-filters')?.toggleAttribute('hidden',agendaMode!=='countdown');
    $('calendar-new').textContent=agendaMode==='countdown'?'⊕ 添加倒数日':'⊕ 添加待办';
    $('agenda-list').querySelectorAll('[data-builtin-date]').forEach(b=>b.onclick=()=>{selected=b.dataset.builtinDate;month=new Date(selected+'T12:00:00');calendar();});
    $('agenda-list').querySelectorAll('[data-event]').forEach(b=>b.onclick=()=>editEvent(events.find(e=>e.id===b.dataset.event)));
    $('agenda-list').querySelectorAll('[data-done]').forEach(b=>b.onclick=safe(async()=>{const e=events.find(e=>e.id===b.dataset.done);await checked(api.save('calendar',{id:e.id,title:e.title,text:e.text,...e.meta,done:!e.meta.done}));await loadCalendar();}));
    $('agenda-list').querySelectorAll('[data-remove]').forEach(b=>b.onclick=safe(async()=>{if(!confirm('删除这条日程？'))return;await checked(api.remove('calendar',b.dataset.remove));await loadCalendar();}));
  }
  async function loadCalendar(){await window.CalendarData.ready();events=await api.list('calendar');upcomingDays=window.CalendarData.upcoming(new Date());calendar();}
  function editEvent(item){editing=item?.id||'';$('event-form').hidden=false;$('event-title').value=item?.title||'';$('event-notes').value=item?.text||'';$('event-date').value=item?.meta.date||selected;$('event-time').value=item?.meta.time||'';$('event-category').value=item?.meta.category||'work';$('event-priority').value=item?.meta.priority||'normal';$('event-location').value=item?.meta.location||'';$('event-title').focus();}
  const monthPicker=document.createElement('label');monthPicker.className='calendar-month-picker';monthPicker.title='选择年份和月份';
  $('calendar-month').before(monthPicker);monthPicker.append($('calendar-month'));
  const monthInput=document.createElement('input');monthInput.type='month';monthInput.id='calendar-jump';monthInput.min='1900-01';monthInput.max='2200-12';monthInput.setAttribute('aria-label','跳转到指定月份');monthPicker.append(monthInput);
  monthInput.onchange=()=>{if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthInput.value))return;const [year,value]=monthInput.value.split('-').map(Number);if(year<1900||year>2200)return;month=new Date(year,value-1,1);selected=dateKey(month);calendar();};
  let wheelLast=0,wheelTotal=0,wheelLocked=false;
  $('calendar-grid').addEventListener('wheel',event=>{
    if(calendarView!=='month'||event.ctrlKey||event.metaKey)return;
    const delta=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY;if(!delta)return;
    event.preventDefault();const now=performance.now();if(now-wheelLast>200){wheelLocked=false;wheelTotal=0;}wheelLast=now;
    if(wheelLocked)return;wheelTotal+=delta*(event.deltaMode===1?32:event.deltaMode===2?300:1);
    if(Math.abs(wheelTotal)<40)return;wheelLocked=true;month=new Date(month.getFullYear(),month.getMonth()+Math.sign(wheelTotal),1);calendar();
  },{passive:false});
  $('calendar-prev').onclick=()=>{if(calendarView==='week'){const day=new Date(selected+'T12:00:00');day.setDate(day.getDate()-7);selected=dateKey(day);month=day;calendar();return;}month=new Date(month.getFullYear(),month.getMonth()-1,1);calendar();};
  $('calendar-next').onclick=()=>{if(calendarView==='week'){const day=new Date(selected+'T12:00:00');day.setDate(day.getDate()+7);selected=dateKey(day);month=day;calendar();return;}month=new Date(month.getFullYear(),month.getMonth()+1,1);calendar();};
  $('calendar-today').onclick=()=>{month=new Date();selected=dateKey(month);calendar();};
  $('calendar-new').onclick=()=>editEvent();$('event-cancel').onclick=()=>{$('event-form').hidden=true;};
  $('event-form').onsubmit=event=>{event.preventDefault();safe(async()=>{const button=event.submitter;button.disabled=true;try{await checked(api.save('calendar',{id:editing,title:$('event-title').value,text:$('event-notes').value,date:$('event-date').value,time:$('event-time').value,category:$('event-category').value,priority:$('event-priority').value,location:$('event-location').value,done:events.find(e=>e.id===editing)?.meta.done||false}));selected=$('event-date').value;month=new Date(selected+'T12:00:00');$('event-form').hidden=true;await loadCalendar();}finally{button.disabled=false;}})();};
  document.querySelectorAll('[data-calendar-view]').forEach(button=>button.onclick=()=>{calendarView=button.dataset.calendarView;document.querySelectorAll('[data-calendar-view]').forEach(b=>{b.classList.toggle('is-active',b===button);b.setAttribute('aria-pressed',String(b===button));});calendar();});
  for(const id of ['calendar-search','calendar-category','calendar-hide-done'])$(id).addEventListener(id==='calendar-search'?'input':'change',calendar);
  $('calendar-export').onclick=safe(async()=>{const result=await api.calendarExport();if(result.canceled)return;await checked(Promise.resolve(result));notify('日历已导出');});
  function preview(){
    clearTimeout(previewTimer);
    const text=$('md-editor').value;
    const html=window.marked.parse(text,{gfm:true,breaks:false});
    $('md-preview').innerHTML=window.SuiraMarkdown.safeHTML(html);
    $('md-preview').querySelectorAll('input').forEach(input=>{if(input.type!=='checkbox'){input.remove();return;}input.disabled=true;});
    $('md-preview').querySelectorAll('a').forEach(link=>{link.removeAttribute('target');link.onclick=event=>{event.preventDefault();const url=link.getAttribute('href');if(/^https?:\/\//i.test(url||''))safe(()=>checked(api.openLink(url)))();};});
    syncRichDocument();renderOutline();
    $('md-words').textContent=`${text.length.toLocaleString()} 字符 · ${text.split('\n').length} 行`;
  }
  function docList(){const query=$('md-search').value.trim().toLowerCase();$('md-list').innerHTML=docs.filter(d=>allDocuments||!d.meta?.recentHidden).filter(d=>(d.title+' '+d.text).toLowerCase().includes(query)).map(d=>`<button class="document-row ${d.id===current?'is-active':''}" data-document="${d.id}"><span class="recent-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6"/></svg></span><div><b>${esc(d.title)}.md</b><small class="recent-path" title="${esc(d.meta?.externalPath||'随序文档')}">${esc(d.meta?.externalPath||'随序文档')}</small><small>${new Date(d.updatedAt).toLocaleDateString('zh-CN')}</small></div><em>›</em></button>`).join('')||'<div class="workspace-empty">没有匹配的文档</div>';$('md-list').querySelectorAll('[data-document]').forEach(b=>b.onclick=safe(()=>selectDoc(b.dataset.document)));}
  async function flush(){
    clearTimeout(timer);await richDocument?.commit();clearTimeout(timer);if(!current||revision===savedRevision)return chain;
    const id=current, version=revision, payload={id,title:$('md-title').value.trim()||'未命名文档',text:$('md-editor').value};
    $('md-status').textContent='保存中…';
    const job=chain.catch(()=>{}).then(async()=>{const result=await checked(api.save('markdown',payload));const index=docs.findIndex(d=>d.id===id);if(index>=0)docs[index]=result.item;if(current===id){documentIdentity(result.item);savedRevision=Math.max(savedRevision,version);$('md-status').textContent=revision===savedRevision?savedLabel(result.item):'有未保存的修改';docList();}});
    chain=job.catch(error=>{if(current===id)$('md-status').textContent='保存失败，请重试';throw error;});
    // Callers can await rejection, while the background save also has an observer.
    chain.catch(()=>{});return chain;
  }
  async function selectDoc(id){clearTimeout(previewTimer);await flush();closeDocumentFind(false);richDocument?.destroy();richDocument=null;richText='';richKey='';foldedHeadings.clear();current=id;revision=savedRevision=0;const item=docs.find(d=>d.id===id);if(item?.meta?.recentHidden){await checked(api.recent('open',id));item.meta.recentHidden=false;}$('md-body').hidden=!item;$('md-empty').hidden=Boolean(item);document.documentElement.classList.toggle('md-home',!item);if(item){$('md-title').value=item.title;$('md-editor').value=item.text;$('md-status').textContent=item.meta?.externalPath?'本地文件；Ctrl+S 保存到原位置':'已保存';setDocumentView(requestedView);preview();}documentIdentity(item);for(const id of ['md-save','md-export','md-export-format','md-delete'])$(id).disabled=!item;docList();syncDocumentNavigation();}
  async function loadDocs(){docs=await api.list('markdown');const opened=await api.openedFile?.();await selectDoc(opened|| (docs.some(d=>d.id===current)?current:docs.find(d=>!d.meta?.recentHidden)?.id||''));}
  function dirty(){revision++;$('md-status').textContent='未保存';clearTimeout(previewTimer);previewTimer=setTimeout(preview,120);clearTimeout(timer);timer=setTimeout(()=>flush().catch(error=>notify(error.message)),400);}
  $('md-editor').oninput=dirty;$('md-title').oninput=dirty;$('md-search').oninput=docList;
  $('md-new').onclick=safe(async()=>{await flush();const result=await checked(api.save('markdown',{title:'未命名文档',text:'# 新的想法\n\n'}));docs.unshift(result.item);await selectDoc(result.item.id);$('md-title').focus();$('md-title').select();});
  $('md-import').onclick=safe(async()=>{await flush();const result=await api.import();if(result.canceled)return;await checked(Promise.resolve(result));docs=[result.item,...docs.filter(item=>item.id!==result.item.id)];await selectDoc(result.item.id);if(result.recovered)notify('已恢复尚未写回原文件的草稿，请检查后再保存');});
  $('md-export').onclick=safe(async()=>{await flush();const result=await api.export(current,$('md-export-format').value);if(result.canceled)return;await checked(Promise.resolve(result));notify('文档已导出');});
  $('md-delete').onclick=safe(async()=>{if(!confirm('删除这篇文档？'))return;await flush();await checked(api.remove('markdown',current));current='';revision=savedRevision=0;await loadDocs();});
  function supportsVisualEditing(text){
    if(/^---\r?\n[\s\S]*?\n---(?:\r?\n|$)/.test(text)||/(?:^|\n)\[\^[^\]]+\]:/.test(text))return false;
    let safe=true;
    const walk=tokens=>{for(const token of tokens||[]){
      if(token.type==='html'){
        const tags=(token.raw||token.text||'').match(/<[^>]*>/g)||[];
        if(!tags.length||tags.some(tag=>!/^<\/?(?:span|u|br)\b[^>]*>$/i.test(tag)||/\bon\w+\s*=|\b(?:src|href)\s*=/i.test(tag)))safe=false;
        for(const tag of tags.filter(tag=>/^<span\b/i.test(tag))){
          const template=document.createElement('template');template.innerHTML=tag+'</span>';const span=template.content.querySelector('span');
          if(!span||[...span.attributes].some(a=>a.name!=='style')){safe=false;continue;}
          for(const property of span.style)if(!['color','background-color','font-size'].includes(property))safe=false;
          if(span.style.fontSize&&!['12px','14px','16px','18px','20px','24px','28px','32px'].includes(span.style.fontSize))safe=false;
        }
      }
      if(token.tokens)walk(token.tokens);for(const item of token.items||[])walk(item.tokens);
    }};
    walk(window.marked.lexer(text,{gfm:true}));return safe;
  }
  function syncRichDocument(){
    if(!current||$('md-split').dataset.view!=='write')return;
    const text=$('md-editor').value;
    if(!supportsVisualEditing(text)){setDocumentView('edit',true);notify('这篇文档包含扩展语法，已保留完整源码供编辑');return;}
    if(richDocument&&richText!==text){richDocument.destroy();richDocument=null;}
    if(!richDocument){richDocument=window.SuiraRichDocument.create({element:$('md-rich'),notify,onChange:value=>{richText=value;$('md-editor').value=value;dirty();},onSelection:()=>updateActiveHeading(),openLink:url=>safe(()=>checked(api.openLink(url)))(),readClipboard:()=>checked(api.clipboard())});richKey=current;}
    if(richText!==text||richKey!==current){richDocument.load(text);richText=text;richKey=current;}
  }
  function setDocumentView(view,automatic=false){
    sourceDocument?.close();richDocument?.closeMenu();
    if(!automatic)requestedView=view;
    if(view==='write'&&current&&!supportsVisualEditing($('md-editor').value)){view='edit';notify('这篇文档包含扩展语法，使用源码模式可保持内容完整');}
    $('md-split').dataset.view=view;document.querySelector('.markdown-toolbar').hidden=false;
    document.querySelectorAll('[data-md-view]').forEach(b=>{b.classList.toggle('is-active',b.dataset.mdView===view);b.setAttribute('aria-pressed',String(b.dataset.mdView===view));});
    $('md-sync-scroll').closest('label').hidden=view!=='split';
    document.querySelectorAll('[data-document-menu],[data-rich-format]').forEach(b=>b.hidden=false);
    syncRichDocument();
  }
  function syncDocumentNavigation(){
    const isOpen=Boolean(current);$('md-search').hidden=isOpen;$('md-list').hidden=isOpen;
    if($('md-sidebar-label'))$('md-sidebar-label').textContent=isOpen?'目录':allDocuments?'全部文档':'最近打开';
    $('md-outline').hidden=!isOpen||outlineCollapsed;if($('md-clear-recent'))$('md-clear-recent').hidden=isOpen||allDocuments;if($('md-all-documents'))$('md-all-documents').hidden=isOpen;
    document.documentElement.classList.toggle('md-outline-collapsed',isOpen&&outlineCollapsed);
    for(const button of document.querySelectorAll('[aria-controls="md-outline"]')){button.disabled=!isOpen;button.setAttribute('aria-expanded',String(isOpen&&!outlineCollapsed));button.setAttribute('aria-label',outlineCollapsed?'展开目录':'收起目录');}
  }
  function toggleOutline(){outlineCollapsed=!outlineCollapsed;syncDocumentNavigation();}
  function renderOutline(){
    const source=window.SuiraMarkdown.sourceHeadings($('md-editor').value),headings=[...$('md-preview').querySelectorAll('h1,h2,h3,h4,h5,h6')],counts=new Map();
    outlineItems=headings.map((h,i)=>{h.id='md-heading-'+i;const level=+h.tagName[1],base=level+':'+h.textContent,n=(counts.get(base)||0)+1;counts.set(base,n);return {level,text:h.textContent,key:base+':'+n,offset:source[i]?.offset||0,node:h};});
    const root=[],stack=[];outlineItems.forEach((h,index)=>{const entry={...h,index,children:[]};while(stack.length&&stack.at(-1).level>=h.level)stack.pop();(stack.at(-1)?.children||root).push(entry);stack.push(entry);});
    const render=entries=>entries.map(h=>`<div class="md-toc-branch" data-outline-key="${esc(h.key)}"><div class="md-toc-row"><button type="button" class="md-toc-fold" data-fold="${h.index}" aria-label="${foldedHeadings.has(h.key)?'展开':'折叠'} ${esc(h.text)}" aria-expanded="${!foldedHeadings.has(h.key)}" ${h.children.length?'':'disabled'}><svg viewBox="0 0 16 16"><path d="m6 4 4 4-4 4"/></svg></button><button type="button" data-heading="${h.index}" title="${esc(h.text)}">${esc(h.text||'未命名标题')}</button></div>${h.children.length?`<div class="md-toc-children" ${foldedHeadings.has(h.key)?'hidden':''}>${render(h.children)}</div>`:''}</div>`).join('');
    $('md-outline').innerHTML=root.length?render(root):'<p class="md-toc-empty">添加标题后，目录会显示在这里</p>';
    $('md-outline').querySelectorAll('[data-heading]').forEach(button=>button.onclick=()=>jumpToHeading(+button.dataset.heading));
    $('md-outline').querySelectorAll('[data-fold]').forEach(button=>button.onclick=()=>{const h=outlineItems[+button.dataset.fold],children=button.closest('.md-toc-branch').querySelector(':scope>.md-toc-children');if(!children)return;children.hidden=!children.hidden;if(children.hidden)foldedHeadings.add(h.key);else foldedHeadings.delete(h.key);button.setAttribute('aria-expanded',String(!children.hidden));button.setAttribute('aria-label',(children.hidden?'展开 ':'折叠 ')+h.text);});
    syncDocumentNavigation();updateActiveHeading();
  }
  function jumpToHeading(index){
    const heading=outlineItems[index];if(!heading)return;
    const view=$('md-split').dataset.view;
    if(view==='write'&&richDocument)richDocument.jump(index);
    else if(view==='preview')heading.node.scrollIntoView({block:'start'});
    else{const editor=$('md-editor');editor.focus();editor.setSelectionRange(heading.offset,heading.offset);const lines=editor.value.slice(0,heading.offset).split('\n').length-1;editor.scrollTop=Math.max(0,lines*parseFloat(getComputedStyle(editor).lineHeight)-24);if(view==='split')heading.node.scrollIntoView({block:'start'});}
    activeHeading=index;markActiveHeading();
  }
  function markActiveHeading(){for(const b of $('md-outline').querySelectorAll('[data-heading]')){const active=+b.dataset.heading===activeHeading;b.classList.toggle('is-active',active);if(active)b.setAttribute('aria-current','location');else b.removeAttribute('aria-current');}}
  function updateActiveHeading(){
    if(!outlineItems.length)return;const view=$('md-split').dataset.view;
    if(view==='write'&&richDocument){const heads=richDocument.headings(),cursor=richDocument.selection().from;activeHeading=Math.max(0,heads.findLastIndex(h=>h.pos<cursor));}
    else if(view==='edit'||view==='split')activeHeading=Math.max(0,outlineItems.findLastIndex(h=>h.offset<=$('md-editor').selectionStart));
    else{const top=$('md-preview').getBoundingClientRect().top+32;activeHeading=Math.max(0,outlineItems.findLastIndex(h=>h.node.getBoundingClientRect().top<=top));}
    markActiveHeading();
  }
  document.querySelectorAll('[data-md-view]').forEach(b=>b.onclick=()=>setDocumentView(b.dataset.mdView));
  const findBar=document.createElement('div');findBar.id='md-find';findBar.hidden=true;
  findBar.innerHTML='<input id="md-find-query" type="search" maxlength="200" placeholder="查找正文" aria-label="查找当前 Markdown 正文"><span id="md-find-count" role="status" aria-live="polite">0 / 0</span><button id="md-find-prev" title="上一个 · Shift+Enter" aria-label="上一个匹配">↑</button><button id="md-find-next" title="下一个 · Enter" aria-label="下一个匹配">↓</button><button id="md-find-close" title="关闭查找 · Esc" aria-label="关闭文内查找">×</button>';
  document.querySelector('.markdown-toolbar').after(findBar);
  const findToggle=document.createElement('button');findToggle.id='md-find-toggle';findToggle.className='quiet-btn';findToggle.textContent='查找';findToggle.title='查找正文 · Ctrl+F';document.querySelector('.markdown-toolbar .view-switch').before(findToggle);
  let findMatches=[],findIndex=0,findTimer,lastFindQuery='',lastFindText='';
  function closeDocumentFind(focus=true){clearTimeout(findTimer);findBar.hidden=true;findMatches=[];findIndex=0;if(focus)$('md-editor').focus();}
  function revealFindMatch(){
    const match=findMatches[findIndex];if(!match)return;
    if(['preview','write'].includes($('md-split').dataset.view))setDocumentView('edit',true);
    const editor=$('md-editor');editor.setSelectionRange(match.start,match.end);
    const style=getComputedStyle(editor),mirror=document.createElement('div'),marker=document.createElement('span');
    Object.assign(mirror.style,{position:'fixed',left:'-10000px',top:'0',visibility:'hidden',whiteSpace:'pre-wrap',overflowWrap:'break-word',width:editor.clientWidth+'px',boxSizing:'border-box',font:style.font,padding:style.padding,tabSize:style.tabSize,letterSpacing:style.letterSpacing});
    mirror.textContent=editor.value.slice(0,match.start);marker.textContent=editor.value.slice(match.start,match.end)||' ';mirror.append(marker);document.body.append(mirror);editor.scrollTop=Math.max(0,marker.offsetTop-editor.clientHeight/3);mirror.remove();
  }
  function refreshDocumentFind(reveal=true){
    clearTimeout(findTimer);if(findBar.hidden)return;findMatches=[];findIndex=0;
    const query=$('md-find-query').value,slash=String.fromCharCode(92);
    lastFindQuery=query;lastFindText=$('md-editor').value;
    if(query){const pattern=[...query].map(char=>(slash+'^$.*+?()[]{}|').includes(char)?slash+char:char).join('');
      for(const match of $('md-editor').value.matchAll(new RegExp(pattern,'giu'))){findMatches.push({start:match.index,end:match.index+match[0].length});if(findMatches.length===10000)break;}}
    $('md-find-count').textContent=(findMatches.length?1:0)+' / '+findMatches.length+(findMatches.length===10000?'+':'');
    $('md-find-prev').disabled=$('md-find-next').disabled=!findMatches.length;if(reveal)revealFindMatch();
  }
  function nextFindMatch(step){if(lastFindQuery!==$('md-find-query').value||lastFindText!==$('md-editor').value){refreshDocumentFind();return;}if(!findMatches.length)return;findIndex=(findIndex+step+findMatches.length)%findMatches.length;$('md-find-count').textContent=(findIndex+1)+' / '+findMatches.length;revealFindMatch();}
  function openDocumentFind(){if(!current)return;findBar.hidden=false;refreshDocumentFind();$('md-find-query').focus();$('md-find-query').select();}
  findToggle.onclick=openDocumentFind;$('md-find-close').onclick=()=>closeDocumentFind();$('md-find-prev').onclick=()=>nextFindMatch(-1);$('md-find-next').onclick=()=>nextFindMatch(1);
  $('md-find-query').oninput=()=>{clearTimeout(findTimer);findTimer=setTimeout(refreshDocumentFind,100);};
  const updateFindAfterEditing=event=>{if(!findBar.hidden){clearTimeout(findTimer);if(!event.isComposing)findTimer=setTimeout(()=>refreshDocumentFind(false),150);}};
  $('md-editor').addEventListener('input',updateFindAfterEditing);$('md-editor').addEventListener('compositionend',updateFindAfterEditing);
  document.addEventListener('keydown',event=>{
    if(event.isComposing||!document.querySelector('#page-markdown.is-active'))return;
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'&&current){event.preventDefault();openDocumentFind();}
    else if(!findBar.hidden&&event.key==='Escape'){event.preventDefault();closeDocumentFind();}
    else if(event.target===$('md-find-query')&&event.key==='Enter'){event.preventDefault();clearTimeout(findTimer);nextFindMatch(event.shiftKey?-1:1);}
  });
  const savedLabel=item=>item?.meta?.externalPath?'草稿已保存到随序；Ctrl+S 写回原文件':'已保存';
  async function saveCurrentFile(){await flush();const item=docs.find(d=>d.id===current);if(item?.meta?.externalPath){const result=await checked(api.saveFile(current));docs[docs.findIndex(d=>d.id===current)]=result.item;$('md-status').textContent='已写回原文件';notify('已保存到 '+result.item.meta.externalPath);}else notify('已保存在随序');}
  $('md-save').onclick=safe(saveCurrentFile);
  api.onFileOpened?.(safe(async payload=>{await flush();docs=await api.list('markdown');await selectDoc(payload.id);if(payload.recovered)notify('已恢复尚未写回原文件的草稿，请检查后再保存');}));
  let syncing=false;
  function syncScroll(source,target){if(syncing||!$('md-sync-scroll').checked||$('md-split').dataset.view!=='split')return;syncing=true;const range=source.scrollHeight-source.clientHeight;target.scrollTop=range>0?source.scrollTop/range*(target.scrollHeight-target.clientHeight):0;requestAnimationFrame(()=>syncing=false);}
  $('md-editor').addEventListener('scroll',()=>syncScroll($('md-editor'),$('md-preview')));
  $('md-preview').addEventListener('scroll',()=>{syncScroll($('md-preview'),$('md-editor'));updateActiveHeading();});
  $('md-editor').addEventListener('click',updateActiveHeading);$('md-editor').addEventListener('keyup',updateActiveHeading);
  const syntax={italic:['*','*'],quote:['> ',''],link:['[','](https://example.com)'],table:['| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |',''],rule:['\n---\n',''],heading:['## ',''],bold:['**','**'],list:['- ',''],task:['- [ ] ',''],code:['```\n','\n```']};
  document.querySelectorAll('[data-md]').forEach(button=>button.onclick=()=>{if($('md-split').dataset.view==='write'&&richDocument){richDocument.apply(button.dataset.md);return;}const editor=$('md-editor'),[left,right]=syntax[button.dataset.md],start=editor.selectionStart,end=editor.selectionEnd;const insertion=left+editor.value.slice(start,end)+right;editor.focus();editor.setSelectionRange(start,end);if(!document.execCommand('insertText',false,insertion))editor.setRangeText(insertion,start,end,'end');dirty();});
  document.addEventListener('keydown',event=>{if(event.isComposing)return;if((event.ctrlKey||event.metaKey)&&document.querySelector('#page-markdown.is-active')){const views={'1':'edit','2':'split','3':'preview'};if(views[event.key]){event.preventDefault();setDocumentView(views[event.key]);return;}}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'&&document.querySelector('#page-markdown.is-active')){event.preventDefault();saveCurrentFile().catch(error=>notify(error.message));}});
  api.onClosing?.(safe(async()=>{await flush();const result=await api.confirmClose?.(current);if(result?.canceled)return;if(result && !result.ok)throw Error(result.error||'无法保存');await api.closeReady();}));
  window.addEventListener('blur',()=>flush().catch(()=>{}));
  // Preserve every original settings control and listener while changing the layout.
  const categories=['storage','general','translation','storage','shortcuts','about'];
  document.querySelectorAll('.settings-grid > .setting-card').forEach((card,index)=>card.dataset.category=categories[index]);
  function settingTab(value){document.querySelectorAll('[data-setting-tab]').forEach(b=>{b.classList.toggle('is-active',b.dataset.settingTab===value);b.setAttribute('aria-pressed',String(b.dataset.settingTab===value));});document.querySelectorAll('[data-category]').forEach(card=>card.hidden=card.dataset.category!==value);}
  document.querySelectorAll('[data-setting-tab]').forEach(button=>button.onclick=()=>settingTab(button.dataset.settingTab));settingTab('general');
  const tool=document.documentElement.dataset.tool;
  if(tool){
    const mark=document.createElement('span');mark.className='tool-kind';mark.title=tool==='markdown'?'Markdown 文档':'日历';mark.setAttribute('aria-label',mark.title);
    mark.dataset.toolObject=tool;mark.innerHTML=window.SuiraToolArt?.render(tool)||'';
    document.querySelector('.brand').prepend(mark);
    const top=document.createElement('div');top.className='tool-top-actions';
    document.querySelector('.titlebar').insertBefore(top,document.querySelector('.window-actions'));
    const theme=document.createElement('button');theme.className='quiet-btn tool-icon';theme.title='切换明暗主题';theme.setAttribute('aria-label',theme.title);theme.innerHTML='<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>';theme.onclick=safe(()=>window.suira.settings.update({theme:matchMedia('(prefers-color-scheme: dark)').matches?'light':'dark'}));top.append(theme);
    const pin=document.createElement('button');pin.className='quiet-btn tool-icon';pin.title='窗口置顶';pin.setAttribute('aria-label',pin.title);pin.innerHTML='<svg viewBox="0 0 24 24"><path d="M8 3h8l-1 7 4 4H5l4-4z M12 14v7"/></svg>';pin.onclick=safe(async()=>pin.setAttribute('aria-pressed',String(await window.suira.window.pin())));top.append(pin);
    if(tool==='markdown'){
      for(const node of document.querySelectorAll('#page-markdown .page-actions > *'))top.append(node);
      top.append(document.querySelector('.markdown-toolbar .view-switch'));
      for(const id of ['md-save','md-export-format','md-export','md-delete'])top.append($(id));
      const home=document.createElement('button');home.id='md-home';home.className='quiet-btn';home.textContent='最近';home.title='返回最近文档';home.onclick=safe(async()=>{await flush();docs=await api.list('markdown');await selectDoc('');});top.prepend(home);
      const icons={'md-import':'M3 7h6l2 2h10v11H3z M3 7V4h6l2 3','md-new':'M6 3h8l4 4v14H6z M12 10v7 M9 13h6','md-save':'M4 3h14l3 3v15H3V3z M7 3v6h10V3 M7 21v-8h10v8','md-export':'M12 3v12 M8 11l4 4 4-4 M4 16v5h16v-5','md-delete':'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7'};
      for(const [id,path] of Object.entries(icons)){const button=$(id);button.title=button.textContent;button.setAttribute('aria-label',button.textContent);button.classList.add('tool-icon');button.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;}
      const viewIcons={write:'M4 20l4-1L20 7l-3-3L5 16z',edit:'m8 6-6 6 6 6 M16 6l6 6-6 6 M14 3l-4 18',split:'M3 4h18v16H3z M12 4v16',preview:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6'};
      document.querySelectorAll('[data-md-view]').forEach(b=>{b.title=b.textContent;b.setAttribute('aria-label',b.textContent);b.innerHTML=`<svg viewBox="0 0 24 24"><path d="${viewIcons[b.dataset.mdView]}"/></svg>`;});
      const search=document.createElement('button');search.className='quiet-btn tool-icon';search.title='搜索文档';search.setAttribute('aria-label',search.title);search.innerHTML='<svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></svg>';search.onclick=safe(async()=>{await flush();docs=await api.list('markdown');await selectDoc('');$('md-search').focus();});top.prepend(search);
      const empty=$('md-empty');empty.innerHTML='<span class="welcome-document tool-emblem" data-tool-object="markdown" aria-hidden="true"></span><b>未打开 Markdown</b><p>打开 Markdown 文件，或新建空白文档</p><div class="welcome-actions"><button class="primary-btn" id="welcome-open">打开 Markdown</button><button class="quiet-btn" id="welcome-new">新建空白 Markdown</button></div>';
      $('welcome-open').onclick=()=>$('md-import').click();$('welcome-new').onclick=()=>$('md-new').click();
      const paste=document.createElement('button');paste.className='quiet-btn';paste.id='md-paste';paste.title='从剪贴板新建';paste.textContent='从剪贴板新建';paste.onclick=safe(async()=>{await flush();const clip=await checked(api.clipboard());if(!clip.text.trim())return notify('剪贴板没有文本');const r=await checked(api.save('markdown',{title:'剪贴板文档',text:clip.text}));docs.unshift(r.item);await selectDoc(r.item.id);});empty.querySelector('.welcome-actions').after(paste);
      const outline=document.createElement('button');outline.id='md-outline-toggle';outline.className='quiet-btn tool-icon';outline.title='文档目录';outline.setAttribute('aria-label',outline.title);outline.setAttribute('aria-controls','md-outline');outline.setAttribute('aria-expanded','false');outline.innerHTML='<svg viewBox="0 0 24 24"><path d="M8 6h13 M8 12h13 M8 18h13 M3 6h1 M3 12h1 M3 18h1"/></svg>';
      outline.onclick=toggleOutline;top.querySelector('[data-md-view]').parentElement.after(outline);
      // Keep the original controls/listeners; title and save state each have one home.
      document.querySelector('.brand>div').append($('md-title'));
      $('md-words').after($('md-status'));
      for(const [label,nodes] of [
        ['文件',[$('md-import'),$('md-new')]],
        ['文档视图',[top.querySelector('.view-switch'),outline]],
        ['保存与导出',[$('md-save'),$('md-export-format'),$('md-export'),$('md-delete')]]
      ]){
        const group=document.createElement('div');group.className='tool-action-group';group.setAttribute('role','group');group.setAttribute('aria-label',label);
        top.append(group);group.append(...nodes);
      }
      const foot=document.querySelector('.document-foot>span:last-child');
      foot.innerHTML='<kbd>Ctrl</kbd> + <kbd>S</kbd> 保存';
      const label=document.createElement('h3');label.id='md-sidebar-label';label.textContent='最近打开';
      const collapse=document.createElement('button');collapse.id='md-sidebar-collapse';collapse.type='button';collapse.className='md-sidebar-collapse';collapse.setAttribute('aria-controls','md-outline');collapse.setAttribute('aria-label','收起目录');collapse.innerHTML='<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z M10 4v16 M15 9l-3 3 3 3"/></svg>';collapse.onclick=toggleOutline;
      const sidebarHead=document.createElement('div');sidebarHead.className='md-sidebar-head';sidebarHead.append(label,collapse);const clear=document.createElement('button');clear.id='md-clear-recent';clear.type='button';clear.className='md-clear-recent';clear.textContent='清理记录';clear.title='清除最近打开记录，保留文档内容';clear.onclick=safe(async()=>{await flush();await checked(api.recent('clear'));docs=await api.list('markdown');docList();notify('最近打开记录已清理，文档仍保存在本地');});sidebarHead.append(clear);const all=document.createElement('button');all.id='md-all-documents';all.type='button';all.className='md-clear-recent';all.textContent='全部文档';all.onclick=()=>{allDocuments=!allDocuments;all.textContent=allDocuments?'最近打开':'全部文档';docList();syncDocumentNavigation();};sidebarHead.append(all);document.querySelector('.document-sidebar').prepend(sidebarHead);
    }else{
      top.append($('calendar-export'));
      const clock=document.createElement('time');clock.className='calendar-clock';top.append(clock);
      let tick;const updateClock=()=>{clearTimeout(tick);if(document.hidden)return;clock.textContent=new Date().toLocaleTimeString('zh-CN',{hour12:false});tick=setTimeout(updateClock,1000);};document.addEventListener('visibilitychange',updateClock);updateClock();
      const nav=document.querySelector('.calendar-month');nav.prepend($('calendar-prev'));nav.append($('calendar-next'),$('calendar-today'));
      const aside=document.querySelector('.agenda-card');aside.prepend($('calendar-new'));
      const tabs=document.createElement('div');tabs.className='agenda-tabs view-switch';tabs.innerHTML='<button data-agenda="countdown" class="is-active" aria-pressed="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10 M7 21h10 M8 3v4l8 10v4 M16 3v4L8 17v4"/></svg>倒数日</button><button data-agenda="todo" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 2 2 3-4 M11 6h10 M3 13h4 M11 13h10 M3 20h4 M11 20h10"/></svg>待办</button>';aside.prepend(tabs);
      const filters=document.createElement('div');filters.id='countdown-filters';filters.innerHTML=[['all','全部'],['holiday','节假日'],['term','24 节气'],['custom','自定义']].map(([id,label])=>`<button data-countdown="${id}" class="${id==='all'?'is-active':''}">${label}</button>`).join('');tabs.after(filters);
      filters.querySelectorAll('button').forEach(b=>b.onclick=()=>{countdownFilter=b.dataset.countdown;filters.querySelectorAll('button').forEach(x=>x.classList.toggle('is-active',x===b));calendar();});
      const numbers=document.createElement('div');numbers.id='calendar-week-numbers';$('calendar-grid').before(numbers);const dates=document.createElement('div');dates.className='calendar-dates';numbers.before(dates);dates.append(numbers,$('calendar-grid'));
      const selectedLabel=document.createElement('span');selectedLabel.id='calendar-selected';nav.append(selectedLabel);
      const filterToggle=document.createElement('button');filterToggle.className='quiet-btn';filterToggle.textContent='☰';filterToggle.title='搜索和视图';filterToggle.onclick=()=>document.querySelector('.calendar-controls').classList.toggle('is-open');top.prepend(filterToggle);
      tabs.querySelectorAll('button').forEach(button=>button.onclick=()=>{agendaMode=button.dataset.agenda;tabs.querySelectorAll('button').forEach(b=>{b.classList.toggle('is-active',b===button);b.setAttribute('aria-pressed',String(b===button));});calendar();});
    }
  }
  const visual=document.createElement('div');visual.id='md-rich';visual.className='md-rich';$('md-split').prepend(visual);
  const writeButton=document.createElement('button');writeButton.type='button';writeButton.dataset.mdView='write';writeButton.textContent='写作';writeButton.title='可视化写作';writeButton.setAttribute('aria-label','可视化写作');writeButton.innerHTML='<svg viewBox="0 0 24 24"><path d="M4 20l4-1L20 7l-3-3L5 16z"/></svg>';writeButton.onclick=()=>setDocumentView('write');document.querySelector('[data-md-view]').parentElement.prepend(writeButton);
  document.querySelector('[data-md-view="edit"]').setAttribute('aria-label','Markdown 源码');document.querySelector('[data-md-view="edit"]').setAttribute('title','Markdown 源码');
  sourceDocument=window.SuiraSourceDocument.create({element:$('md-editor'),preview:$('md-preview'),enabled:()=>Boolean(current&&document.querySelector('#page-markdown.is-active')&&$('md-split').dataset.view!=='write'),readOnly:()=>$('md-split').dataset.view==='preview',activate:()=>{if($('md-split').dataset.view==='preview')setDocumentView('edit');},onChange:dirty,notify,readClipboard:()=>checked(api.clipboard())});
  const editingController=()=>$('md-split').dataset.view==='write'?richDocument:sourceDocument;
  const documentMenus=document.createElement('div');documentMenus.className='md-format-menus';documentMenus.innerHTML=[['style','正文与标题'],['color','文字颜色'],['highlight','高亮'],['size','字号'],['insert','插入']].map(([kind,label])=>`<button type="button" data-document-menu="${kind}">${label}<span aria-hidden="true">⌄</span></button>`).join('');document.querySelector('.markdown-toolbar').prepend(documentMenus);documentMenus.querySelectorAll('button').forEach(button=>{button.onmousedown=e=>e.preventDefault();button.onclick=()=>editingController()?.openMenu(button.dataset.documentMenu,button);});
  const richFormats=document.createElement('div');richFormats.className='md-rich-formats';richFormats.innerHTML=[['bold','加粗','<b>B</b>'],['italic','斜体','<i>I</i>'],['underline','下划线','<u>U</u>'],['strike','删除线','<s>S</s>'],['inlineCode','行内代码','&lt;/&gt;']].map(([command,label,icon])=>`<button type="button" data-rich-format="${command}" aria-label="${label}" title="${label}">${icon}</button>`).join('');documentMenus.after(richFormats);richFormats.querySelectorAll('button').forEach(button=>{button.onmousedown=e=>e.preventDefault();button.onclick=()=>editingController()?.apply(button.dataset.richFormat);});
  document.querySelector('.document-sidebar').append($('md-outline'));
  window.SuiraToolArt?.mount();
  window.WorkspaceUI={open:safe(async type=>{if(type==='calendar')await loadCalendar();else await loadDocs();}),flush,get documentEditor(){return richDocument;},
    shortcuts(snapshot){const rows=Object.entries(snapshot.bindings||{}).filter(([name,acc])=>name.startsWith('panelKey:')&&acc);$('all-shortcut-status').innerHTML=rows.map(([name,acc])=>`<div><kbd>${esc(acc.replace('+',' + '))}</kbd><small class="${snapshot.status?.[name]?.ok?'is-ok':'is-error'}">${snapshot.status?.[name]?.localOnly?'仅面板内':snapshot.status?.[name]?.ok?'已生效':esc(snapshot.status?.[name]?.error||'未注册')}</small></div>`).join('');}
  };
})();
