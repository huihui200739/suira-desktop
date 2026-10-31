'use strict';
// Read only Windows' static wallpaper, never the screen or open applications.
const path=require('node:path'),fs=require('node:fs/promises');
let cached=null;
async function readLaunchpadBackground(nativeImage,env=process.env){
  const files=[env.APPDATA&&path.join(env.APPDATA,'Microsoft','Windows','Themes','TranscodedWallpaper'),env.WINDIR&&path.join(env.WINDIR,'Web','Wallpaper','Windows','img0.jpg')].filter(Boolean);
  for(const file of files){
    try{
      const stat=await fs.stat(file);if(!stat.isFile()||stat.size>32*1024*1024)continue;
      if(cached?.file===file&&cached.mtime===stat.mtimeMs)return cached.result;
      const original=nativeImage.createFromBuffer(await fs.readFile(file));if(original.isEmpty())continue;
      const {width,height}=original.getSize(),scale=Math.min(1,1600/width,1200/height);
      const image=scale<1?original.resize({width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale)),quality:'good'}):original;
      const result={dataUrl:'data:image/jpeg;base64,'+image.toJPEG(78).toString('base64'),source:'wallpaper'};
      cached={file,mtime:stat.mtimeMs,result};return result;
    }catch{/* The immersive gradient remains usable if wallpaper is unavailable. */}
  }
  cached=null;return {dataUrl:'',source:'gradient'};
}
module.exports={readLaunchpadBackground};
