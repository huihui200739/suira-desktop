'use strict';
// Exercise the real NSIS macros against files created only by this test.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'suira-workspace-'));
const cache=path.join(process.env.LOCALAPPDATA,'electron-builder/Cache/nsis-3.0.4.1');
const compiler=process.env.SUIRA_MAKENSIS||fs.readdirSync(cache).map(n=>path.join(cache,n,'Bin/makensis.exe')).find(fs.existsSync);
assert.ok(compiler,'Build an installer first to prepare NSIS');
function run(exe,args=[]){const result=spawnSync(exe,args,{windowsHide:true,encoding:'utf8',timeout:30000});if(result.error)throw result.error;return result;}
function compile(name,source){const input=path.join(tmp,name+'.nsi');fs.writeFileSync(input,'\ufeff'+source);const result=run(compiler,['/V2',input]);assert.equal(result.status,0,result.stdout+result.stderr);return path.join(tmp,name+'.exe');}
const nsis=fs.readFileSync(path.join(root,'node_modules/app-builder-lib/templates/nsis/uninstaller.nsh'),'utf8');
const functions=nsis.slice(nsis.indexOf('Function un.atomicRMDir'),nsis.indexOf('!ifndef UNINSTALL_SECTION_NAME'));
const report={version:require('../package.json').version,checks:[]};
const workspaceProbe=path.join(root,'.workbuddy','installer-context-fixture.exe');
try{
  const context=compile('context',`Unicode true
!include LogicLib.nsh
!include "${path.join(root,'build/installer-context.nsh')}"
OutFile "${path.join(tmp,'context.exe')}"
SilentInstall silent
RequestExecutionLevel user
Function .onInit
!insertmacro suiraCheckInstallerContext
FunctionEnd
Section
SetErrorLevel 0
SectionEnd
`);
  report.contextExit=run(context).status;
  assert.ok([0,740].includes(report.contextExit),'Context guard must allow desktop or fail fast with 740');
  report.checks.push(report.contextExit===740?'low-integrity-rejected-before-mutation':'normal-context-accepted');
  // This execution host may apply a different integrity policy to workspace
  // executables. Probe it without touching the installed app or registry.
  fs.copyFileSync(context,workspaceProbe);
  report.workspaceContextExit=run(workspaceProbe).status;
  assert.ok([0,740].includes(report.workspaceContextExit));
  report.checks.push(report.workspaceContextExit===740?'restricted-workspace-context-rejected-before-mutation':'workspace-context-accepted');
  for(const lockTarget of ['', 'resources\\z-locked', 'Fixture.exe']){
    const locked=Boolean(lockTarget);
    const fixture=path.join(os.tmpdir(),'Low','suira-installer-probe-'+crypto.randomBytes(6).toString('hex'));
    const name=locked?(lockTarget==='Fixture.exe'?'rollback-root':'rollback-resource'):'preserve',uninstall=path.join(tmp,name+'-uninstall.exe');
    const stub=compile(name,`Unicode true
!include LogicLib.nsh
!include FileFunc.nsh
!define APP_EXECUTABLE_FILENAME "Fixture.exe"
!define UNINSTALL_FILENAME "Uninstall Fixture.exe"
!include "${path.join(root,'build/runtime-removal.nsh')}"
OutFile "${path.join(tmp,name+'.exe')}"
SilentInstall silent
SilentUnInstall silent
RequestExecutionLevel user
${functions}
Section
WriteUninstaller "${uninstall}"
SectionEnd
Section "un.test"
StrCpy $INSTDIR "${fixture}"
InitPluginsDir
CreateDirectory "$INSTDIR\\resources"
CreateDirectory "$INSTDIR\\locales"
CreateDirectory "$INSTDIR\\udata"
FileOpen $0 "$INSTDIR\\Fixture.exe" w
FileWrite $0 "program"
FileClose $0
FileOpen $0 "$INSTDIR\\resources\\app.asar" w
FileWrite $0 "runtime"
FileClose $0
FileOpen $0 "$INSTDIR\\resources\\z-locked" w
FileWrite $0 "locked"
FileClose $0
FileOpen $0 "$INSTDIR\\locales\\en.pak" w
FileWrite $0 "locale"
FileClose $0
FileOpen $0 "$INSTDIR\\udata\\suira-data.key" w
FileWrite $0 "keep-key"
FileClose $0
FileOpen $0 "$INSTDIR\\user-note.md" w
FileWrite $0 "keep-note"
FileClose $0
${locked?`System::Call 'kernel32::CreateFileW(w "$INSTDIR\\${lockTarget}", i 0x80000000, i 0, p 0, i 3, i 0, p 0) p.r9'`:''}
!insertmacro customRemoveFiles
SetErrorLevel 0
SectionEnd
`);
    assert.equal(run(stub).status,0);
    const result=run(uninstall,['/S','_?='+tmp]);
    assert.equal(result.status,locked?2:0,result.stdout+result.stderr);
    assert.equal(fs.readFileSync(path.join(fixture,'udata/suira-data.key'),'utf8'),'keep-key');
    assert.equal(fs.readFileSync(path.join(fixture,'user-note.md'),'utf8'),'keep-note');
    if(locked){assert.equal(fs.readFileSync(path.join(fixture,'resources/app.asar'),'utf8'),'runtime');assert.equal(fs.readFileSync(path.join(fixture,'Fixture.exe'),'utf8'),'program');assert.equal(fs.readFileSync(path.join(fixture,'locales/en.pak'),'utf8'),'locale');}
    else{assert.equal(fs.existsSync(path.join(fixture,'resources')),false);assert.equal(fs.existsSync(path.join(fixture,'Fixture.exe')),false);}
    const safeRoot=path.join(path.resolve(os.tmpdir()),'Low')+path.sep;
    assert.ok(path.resolve(fixture).startsWith(safeRoot)&&path.basename(fixture).startsWith('suira-installer-probe-'));
    fs.rmSync(fixture,{recursive:true,force:true});
    report.checks.push(locked?name+'-restored-transactionally':'owned-runtime-removed-user-data-retained');
  }
  fs.writeFileSync(path.join(root,'docs/installer-safety-verification.json'),JSON.stringify(report,null,2)+'\n');
  console.log('PASS NSIS context check, owned-file removal, user-data preservation and busy-file rollback',JSON.stringify(report));
}finally{
  fs.rmSync(workspaceProbe,{force:true});
  assert.equal(path.dirname(path.resolve(tmp)),path.resolve(os.tmpdir()));
  fs.rmSync(tmp,{recursive:true,force:true,maxRetries:3,retryDelay:200});
}
