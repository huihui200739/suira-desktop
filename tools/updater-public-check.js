'use strict';
// Anonymous production feed + real download, isolated profile. Never install.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),pkg=require('../package.json'),manifest=require('../docs/release-'+pkg.version+'.json');
const previousArg=process.argv.find(arg=>arg.startsWith('--from='));
const previous=previousArg?previousArg.slice('--from='.length):'0.2.12';
assert.match(previous,/^\d+\.\d+\.\d+$/,'Use --from=<previous-version>');
assert.ok(require('semver').lt(previous,pkg.version),'The previous version must be older than the release');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-workspace-'));let child;
(async()=>{
 const entry=path.join(tmp,'check.js');
 fs.copyFileSync(path.join(root,'dist','win-unpacked','resources','app-update.yml'),path.join(tmp,'app-update.yml'));
 fs.writeFileSync(entry,`const {app}=require('electron'),fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
 const current=process.argv.includes('--current');app.getVersion=()=>current?${JSON.stringify(pkg.version)}:${JSON.stringify(previous)};app.setPath('userData',${JSON.stringify(path.join(tmp,'profile'))}+(current?'-current':''));
 if(process.env.HTTPS_PROXY)app.commandLine.appendSwitch('proxy-server',process.env.HTTPS_PROXY);
 app.whenReady().then(async()=>{const {NsisUpdater}=require(${JSON.stringify(path.join(root,'node_modules/electron-updater'))});const {UpdateController}=require(${JSON.stringify(path.join(root,'lib/update-controller'))});
 const engine=new NsisUpdater();engine.forceDevUpdateConfig=true;engine.disableDifferentialDownload=true;engine.logger=null;engine.updateConfigPath=${JSON.stringify(path.join(tmp,'app-update.yml'))};
 const controller=new UpdateController({version:app.getVersion(),supported:()=>true,factory:()=>engine});controller.on('state',value=>{if(value.phase==='downloading')console.log('Download '+Math.round(value.percent)+'%');});
 await controller.check();assert.equal(controller.snapshot().phase,current?'current':'available',JSON.stringify(controller.snapshot()));
 if(!current){assert.equal(controller.snapshot().version,${JSON.stringify(pkg.version)});await controller.download();assert.equal(controller.snapshot().phase,'ready',JSON.stringify(controller.snapshot()));assert.equal(crypto.createHash('sha512').update(fs.readFileSync(engine.installerPath)).digest('base64'),${JSON.stringify(manifest.sha512)});}
 console.log(current?'PASS current installed version reports latest':'PASS older version discovers public release and downloads matching installer anonymously');app.quit();}).catch(e=>{console.error(e.message);app.exit(1);});`);
 const env={...process.env,APPDATA:path.join(tmp,'roaming'),LOCALAPPDATA:path.join(tmp,'local')};delete env.ELECTRON_RUN_AS_NODE;delete env.GH_TOKEN;delete env.GITHUB_TOKEN;delete env.UPDATE_RELEASE_TOKEN;fs.mkdirSync(env.APPDATA);fs.mkdirSync(env.LOCALAPPDATA);
 const runtime=[process.env.SUIRA_ELECTRON,'C:\\suira-electron\\electron.exe',path.join(root,'node_modules/electron/dist/electron.exe')].filter(Boolean).find(fs.existsSync);assert.ok(runtime);
 for(const current of [false,true])await new Promise((resolve,reject)=>{child=spawn(runtime,[entry,...(current?['--current']:[])],{cwd:tmp,env,windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',data=>process.stdout.write(data));let errors='';child.stderr.on('data',data=>errors+=data);const timer=setTimeout(()=>{child.kill();reject(Error('Public updater check timeout'));},360000);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);if(code!==0)reject(Error('Public updater check failed: '+errors.slice(-1800)));else resolve();});});
 const proof={version:pkg.version,previousVersion:previous,checkedAt:new Date().toISOString(),anonymous:true,productionFeed:true,olderVersionDiscoversRelease:true,downloadSha512:manifest.sha512,currentVersionReportsLatest:true,isolatedDataAndCache:true,installationTriggered:false};
 fs.writeFileSync(path.join(root,'docs',`updater-public-${pkg.version}-verification.json`),JSON.stringify(proof,null,2)+'\n');
 console.log('PASS public updater verification from '+previous+' to '+pkg.version);
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{if(child&&child.exitCode===null)child.kill();await new Promise(resolve=>setTimeout(resolve,400));const absolute=path.resolve(tmp);if(path.dirname(absolute)!==path.resolve(os.tmpdir())||!path.basename(absolute).startsWith('suira-workspace-'))throw Error('Unsafe cleanup');fs.rmSync(absolute,{recursive:true,force:true,maxRetries:4,retryDelay:300});});
