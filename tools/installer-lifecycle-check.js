'use strict';
// Build a separately named test product. Never install over Suira or change defaults.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-workspace-'));
const appId='com.suira.releasecheck.'+crypto.randomBytes(6).toString('hex'),product='SuiraReleaseCheck',appDir=path.join(tmp,'app'),output=path.join(tmp,'out'),target=path.join(tmp,'中文 install folder');
const version=require('../package.json').version,installer=path.join(output,`Suira-${version}-x64.exe`),exe=path.join(target,product+'.exe');
const wait=ms=>new Promise(r=>setTimeout(r,ms));let uninstall;
const quote=value=>"'"+value.replace(/'/g,"''")+"'";
function ps(script){return execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);'+script],{encoding:'utf8',windowsHide:true,timeout:20000}).trim();}
function defaults(){return ps(`$result=@{};foreach($ext in @('.md','.markdown')){foreach($key in @("Software\\Classes\\$ext","Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\$ext\\UserChoice")){$reg=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($key);$values=@{};if($reg){foreach($name in $reg.GetValueNames()){$values[$name]=$reg.GetValue($name)};$reg.Dispose()};$result[$key]=$values}};ConvertTo-Json -InputObject $result -Compress -Depth 5`);}
async function run(file,args,timeout=120000){return new Promise((resolve,reject)=>{const child=spawn(file,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);const timer=setTimeout(()=>{child.kill();reject(Error('Installer test timed out: '+log.slice(-1500)));},timeout);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);if(code!==0)reject(Error('Exit '+code+': '+log.slice(-2500)));else resolve(log);});});}
async function until(fn){for(let n=0;n<200;n++){if(fn())return;await wait(100);}throw Error('Installer files did not reach expected state');}
(async()=>{
  const before=JSON.parse(defaults());
  try{execFileSync('robocopy.exe',[path.join(root,'dist','win-unpacked'),appDir,'/E','/R:1','/W:1','/NFL','/NDL','/NJH','/NJS','/NP'],{windowsHide:true,stdio:'ignore'});}catch(e){if(e.status===null||e.status>=8)throw e;}
  fs.renameSync(path.join(appDir,'随序.exe'),path.join(appDir,product+'.exe'));
  const log=await run(process.execPath,[path.join(root,'node_modules','electron-builder','out','cli','cli.js'),'--win','nsis','--prepackaged',appDir,'--publish','never','--config.appId='+appId,'--config.productName='+product,'--config.nsis.shortcutName='+product,'--config.nsis.createDesktopShortcut=false','--config.nsis.createStartMenuShortcut=false','--config.directories.output='+output],240000);
  fs.writeFileSync(path.join(tmp,'build.log'),log);assert.ok(fs.existsSync(installer));
  if(process.argv.includes('--legacy-upgrade')){
    // Reproduce the 0.2.3 process macro in a separate product, without its old
    // default-association behavior. Production installations remain untouched.
    const legacyInclude=path.join(tmp,'legacy.nsh');
    fs.writeFileSync(legacyInclude,'!macro customCheckAppRunning\n legacy_check:\n nsProcess::_FindProcess "${APP_EXECUTABLE_FILENAME}"\n Pop $R0\n ${If} $R0 == 0\n MessageBox MB_RETRYCANCEL "Test app is running" /SD IDCANCEL IDRETRY legacy_check\n Quit\n ${EndIf}\n nsProcess::_Unload\n!macroend\n');
    const legacyOutput=path.join(tmp,'legacy-out'),legacyConfig=path.join(tmp,'legacy.json');
    const config=JSON.parse(JSON.stringify(require('../package.json').build));
    Object.assign(config,{appId,productName:product,fileAssociations:[],directories:{output:legacyOutput},extraMetadata:{version:'0.2.3'}});
    Object.assign(config.nsis,{shortcutName:product,createDesktopShortcut:false,createStartMenuShortcut:false,include:legacyInclude});
    fs.writeFileSync(legacyConfig,JSON.stringify(config));
    await run(process.execPath,[path.join(root,'node_modules','electron-builder','out','cli','cli.js'),'--win','nsis','--prepackaged',appDir,'--publish','never','--config',legacyConfig],240000);
    const legacyInstaller=fs.readdirSync(legacyOutput).find(name=>name.endsWith('.exe'));
    await run(path.join(legacyOutput,legacyInstaller),['/S','/currentuser','/D='+target]);await until(()=>fs.existsSync(exe));
    assert.deepEqual(JSON.parse(defaults()),before);console.log('PASS legacy process-macro fixture installed');
  }
  const expectedHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(appDir,'resources','app.asar'))).digest('hex');
  for(const stage of [process.argv.includes('--legacy-upgrade')?'legacy macro upgrade':'fresh install','reinstall upgrade']){
    await run(installer,['/S','/currentuser','/D='+target]);await until(()=>fs.existsSync(exe));
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(target,'resources','app.asar'))).digest('hex'),expectedHash);
    uninstall=fs.readdirSync(target).find(name=>/^Uninstall.*\.exe$/.test(name));assert.ok(uninstall);
    const command=ps(`$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey(${quote('Software\\Classes\\'+appId+'.Markdown\\shell\\open\\command')});if($k){$k.GetValue('');$k.Dispose()}`);
    assert.equal(command,'"'+exe+'" "%1"');
    for(const ext of ['md','markdown'])assert.equal(ps(`$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey(${quote('Software\\Classes\\.'+ext+'\\OpenWithProgids')});if($k){$k.GetValueNames() -contains ${quote(appId+'.Markdown')};$k.Dispose()}`),'True');
    assert.deepEqual(JSON.parse(defaults()),before,'Existing default associations changed');
    console.log('PASS NSIS '+stage+': installed payload verified; quoted OpenWith commands; existing defaults unchanged');
  }
  // Exercise the updater's --updated path while a same-name test process exits.
  // This fixture is unrelated to the installed Suira process and profile.
  const {ensureNativeHost}=require('../lib/key-watch');
  const sleeperSource=path.join(tmp,'wait.cs'),sleeperDir=path.join(tmp,'sleeper');fs.mkdirSync(sleeperDir);
  fs.writeFileSync(sleeperSource,'class WaitForExit { static void Main(){System.Threading.Thread.Sleep(5000);} }');
  const sleeper=await ensureNativeHost({sourcePath:sleeperSource,targetPath:path.join(sleeperDir,product+'.exe')});assert.ok(sleeper);
  const feedFile=path.join(target,'resources','app-update.yml'),expectedFeed=fs.readFileSync(path.join(appDir,'resources','app-update.yml'));
  fs.writeFileSync(feedFile,'old fixture');
  const waiting=spawn(sleeper,[],{windowsHide:true,stdio:'ignore'});await new Promise((resolve,reject)=>{waiting.once('spawn',resolve);waiting.once('error',reject);});
  await run(installer,['/S','/currentuser','--updated','/D='+target]);
  assert.deepEqual(fs.readFileSync(feedFile),expectedFeed,'Updated install must replace the old payload after the process exits');
  assert.deepEqual(JSON.parse(defaults()),before);
  console.log('PASS --updated installer waits for exiting test process and reinstalls verified feed without changing defaults');
  await run(path.join(target,uninstall),['/S','/currentuser']);await until(()=>!fs.existsSync(exe));
  assert.equal(ps(`Test-Path -LiteralPath ${quote('Registry::HKEY_CURRENT_USER\\Software\\Classes\\'+appId+'.Markdown')}`),'False');
  assert.deepEqual(JSON.parse(defaults()),before);
  console.log('PASS NSIS uninstall: test product and own file association removed; existing defaults unchanged');
  fs.writeFileSync(path.join(root,'.workbuddy','installer-lifecycle-result.json'),JSON.stringify({version,appId,passed:[process.argv.includes('--legacy-upgrade')?'legacy-process-macro-upgrade':'fresh-install','reinstall-upgrade','updated-waits-for-exiting-process','uninstall','unicode-space-path','payload-hash','open-with-both-extensions','defaults-preserved'],date:new Date().toISOString()},null,2));
})().catch(error=>{console.error(error);console.error('Test artifacts:',tmp);process.exitCode=1;}).finally(async()=>{
  // Preserve failed test installations for diagnosis; do not touch production registration.
  if(process.exitCode || fs.existsSync(exe))return;
  const absolute=path.resolve(tmp);if(path.dirname(absolute)!==path.resolve(os.tmpdir())||!path.basename(absolute).startsWith('suira-workspace-'))throw Error('Unsafe cleanup path');
  fs.rmSync(absolute,{recursive:true,force:true,maxRetries:3,retryDelay:300});
});
