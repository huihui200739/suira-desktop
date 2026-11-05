'use strict';
const assert=require('node:assert/strict');
const {iconSources,createAppIconLoader,createSourceIconResolver}=require('../lib/app-icons');
(async()=>{
  const links={
    'C:\\Apps\\Editor.lnk':{target:'C:\\Program Files\\Editor\\Editor.exe'},
    'C:\\Apps\\System.lnk':{target:'%windir%\\system32\\tool.exe',icon:'%windir%\\system32\\shell32.dll',iconIndex:17},
    'C:\\Apps\\Broken.lnk':{target:'C:\\missing.exe'}
  };
  const calls=[];let unavailable=true,batches=0;
  const readShortcutLink=p=>{if(!links[p])throw Error('broken');return links[p];};
  const readFile=async()=>Buffer.from('[InternetShortcut]\r\nURL=steam://rungameid/123\r\nIconFile="D:\\Games\\游戏.ico"\r\nIconIndex=0\r\n');
  const options={readShortcutLink,readFile,env:{WINDIR:'C:\\Windows'},
    extractResources:async rows=>{batches++;return rows.map(r=>r.filePath.includes('missing')?'':`resource:${r.filePath}:${r.index}`);},
    loadImage:async p=>'image:'+p,
    getFileIcon:async p=>{calls.push(p);return p.includes('missing')&&unavailable?'':'fallback:'+p;}
  };
  const service=createAppIconLoader(options);
  const result=await service.getMany(['C:\\Apps\\Editor.lnk','C:\\Apps\\System.lnk','C:\\Apps\\Game.url']);
  assert.equal(result['C:\\Apps\\Editor.lnk'],'resource:C:\\Program Files\\Editor\\Editor.exe:0');
  assert.equal(result['C:\\Apps\\System.lnk'],'resource:C:\\Windows\\system32\\shell32.dll:17');
  assert.equal(result['C:\\Apps\\Game.url'],'resource:D:\\Games\\游戏.ico:0');
  assert.equal(batches,1);assert.deepEqual(calls,[]);
  console.log('PASS 快捷方式解析到真实程序、指定 DLL 资源索引和本地游戏图标，一批提取');
  const fallback=createAppIconLoader({...options,extractResources:async()=>[]});
  assert.equal((await fallback.getMany(['C:\\Apps\\Game.url']))['C:\\Apps\\Game.url'],'image:D:\\Games\\游戏.ico');
  console.log('PASS ICO 资源无法提取时仍可回退读取原始图标');
  await service.getMany(Object.keys(result));assert.equal(batches,1);
  const first=await service.getMany(['C:\\Apps\\Broken.lnk']);assert.equal(first['C:\\Apps\\Broken.lnk'],'');
  unavailable=false;
  const retry=await service.getMany(['C:\\Apps\\Broken.lnk']);assert.equal(retry['C:\\Apps\\Broken.lnk'],'fallback:C:\\missing.exe');
  assert.ok(calls.every(p=>!p.endsWith('.lnk')));
  console.log('PASS 图标失败可重试，未使用快捷方式的通用白纸图标');
  const utf16=Buffer.concat([Buffer.from([255,254]),Buffer.from('[InternetShortcut]\r\nIconFile=%WINDIR%\\game.ico\r\n','utf16le')]);
  assert.deepEqual(await iconSources('C:\\Apps\\Game.url',{readShortcutLink,readFile:async()=>utf16,env:{WINDIR:'C:\\Windows'}}),[{filePath:'C:\\Windows\\game.ico',index:0}]);
  console.log('PASS UTF-16 快捷方式及环境变量路径');
  const extracted=[];
  const shared=createAppIconLoader({...options,extractResources:async rows=>{extracted.push(...rows.map(r=>r.filePath));await new Promise(r=>setTimeout(r,20));return rows.map(r=>'resource:'+r.filePath);}});
  await Promise.all([shared.getMany(['C:\\Apps\\Editor.lnk','C:\\Apps\\System.lnk']),shared.getMany(['C:\\Apps\\Editor.lnk'])]);
  assert.equal(extracted.filter(p=>p==='C:\\Program Files\\Editor\\Editor.exe').length,1);
  console.log('PASS 重叠图标请求按文件复用在途提取任务');
  let sourceIndexCalls=0;
  const sourceIcons=createSourceIconResolver({listApps:async()=>{sourceIndexCalls++;return [{name:'编辑器',filePath:'C:\\Apps\\Editor.lnk'}];},readShortcutLink,loadIcons:paths=>service.getMany(paths)});
  const byProcess=await sourceIcons.getMany(['EDITOR.exe','编辑器','Unknown','C:\\private.exe','https://example.com']);
  assert.equal(byProcess['EDITOR.exe'],result['C:\\Apps\\Editor.lnk']);assert.equal(byProcess['编辑器'],byProcess['EDITOR.exe']);assert.equal(byProcess.Unknown,'');assert.equal(Object.hasOwn(byProcess,'C:\\private.exe'),false);assert.equal(Object.hasOwn(byProcess,'https://example.com'),false);
  await sourceIcons.getMany(['Editor']);assert.equal(sourceIndexCalls,1);console.log('PASS 剪贴板来源按进程名和中文名称匹配既有图标，不解析外部路径');
})().catch(e=>{console.error(e);process.exitCode=1;});
