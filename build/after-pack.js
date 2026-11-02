'use strict';
// A custom Electron distribution can contain the runtime owner's old Chromium
// cache. Remove only these exact, non-runtime names from the packaging stage.
const fs=require('node:fs'),path=require('node:path');
module.exports=async context=>{
 const stage=path.resolve(context.appOutDir),dist=path.resolve(__dirname,'../dist');
 if(!stage.startsWith(dist+path.sep))throw Error('Unexpected package staging directory');
 for(const name of ['udata','debug.log']){
  const target=path.resolve(stage,name);if(path.dirname(target)!==stage)throw Error('Unsafe runtime-cache target');
  fs.rmSync(target,{recursive:true,force:true});
 }
};
