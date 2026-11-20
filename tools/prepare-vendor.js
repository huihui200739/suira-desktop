'use strict';
// Keep browser resources and licenses explicit in src rather than making the
// renderer reach into package internals. This directory is included in the ASAR.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'src/vendor');fs.mkdirSync(out,{recursive:true});
for(const [source,target] of [
  ['jsqr/LICENSE','jsqr-Apache-2.0.txt'],['opencc-js/LICENSE','opencc-MIT.txt'],['opencc-js/LICENSES/Apache-2.0.txt','opencc-data-Apache-2.0.txt'],['opencc-js/THIRD_PARTY_LICENSES.md','opencc-THIRD-PARTY.md'],
  ['lunar-javascript/lunar.js','lunar.js'],['lunar-javascript/LICENSE','lunar-LICENSE.txt'],
  ['marked/lib/marked.umd.js','marked.js'],['marked/LICENSE','marked-LICENSE.txt'],
  ['dompurify/dist/purify.min.js','purify.js'],['dompurify/LICENSE','dompurify-LICENSE.txt']
])fs.copyFileSync(path.join(root,'node_modules',source),path.join(out,target));
const bundle=require('esbuild').buildSync({entryPoints:[path.join(root,'tools/document-editor-entry.mjs')],outfile:path.join(out,'document-editor.js'),bundle:true,minify:true,format:'iife',platform:'browser',target:'chrome140',legalComments:'eof',metafile:true});
// Use the exact files from the Windows port revision, even for an offline build.
const portRoot=path.join(root,'vendor/miaoyan-windows');
const portOrigin=require(path.join(portRoot,'origin.json'));
for(const [file,digest] of Object.entries(portOrigin.files)) {
 const value=require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(portRoot,file))).digest('hex');
 if(value!==digest)throw new Error('MiaoYan Windows source does not match its recorded revision: '+file);
}
fs.copyFileSync(path.join(portRoot,'lib/layout.css'),path.join(out,'markdown-layout.css'));
const sourceBundle = require('esbuild').buildSync({entryPoints:[path.join(root,'tools/document-source-editor.mjs')],outfile:path.join(out,'document-source-editor.js'),bundle:true,minify:true,format:'iife',platform:'browser',target:'chrome140',legalComments:'eof',metafile:true});
const packages=new Set([...Object.keys(bundle.metafile.inputs),...Object.keys(sourceBundle.metafile.inputs)].map(file=>file.match(/node_modules\/((@[^/]+\/)?[^/]+)\//)?.[1]).filter(Boolean));
const licenses=[];
for(const name of [...packages].sort()){
 const directory=path.join(root,'node_modules',name),file=['LICENSE.md','LICENSE','LICENSE.txt','license','license.md'].find(name=>fs.existsSync(path.join(directory,name)));
 if(file)licenses.push('=== '+name+' ===\n'+fs.readFileSync(path.join(directory,file),'utf8'));
}
fs.writeFileSync(path.join(out,'document-editor-LICENSES.txt'),licenses.join('\n\n')+'\n');
console.log('Prepared local Markdown/document editor assets and licenses');
