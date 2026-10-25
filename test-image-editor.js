'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {loadImage,validateImage,isOriginalDestination,decodeOutput,MAX_BYTES}=require('./lib/image-editor');
const {createPanelActions}=require('./lib/panel-actions');
let pass=0;
const check=async(name,fn)=>{await fn();pass++;console.log('PASS '+name);};
(async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'suira-image-editor-'));
  try {
    const file=path.join(tmp,'original.png'),link=path.join(tmp,'original-link.png'),copy=path.join(tmp,'copy.png');
    await fs.writeFile(file,'fixture');await fs.link(file,link);await fs.writeFile(copy,'fixture');
    const image={isEmpty:()=>false,getSize:()=>({width:1800,height:1000}),toDataURL:()=>'data:image/png;base64,fixture'};
    const nativeImage={createFromBuffer:()=>image,createFromDataURL:()=>image};
    await check('载入原尺寸与文件名',async()=>assert.deepEqual((await loadImage(file,nativeImage)).size,{width:1800,height:1000}));
    await check('拒绝相对路径',()=>assert.rejects(loadImage('relative.png',nativeImage),/本机图片/));
    await check('不接受 SVG 与脚本文件',()=>assert.rejects(loadImage(path.join(tmp,'x.svg'),nativeImage),/支持/));
    await check('缺失文件返回可读错误',()=>assert.rejects(loadImage(path.join(tmp,'missing.png'),nativeImage),/不存在/));
    await check('目录不能作为图片',async()=>{const dir=path.join(tmp,'folder.png');await fs.mkdir(dir);await assert.rejects(loadImage(dir,nativeImage),/图片文件/);});
    await check('空图和损坏图被拒绝',()=>assert.throws(()=>validateImage({isEmpty:()=>true}),/无法读取/));
    await check('限制像素上限',()=>assert.throws(()=>validateImage({...image,getSize:()=>({width:10000,height:10000})}),/尺寸过大/));
    await check('限制单边像素',()=>assert.throws(()=>validateImage({...image,getSize:()=>({width:20000,height:10})}),/尺寸过大/));
    await check('限制压缩文件大小',async()=>{const large=path.join(tmp,'large.png'),fd=await fs.open(large,'w');await fd.truncate(MAX_BYTES+1);await fd.close();await assert.rejects(loadImage(large,nativeImage),/64 MB/);});
    await check('同一路径禁止覆盖',async()=>assert.equal(await isOriginalDestination(file,file),true));
    await check('硬链接到原图也禁止覆盖',async()=>assert.equal(await isOriginalDestination(file,link),true));
    await check('内容相同的独立文件可另存',async()=>assert.equal(await isOriginalDestination(file,copy),false));
    await check('新文件路径可另存',async()=>assert.equal(await isOriginalDestination(file,path.join(tmp,'new.png')),false));
    await check('导出只接受 PNG 位图',()=>assert.throws(()=>decodeOutput('data:image/svg+xml,<svg/>',nativeImage),/数据无效/));
    await check('导出保留解码后的原图对象',()=>assert.equal(decodeOutput('data:image/png;base64,fixture',nativeImage),image));
    await check('面板改图动作调用编辑器并收起面板',async()=>{let calls=0;const panel=createPanelActions({openImageEditor:async()=>{calls++;return {ok:true};}});assert.deepEqual(await panel.run('edit-image'),{ok:true,closePanel:true});assert.equal(calls,1);});
    await check('编辑器打不开时面板保留并显示原因',async()=>{const panel=createPanelActions({openImageEditor:async()=>({ok:false,error:'窗口打开失败'})});assert.deepEqual(await panel.run('edit-image'),{ok:false,error:'窗口打开失败'});});
    console.log(`\n${pass} 通过 / 0 失败`);
  } finally {await fs.rm(tmp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
