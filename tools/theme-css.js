'use strict';
// Generate only foundation scales. Semantic tokens have one shared mapping.
const fs=require('node:fs'),path=require('node:path');
const {presetPalette,PRESET_NAMES}=require('../lib/palette');
const start='/* BEGIN GENERATED THEME SCALES */',end='/* END GENERATED THEME SCALES */';
function render(){
  const blocks=[];
  for(const mode of ['light','dark']){
    const rules=PRESET_NAMES.map(name=>{
      const p=presetPalette(name)[mode];
      return `:root[data-theme="${name}"], .theme-swatch[data-theme="${name}"] {\n`+['slate','accent'].map(scale=>p[scale].map((color,i)=>`  --${scale}-${i+1}:${color};`).join('\n')).join('\n')+'\n}';
    }).join('\n');
    blocks.push(mode==='dark'?`@media (prefers-color-scheme:dark) {\n${rules}\n}`:rules);
  }
  return start+'\n'+blocks.join('\n')+'\n'+end;
}
const file=path.resolve(__dirname,'../src/theme.css'),source=fs.readFileSync(file,'utf8'),generated=render();
if(process.argv.includes('--check')){
  if(!source.includes(generated))throw Error('Theme scales are stale: run node tools/theme-css.js');
  console.log('PASS preset CSS matches palette foundations');
}else{
  const from=source.indexOf(start),to=source.indexOf(end);
  fs.writeFileSync(file,from<0?source+'\n'+generated+'\n':source.slice(0,from)+generated+source.slice(to+end.length));
}
