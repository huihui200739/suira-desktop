'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createIconDiskCache}=require('../lib/icon-disk-cache');
(async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'suira-icon-cache-'));
  try {
    const link=path.join(dir,'app.lnk'),file=path.join(dir,'cache.json'),data='data:image/png;base64,cGl4ZWw=';
    await fs.writeFile(link,'version1');let now=10000;
    const cache=createIconDiskCache(file,{now:()=>now,ttl:1000});await cache.set(link,data);await cache.flush();
    assert.equal(await createIconDiskCache(file,{now:()=>now,ttl:1000}).get(link),data);
    const text=await fs.readFile(file,'utf8');assert.ok(!text.includes(link));
    await fs.appendFile(link,'changed');assert.equal(await createIconDiskCache(file,{now:()=>now,ttl:1000}).get(link),'');
    now+=2000;assert.equal(await createIconDiskCache(file,{now:()=>now,ttl:1000}).get(link),'');
    await fs.writeFile(file,'broken');assert.equal(await createIconDiskCache(file).get(link),'');
    console.log('PASS 图标缓存跨实例命中、快捷方式变化失效、到期失效及损坏恢复；磁盘键不存路径明文');
  }finally{for(const name of await fs.readdir(dir))await fs.unlink(path.join(dir,name));await fs.rmdir(dir);}
})().catch(e=>{console.error(e);process.exitCode=1;});
