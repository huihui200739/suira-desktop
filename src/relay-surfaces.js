'use strict';
(() => {
  const strip=window.SuiraActionStrip,api=window.suira||window.pinApi;if(!strip||!api)return;
  const textItem=(text,parentIds=[])=>({kind:'text',text:String(text||''),parentIds});
  const mounts=[];let dateRefresh=()=>{};
  function showResult(item){
    let dialog=document.getElementById('relay-result');if(dialog)dialog.close();
    dialog=document.createElement('dialog');dialog.id='relay-result';dialog.className='relay-result';
    const head=document.createElement('header'),title=document.createElement('b'),close=document.createElement('button'),area=document.createElement('textarea'),host=document.createElement('div');
    title.textContent=item.title||'处理结果';close.type='button';close.textContent='关闭';close.onclick=()=>dialog.close();area.value=item.text||'';area.setAttribute('aria-label','处理结果');head.append(title,close);dialog.append(head,area,host);document.body.append(dialog);
    const child=strip.mount(host,{getItem:()=>textItem(area.value,[item.id]),onResult:result=>{if(result.output)showResult(result.output);}});const owned=dialog;dialog.addEventListener('close',()=>{child.destroy();owned.remove();},{once:true});dialog.addEventListener('keydown',event=>{if(event.key==='Escape'&&!dialog.querySelector('details')?.open){event.preventDefault();event.stopPropagation();dialog.close();}});area.addEventListener('input',()=>child.refresh());if (document.getElementById('bar-track')) dialog.showModal();
    else dialog.show();
  }
  function mount(host,getItem,options={}){const instance=strip.mount(host,{getItem,onResult:result=>{if(result.output)showResult(result.output);},...options});mounts.push(instance);return instance;}
  if(document.getElementById('ocr-result')){
    const result=document.getElementById('ocr-result'),host=document.createElement('div');host.id='ocr-action-strip';result.append(host);
    const getItem=()=>({...textItem(document.getElementById('ocr-translation-text').value.trim()?document.getElementById('ocr-translation-text').value:document.getElementById('ocr-result-text').value),qrUrl:result.dataset.qrUrl||''});
    mount(host,getItem,{onResult:result=>{if(result.output){const area=document.getElementById('ocr-translation-text');area.value=result.output.text;area.dispatchEvent(new Event('input'));}}});
  }
  if(document.getElementById('tool-result')){
    const host=document.createElement('div');host.id='tool-action-strip';document.querySelector('.text-tool-foot').before(host);
    mount(host,()=>textItem(document.getElementById('tool-result').value),{onResult:result=>{if(result.output){const area=document.getElementById('tool-result');area.value=result.output.text;area.dispatchEvent(new Event('input'));}}});
  }
  const clipboardHost = document.getElementById('bar-action-strip');
  if (clipboardHost && api.actions) {
    const instance = strip.mount(clipboardHost, {
      getItem: () => window.ClipboardBarSelection?.item(),
      onResult: result => { if (result.output) showResult(result.output); },
      onStatus: (message, error) => window.ClipboardBarSelection?.notice(message, error),
      includeAction: action => action.id !== 'image.pin',
      menuOnly: true
    });
    function updateClipboardActions() {
      clipboardHost.hidden = !clipboardHost.dataset.itemId;
      instance.refresh({ reset: true });
    }
    clipboardHost.addEventListener('bar-selection-change', updateClipboardActions);
    updateClipboardActions();
    window.addEventListener('beforeunload', () => instance.destroy(), { once: true });
  }
  if(document.getElementById('pin-menu')){
    const menu=document.getElementById('pin-menu'),host=document.createElement('div');host.id='pin-action-strip';menu.prepend(host);
    let content=null;api.getData().then(result=>{const data=result.data;content=data.kind==='text'?textItem(data.text,data.itemId?[data.itemId]:[]):{id:data.itemId,kind:'image'};mount(host,()=>content,{reveal:()=>window.PinUI?.revealMenu()});});
  }
  if(document.getElementById('note-body')){
    const menu=document.createElement('div');menu.className='note-relay-menu';menu.id='note-relay-menu';menu.hidden=true;
    const host=document.createElement('div'),button=document.createElement('button');button.type='button';button.id='note-more';button.textContent='…';button.title='下一步 · Ctrl+K';button.setAttribute('aria-label','速记下一步');button.setAttribute('aria-expanded','false');
    document.querySelector('.note-tools').prepend(button);menu.append(host);document.getElementById('note').append(menu);
    button.onclick=()=>{menu.hidden=!menu.hidden;button.setAttribute('aria-expanded',String(!menu.hidden));};
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!menu.hidden&&!menu.querySelector('details')?.open){event.preventDefault();event.stopImmediatePropagation();menu.hidden=true;button.setAttribute('aria-expanded','false');button.focus();}},true);
    const instance=mount(host,()=>textItem(window.NoteUI.text()),{reveal:()=>{menu.hidden=false;}});
    document.addEventListener('pointerdown',event=>{if(!menu.contains(event.target)&&!button.contains(event.target)){menu.hidden=true;button.setAttribute('aria-expanded','false');}});
    const hint=document.createElement('button');hint.type='button';hint.id='note-date-hint';hint.className='note-date-hint';hint.textContent='加到日历？';hint.hidden=true;document.querySelector('.note-status').prepend(hint);hint.onclick=()=>instance.run('text.to-calendar');
    let timer,revision=0;function parse(){const token=++revision;clearTimeout(timer);timer=setTimeout(async()=>{try{const draft=await api.dates?.parse(window.NoteUI.text());if(token===revision&&hint.hidden!==!draft)hint.hidden=!draft;}catch{if(token===revision&&!hint.hidden)hint.hidden=true;}},200);}
    dateRefresh=parse;document.getElementById('note-body').addEventListener('note-input',parse);api.notes?.onChanged?.(parse);api.notes?.onOpened?.(parse);parse();
    api.relay?.onRequest?.(async request=>{if(request.kind!=='notes.flush')return;try{await window.NoteUI.flush();await api.relay.reply({token:request.token,ok:true});}catch(error){await api.relay.reply({token:request.token,ok:false,error:error.message});}});
  }
  window.SuiraRelay={showResult};
  if (!mounts.length) return;
  let refreshTimer;const refresh=()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{mounts.forEach(instance=>instance.refresh());dateRefresh();},100);};
  document.addEventListener('input',refresh);
  new MutationObserver(records=>{if(records.some(record=>!record.target.closest?.('.action-strip')&&!record.target.parentElement?.closest('.action-strip')))refresh();}).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','aria-selected']});
  window.addEventListener('beforeunload',()=>mounts.forEach(instance=>instance.destroy()));
})();
