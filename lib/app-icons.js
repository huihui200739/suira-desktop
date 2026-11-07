'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {execFile}=require('node:child_process');

function localPath(value, shortcut, env=process.env) {
  let text=String(value||'').trim().replace(/^"(.*)"$/,'$1');
  text=text.replace(/%([^%]+)%/g,(all,name)=>Object.entries(env).find(([key])=>key.toLowerCase()===name.toLowerCase())?.[1]||all);
  if (!text || /^(?:https?|steam|shell|ms-[\w-]+):/i.test(text)) return '';
  return path.win32.isAbsolute(text)?path.win32.normalize(text):path.win32.resolve(path.win32.dirname(shortcut),text);
}

async function iconSources(shortcut,{readShortcutLink,readFile=fs.readFile,env=process.env}) {
  const ext=path.win32.extname(shortcut).toLowerCase(),found=[];
  const add=(value,index=0)=>{const filePath=localPath(value,shortcut,env);if(filePath&&!found.some(x=>x.filePath===filePath&&x.index===index))found.push({filePath,index:Number(index)||0});};
  if(ext==='.lnk') {
    try {const link=readShortcutLink(shortcut);add(link.icon,link.iconIndex);add(link.target);} catch { }
  } else if(ext==='.url') {
    try {
      const data=await readFile(shortcut), text=data[0]===255&&data[1]===254?data.subarray(2).toString('utf16le'):data.toString('utf8');
      const section=/\[InternetShortcut\]([\s\S]*?)(?:\n\s*\[|$)/i.exec(text)?.[1]||'';
      const icon=/^\s*IconFile\s*=\s*(.+)$/im.exec(section)?.[1];
      const index=/^\s*IconIndex\s*=\s*(-?\d+)/im.exec(section)?.[1];add(icon,index);
    } catch { }
  } else add(shortcut);
  return found;
}

function extractResourceBatch(executable,sources) {
  if(!executable||!sources.length)return Promise.resolve([]);
  return new Promise(resolve=>{
    const child=execFile(executable,[],{windowsHide:true,timeout:8000,maxBuffer:8*1024*1024},(error,stdout)=>{
      resolve(error?[]:stdout.replace(/\r/g,'').split('\n').slice(0,sources.length));
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(sources.map(s=>Buffer.from(s.filePath,'utf8').toString('base64')+'\t'+s.index).join('\n')+'\n');
  });
}

function createAppIconLoader({readShortcutLink,getFileIcon,loadImage,extractResources,readFile,env,diskCache}) {
  const cache=new Map(),pending=new Map();
  // 图标 data URL 单条可达几十 KB，按 LRU 限住常驻内存；
  // 应用索引最多 2000 条，512 条足够覆盖常用应用。
  const CACHE_LIMIT=512;
  const remember=(key,data)=>{
    if(cache.has(key))cache.delete(key);
    cache.set(key,data);
    while(cache.size>CACHE_LIMIT)cache.delete(cache.keys().next().value);
  };
  async function load(paths) {
    if(diskCache)await Promise.all(paths.filter(p=>!cache.has(p)).map(async p=>{const data=await diskCache.get(p);if(data)remember(p,data);}));
    const rows=await Promise.all(paths.filter(p=>!cache.has(p)).map(async filePath=>({filePath,sources:await iconSources(filePath,{readShortcutLink,readFile,env})})));
    const resources=[],resourceMap=new Map();
    for(const row of rows)for(const source of row.sources) {
      if(/\.(?:exe|dll|icl|ico)$/i.test(source.filePath)) {
        const key=source.filePath.toLowerCase()+'|'+source.index;
        if(!resourceMap.has(key)){resourceMap.set(key,resources.length);resources.push(source);}
      }
    }
    let extracted=[];try{if(resources.length)extracted=await extractResources(resources);}catch{}
    await Promise.all(rows.map(async row=>{
      for(const source of row.sources) {
        let data='';
        try {
          if(/\.ico$/i.test(source.filePath))data=extracted[resourceMap.get(source.filePath.toLowerCase()+'|'+source.index)]||await loadImage(source.filePath);
          else if(/\.(?:png|bmp|jpg|jpeg)$/i.test(source.filePath))data=await loadImage(source.filePath);
          else data=extracted[resourceMap.get(source.filePath.toLowerCase()+'|'+source.index)]||'';
          // 资源提取不可用时仍可读目标程序；不再把快捷方式自身的通用图标当成应用图标。
          if(!data&&!/\.dll$/i.test(source.filePath))data=await getFileIcon(source.filePath);
        }catch{}
        if(data){remember(row.filePath,data);diskCache?.set(row.filePath,data).catch(()=>{});break;}
      }
    }));
    return Object.fromEntries(paths.map(p=>[p,cache.get(p)||'']));
  }
  return {getMany(filePaths){
    const paths=[...new Set(filePaths.filter(p=>typeof p==='string'&&p).slice(0,64))];
    const fresh=paths.filter(p=>!cache.has(p)&&!pending.has(p));
    if(fresh.length){const job=load(fresh).finally(()=>fresh.forEach(p=>pending.delete(p)));for(const p of fresh)pending.set(p,job);}
    return Promise.all(paths.map(p=>pending.get(p))).then(()=>Object.fromEntries(paths.map(p=>[p,cache.get(p)||''])));
  }};
}
// Resolve recorded process names against installed shortcuts, never as arbitrary
// filesystem paths supplied by the renderer. Reuse the existing icon loader.
function createSourceIconResolver({listApps,readShortcutLink,loadIcons}) {
  let index,building,loadedAt=0;
  const key=value=>String(value||'').normalize('NFKC').trim().toLocaleLowerCase().replace(/\.exe$/,'');
  async function ensure(){
    if(index&&Date.now()-loadedAt<300000)return index;
    if(building)return building;
    building=(async()=>{
      const result=new Map();
      for(const entry of await listApps()){
        if(!entry?.filePath)continue;
        const aliases=[entry.name,path.win32.basename(entry.filePath,path.win32.extname(entry.filePath))];
        if(/\.lnk$/i.test(entry.filePath))try{const target=readShortcutLink(entry.filePath).target;aliases.push(path.win32.basename(target,path.win32.extname(target)));}catch{}
        for(const alias of aliases){const name=key(alias);if(name&&!result.has(name))result.set(name,entry.filePath);}
      }
      index=result;loadedAt=Date.now();return result;
    })().finally(()=>{building=null;});
    return building;
  }
  return {async getMany(names){
    const requested=[...new Set((Array.isArray(names)?names:[]).filter(name=>typeof name==='string'&&name.length<=128&&!/[\\/:\0]/.test(name)).slice(0,64))];
    if(!requested.length)return {};
    const entries=await ensure(),paths=[...new Set(requested.map(name=>entries.get(key(name))).filter(Boolean))];
    const icons=paths.length?await loadIcons(paths):{};
    return Object.fromEntries(requested.map(name=>[name,icons[entries.get(key(name))]||'']));
  }};
}
module.exports={localPath,iconSources,extractResourceBatch,createAppIconLoader,createSourceIconResolver};
