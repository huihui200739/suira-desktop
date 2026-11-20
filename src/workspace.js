'use strict';
(() => {
  const $=id=>document.getElementById(id), api=window.suira.workspace;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const toolEmpty=(id,title,hint='')=>'<div class="workspace-empty"><span class="tool-emblem" aria-hidden="true">'+(window.SuiraToolArt?.render(id)||'')+'</span><b>'+esc(title)+'</b>'+(hint?'<p>'+esc(hint)+'</p>':'')+'</div>';
  const dateKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const lunarFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese',{day:'numeric'});
  const lunarDays = ['初一','初二','初三','初四','初五','初六','初七','初八','初九','初十','十一','十二','十三','十四','十五','十六','十七','十八','十九','二十','廿一','廿二','廿三','廿四','廿五','廿六','廿七','廿八','廿九','三十'];
  const lunar = day => lunarDays[Number(lunarFormatter.formatToParts(day).find(p=>p.type==='day')?.value)-1] || lunarFormatter.format(day);
  let previewTimer, richDocument = null, sourceDocument = null, richText = '', richKey = '';
  const views = new Set(['edit', 'split', 'preview', 'write']);
  const viewStorageKey = 'suira:markdown:view';
  let requestedView = localStorage.getItem(viewStorageKey);
  if (!views.has(requestedView)) requestedView = 'edit';
  let renderedText = null, focusedWriting = false, saveInFlight, visualBundle;
  let viewRevision = 0;
  const editor = $('md-editor'), previewPane = $('md-preview');
  const sourceHighlight = window.SuiraSourceHighlight?.attach(editor, $('md-source-highlight'));
  let sourceHeadingPositions, ignoreEditorScroll, ignorePreviewScroll;
  let documentLayout, documentLocation = 'all', locationsKey = '';
  let outlineCollapsed=true, outlineItems=[], activeHeading=-1;
  const documentDate = new Intl.DateTimeFormat('zh-CN', { dateStyle:'short', timeStyle:'short' });
  const narrowDocumentLayout = () => matchMedia('(max-width: 540px)').matches;
  const documentFolder = doc => (doc.meta?.externalPath || '').replaceAll('\\','/').replace(/\/[^/]*$/, '');
  const switchDocumentLocation = id => {
    documentLocation = id;
    outlineCollapsed = true;
    if (narrowDocumentLayout()) documentLayout.shell.classList.add('mia-notes-only');
    docList();
    syncDocumentNavigation();
    documentLayout.sections.querySelector('[aria-current="true"]')?.focus();
  };
  const foldedHeadings=new Set();
  function setWritingFocus(enabled) {
    focusedWriting = Boolean(enabled && current);
    document.documentElement.classList.toggle('md-writing-focus', focusedWriting);
    documentLayout?.shell.classList.toggle('mia-focus', focusedWriting);
    if (focusedWriting && $('md-format-toggle')?.getAttribute('aria-expanded') === 'true') $('md-format-toggle').click();
    const button = $('md-focus-toggle');
    if (button) {
      button.setAttribute('aria-pressed', String(focusedWriting));
      button.title = (focusedWriting ? '退出专注' : '专注模式') + ' · Ctrl+Shift+F';
      button.setAttribute('aria-label', button.title);
    }
    if (focusedWriting && ['edit', 'split'].includes($('md-split').dataset.view)) editor.focus();
  }
  document.addEventListener('keydown', event => {
    if (event.isComposing || event.defaultPrevented || !current || !document.querySelector('#page-markdown.is-active')) return;
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      setWritingFocus(!focusedWriting);
    } else if (focusedWriting && event.key === 'Escape' && $('md-find').hidden) {
      event.preventDefault();
      setWritingFocus(false);
    }
  });
  function documentIdentity(item) {
    if(document.documentElement.dataset.tool!=='markdown')return;
    document.title = item ? `${item.title} · 随序 Markdown` : 'Markdown · 随序';
  }
  let agendaMode='countdown', countdownFilter='all', upcomingDays=[];
  let calendarView='month';
  let month=new Date(), selected=dateKey(month), events=[], editing='', docs=[], current='', revision=0, savedRevision=0, timer;
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
      const shownItems=calendarView==='week'?8:2;
      return `<button class="calendar-day ${i%7>=5?'weekend':''} ${day.getMonth()!==month.getMonth()?'outside':''} ${key===dateKey(new Date())?'today':''} ${key===selected?'selected':''}" data-date="${key}" aria-pressed="${key===selected}"><span class="day-number">${day.getDate()}${info.work!==null?`<i class="work-badge ${info.work?'work':'rest'}">${info.work?'班':'休'}</i>`:''}</span><label class="lunar-day">${badge?`<span class="date-badge ${info.term?'term':'holiday'}">${esc(badge)}</span>`:info.lunar}</label>${items.slice(0,shownItems).map(e=>`<small class="category-${e.meta.category||'work'} ${e.meta.done?'done':''}">${e.meta.priority==='high'?'! ':''}${esc(e.title)}</small>`).join('')}${items.length>shownItems?`<em>还有 ${items.length-shownItems} 项</em>`:''}</button>`;
    }).join('');
    $('calendar-grid').querySelectorAll('[data-date]').forEach(button=>button.onclick=()=>{selected=button.dataset.date;$('event-form').hidden=true;calendar();});
    if($('calendar-week-numbers')){const start=calendarView==='week'?first:new Date(month.getFullYear(),month.getMonth(),1-offset);$('calendar-week-numbers').innerHTML=Array.from({length:calendarView==='week'?1:6},(_,i)=>`<span>${window.CalendarData.week(new Date(start.getFullYear(),start.getMonth(),start.getDate()+i*7))}</span>`).join('');}
    if($('calendar-selected')){const d=new Date(selected+'T12:00:00'),v=window.CalendarData.day(d);$('calendar-selected').textContent=d.toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'short'})+' '+v.month+v.lunar;}
    $('agenda-date').textContent=new Date(selected+'T12:00:00').toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});
    const entries=visible.filter(e=>e.meta.date===selected).sort((a,b)=>(a.meta.time||'').localeCompare(b.meta.time||''));
    $('agenda-count').textContent=`${entries.filter(e=>!e.meta.done).length} 项待办`;
    // 倒数日模式下面这整棵待办 DOM 会立刻被覆盖，别白建一次
    if(agendaMode!=='countdown')$('agenda-list').innerHTML=entries.length?entries.map(e=>`<div class="agenda-item ${e.meta.done?'done':''}"><button class="agenda-check" data-done="${e.id}" aria-label="${e.meta.done?'重新打开':'标记完成'}">${e.meta.done?'✓':'○'}</button><div class="agenda-entry"><button class="agenda-content" data-event="${e.id}"><small>${esc(e.meta.time||'全天')} ${e.meta.priority==='high'?' · 重要':''}</small><b>${esc(e.title)}</b><small>${esc(e.meta.location||'')}</small></button>${e.text?`<details class="agenda-notes"><summary>备注</summary><p>${esc(e.text)}</p></details>`:''}</div><button class="agenda-remove" data-remove="${e.id}" aria-label="删除日程">×</button></div>`).join(''):toolEmpty('calendar','这一天，留给你安排','添加日程，或给自己留一点空闲。');
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
  function editEvent(item){$('agenda-list').before($('event-form'));$('event-draft-hint')?.remove();$('event-form').dataset.draft='false';editing=item?.id||'';$('event-form').hidden=false;$('event-title').value=item?.title||'';$('event-notes').value=item?.text||'';$('event-date').value=item?.meta.date||selected;$('event-time').value=item?.meta.time||'';$('event-category').value=item?.meta.category||'work';$('event-priority').value=item?.meta.priority||'normal';$('event-location').value=item?.meta.location||'';$('event-title').focus();}
  let calendarDraftRevision=0;async function receiveCalendarDraft(draft){if(!draft)return;const token=++calendarDraftRevision;await window.CalendarData.ready();if(token!==calendarDraftRevision)return;selected=draft.date;month=new Date(draft.date+'T12:00:00');calendar();editEvent({title:draft.title,text:draft.text,meta:draft});$('event-form').dataset.draft='true';let hint=$('event-draft-hint');if(!hint){hint=document.createElement('p');hint.id='event-draft-hint';hint.setAttribute('role','status');$('event-form').prepend(hint);}hint.textContent='日程草稿 · 请核对日期和时间，保存后才会加入日历。'+(draft.warning||'');requestAnimationFrame(()=>$('event-form').scrollIntoView({block:'nearest'}));}
  if(document.documentElement.dataset.tool==='calendar'){api.onCalendarDraft?.(safe(async()=>receiveCalendarDraft(await api.calendarDraft())));api.calendarDraft?.().then(receiveCalendarDraft).catch(error=>notify(error.message));}
  window.suira.relay?.onRequest?.(async request=>{if(request.kind!=='markdown.append')return;try{await flush();if(current!==request.id)throw Error('当前文档已切换，请重试');$('md-editor').value=[$('md-editor').value,request.text].filter(Boolean).join('\n\n');richText=$('md-editor').value;richDocument?.load(richText);dirty();await flush();await window.suira.relay.reply({token:request.token,ok:true});}catch(error){await window.suira.relay.reply({token:request.token,ok:false,error:error.message});}});
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
  $('event-form').onsubmit=event=>{event.preventDefault();safe(async()=>{const button=event.submitter,payload={id:editing,title:$('event-title').value,text:$('event-notes').value,date:$('event-date').value,time:$('event-time').value,category:$('event-category').value,priority:$('event-priority').value,location:$('event-location').value,done:events.find(e=>e.id===editing)?.meta.done||false};if(button)button.disabled=true;try{await checked(api.save('calendar',payload));selected=payload.date;month=new Date(selected+'T12:00:00');$('event-form').hidden=true;await loadCalendar();}finally{if(button)button.disabled=false;}})();};
  document.querySelectorAll('[data-calendar-view]').forEach(button=>button.onclick=()=>{calendarView=button.dataset.calendarView;document.querySelectorAll('[data-calendar-view]').forEach(b=>{b.classList.toggle('is-active',b===button);b.setAttribute('aria-pressed',String(b===button));});calendar();});
  for(const id of ['calendar-search','calendar-category','calendar-hide-done'])$(id).addEventListener(id==='calendar-search'?'input':'change',calendar);
  $('calendar-export').onclick=safe(async()=>{const result=await api.calendarExport();if(result.canceled)return;await checked(Promise.resolve(result));notify('日历已导出');});
  function preview() {
    clearTimeout(previewTimer);
    const text = editor.value;
    if (renderedText === text) return;
    const { html, headings } = window.SuiraMarkdown.renderWithOutline(text);
    const scroll = previewPane.scrollTop;
    previewPane.innerHTML = html;
    for (const input of previewPane.querySelectorAll('input')) {
      if (input.type === 'checkbox') input.disabled = true;
      else input.remove();
    }
    renderedText = text;
    sourceHeadingPositions = null;
    renderOutline(headings);
    previewPane.scrollTop = scroll;
    ignorePreviewScroll = previewPane.scrollTop;
    syncScroll(editor);
    $('md-words').textContent = `${text.length.toLocaleString()} 字符 · ${text.split('\n').length} 行`;
    updateActiveHeading();
  }
  previewPane.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    event.preventDefault();
    const url = link.getAttribute('href');
    if (/^(?:https?:\/\/|suira-image:\/\/[-\w]+$)/i.test(url)) safe(() => checked(api.openLink(url)))();
  });
  function docList({ revealActive = false } = {}) {
    if (documentLayout) {
      const folders = new Map();
      for (const doc of docs) {
        const folder = documentFolder(doc);
        if (folder && !folders.has(folder.toLowerCase())) folders.set(folder.toLowerCase(), folder);
      }
      const locations = [
        { id:'all', label:'全部', icon:'library' },
        { id:'recent', label:'最近打开', icon:'recent' },
        { id:'local', label:'随序文档' },
        ...[...folders].sort((a,b)=>a[1].localeCompare(b[1],'zh-CN')).map(([key,folder])=>({
          id:'folder:'+key, label:folder.split('/').at(-1) || folder, title:folder
        }))
      ];
      if (!locations.some(item=>item.id===documentLocation)) documentLocation = 'all';
      const key = JSON.stringify([locations,documentLocation]);
      if (key !== locationsKey) {
        window.SuiraMarkdownLayout.renderLocations(documentLayout.sections, locations, documentLocation, switchDocumentLocation);
        locationsKey = key;
      }
    }
    const query = $('md-search').value.trim().toLowerCase();
    const visible = docs.filter(doc => {
      if (documentLocation==='recent' && doc.meta?.recentHidden) return false;
      if (documentLocation==='local' && doc.meta?.externalPath) return false;
      if (documentLocation.startsWith('folder:') && 'folder:'+documentFolder(doc).toLowerCase()!==documentLocation) return false;
      return !query || doc.title.toLowerCase().includes(query) || doc.text.toLowerCase().includes(query);
    });
    const list = $('md-list');
    const previousFocus = list.contains(document.activeElement) ? document.activeElement.dataset.document : null;
    const previousScroll = list.scrollTop;
    list.innerHTML = visible.map(doc => {
      const active = doc.id===current;
      return `<button type="button" class="document-row mia-row${active?' is-active':''}" data-document="${esc(doc.id)}" aria-current="${active}" title="${esc(doc.meta?.externalPath || doc.title)}"><b>${esc(doc.title)}</b><time datetime="${new Date(doc.updatedAt).toISOString()}">${documentDate.format(doc.updatedAt)}</time></button>`;
    }).join('') || `<div class="workspace-empty">${query?'没有匹配的文档':'这里还没有文档'}</div>`;
    list.scrollTop = previousScroll;
    for (const button of list.querySelectorAll('[data-document]')) {
      button.onclick = safe(() => selectDoc(button.dataset.document));
      if (button.dataset.document===previousFocus && !narrowDocumentLayout()) button.focus({preventScroll:true});
    }
    if (revealActive) list.querySelector('.is-active')?.scrollIntoView({block:'nearest'});
  }
  function flush() {
    if (!saveInFlight) saveInFlight = saveDocument().finally(() => { saveInFlight = null; });
    return saveInFlight;
  }
  async function saveDocument(){
    clearTimeout(timer);await richDocument?.commit();clearTimeout(timer);
    const documentId=current;
    // A switch/close must also wait for edits made while the first snapshot saves.
    while(documentId&&current===documentId&&revision!==savedRevision){
      const id=current, version=revision, payload={id,title:$('md-title').value.trim()||'未命名文档',text:$('md-editor').value};
      $('md-status').textContent='保存中…';
      try {
        const { item } = await checked(api.save('markdown', payload));
        const index = docs.findIndex(doc => doc.id === id);
        if (index >= 0) docs[index] = item;
        if (current === id) {
          documentIdentity(item);
          docList();
          savedRevision = version;
          $('md-status').textContent = revision === savedRevision ? savedLabel(item) : '有未保存的修改';
        }
      } catch (error) {
        if (current === id) $('md-status').textContent = '保存失败，请重试';
        throw error;
      }
      if(current!==documentId)break;
      clearTimeout(timer);await richDocument?.commit();clearTimeout(timer);
    }
  }
  async function selectDoc(id) {
    await flush();
    const item = docs.find(doc => doc.id === id);
    if (item?.meta?.recentHidden) {
      await checked(api.recent('open', item.id));
      item.meta.recentHidden = false;
      await flush();
    }
    clearTimeout(previewTimer);
    closeDocumentFind(false);
    richDocument?.destroy();
    richDocument = null;
    richText = '';
    richKey = '';
    foldedHeadings.clear();
    renderedText = null;
    viewRevision++;
    current = item?.id || '';
    revision = savedRevision = 0;
    if (!current) setWritingFocus(false);
    if (item) documentLayout?.shell.classList.remove('mia-notes-only');
    $('md-body').hidden = !item;
    $('md-empty').hidden = Boolean(item);
    if (item) {
      $('md-title').value = item.title;
      editor.value = item.text;
      $('md-status').textContent = item.meta?.externalPath ? '本地文件；Ctrl+S 保存到原位置' : '已保存';
      editor.scrollTop = 0;
      previewPane.scrollTop = 0;
      setDocumentView(requestedView, true);
    } else {
      editor.value = '';
      previewPane.replaceChildren();
      $('md-outline').replaceChildren();
      outlineItems = [];
      sourceHeadingPositions = null;
    }
    documentIdentity(item);
    api.activeDocument?.(current);
    for (const button of ['md-save', 'md-export', 'md-export-format', 'md-delete']) $(button).disabled = !item;
    docList({ revealActive:true });
    syncDocumentNavigation();
  }
  async function loadDocs() {
    await flush();
    docs = await api.list('markdown');
    const opened = await api.openedFile?.();
    await selectDoc(opened || (docs.some(doc => doc.id === current) ? current : docs.find(doc => !doc.meta?.recentHidden)?.id));
  }
  function dirty(updatePreview = true) {
    revision++;
    if (updatePreview) sourceHighlight?.schedule();
    $('md-status').textContent = '未保存';
    if (updatePreview) {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(preview, 120);
    }
    clearTimeout(timer);
    timer = setTimeout(() => flush().catch(error => notify(error.message)), 400);
  }
  editor.oninput = () => dirty();
  $('md-title').oninput = () => dirty(false);
  $('md-search').oninput = () => docList();
  $('md-new').onclick=safe(async()=>{await flush();const result=await checked(api.save('markdown',{title:'未命名文档',text:'# 新的想法\n\n'}));docs.unshift(result.item);if(documentLocation.startsWith('folder:'))documentLocation='local';$('md-search').value='';await selectDoc(result.item.id);$('md-title').focus();$('md-title').select();});
  $('md-import').onclick=safe(async()=>{await flush();const result=await api.import();if(result.canceled)return;await checked(Promise.resolve(result));docs=[result.item,...docs.filter(item=>item.id!==result.item.id)];if(documentLocation!=='all'&&documentLocation!=='recent')documentLocation='folder:'+documentFolder(result.item).toLowerCase();$('md-search').value='';await selectDoc(result.item.id);if(result.recovered)notify('已恢复尚未写回原文件的草稿，请检查后再保存');});
  $('md-export').onclick=safe(async()=>{await flush();const result=await api.export(current,$('md-export-format').value);if(result.canceled)return;await checked(Promise.resolve(result));notify('文档已导出');});
  $('md-delete').onclick=safe(async()=>{const id=current;if(!id||!confirm('删除这篇文档？此操作会移除随序中的文档记录。'))return;await flush();await checked(api.remove('markdown',id));if(current===id){current='';revision=savedRevision=0;await loadDocs();}});
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
    if(!richDocument){richDocument=window.SuiraRichDocument.create({element:$('md-rich'),notify,onChange:value=>{richText=value;$('md-editor').value=value;dirty();},onSelection:()=>updateActiveHeading(),openLink:url=>safe(()=>checked(api.openLink(url)))(),readClipboard:()=>checked(api.clipboard()),capture:async kind=>{const id=current;await flush();const result=await api.capture({kind});if(current!==id)throw Error('当前文档已切换，未插入截图');return result;}});richKey=current;}
    if(richText!==text||richKey!==current){richDocument.load(text);richText=text;richKey=current;}
  }
  function loadVisualBundle() {
    if (!visualBundle) visualBundle = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'vendor/document-editor.js';
      script.onload = () => window.SuiraRichDocument ? resolve() : reject(Error('可视化编辑器初始化失败'));
      script.onerror = () => reject(Error('无法加载可视化编辑器'));
      document.head.append(script);
    }).catch(error => { visualBundle = null; throw error; });
    return visualBundle;
  }
  function setDocumentView(view, automatic = false) {
    const change = ++viewRevision;
    sourceDocument?.close();
    richDocument?.closeMenu();
    if (!automatic) {
      requestedView = view;
      localStorage.setItem(viewStorageKey, view);
    }
    // 扩展语法只对当前文档使用源码，不改用户为其他文档选的视图。
    if (view === 'write' && current && !supportsVisualEditing(editor.value)) {
      view = 'edit';
      if (!automatic) notify('这篇文档包含扩展语法，使用源码模式可保持内容完整');
    }
    if (view === 'write' && current && !window.SuiraRichDocument) {
      const id = current;
      loadVisualBundle().then(() => {
        if (current === id && change === viewRevision) setDocumentView('write', true);
      }).catch(error => { if (change === viewRevision) notify(error.message); });
      view = 'edit';
    }
    $('md-split').dataset.view=view;
    document.querySelectorAll('[data-md-view]').forEach(b=>{b.classList.toggle('is-active',b.dataset.mdView===view);b.setAttribute('aria-pressed',String(b.dataset.mdView===view));});
    $('md-sync-scroll').closest('label').hidden=view!=='split';
    if (!current) return;
    sourceHighlight?.refresh();
    if (view === 'write') syncRichDocument();
    else if (richDocument) {
      richDocument.destroy();
      richDocument = null;
      richText = '';
      richKey = '';
    }
    preview();
    if (view === 'split') syncScroll(editor);
    updateActiveHeading();
  }
  function syncDocumentNavigation(){
    const isOpen=Boolean(current);
    const showOutline = isOpen && !outlineCollapsed;
    if ($('md-focus-toggle')) $('md-focus-toggle').disabled = !isOpen;
    $('md-search').hidden = showOutline;
    $('md-list').hidden = showOutline;
    if (documentLayout) {
      documentLayout.listHead.hidden = showOutline;
      $('md-outline-head').hidden = !showOutline;
    }
    $('md-outline').hidden=!showOutline;
    const outline = $('md-outline-toggle');
    if (outline) {
      outline.disabled = !isOpen;
      outline.setAttribute('aria-expanded', String(showOutline));
      outline.title = showOutline ? '收起目录' : '展开目录';
      outline.setAttribute('aria-label', outline.title);
    }
  }
  function toggleOutline(){
    outlineCollapsed=!outlineCollapsed;
    if (documentLayout && narrowDocumentLayout()) documentLayout.shell.classList.add('mia-notes-only');
    syncDocumentNavigation();
  }
  function renderOutline(headings) {
    const counts = new Map();
    outlineItems = [...previewPane.querySelectorAll('[data-md-heading]')].flatMap(node => {
      const heading = headings[Number(node.dataset.mdHeading)];
      if (!heading || node.tagName !== 'H' + heading.level) return [];
      const text = node.textContent;
      const base = heading.level + ':' + text;
      const occurrence = (counts.get(base) || 0) + 1;
      counts.set(base, occurrence);
      return [{ ...heading, text, key: base + ':' + occurrence, node }];
    });
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
    else {
      editor.focus();
      editor.setSelectionRange(heading.offset, heading.offset);
      editor.scrollTop = Math.max(0, positionsInEditor()[index] - 24);
      if (view === 'split') {
        previewPane.scrollTop = previewHeadingPosition(heading);
        ignorePreviewScroll = previewPane.scrollTop;
        ignoreEditorScroll = editor.scrollTop;
      }
    }
    activeHeading=index;markActiveHeading();
    if (documentLayout && narrowDocumentLayout()) {
      documentLayout.shell.classList.remove('mia-notes-only');
      if (view==='edit'||view==='split') editor.focus({preventScroll:true});
    }
  }
  function markActiveHeading(){for(const b of $('md-outline').querySelectorAll('[data-heading]')){const active=+b.dataset.heading===activeHeading;b.classList.toggle('is-active',active);if(active)b.setAttribute('aria-current','location');else b.removeAttribute('aria-current');}}
  function updateActiveHeading(){
    if(!outlineItems.length)return;const view=$('md-split').dataset.view;
    if(view==='write'&&richDocument){const heads=richDocument.headings(),cursor=richDocument.selection().from;activeHeading=Math.max(0,heads.findLastIndex(h=>h.pos<cursor));}
    else if(view==='edit'||view==='split')activeHeading=Math.max(0,outlineItems.findLastIndex(h=>h.offset<=$('md-editor').selectionStart));
    else{const top=$('md-preview').getBoundingClientRect().top+32;activeHeading=Math.max(0,outlineItems.findLastIndex(h=>h.node.getBoundingClientRect().top<=top));}
    markActiveHeading();
  }
  document.querySelectorAll('[data-md-view]').forEach(button => {
    button.onclick = () => setDocumentView(button.dataset.mdView);
  });
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
    if((event.ctrlKey||event.metaKey)&&!event.shiftKey&&event.key.toLowerCase()==='f'&&current){event.preventDefault();openDocumentFind();}
    else if(!findBar.hidden&&event.key==='Escape'){event.preventDefault();closeDocumentFind();}
    else if(event.target===$('md-find-query')&&event.key==='Enter'){event.preventDefault();clearTimeout(findTimer);nextFindMatch(event.shiftKey?-1:1);}
  });
  const savedLabel=item=>item?.meta?.externalPath?'草稿已保存到随序；Ctrl+S 写回原文件':'已保存';
  async function saveCurrentFile(){
    const id=current;await flush();if(current!==id)return;
    const item=docs.find(d=>d.id===id),version=revision;
    if(item?.meta?.externalPath){
      const result=await checked(api.saveFile(id)),index=docs.findIndex(d=>d.id===id);
      // Only the original-file metadata changed; keep any newer local draft.
      if(index>=0)docs[index]={...docs[index],meta:{...docs[index].meta,...result.item.meta}};
      if(current===id&&revision===version)$('md-status').textContent='已写回原文件';
      notify('已保存到 '+result.item.meta.externalPath);
    }else notify('已保存在随序');
  }
  $('md-save').onclick=safe(saveCurrentFile);
  api.onFileOpened?.(safe(async payload=>{await flush();docs=await api.list('markdown');await selectDoc(payload.id);if(payload.recovered)notify('已恢复尚未写回原文件的草稿，请检查后再保存');}));
  function positionsInEditor() {
    const width = editor.clientWidth;
    if (sourceHeadingPositions?.width === width) return sourceHeadingPositions.positions;
    const style = getComputedStyle(editor);
    const mirror = document.createElement('div');
    Object.assign(mirror.style, {
      position: 'fixed', left: '-10000px', top: '0', visibility: 'hidden', width: `${width}px`,
      boxSizing: 'border-box', font: style.font, lineHeight: style.lineHeight, padding: style.padding,
      letterSpacing: style.letterSpacing, tabSize: style.tabSize, whiteSpace: 'pre-wrap', overflowWrap: 'break-word'
    });
    const markers = [];
    let offset = 0;
    for (const heading of outlineItems) {
      mirror.append(renderedText.slice(offset, heading.offset));
      const marker = document.createElement('span');
      mirror.append(marker);
      markers.push(marker);
      offset = heading.offset;
    }
    mirror.append(renderedText.slice(offset));
    document.body.append(mirror);
    const positions = markers.map(marker => marker.offsetTop);
    mirror.remove();
    sourceHeadingPositions = { width, positions };
    return positions;
  }
  function previewHeadingPosition(heading) {
    return heading.node.getBoundingClientRect().top - previewPane.getBoundingClientRect().top + previewPane.scrollTop;
  }
  function syncScroll(source) {
    if (!$('md-sync-scroll').checked || $('md-split').dataset.view !== 'split' || renderedText !== editor.value) return;
    const fromEditor = source === editor;
    const target = fromEditor ? previewPane : editor;
    const sourceMax = Math.max(0, source.scrollHeight - source.clientHeight);
    const targetMax = Math.max(0, target.scrollHeight - target.clientHeight);
    if (!sourceMax || !targetMax) return;
    const sourcePositions = positionsInEditor();
    const anchors = [[0, 0]];
    outlineItems.forEach((heading, index) => {
      const sourceTop = sourcePositions[index] - 24;
      const previewTop = previewHeadingPosition(heading) - 24;
      const pair = fromEditor ? [sourceTop, previewTop] : [previewTop, sourceTop];
      const previous = anchors.at(-1);
      if (pair[0] > previous[0] && pair[1] > previous[1] && pair[0] < sourceMax && pair[1] < targetMax) anchors.push(pair);
    });
    anchors.push([sourceMax, targetMax]);
    const top = Math.min(sourceMax, Math.max(0, source.scrollTop));
    const index = Math.max(1, anchors.findIndex(([at]) => at >= top));
    const [from, targetFrom] = anchors[index - 1];
    const [to, targetTo] = anchors[index];
    const next = targetFrom + (top - from) / (to - from) * (targetTo - targetFrom);
    target.scrollTop = next;
    if (fromEditor) ignorePreviewScroll = target.scrollTop;
    else ignoreEditorScroll = target.scrollTop;
  }
  editor.addEventListener('scroll', () => {
    if (editor.scrollTop !== ignoreEditorScroll) syncScroll(editor);
    ignoreEditorScroll = null;
  });
  previewPane.addEventListener('scroll', () => {
    if (previewPane.scrollTop !== ignorePreviewScroll) syncScroll(previewPane);
    ignorePreviewScroll = null;
    updateActiveHeading();
  });
  $('md-sync-scroll').addEventListener('change', () => syncScroll(editor));
  $('md-editor').addEventListener('click',updateActiveHeading);$('md-editor').addEventListener('keyup',updateActiveHeading);
  document.addEventListener('keydown',event=>{if(event.isComposing)return;if((event.ctrlKey||event.metaKey)&&document.querySelector('#page-markdown.is-active')){const views={'1':'edit','2':'split','3':'preview'};if(views[event.key]){event.preventDefault();setDocumentView(views[event.key]);return;}}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'&&document.querySelector('#page-markdown.is-active')){event.preventDefault();saveCurrentFile().catch(error=>notify(error.message));}});
  api.onClosing?.(safe(async()=>{await flush();const result=await api.confirmClose?.(current);if(result?.canceled)return;if(result && !result.ok)throw Error(result.error||'无法保存');await api.closeReady();}));
  window.addEventListener('blur',()=>flush().catch(()=>{}));
  // Preserve every original settings control and listener while changing the layout.
  document.querySelectorAll('.settings-grid > .setting-card').forEach(card=>{card.dataset.category ||= card.querySelector('#recipe-name,#setting-currency,#color-history')?'tools':card.querySelector('#setting-translate-provider')?'translation':card.querySelector('#setting-key-longCapture')?'shortcuts':card.classList.contains('about-card')?'about':card.querySelector('#setting-record,#setting-days')?'storage':'general';});
  function settingTab(value){window.SuiraGlassSelect?.close();document.querySelectorAll('[data-setting-tab]').forEach(b=>{b.classList.toggle('is-active',b.dataset.settingTab===value);b.setAttribute('aria-pressed',String(b.dataset.settingTab===value));});document.querySelectorAll('[data-category]').forEach(card=>card.hidden=card.dataset.category!==value);document.querySelector('.main-scroll')?.scrollTo(0,0);}
  document.querySelectorAll('[data-setting-tab]').forEach(button=>button.onclick=()=>settingTab(button.dataset.settingTab));settingTab('general');
  const tool=document.documentElement.dataset.tool;
  if(tool){
    const mark=document.createElement('span');mark.className='tool-kind';mark.title=tool==='markdown'?'Markdown 文档':'日历';mark.setAttribute('aria-label',mark.title);
    mark.dataset.toolObject=tool;mark.innerHTML=window.SuiraToolArt?.render(tool)||'';
    document.querySelector('.brand').prepend(mark);
    const top=document.createElement('div');top.className='tool-top-actions';
    document.querySelector('.titlebar').insertBefore(top,document.querySelector('.window-actions'));
    const theme=document.createElement('button');theme.className='quiet-btn tool-icon';theme.title='切换明暗主题';theme.setAttribute('aria-label',theme.title);theme.innerHTML='<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>';theme.onclick=safe(async()=>{const settings=await window.suira.settings.get();await window.suira.settings.update({theme:settings?.theme==='dark'?'light':'dark',themeChosen:true});});top.append(theme);
    const pin=document.createElement('button');pin.className='quiet-btn tool-icon';pin.title='窗口置顶';pin.setAttribute('aria-label',pin.title);pin.innerHTML='<svg viewBox="0 0 24 24"><path d="M8 3h8l-1 7 4 4H5l4-4z M12 14v7"/></svg>';pin.onclick=safe(async()=>pin.setAttribute('aria-pressed',String(await window.suira.window.pin())));top.append(pin);
    if(tool==='markdown'){
      const { mountEditorLayout, iconButton } = window.SuiraMarkdownLayout;
      const shell = document.querySelector('.markdown-layout');
      const actions = document.createElement('div');
      actions.setAttribute('role','group');
      actions.setAttribute('aria-label','编辑器视图和操作');
      const headingBar = $('md-title').parentElement;
      headingBar.classList.remove('document-heading');
      $('md-title').classList.add('mia-title');
      documentLayout = { shell, ...mountEditorLayout({
        shell, sidebar:document.querySelector('.document-sidebar'), search:$('md-search'),
        create:$('md-new'), list:$('md-list'), main:document.querySelector('.document-main'),
        heading:headingBar, actions, brand:'随序', open:$('md-import')
      }) };
      const action = (id,icon,label) => iconButton(Object.assign(document.createElement('button'),{id}),icon,label);
      const home = action('md-home','library','返回文档库');
      home.onclick=safe(async()=>{await flush();docs=await api.list('markdown');await selectDoc('');});
      const panes = action('md-panes','sidebar','显示或收起左栏');
      panes.setAttribute('aria-pressed','false');
      panes.onclick = () => {
        if (narrowDocumentLayout()) {
          shell.classList.toggle('mia-notes-only');
          $('md-search').focus();
        } else panes.setAttribute('aria-pressed',String(shell.classList.toggle('mia-hide-library')));
      };
      const back = action('md-notes-back','sidebar','返回编辑区');
      back.onclick = () => { shell.classList.remove('mia-notes-only'); (current ? $('md-title') : compactMore).focus(); };
      documentLayout.listHead.prepend(back);
      top.remove();
      const shortTitle = document.querySelector('.brand b');
      shortTitle.textContent = 'Markdown';
      const view = document.querySelector('.markdown-toolbar .view-switch');
      for (const button of view.querySelectorAll('button')) {
        const mode = button.dataset.mdView;
        iconButton(button,mode==='edit'?'source':mode,button.textContent);
      }
      const empty=$('md-empty');empty.innerHTML='<span class="welcome-document tool-emblem" data-tool-object="markdown" aria-hidden="true"></span><b>未打开 Markdown</b><p>打开 Markdown 文件，或新建空白文档</p><div class="welcome-actions"><button class="primary-btn" id="welcome-open">打开 Markdown</button><button class="quiet-btn" id="welcome-new">新建空白 Markdown</button></div>';
      $('welcome-open').onclick=()=>$('md-import').click();$('welcome-new').onclick=()=>$('md-new').click();
      const paste=document.createElement('button');paste.className='quiet-btn';paste.id='md-paste';paste.title='从剪贴板新建';paste.textContent='从剪贴板新建';paste.onclick=safe(async()=>{await flush();const clip=await checked(api.clipboard());if(!clip.text.trim())return notify('剪贴板没有文本');const r=await checked(api.save('markdown',{title:'剪贴板文档',text:clip.text}));docs.unshift(r.item);await selectDoc(r.item.id);});empty.querySelector('.welcome-actions').after(paste);
      const outline = action('md-outline-toggle','outline','文档目录');
      outline.setAttribute('aria-controls','md-outline');
      outline.onclick = toggleOutline;
      $('md-words').after($('md-status'));
      const more = action('md-more','more','更多文档操作');
      more.setAttribute('aria-expanded','false');
      more.setAttribute('aria-controls','md-file-menu');
      const menu=document.createElement('div');menu.id='md-file-menu';menu.className='md-file-menu';menu.hidden=true;menu.setAttribute('role','dialog');menu.setAttribute('aria-label','更多文档操作');document.body.append(menu);
      const heading=text=>{const h=document.createElement('small');h.textContent=text;menu.append(h);};
      const clear = document.createElement('button');
      clear.id = 'md-clear-recent';
      clear.type = 'button';
      clear.textContent = '清理最近打开记录';
      clear.className = 'quiet-btn';
      clear.onclick = safe(async()=>{
        await flush();
        await checked(api.recent('clear'));
        docs = await api.list('markdown');
        docList();
        notify('最近打开记录已清理，文档仍保存在本地');
      });
      heading('文件');menu.append(home,$('md-save'),clear);
      heading('导出');menu.append($('md-export-format'),$('md-export'));
      heading('视图');menu.append(theme,pin);
      heading('文档');menu.append($('md-delete'));
      const focus = action('md-focus-toggle','focus','专注模式 · Ctrl+Shift+F');
      focus.setAttribute('aria-pressed','false');
      focus.onclick = () => setWritingFocus(!focusedWriting);
      const format = action('md-format-toggle','format','格式工具');
      const toolbar = document.querySelector('.markdown-toolbar');
      toolbar.hidden = true;
      toolbar.id = 'md-format-bar';
      format.setAttribute('aria-expanded','false');
      format.setAttribute('aria-controls',toolbar.id);
      format.onmousedown = event => event.preventDefault();
      format.onclick = () => {
        toolbar.hidden = !toolbar.hidden;
        format.setAttribute('aria-expanded',String(!toolbar.hidden));
      };
      actions.append(panes,outline,view,focus,format,more);
      const compactMore = action('md-empty-more','more','文档库操作');
      compactMore.setAttribute('aria-controls',menu.id);
      compactMore.setAttribute('aria-expanded','false');
      const emptyNotes = action('md-empty-notes','sidebar','查看文档列表');
      emptyNotes.onclick = () => { shell.classList.add('mia-notes-only'); $('md-search').focus(); };
      empty.querySelector('.welcome-actions').append(emptyNotes, compactMore);
      let menuAnchor = more;
      const closeMenu=(focus=false)=>{menu.hidden=true;menuAnchor.setAttribute('aria-expanded','false');window.SuiraGlassSelect?.close();if(focus)menuAnchor.focus();};
      for (const trigger of [more,compactMore]) trigger.onclick=()=>{
        if (!menu.hidden) { closeMenu(); return; }
        menuAnchor = trigger;
        menu.hidden = false;
        trigger.setAttribute('aria-expanded','true');
        const rect = trigger.getBoundingClientRect();
        menu.style.right = Math.max(8,innerWidth-rect.right)+'px';
        menu.style.top = Math.max(8,Math.min(rect.bottom+8,innerHeight-menu.offsetHeight-8))+'px';
        menu.querySelector('button:not(:disabled)')?.focus();
      };
      menu.addEventListener('click',event=>{if(event.target.closest('button')&&!event.target.closest('.glass-select'))closeMenu();});
      document.addEventListener('pointerdown',event=>{if(!menu.hidden&&!menu.contains(event.target)&&!menuAnchor.contains(event.target)&&!event.target.closest('.glass-select-menu'))closeMenu();},true);
      document.addEventListener('keydown',event=>{if(menu.hidden||window.SuiraGlassSelect?.isOpen())return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeMenu(true);return;}if(!menu.contains(event.target)||event.target.closest('.glass-select'))return;if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();const list=[...menu.querySelectorAll('button:not(:disabled)')].filter(b=>b.checkVisibility()),index=list.indexOf(document.activeElement);list[event.key==='Home'?0:event.key==='End'?list.length-1:(index+(event.key==='ArrowDown'?1:-1)+list.length)%list.length]?.focus();},true);
      window.addEventListener('resize',()=>closeMenu());window.addEventListener('blur',()=>closeMenu());
      const foot=document.querySelector('.document-foot>span:last-child');
      foot.innerHTML='<kbd>Ctrl</kbd> + <kbd>S</kbd> 保存';
      const outlineHead = document.createElement('div');
      outlineHead.className = 'md-outline-head';
      outlineHead.id = 'md-outline-head';
      outlineHead.hidden = true;
      const collapse = action('md-sidebar-collapse','sidebar','返回文档列表');
      collapse.setAttribute('aria-controls','md-outline');
      collapse.onclick = () => { toggleOutline(); $('md-search').focus(); };
      const outlineBack = action('md-outline-back','sidebar','返回编辑区');
      outlineBack.onclick = back.onclick;
      const outlineLabel = document.createElement('b');
      outlineLabel.textContent = '文档目录';
      outlineHead.append(outlineLabel,outlineBack,collapse);
      document.querySelector('.document-sidebar').append(outlineHead);
    }else{
      top.append($('calendar-export'));
      const clock=document.createElement('time');clock.className='calendar-clock';top.append(clock);
      let tick;const updateClock=()=>{clearTimeout(tick);if(document.hidden)return;clock.textContent=window.CalendarData.clock(new Date());tick=setTimeout(updateClock,60000-Date.now()%60000);};document.addEventListener('visibilitychange',updateClock);updateClock();
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
  const writeButton=document.createElement('button');writeButton.dataset.mdView='write';window.SuiraMarkdownLayout.iconButton(writeButton,'new','可视化写作');writeButton.onclick=()=>setDocumentView('write');document.querySelector('[data-md-view]').parentElement.prepend(writeButton);
  document.querySelector('[data-md-view="edit"]').setAttribute('aria-label','Markdown 源码');document.querySelector('[data-md-view="edit"]').setAttribute('title','Markdown 源码');
  sourceDocument=window.SuiraSourceDocument.create({element:$('md-editor'),preview:$('md-preview'),enabled:()=>Boolean(current&&document.querySelector('#page-markdown.is-active')&&$('md-split').dataset.view!=='write'),readOnly:()=>$('md-split').dataset.view==='preview',activate:()=>{if($('md-split').dataset.view==='preview')setDocumentView('edit');},onChange:dirty,notify,readClipboard:()=>checked(api.clipboard()),capture:async kind=>{const id=current;await flush();const result=await api.capture({kind});if(current!==id)throw Error('当前文档已切换，未插入截图');return result;}});
  const editingController=()=>$('md-split').dataset.view==='write'?richDocument:sourceDocument;
  const documentMenus=document.createElement('div');documentMenus.className='md-format-menus';documentMenus.innerHTML=[['style','正文与标题'],['color','文字颜色'],['highlight','高亮'],['size','字号'],['insert','插入']].map(([kind,label])=>`<button type="button" data-document-menu="${kind}">${label}${window.suiraIcons.svg('chevron_down')}</button>`).join('');document.querySelector('.markdown-toolbar').prepend(documentMenus);documentMenus.querySelectorAll('button').forEach(button=>{button.onmousedown=e=>e.preventDefault();button.onclick=()=>editingController()?.openMenu(button.dataset.documentMenu,button);});
  const richFormats=document.createElement('div');richFormats.className='md-rich-formats';richFormats.innerHTML=[['bold','加粗','<b>B</b>'],['italic','斜体','<i>I</i>'],['underline','下划线','<u>U</u>'],['strike','删除线','<s>S</s>'],['inlineCode','行内代码','&lt;/&gt;']].map(([command,label,icon])=>`<button type="button" data-rich-format="${command}" aria-label="${label}" title="${label}">${icon}</button>`).join('');documentMenus.after(richFormats);richFormats.querySelectorAll('button').forEach(button=>{button.onmousedown=e=>e.preventDefault();button.onclick=()=>editingController()?.apply(button.dataset.richFormat);});
  document.querySelector('.document-sidebar').append($('md-outline'));
  window.SuiraToolArt?.mount();
  window.WorkspaceUI={open:safe(async type=>{if(type==='calendar')await loadCalendar();else await loadDocs();}),flush,get documentEditor(){return richDocument;},
    shortcuts(snapshot){const rows=Object.entries(snapshot.bindings||{}).filter(([name,acc])=>name.startsWith('panelKey:')&&acc);$('all-shortcut-status').innerHTML=rows.map(([name,acc])=>`<div><kbd>${esc(acc.replace(/\+/g,' + '))}</kbd><small class="${snapshot.status?.[name]?.ok?'is-ok':'is-error'}">${snapshot.status?.[name]?.localOnly?'仅面板内':snapshot.status?.[name]?.ok?'已生效':esc(snapshot.status?.[name]?.error||'未注册')}</small></div>`).join('');}
  };
})();
