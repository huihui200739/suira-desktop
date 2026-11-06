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
let sampleCache;
const wallpaperFiles=env=>[env.APPDATA&&path.join(env.APPDATA,'Microsoft','Windows','Themes','TranscodedWallpaper'),env.WINDIR&&path.join(env.WINDIR,'Web','Wallpaper','Windows','img0.jpg')].filter(Boolean);
async function readWallpaperSample(nativeImage,env=process.env){
  for(const file of wallpaperFiles(env))try{
    const stat=await fs.stat(file);if(!stat.isFile()||stat.size>32*1024*1024)continue;
    const signature=file+'|'+stat.mtimeMs+'|'+stat.size;
    if(sampleCache?.signature===signature)return sampleCache;
    let image;
    try{image=await nativeImage.createThumbnailFromPath(file,{width:64,height:64});}catch{}
    if(!image||image.isEmpty())image=nativeImage.createFromBuffer(await fs.readFile(file));
    if(image.isEmpty())continue;
    const size=image.getSize(),scale=Math.min(1,64/size.width,64/size.height);
    if(scale<1)image=image.resize({width:Math.max(1,Math.round(size.width*scale)),height:Math.max(1,Math.round(size.height*scale)),quality:'good'});
    const {width,height}=image.getSize();
    // NativeImage bitmap byte order on our Windows target is BGRA. The native
    // theme acceptance test verifies this with a known red/blue sample.
    sampleCache={signature,data:image.toBitmap(),width,height,order:'bgra',source:'wallpaper'};
    return sampleCache;
  }catch{/* Keep a usable preset if a wallpaper is missing or being replaced. */}
  sampleCache=null;return null;
}
module.exports={readLaunchpadBackground,readWallpaperSample,wallpaperFiles};
