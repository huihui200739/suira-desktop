'use strict';
// Keep browser resources and licenses explicit in src rather than making the
// renderer reach into package internals. This directory is included in the ASAR.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'src/vendor');fs.mkdirSync(out,{recursive:true});
for(const [source,target] of [
  ['lunar-javascript/lunar.js','lunar.js'],['lunar-javascript/LICENSE','lunar-LICENSE.txt'],
  ['marked/lib/marked.umd.js','marked.js'],['marked/LICENSE','marked-LICENSE.txt'],
  ['dompurify/dist/purify.min.js','purify.js'],['dompurify/LICENSE','dompurify-LICENSE.txt']
])fs.copyFileSync(path.join(root,'node_modules',source),path.join(out,target));
console.log('Prepared local Markdown renderer assets and licenses');
