'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-workspace-'));
const version=require('../package.json').version;
const source=path.resolve(process.argv[2]||path.join(root,'dist','v'+version,'win-unpacked'));
// Chromium can fail before logging when its executable is under a non-ASCII
// checkout path. Match the developer launcher's existing ASCII-runtime policy.
const installed=/^[\x00-\x7F]*$/.test(source)?source:path.join(temp,'app');
if(installed!==source){
  try { execFileSync('robocopy.exe',[source,installed,'/E','/R:1','/W:1','/NFL','/NDL','/NJH','/NJS','/NP'],{windowsHide:true,stdio:'ignore'}); }
  catch(error){if(error.status===null||error.status>=8)throw error;}
}
const exe=path.join(installed,'随序.exe');
const env={...process.env,APPDATA:path.join(temp,'roaming'),LOCALAPPDATA:path.join(temp,'local')};delete env.ELECTRON_RUN_AS_NODE;fs.mkdirSync(env.APPDATA,{recursive:true});fs.mkdirSync(env.LOCALAPPDATA,{recursive:true});
const child=spawn(exe,['--background','--diag','--user-data-dir='+path.join(temp,'profile')],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
const timeout=setTimeout(()=>{child.kill();console.error('Packaged diagnostic timed out',log);process.exitCode=1;},45000);
child.on('error',e=>{clearTimeout(timeout);console.error(e);process.exitCode=1;});child.on('exit',code=>{clearTimeout(timeout);fs.writeFileSync(path.join(temp,'smoke.log'),log);console.log(log.slice(-7000));console.log('PACKAGED_EXIT',code,'PROFILE',temp);if(code!==0||!log.includes('报告已写入'))process.exitCode=1;});
