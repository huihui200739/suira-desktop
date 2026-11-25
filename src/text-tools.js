'use strict';
(() => {
  const $ = id => document.getElementById(id), api = window.suira;
  let mode='convert',revision=0,modeRevision=0,busy=false,currentResult=false,providerReady=false;
  let autoTimer,composing=false,preferredTarget='zh',targetChosen=false,selectionPaste=false;
  const history=[];
  let cleared=null;
  const message=(text,error=false,copied=false)=>{$('tool-status').textContent=text;$('tool-status').dataset.error=String(error);if(!error&&copied)window.SuiraUI?.copyFeedback($('tool-status'));};
  function invalidate(){clearTimeout(autoTimer);++revision;busy=false;currentResult=false;}
  function counts(){
    $('source-count').textContent=$('tool-source').value.length.toLocaleString()+' 字';$('result-count').textContent=$('tool-result').value.length.toLocaleString()+' 字';
    const unavailable=!currentResult||!$('tool-result').value.trim()||busy;
    $('tool-copy').disabled=$('tool-paste').disabled=unavailable;$('tool-next').hidden=unavailable;$('tool-back').hidden=!history.length;
    $('tool-run').disabled=busy||!$('tool-source').value.trim()||(mode==='translate'&&!providerReady);
    $('tool-clear').hidden=!$('tool-source').value&&!$('tool-result').value;
    $('tool-restore').hidden=!cleared;
  }
  async function run(){
    clearTimeout(autoTimer);const text=$('tool-source').value;if(!text.trim()||busy||(mode==='translate'&&!providerReady))return;
    const token=++revision;busy=true;currentResult=false;message(mode==='translate'?'正在翻译…':'正在整理…');counts();
    try{
      const result=mode==='translate'?await api.translate.run({text,source:$('source-language').value,target:$('target-language').value}):await api.textTools.transform(text,$('operation').value);
      if(token!==revision)return;if(!result?.ok)throw Error(result?.error||'处理失败');
      $('tool-result').value=result.text||'';currentResult=true;message(selectionPaste?'结果已就绪 · Enter 替换原选区，Shift+Enter 换行':mode==='translate'?'已翻译':'已整理，原文保持不变');
    }catch(error){if(token===revision)message(error.message,true);}finally{if(token===revision){busy=false;counts();}}
  }
  function schedule(){clearTimeout(autoTimer);if(mode==='translate'&&providerReady&&!composing&&$('tool-source').value.trim())autoTimer=setTimeout(run,500);}
  async function setMode(next,process=true){
    cleared=null;
    invalidate();mode=next==='translate'?'translate':'convert';const token=revision,generation=++modeRevision;
    window.history.replaceState(null,'','text-tools.html?mode='+mode);document.title='随序 · 文字工具';$('tool-title').textContent='文字工具';
    $('tool-mark').innerHTML=window.SuiraToolArt?.render(mode==='translate'?'translate':'text-clean')||'';
    document.querySelectorAll('[data-tool-mode]').forEach(button=>{const active=button.dataset.toolMode===mode;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});
    $('tool-content').setAttribute('aria-labelledby','tab-'+mode);$('language-capsule').hidden=mode!=='translate';$('tool-configure').hidden=mode!=='translate';$('operation-label').hidden=mode!=='convert';
    $('tool-run').textContent=mode==='translate'?'翻译':'转换';$('result-label').textContent=mode==='translate'?'译文':'转换结果';$('tool-hint').textContent=mode==='translate'?'停止输入后自动翻译 · Ctrl + Enter 立即翻译':'Ctrl + Enter 转换 · 可以继续处理结果';
    $('tool-result').value='';counts();
    if(mode==='translate'){
      providerReady=false;counts();
      try{const status=await api.translate.status();if(generation!==modeRevision)return;providerReady=Boolean(status.configured);preferredTarget=status.target||'zh';const selected=$('target-language').value;
        const targets=status.targets?.length?status.targets:[{code:'zh',label:'中文'},{code:'en',label:'英语'}];$('target-language').replaceChildren(...targets.map(entry=>new Option(entry.label,entry.code)));
        $('target-language').value=targetChosen&&targets.some(entry=>entry.code===selected)?selected:SuiraTranslateLanguage.defaultTarget($('tool-source').value,preferredTarget);
        message(providerReady?'输入文字，停止输入后自动翻译':'还没有设置翻译服务');
      }catch(error){if(generation!==modeRevision)return;message(error.message,true);}
    }else message('选择转换方式，比较原文与结果');
    counts();if(process&&generation===modeRevision){if(token===revision)await run();else schedule();}
  }
  async function load(payload){
    selectionPaste=payload.selectionPaste===true;
    if(payload.switchOnly){await setMode(payload.mode);return;}
    invalidate();history.length=0;targetChosen=false;$('tool-source').value=payload.text||'';$('operation').value=payload.operation||'compact';const job=setMode(payload.mode);$('tool-source').focus();await job;
  }
  $('tool-run').onclick=run;$('operation').onchange=()=>{invalidate();run();};
  for(const id of ['source-language','target-language'])$(id).onchange=()=>{if(id==='target-language')targetChosen=true;invalidate();run();};
  $('tool-source').oninput=()=>{cleared=null;invalidate();if(!targetChosen&&mode==='translate')$('target-language').value=SuiraTranslateLanguage.defaultTarget($('tool-source').value,preferredTarget);message(mode==='translate'?(providerReady?'输入结束后自动翻译…':'还没有设置翻译服务'):'');counts();schedule();};
  $('tool-source').addEventListener('compositionstart',()=>{composing=true;invalidate();counts();});$('tool-source').addEventListener('compositionend',()=>{composing=false;$('tool-source').oninput();});
  $('tool-result').oninput=()=>{cleared=null;currentResult=true;counts();};
  const sourceMenu=$('tool-image').closest('details');
  $('tool-clear').onclick=()=>{
    cleared={source:$('tool-source').value,result:$('tool-result').value,currentResult};
    invalidate();sourceMenu.open=false;$('tool-source').value=$('tool-result').value='';message('已清空');counts();$('tool-source').focus();
  };
  $('tool-restore').onclick=()=>{
    if(!cleared)return;
    const snapshot=cleared;cleared=null;invalidate();
    $('tool-source').value=snapshot.source;$('tool-result').value=snapshot.result;currentResult=snapshot.currentResult;
    message('已恢复原文和结果');counts();$('tool-source').focus();
  };
  $('tool-clipboard').onclick=async()=>{
    const token=revision;
    try{const clip=await api.workspace.clipboard();if(token!==revision)return;if(!clip?.ok)throw Error(clip?.error||'无法读取剪贴板');if(!clip.text?.trim()){message('剪贴板里没有文字');return;}$('tool-source').value=clip.text;$('tool-source').oninput();if(mode==='convert')run();}
    catch(error){if(token===revision)message(error.message,true);}
  };
  $('tool-capture').onclick=async()=>{invalidate();counts();try{const result=await api.textTools.capture({mode,text:$('tool-source').value,operation:$('operation').value});if(!result?.ok)throw Error(result?.error||'无法开始截图');}catch(error){message(error.message,true);}};
  $('tool-image').onclick=async()=>{
    $('tool-image').closest('details').open=false;invalidate();const token=revision;busy=true;message('正在从最近图片提取文字…');counts();
    try{const items=await api.content.list({limit:1,kinds:['image']});if(!items?.length)throw Error('还没有图片，先截图或将图片加入内容库');const result=await api.ocr.recognizeItem(items[0].id);if(token!==revision)return;if(!result?.ok)throw Error(result?.error||'提取文字失败');$('tool-source').value=result.output?.text||'';busy=false;await run();}catch(error){if(token===revision){busy=false;message(error.message,true);counts();}}
  };
  $('swap-languages').onclick=()=>{if(!currentResult)return;const previous=$('tool-source').value,source=$('source-language').value,target=$('target-language').value;$('tool-source').value=$('tool-result').value;$('source-language').value=target;$('target-language').value=source==='auto'?(SuiraTranslateLanguage.detectLang(previous)==='zh'?'zh':'en'):source;targetChosen=true;invalidate();run();};
  for(const button of document.querySelectorAll('[data-tool-mode]')){
    button.onclick=()=>{if(button.dataset.toolMode!==mode)setMode(button.dataset.toolMode);};
    button.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?'translate':event.key==='End'?'convert':mode==='translate'?'convert':'translate';$('tab-'+next).focus();setMode(next);};
  }
  for(const button of document.querySelectorAll('[data-next-mode]'))button.onclick=async()=>{
    if(!currentResult||!$('tool-result').value.trim())return;history.push({mode,source:$('tool-source').value,result:$('tool-result').value,operation:$('operation').value,sourceLang:$('source-language').value,targetLang:$('target-language').value});
    $('tool-next').open=false;$('tool-source').value=$('tool-result').value;await setMode(button.dataset.nextMode);
  };
  $('tool-back').onclick=async()=>{const previous=history.pop();if(!previous)return;$('tool-source').value=previous.source;$('operation').value=previous.operation;const job=setMode(previous.mode,false),token=revision;await job;if(token!==revision)return;$('source-language').value=previous.sourceLang;$('target-language').value=previous.targetLang;$('tool-result').value=previous.result;currentResult=true;counts();message('已回到上一步');};
  async function copy(paste=false){const text=$('tool-result').value;if(!currentResult||!text.trim())return;try{const saved=await api.content.addText({text,title:mode==='translate'?'译文':'转换后的文字',source:mode==='translate'?'translate':'derived'});if(!saved?.ok)throw Error(saved?.error||'保存结果失败');const result=paste?await api.returnTo.commit({itemId:saved.item.id,intent:'return-and-paste'}):await api.actions.run(saved.item.id,'output.copy');if(!result?.ok)throw Error(result?.error||'复制失败');message(result.message||(paste?'已粘回原处':'结果已复制'),false,!paste);}catch(error){message(error.message,true);}}
  $('tool-copy').onclick=()=>copy();$('tool-paste').onclick=()=>copy(true);$('tool-configure').onclick=()=>api.textTools.configure();$('tool-min').onclick=()=>api.window.minimize();$('tool-max').onclick=()=>api.window.maximize();$('tool-close').onclick=()=>{clearTimeout(autoTimer);api.window.close();};
  document.addEventListener('keydown',event=>{
    if(event.isComposing)return;
    if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();run();}
    else if(selectionPaste&&!event.target.closest('button,select,[role=combobox]')&&event.key==='Enter'&&!event.shiftKey&&!event.altKey&&currentResult&&!busy){event.preventDefault();copy(true);}
    else if(event.key==='Escape'){
      // 先收起「更多原文操作 / 接着处理」等浮层，再关窗口；
      // 否则菜单开着按 Esc 会直接销毁窗口，未保存的原文和结果一起丢掉。
      const layer=document.querySelector('details[open], dialog[open], [popover]:popover-open');
      if(layer){event.preventDefault();if(layer.tagName==='DETAILS')layer.open=false;else if(typeof layer.hidePopover==='function')layer.hidePopover();else if(typeof layer.close==='function')layer.close();return;}
      api.window.close();
    }
  });window.addEventListener('pagehide',()=>clearTimeout(autoTimer));
  api.textTools.onInput(payload=>load(payload).catch(error=>message(error.message,true)));api.textTools.initial().then(load).catch(error=>message(error.message,true));
})();
