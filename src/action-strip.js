'use strict';
(() => {
  const editing=target=>target?.closest?.('input,textarea,select,[contenteditable="true"]');
  function mount(host,{getItem,onResult=()=>{},onError=()=>{},reveal=()=>{},label='下一步'}={}){
    const api=(window.suira||window.pinApi)?.actions;if(!host||!api)return {refresh(){},destroy(){}};
    host.classList.add('action-strip');host.setAttribute('aria-label',label);
    const title=document.createElement('span');title.className='action-strip-label';title.textContent=label;
    const direct=document.createElement('div');direct.className='action-strip-direct';
    const more=document.createElement('details');more.className='action-strip-more';
    const summary=document.createElement('summary');summary.textContent='…';summary.title='全部动作 · Ctrl+K';summary.setAttribute('aria-label','全部下一步动作');
    const menu=document.createElement('div');menu.className='action-strip-menu';menu.setAttribute('role','group');menu.setAttribute('aria-label','全部下一步动作');
    const search=document.createElement('input');search.type='search';search.placeholder='搜索下一步动作';search.setAttribute('aria-label','搜索下一步动作');
    const list=document.createElement('div'),status=document.createElement('span');status.className='action-strip-status';status.setAttribute('role','status');
    menu.setAttribute('popover','manual');
    menu.append(search,list);more.append(summary,menu);host.replaceChildren(title,direct,more,status);
    let actions=[],revision=0,busy=false,returnFocus=null,destroyed=false;
    function available(node){if(!node?.isConnected||!node.getClientRects().length||node.closest('[hidden],[inert],[aria-hidden="true"]'))return false;const style=getComputedStyle(node);return style.visibility!=='hidden'&&style.visibility!=='collapse';}
    function close(restore=true){if(more.open)more.open=false;if(menu.matches(':popover-open'))menu.hidePopover();search.value='';const origin=returnFocus;returnFocus=null;if(restore&&available(origin))origin.focus({preventScroll:true});}
    const toggle=()=>{if(more.open){if(destroyed||document.hidden||!available(summary)){close(false);return;}menu.showPopover();const anchor=summary.getBoundingClientRect(),rect=menu.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(innerWidth-rect.width-8,anchor.right-rect.width))+'px';menu.style.top=Math.max(8,anchor.top-rect.height-4)+'px';}else close(false);};
    more.addEventListener('toggle',toggle);
    async function run(action){
      if(busy||destroyed)return;busy=true;host.setAttribute('aria-busy','true');status.textContent='正在处理…';close(false);
      try{const item=await getItem();if(!item||(item.kind!=='image'&&!String(item.text||'').trim()))throw Error('没有可处理的内容');const result=await api.run(item.id||item,action.id);if(!result?.ok)throw Error(result?.error||'操作失败');const latest=await getItem();if(result.output&&JSON.stringify([item.id,item.kind,item.text])!==JSON.stringify([latest?.id,latest?.kind,latest?.text])){status.textContent='上一份内容已处理，当前内容保持不变';return;}status.textContent=result.message||'已完成';await onResult(result,action);}
      catch(error){status.textContent=error.message||'操作失败';onError(status.textContent);}
      finally{busy=false;host.removeAttribute('aria-busy');}
    }
    function button(action,index){const b=document.createElement('button');b.type='button';b.dataset.actionId=action.id;b.textContent=action.label;b.title=(action.hint||action.label)+(index<9?' · '+(index+1):'');if(index<9){const k=document.createElement('kbd');k.textContent=String(index+1);b.append(k);}b.onclick=()=>run(action);return b;}
    function render(){direct.replaceChildren(...actions.slice(0,3).map(button));list.replaceChildren(...actions.map((action,i)=>({action,i})).filter(({action})=>(action.label+' '+action.hint).toLowerCase().includes(search.value.toLowerCase())).map(({action,i})=>button(action,i)));more.hidden=actions.length===0;}
    async function refresh(){const token=++revision;try{const item=await getItem();const values=item?await api.list(item.id||item):[];if(token!==revision||destroyed)return;actions=values||[];if(item?.kind==='image')actions.sort((a,b)=>(a.id==='ocr.local'?-1:0)-(b.id==='ocr.local'?-1:0));else if(/[A-Za-z]/.test(item?.text||'')&&!/[\u4e00-\u9fff]/.test(item.text))actions.sort((a,b)=>(a.id==='text.translate'?-1:0)-(b.id==='text.translate'?-1:0));render();}catch(error){if(token===revision){actions=[];render();status.textContent=error.message;}}}
    search.addEventListener('input',render);
    function keydown(event){
      if(event.defaultPrevented||event.isComposing||event.altKey)return;
      const dialog=[...document.querySelectorAll('dialog[open]')].at(-1);if(dialog&&!dialog.contains(host))return;
      if(dialog&&event.key==='Escape'&&!more.open){event.preventDefault();event.stopImmediatePropagation();dialog.close();return;}
      const command=(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k';
      if(destroyed||document.hidden||!host.isConnected||(!available(host)&&!command))return;
      if(command){reveal();if(!available(host)||!available(summary))return;event.preventDefault();event.stopImmediatePropagation();if(!more.open)returnFocus=document.activeElement;more.open=true;refresh().then(()=>{if(more.open&&!destroyed&&available(summary))search.focus();});return;}
      if(event.key==='Escape'&&more.open){event.preventDefault();event.stopImmediatePropagation();close();return;}
      if(event.ctrlKey||event.metaKey||editing(event.target))return;
      const index=Number(event.key)-1;if(/^[1-9]$/.test(event.key)&&actions[index]){event.preventDefault();event.stopImmediatePropagation();run(actions[index]);}
    }
    document.addEventListener('keydown',keydown,true);
    const outside=event=>{if(more.open&&!host.contains(event.target))close(false);};document.addEventListener('pointerdown',outside);
    const blur=()=>close(false),visibility=()=>{if(document.hidden)close(false);};
    window.addEventListener('blur',blur);document.addEventListener('visibilitychange',visibility);
    const lifecycle=new MutationObserver(()=>{if((more.open||menu.matches(':popover-open'))&&(!more.open||!available(summary)))close(false);});
    lifecycle.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','inert','aria-hidden','class','style','open']});
    refresh();return {refresh,run:id=>{const action=actions.find(a=>a.id===id);if(action)return run(action);},destroy(){destroyed=true;++revision;close(false);lifecycle.disconnect();more.removeEventListener('toggle',toggle);document.removeEventListener('keydown',keydown,true);document.removeEventListener('pointerdown',outside);window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',visibility);host.replaceChildren();}};
  }
  window.SuiraActionStrip={mount};
})();
