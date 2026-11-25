'use strict';
// A custom Electron distribution can contain the runtime owner's old Chromium
// cache. Remove only these exact, non-runtime names from the packaging stage.
const fs=require('node:fs'),path=require('node:path');
const { hosts } = require('../lib/native-hosts');
const { ensureNativeHost } = require('../lib/key-watch');
module.exports=async context=>{
 const stage=path.resolve(context.appOutDir),dist=path.resolve(__dirname,'../dist');
 if(!stage.startsWith(dist+path.sep))throw Error('Unexpected package staging directory');
 for(const name of ['udata','debug.log']){
  const target=path.resolve(stage,name);if(path.dirname(target)!==stage)throw Error('Unsafe runtime-cache target');
  fs.rmSync(target,{recursive:true,force:true});
 }
 if (context.electronPlatformName !== 'win32') return;
 const sourceDir = path.resolve(__dirname, '../assets');
 await Promise.all(Object.entries(hosts).map(async ([name, { references }]) => {
  const result = await ensureNativeHost({ sourcePath: path.join(sourceDir, `${name}.cs`),
   targetPath: path.join(stage, 'resources', 'native-hosts', `${name}.exe`), references, exact: true,
   onError: message => { throw Error(`Cannot compile ${name}: ${message}`); } });
  if (!result) throw Error(`Missing Windows helper: ${name}`);
 }));
};
