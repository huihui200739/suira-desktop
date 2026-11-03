'use strict';
(()=>{
 const $=id=>document.getElementById(id),api=window.suira;let mode='convert',revision=0,busy=false,currentResult=false,providerReady=false;
 const message=(text,error=false)=>{$('tool-status').textContent=text;$('tool-status').dataset.error=String(error);};
 const counts=()=>{$('source-count').textContent=$('tool-source').value.length.toLocaleString()+' 字';$('result-count').textContent=$('tool-result').value.length.toLocaleString()+' 字';$('tool-copy').disabled=$('tool-paste').disabled=!currentResult||!$('tool-result').value.trim()||busy;$('tool-run').disabled=busy||!$('tool-source').value.trim()||(mode==='translate'&&!providerReady);};
 async function run(){
  const text=$('tool-source').value;if(!text.trim()||busy)return;
  const token=++revision;busy=true;message(mode==='translate'?'正在翻译…':'正在整理…');counts();
  try{const result=mode==='translate'?await api.translate.run({text,source:$('source-language').value,target:$('target-language').value}):await api.textTools.transform(text,$('operation').value);
   if(token!==revision)return;if(!result?.ok)throw Error(result?.error||'处理失败');$('tool-result').value=result.text||'';currentResult=true;message(mode==='translate'?'翻译完成':'已整理，原文保持不变');
  }catch(error){if(token===revision){currentResult=false;message(error.message,true);}}
  finally{if(token===revision){busy=false;counts();}}
 }
 async function load(payload){
  ++revision;busy=false;currentResult=false;mode=payload.mode==='translate'?'translate':'convert';$('tool-source').value=payload.text||'';$('tool-result').value='';
  $('tool-title').textContent=mode==='translate'?'翻译':'文本转换';document.title='随序 · '+$('tool-title').textContent;$('tool-mark').innerHTML=window.SuiraToolArt?.render(mode==='translate'?'translate':'text-clean')||'';
  for(const id of ['source-language-label','swap-languages','target-language-label','tool-configure'])$(id).hidden=mode!=='translate';$('operation-label').hidden=mode!=='convert';$('tool-run').textContent=mode==='translate'?'翻译':'转换';$('result-label').textContent=mode==='translate'?'译文':'转换结果';
  if(mode==='translate'){
   try{const status=await api.translate.status();providerReady=Boolean(status.configured);const targets=status.targets?.length?status.targets:[{code:'zh',label:'中文'},{code:'en',label:'英语'}];$('target-language').replaceChildren(...targets.map(entry=>{const option=document.createElement('option');option.value=entry.code;option.textContent=entry.label;return option;}));$('target-language').value=status.target||'zh';if($('target-language').value==='zh'&&/[\u3400-\u9fff]/.test(payload.text||''))$('target-language').value='en';message(providerReady?'输入文字，按 Ctrl + Enter 翻译':'先在翻译服务设置中选择引擎并配置服务');}catch(error){providerReady=false;message(error.message,true);}
  }else{$('operation').value=payload.operation||'compact';message('选择转换方式，比较原文与结果');await run();}
  counts();$('tool-source').focus();if(mode==='translate'&&providerReady&&$('tool-source').value.trim())run();
 }
 $('tool-run').onclick=run;$('operation').onchange=run;$('target-language').onchange=()=>{if($('tool-source').value.trim())run();};
 $('tool-source').oninput=()=>{++revision;busy=false;currentResult=false;message(mode==='translate'?'原文已修改，按 Ctrl + Enter 重新翻译':'原文已修改，点击转换查看结果');counts();};
 $('tool-result').oninput=()=>{currentResult=true;counts();};
 $('tool-clear').onclick=()=>{++revision;busy=false;$('tool-source').value='';$('tool-result').value='';currentResult=false;message('');counts();$('tool-source').focus();};
 $('tool-clipboard').onclick=async()=>{const clip=await api.workspace.clipboard();$('tool-source').value=clip.text||'';$('tool-source').oninput();if(mode==='convert')run();};
 $('tool-image').onclick=async()=>{const token=++revision;busy=true;currentResult=false;message('正在从最近图片提取文字…');counts();try{const items=await api.content.list({limit:1,kinds:['image']});if(!items?.length)throw Error('还没有图片，先截图或将图片加入内容库');const result=await api.ocr.recognizeItem(items[0].id);if(token!==revision)return;if(!result?.ok)throw Error(result?.error||'提取文字失败');$('tool-source').value=result.output?.text||'';busy=false;counts();await run();}catch(error){if(token===revision){busy=false;message(error.message,true);counts();}}};
 $('swap-languages').onclick=()=>{if(!currentResult)return;const previous=$('tool-source').value,source=$('source-language').value,target=$('target-language').value;$('tool-source').value=$('tool-result').value;$('tool-result').value=previous;$('source-language').value=target;$('target-language').value=source==='auto'?(/[\u3400-\u9fff]/.test(previous)?'zh':'en'):source;currentResult=false;counts();run();};
 async function copy(paste=false){const text=$('tool-result').value;if(!currentResult||!text.trim())return;try{const saved=await api.content.addText({text,title:mode==='translate'?'译文':'转换后的文字',source:mode==='translate'?'translate':'derived'});if(!saved?.ok)throw Error(saved?.error||'保存结果失败');const result=paste?await api.returnTo.commit({itemId:saved.item.id,intent:'return-and-paste'}):await api.actions.run(saved.item.id,'output.copy');if(!result?.ok)throw Error(result?.error||'复制失败');message(result.message||(paste?'已粘回原处':'结果已复制'));}catch(error){message(error.message,true);}}
 $('tool-copy').onclick=()=>copy();$('tool-paste').onclick=()=>copy(true);$('tool-configure').onclick=()=>api.textTools.configure();$('tool-min').onclick=()=>api.window.minimize();$('tool-max').onclick=()=>api.window.maximize();$('tool-close').onclick=()=>api.window.close();
 document.addEventListener('keydown',event=>{if(event.isComposing)return;if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();run();}else if(event.key==='Escape')api.window.close();});
 api.textTools.onInput(load);api.textTools.initial().then(load).catch(error=>message(error.message,true));
})();
