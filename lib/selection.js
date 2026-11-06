'use strict';
const {SENSITIVE_PROCESS_NAMES}=require('./clipboard-guard');
const DEFAULT_SELECTION_EXCLUSIONS=[...new Set(['WindowsTerminal','cmd','powershell','pwsh','conhost','wezterm','alacritty','mintty',...SENSITIVE_PROCESS_NAMES].map(name=>name.toLowerCase()))];
function processName(value){return String(value||'').trim().split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/,'');}
function cleanExclusions(values){return [...new Set((Array.isArray(values)?values:[]).slice(0,100).map(processName).filter(value=>value&&value.length<=120))];}
function shouldSkipSelection(target,settings={},ownerPid=process.pid){return !settings.selectionEnabled||!target?.hwnd||(!target.processName||target.elevated)||Number(target.pid)===ownerPid||cleanExclusions(settings.selectionExcludedApps??DEFAULT_SELECTION_EXCLUSIONS).includes(processName(target.processName));}
async function materialize(items,ClipboardItem,maxBytes=32*1024*1024){
  let bytes=0;const saved=[];
  for(const item of items){const values={};for(const type of item.types){const value=await item.getType(type);if(type==='electron application/bookmark'){values[type]={title:String(value.title||''),url:String(value.url||'')};bytes+=Buffer.byteLength(JSON.stringify(values[type]));}else{const data=typeof value==='string'?Buffer.from(value):Buffer.from(await value.arrayBuffer());bytes+=data.length;values[type]=new Blob([data],{type});}if(bytes>maxBytes)throw Error('clipboard-too-large');}saved.push(new ClipboardItem(values));}
  return saved;
}
/** One bounded, serial transaction. Nothing from temporary Ctrl+C enters history. */
function createSelectionReader({clipboard,ClipboardItem,ledger,sequence,sendCopy,isCurrent,pause=()=>()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>Date.now(),timeout=250}){
  let busy=false;
  return {get busy(){return busy;},async read(target,settings){
    if(busy||shouldSkipSelection(target,settings))return null;busy=true;
    let saved,originalText='',candidate=null,changed=false,observed,release=()=>{},resume=()=>{};
    async function collect(){
    try{
      resume=pause();release=ledger.beginTransient();
      const before=sequence();if(before===null||!await isCurrent(target))return null;
      saved=await materialize(await clipboard.read(),ClipboardItem);originalText=String(await clipboard.readText()||'');
      if(sequence()!==before||!await isCurrent(target))return null;
      const sent=await sendCopy(target);if(!sent?.ok){observed=sequence();changed=observed!==before;return null;}
      const start=now();let text='';
      while(now()-start<=timeout){
        observed=sequence();if(observed!==before){changed=true;const value=await clipboard.readText();if(!await isCurrent(target))return null;if(sequence()===observed){text=String(value||'').slice(0,200000);if(text.trim()){ledger.record(text);break;}}}
        if(now()-start>=timeout)break;await sleep(Math.min(10,timeout-(now()-start)));
      }
      return text.trim()?{kind:'text',text,source:{type:'selection',appName:target.processName},createdAt:now()}:null;
    }catch{return null;}
    }
    try{candidate=await collect();}
    finally{
      try{
        if(changed&&saved&&sequence()===observed){
          for(let attempt=0;attempt<3;attempt++)try{if(sequence()!==observed){candidate=null;break;}await clipboard.write(saved);ledger.record(originalText);break;}catch{if(attempt===2)throw Error('restore-failed');await sleep(15);}
        }
        else if(changed)candidate=null;
      }catch{candidate=null;}
      finally{release();resume();busy=false;}
    }
    return candidate;
  }};
}
module.exports={DEFAULT_SELECTION_EXCLUSIONS,cleanExclusions,shouldSkipSelection,materialize,createSelectionReader};
