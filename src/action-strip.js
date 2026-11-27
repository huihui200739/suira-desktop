'use strict';
(() => {
  const editing=target=>target?.closest?.('input,textarea,select,[contenteditable="true"]');
  const ACTION_ICONS={
    'output.copy':'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    'text.translate':'<path d="m5 8 6 6m-7 0 6-6 2-3M2 5h12M7 2h1m14 20-5-10-5 10m2-4h6"/>',
    'ocr.local':'<path d="M4 7V5a1 1 0 0 1 1-1h2m10 0h2a1 1 0 0 1 1 1v2m0 10v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 10h8M8 14h5"/>',
    'text.to-note':'<path d="M6 4h12v11l-4 5H6z"/><path d="M9 9h6M9 13h4"/>',
    'text.to-markdown':'<path d="M4 6h16v12H4z"/><path d="M7 14v-4l2 2.5L11 10v4m5-4v4m0 0-2-2m2 2 2-2"/>',
    'text.to-calendar':'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    'item.to-shelf':'<path d="M4 6h16l-1.5 12h-13zM9 10h6"/>',
    'text.pin':'<path d="m8 3 8 0-1 7 3 4H6l3-4zM12 14v7"/>',
    'image.pin':'<path d="m8 3 8 0-1 7 3 4H6l3-4zM12 14v7"/>',
    'text.unwrap':'<path d="M4 7h16M4 12h16M4 17h10"/>',
    'text.clean':'<path d="M5 19 19 5M9 5h10v10"/>',
    'text.open-url':'<path d="M14 4h6v6M10 14 20 4M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'
  };
  const DEFAULT_ICON='<path d="M5 12h14m-5-5 5 5-5 5"/>';
  function actionIconSvg(id){
    const path=ACTION_ICONS[id]||DEFAULT_ICON;
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
  }
  function mount(host,{getItem,onResult=()=>{},onError=()=>{},reveal=()=>{},label='下一步',menuOnly=false,triggerId='',triggerTitle='',triggerLabel='',onStatus=null,includeAction=()=>true,numbersWhenClosed=true}={}){
    const api=(window.suira||window.pinApi)?.actions;if(!host||!api)return {refresh(){},destroy(){}};
    host.classList.add('action-strip');
    if (menuOnly) host.classList.add('action-strip-menu-only');
    host.setAttribute('aria-label',label);
    const title=document.createElement('span');title.className='action-strip-label';title.textContent=label;
    const direct=document.createElement('div');direct.className='action-strip-direct';
    const more=document.createElement('details');more.className='action-strip-more';
    const summary=document.createElement('summary');
    if (triggerId) summary.id=triggerId;
    summary.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>';
    summary.title=triggerTitle||(menuOnly?'更多操作（Ctrl+K）':'全部动作 · Ctrl+K');
    summary.setAttribute('aria-label',triggerLabel||(menuOnly?'更多操作':'全部下一步动作'));
    const menu=document.createElement('div');menu.className='action-strip-menu';menu.setAttribute('role','group');menu.setAttribute('aria-label','全部下一步动作');
    const search=document.createElement('input');search.type='search';search.placeholder='搜索下一步动作';search.setAttribute('aria-label','搜索下一步动作');
    const field=document.createElement('label');field.className='action-strip-menu-search';
    field.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4 4"/></svg>';
    field.append(search);
    const list=document.createElement('div');list.className='action-strip-menu-list';
    const status=document.createElement('span');status.className='action-strip-status';status.setAttribute('role','status');
    menu.setAttribute('popover','manual');
    menu.append(field,list);
    more.append(summary,menu);
    host.replaceChildren(...(menuOnly ? [more] : [title,direct,more,status]));
    const report = (message, error = false) => {
      status.textContent = message;
      onStatus?.(message, error);
    };
    let actions=[],revision=0,busy=false,returnFocus=null,destroyed=false,openedByShortcut=false;
    function available(node){if(!node?.isConnected||!node.getClientRects().length||node.closest('[hidden],[inert],[aria-hidden="true"]'))return false;const style=getComputedStyle(node);return style.visibility!=='hidden'&&style.visibility!=='collapse';}
    function syncCompact(){
      const compact=menuOnly && !openedByShortcut && actions.length<=5 && !search.value;
      if (compact) menu.dataset.compact='true';
      else delete menu.dataset.compact;
    }
    function close(restore=true){
      openedByShortcut=false;
      if(more.open)more.open=false;
      if(menu.matches(':popover-open'))menu.hidePopover();
      search.value='';
      delete menu.dataset.compact;
      menu.style.maxHeight='';
      const origin=returnFocus;returnFocus=null;
      if(restore&&available(origin))origin.focus({preventScroll:true});
    }
    function positionMenu(){
      const anchor=summary.getBoundingClientRect();
      const spaceBelow=innerHeight-anchor.bottom-10;
      const spaceAbove=anchor.top-10;
      const preferBelow=menuOnly ? (spaceBelow>=140 || spaceBelow>=spaceAbove) : (spaceAbove<180 && spaceBelow>spaceAbove);
      const avail=Math.max(96, preferBelow ? spaceBelow : spaceAbove);
      if (menuOnly) menu.style.maxHeight=Math.min(340, Math.floor(avail))+'px';
      else menu.style.maxHeight='';
      const rect=menu.getBoundingClientRect();
      const left=Math.max(8,Math.min(innerWidth-rect.width-8,anchor.right-rect.width));
      const top=preferBelow ? anchor.bottom+6 : anchor.top-rect.height-6;
      menu.style.left=left+'px';
      menu.style.top=Math.max(8,Math.min(innerHeight-rect.height-8,top))+'px';
    }
    const toggle=()=>{
      if(more.open){
        if(destroyed||document.hidden||!available(summary)){close(false);return;}
        syncCompact();
        if (!menu.matches(':popover-open')) menu.showPopover();
        positionMenu();
      }else close(false);
    };
    more.addEventListener('toggle',toggle);
    summary.addEventListener('click', () => {
      if (!more.open) {
        openedByShortcut=false;
        returnFocus = summary;
      }
    });
    async function run(action){
      if(busy||destroyed)return;busy=true;host.setAttribute('aria-busy','true');report('正在处理…');close();
      try{const item=await getItem();if(!item||(!item.id&&item.kind!=='image'&&!String(item.text||'').trim()))throw Error('没有可处理的内容');const result=await api.run(item.id||item,action.id);if(!result?.ok)throw Error(result?.error||'操作失败');const latest=await getItem();if(result.output&&JSON.stringify([item.id,item.kind,item.text])!==JSON.stringify([latest?.id,latest?.kind,latest?.text])){report('已处理先前选中的内容');return;}report(result.message||'已完成');await onResult(result,action);}
      catch(error){report(error.message||'操作失败',true);onError(status.textContent);}
      finally{busy=false;host.removeAttribute('aria-busy');}
    }
    function button(action,index,{withIcon=true}={}){
      const b=document.createElement('button');
      b.type='button';
      b.dataset.actionId=action.id;
      b.title=(action.hint||action.label)+(index<9?' · '+(index+1):'');
      if(withIcon){
        const icon=document.createElement('span');
        icon.className='action-strip-icon';
        icon.innerHTML=actionIconSvg(action.id);
        b.append(icon);
      }
      const copy=document.createElement('span');
      copy.className='action-strip-text';
      copy.textContent=action.label;
      b.append(copy);
      if(index<9){const k=document.createElement('kbd');k.textContent=String(index+1);b.append(k);}
      b.onclick=()=>run(action);
      return b;
    }
    function render(){
      if (!menuOnly) direct.replaceChildren(...actions.slice(0,3).map((action,i)=>button(action,i,{withIcon:false})));
      const q=search.value.trim().toLowerCase();
      const filtered=actions.map((action,i)=>({action,i})).filter(({action})=>!q||(action.label+' '+(action.hint||'')).toLowerCase().includes(q));
      list.replaceChildren(...filtered.map(({action,i})=>button(action,i,{withIcon:true})));
      more.hidden=actions.length===0 && (!menuOnly || !host.dataset.itemId);
      if (more.open && menu.matches(':popover-open')) { syncCompact(); positionMenu(); }
    }
    async function refresh({ reset = false } = {}){
      const token=++revision;
      if (reset) { close(false); actions = []; render(); }
      try{const item=await getItem();const values=item?await api.list(item.id||item):[];if(token!==revision||destroyed)return;actions=(values||[]).filter(action=>includeAction(action,item));if(item?.kind==='image')actions.sort((a,b)=>(a.id==='ocr.local'?-1:0)-(b.id==='ocr.local'?-1:0));else if(/[A-Za-z]/.test(item?.text||'')&&!/[\u4e00-\u9fff]/.test(item.text))actions.sort((a,b)=>(a.id==='text.translate'?-1:0)-(b.id==='text.translate'?-1:0));render();}catch(error){if(token===revision){actions=[];render();report(error.message,true);}}}
    search.addEventListener('input',render);
    menu.addEventListener('focusout', event => { if (event.relatedTarget && !more.contains(event.relatedTarget)) close(false); });
    function keydown(event){
      if(event.defaultPrevented||event.isComposing||event.altKey)return;
      const dialog=[...document.querySelectorAll('dialog[open]')].at(-1);if(dialog&&!dialog.contains(host))return;
      if(dialog&&event.key==='Escape'&&!more.open){event.preventDefault();event.stopImmediatePropagation();dialog.close();return;}
      const command=(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k';
      if(destroyed||document.hidden||!host.isConnected||(!available(host)&&!command))return;
      if(command){reveal();if(!available(host)||!available(summary))return;event.preventDefault();event.stopImmediatePropagation();if(!more.open)returnFocus=document.activeElement;openedByShortcut=true;delete menu.dataset.compact;more.open=true;if (menuOnly) { toggle(); search.focus(); } else refresh().then(()=>{if(more.open&&!destroyed&&available(summary))search.focus();});return;}
      if(event.key==='Escape'&&more.open){event.preventDefault();event.stopImmediatePropagation();close();return;}
      if(event.ctrlKey||event.metaKey||editing(event.target)||(!numbersWhenClosed&&!more.open))return;
      const index=Number(event.key)-1;if(/^[1-9]$/.test(event.key)&&actions[index]){event.preventDefault();event.stopImmediatePropagation();run(actions[index]);}
    }
    document.addEventListener('keydown',keydown,true);
    const outside=event=>{if(more.open&&!host.contains(event.target))close(false);};document.addEventListener('pointerdown',outside);
    const blur=()=>close(false),visibility=()=>{if(document.hidden)close(false);};
    window.addEventListener('blur',blur);document.addEventListener('visibilitychange',visibility);
    const lifecycle=new MutationObserver(()=>{if((more.open||menu.matches(':popover-open'))&&(!more.open||!available(summary)))close(false);});
    lifecycle.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','inert','aria-hidden','class','style','open']});
    if (!menuOnly) refresh();return {refresh,run:id=>{const action=actions.find(a=>a.id===id);if(action)return run(action);},destroy(){destroyed=true;++revision;close(false);lifecycle.disconnect();more.removeEventListener('toggle',toggle);document.removeEventListener('keydown',keydown,true);document.removeEventListener('pointerdown',outside);window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',visibility);host.replaceChildren();}};
  }
  window.SuiraActionStrip={mount};
})();
