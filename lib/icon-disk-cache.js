'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
function createIconDiskCache(filePath,{now=Date.now,ttl=86400000,limit=512}={}) {
  let entries={},timer,writing=Promise.resolve();
  const ready=fs.readFile(filePath,'utf8').then(text=>{const data=JSON.parse(text);if(data.version===1&&data.entries&&typeof data.entries==='object')entries=data.entries;}).catch(()=>{});
  const key=p=>createHash('sha256').update(p.toLowerCase()).digest('hex');
  const stamp=async p=>{try{const s=await fs.stat(p);return s.size+':'+s.mtimeMs;}catch{return '';}};
  const flush=()=>{
    clearTimeout(timer);
    writing=writing.then(async()=>{
      await ready;const rows=Object.entries(entries).filter(([,v])=>now()-v.at<ttl).sort((a,b)=>b[1].at-a[1].at).slice(0,limit);
      // 内存里的 entries 也按同一份裁剪结果回写，否则磁盘文件变小了、常驻 Map 仍无限增长
      entries=Object.fromEntries(rows);
      const text=JSON.stringify({version:1,entries});
      await fs.mkdir(path.dirname(filePath),{recursive:true});await fs.writeFile(filePath+'.tmp',text);await fs.rename(filePath+'.tmp',filePath);
    }).catch(()=>{});return writing;
  };
  return {
    async get(p){await ready;const e=entries[key(p)];if(!e||now()-e.at>=ttl||typeof e.data!=='string'||!e.data.startsWith('data:image/png;base64,'))return '';return e.stamp===await stamp(p)?e.data:'';},
    async set(p,data){if(!data.startsWith('data:image/png;base64,')||data.length>350000)return;await ready;const s=await stamp(p);if(!s)return;entries[key(p)]={stamp:s,at:now(),data};clearTimeout(timer);timer=setTimeout(flush,300);timer.unref?.();},
    flush
  };
}
module.exports={createIconDiskCache};
