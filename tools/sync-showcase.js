'use strict';
// One product introduction; only explicit demo assets enter the public checkout.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version;
const description='随序 SUIRA · Windows 随手工作台｜截图、剪贴板、日历与 Markdown，让零散内容接着走';
const images=['panel','keyboard-menu','apps','workbench','markdown','calendar','notes','toolbox','clipboard','trace','text-tools','selection-panel','selection-fullscreen','recipes','color-picker'];
const files=['README.md','CHANGELOG.md','LICENSE','assets/suira-icon.png','docs/product/README.md','docs/new-tools.md',...images.map(name=>'docs/product/'+name+'.png')];
function generate(){
 const intro=fs.readFileSync(path.join(root,'docs/product/INTRO.md'),'utf8').replaceAll('{{version}}',version).trimEnd();
 const current=fs.readFileSync(path.join(root,'README.md'),'utf8'),developer=current.slice(current.indexOf('## 参与开发'));
 assert.ok(developer.startsWith('## 参与开发'),'Missing developer guide; refuse to replace README');
 fs.writeFileSync(path.join(root,'README.md'),intro+'\n\n<!-- developer-guide -->\n\n'+developer);
 fs.writeFileSync(path.join(root,'docs/distribution/README.md'),intro+'\n\n## 关于此仓库\n\n这里分发随序的正式安装包、更新清单和产品说明。应用源码仓库保持私有；问题反馈请前往本仓库 Issues。\n');
 return intro;
}
function sync(checkout,{verify=false}={}){
 const dir=path.resolve(checkout);assert.notEqual(dir,root);
 assert.equal(execFileSync('git',['remote','get-url','origin'],{cwd:dir,encoding:'utf8'}).trim(),'https://github.com/huihui200739/suira-updates.git');
 const intro=generate();
 for(const file of files){const source=file==='README.md'?path.join(root,'docs/distribution/README.md'):path.join(root,file),target=path.join(dir,file);assert.ok(fs.existsSync(source),'Missing reviewed product asset: '+file);if(!verify){fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);}assert.ok(fs.readFileSync(source).equals(fs.readFileSync(target)),'Public file differs: '+file);}
 assert.ok(fs.readFileSync(path.join(dir,'README.md'),'utf8').startsWith(intro));
 const status=execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:dir,encoding:'utf8'}).trimEnd().split('\n').filter(Boolean);for(const line of status)assert.ok(files.includes(line.slice(3).trim()),'Unexpected public file: '+line.slice(3));
 const digests=files.map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,file))).digest('hex')}));
 return {version,identicalIntroduction:true,publicAssetsLocal:true,allowlistedFiles:digests,description};
}
if(require.main===module){const checkout=process.argv[2];assert.ok(checkout,'Provide the inspected public repository checkout');const proof=sync(checkout,{verify:process.argv.includes('--verify')});fs.writeFileSync(path.join(root,`docs/showcase-${version}.json`),JSON.stringify(proof,null,2)+'\n');console.log('PASS shared introduction and '+proof.allowlistedFiles.length+' allowlisted public files');}
module.exports={generate,sync,description,files};
