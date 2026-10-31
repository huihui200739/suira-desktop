'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process'),asar=require('@electron/asar');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version;
const payload=path.join(root,'dist','win-unpacked','resources','app.asar'),installer=path.join(root,'dist',`Suira-${version}-x64.exe`);
const files=asar.listPackage(payload).map(file=>file.replace(/\\/g,'/').replace(/^\//,''));
assert.ok(!files.some(file=>/(^|\/)(?:__fx_[^/]*|suira-data\.(?:json|key)|\.workbuddy|\.git|shortcut-fallback[^/]*)(?:\/|$)/.test(file)),'Development files or obsolete fallback leaked into payload');
let checked=0;
for(const file of files.filter(file=>/^(main\.js|preload\.js|pin-preload\.js|lib\/|src\/|assets\/foreground-(host\.cs|helper\.ps1))/.test(file))){
  const native=path.normalize(file),stat=asar.statFile(payload,native);if(stat.files)continue;
  assert.deepEqual(asar.extractFile(payload,native),fs.readFileSync(path.join(root,file)),'Payload differs: '+file);checked++;
}
assert.equal(JSON.parse(asar.extractFile(payload,'package.json')).version,version);
assert.ok(!fs.existsSync(path.join(root,'dist','win-unpacked','resources','app.asar.unpacked','assets','shortcut-fallback-host.cs')));
execFileSync(path.join(root,'node_modules','electron-winstaller','vendor','7z-x64.exe'),['t',installer],{stdio:'ignore',windowsHide:true,timeout:90000});
const sha256=crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex').toUpperCase();
const manifest={version,artifact:path.basename(installer),bytes:fs.statSync(installer).size,sha256,platform:'win32',arch:'x64',electron:'45.0.0',checkedSourceFiles:checked,checks:['source-payload-byte-match','no-test-profile-or-obsolete-key-hook','installer-archive-crc'],signature:'unsigned',published:false};
fs.writeFileSync(path.join(root,'docs',`release-${version}.json`),JSON.stringify(manifest,null,2)+'\n');
console.log('PASS packaged source matches '+checked+' files; no private/test data or obsolete fallback; installer CRC verified');
console.log(JSON.stringify(manifest,null,2));
