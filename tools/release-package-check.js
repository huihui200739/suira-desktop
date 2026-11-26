'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process'),asar=require('@electron/asar');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version;
const payload=path.join(root,'dist','win-unpacked','resources','app.asar'),installer=path.join(root,'dist',`Suira-${version}-x64.exe`);
for(const name of ['udata','debug.log'])assert.equal(fs.existsSync(path.join(root,'dist/win-unpacked',name)),false,'Runtime-owner cache must not ship: '+name);
const files=asar.listPackage(payload).map(file=>file.replace(/\\/g,'/').replace(/^\//,''));
assert.ok(!files.some(file=>/(^|\/)(?:__fx_[^/]*|suira-data\.(?:json|key)|\.workbuddy|\.git|shortcut-fallback[^/]*)(?:\/|$)/.test(file)),'Development files or obsolete fallback leaked into payload');
const packagedPaths = new Set(files);
const checkedPackages = new Set();
function checkProductionDependencies(manifestPath) {
  if (checkedPackages.has(manifestPath)) return;
  checkedPackages.add(manifestPath);
  const manifest = JSON.parse(asar.extractFile(payload, path.normalize(manifestPath)));
  for (const name of Object.keys(manifest.dependencies || {})) {
    if (Object.hasOwn(manifest.optionalDependencies || {}, name)) continue;
    let directory = path.posix.dirname(manifestPath);
    while (true) {
      if (path.posix.basename(directory) !== 'node_modules') {
        const candidate = path.posix.join(directory, 'node_modules', name, 'package.json');
        if (packagedPaths.has(candidate)) {
          checkProductionDependencies(candidate);
          break;
        }
      }
      assert.notEqual(directory, '.', `Missing packaged dependency ${name} (required by ${manifestPath}). Run npm ci in the build checkout and rebuild.`);
      directory = path.posix.dirname(directory);
    }
  }
}
checkProductionDependencies('package.json');
console.log(`PASS ${checkedPackages.size - 1} required production packages are present`);
let checked=0;
for(const file of files.filter(file=>/^(main\.js|preload\.js|voice-preload\.js|pin-preload\.js|lib\/|src\/|assets\/licenses\/|assets\/foreground-helper\.ps1)/.test(file))){
  const native=path.normalize(file),stat=asar.statFile(payload,native);if(stat.files)continue;
  assert.deepEqual(asar.extractFile(payload,native),fs.readFileSync(path.join(root,file)),'Payload differs: '+file);checked++;
}
assert.equal(JSON.parse(asar.extractFile(payload,'package.json')).version,version);
for (const name of Object.keys(require('../lib/native-hosts').hosts)) {
  assert.ok(!files.includes(`assets/${name}.cs`), 'Packaged app must not compile its own hosts');
  const executable = fs.readFileSync(path.join(path.dirname(payload), 'native-hosts', `${name}.exe`));
  assert.equal(executable.subarray(0, 2).toString('ascii'), 'MZ', `Missing executable: ${name}`);
}
assert.ok(files.includes('assets/licenses/miaoyan.txt'));
const fontSource=require('../src/vendor/foundation-sources.json').misans;
for(const [name,expected] of [['MiSansVF.ttf',fontSource.sha256],['MiSans-LICENSE.pdf',fontSource.licenseSha256]]){
  const font=asar.extractFile(payload,path.join('assets','fonts',name));
  assert.equal(crypto.createHash('sha256').update(font).digest('hex'),expected,'Packaged original font asset differs: '+name);
  assert.deepEqual(font,fs.readFileSync(path.join(root,'assets','fonts',name)));
}
assert.ok(!fs.existsSync(path.join(root,'dist','win-unpacked','resources','app.asar.unpacked','assets','shortcut-fallback-host.cs')));
const sevenZip=path.join(root,'node_modules','electron-winstaller','vendor','7z-x64.exe');
execFileSync(sevenZip,['t',installer],{stdio:'ignore',windowsHide:true,timeout:90000});
// Read the font bytes out of the actual NSIS payload, not only the staging tree.
// The local 7z runtime inherits the workspace integrity label; keep its scratch
// files in the same workspace rather than a higher-integrity system temp path.
const scratch=path.join(root,'.workbuddy');fs.mkdirSync(scratch,{recursive:true});
const fontCheckDir=fs.mkdtempSync(path.join(scratch,'package-font-'));
try{
  const archive = path.join(fontCheckDir, 'app-64.7z');
  const output = fs.openSync(archive, 'wx');
  try {
    execFileSync(sevenZip, ['e', '-so', installer, '$PLUGINSDIR\\app-64.7z'], {
      stdio: ['ignore', output, 'pipe'], windowsHide: true, timeout: 90000
    });
  } finally { fs.closeSync(output); }
  for(const [name,expected] of [['MiSansVF.ttf',fontSource.sha256],['MiSans-LICENSE.pdf',fontSource.licenseSha256]]){
    const bytes=execFileSync(sevenZip,['e','-so',archive,'resources/app.asar.unpacked/assets/fonts/'+name],{windowsHide:true,timeout:90000,maxBuffer:32*1024*1024});
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),expected,'Installer font bytes differ: '+name);
  }
}finally{
  assert.equal(path.dirname(path.resolve(fontCheckDir)),path.resolve(scratch));
  fs.rmSync(fontCheckDir,{recursive:true,force:true,maxRetries:4,retryDelay:200});
}
const sha256=crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex').toUpperCase();
const fileHash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
const yaml=require('js-yaml'),feed=yaml.load(fs.readFileSync(path.join(root,'dist','latest.yml'),'utf8')),config=yaml.load(fs.readFileSync(path.join(root,'dist','win-unpacked','resources','app-update.yml'),'utf8'));
const publish=require('../package.json').build.publish[0],sha512=crypto.createHash('sha512').update(fs.readFileSync(installer)).digest('base64');
assert.equal(config.provider,publish.provider);assert.equal(config.owner,publish.owner);assert.equal(config.repo,publish.repo);assert.equal(feed.version,version);
const updateFile=feed.files.find(file=>file.url===path.basename(installer));assert.ok(updateFile);assert.equal(updateFile.sha512,sha512);assert.equal(updateFile.size,fs.statSync(installer).size);assert.ok(fs.existsSync(installer+'.blockmap'));assert.ok(files.includes('node_modules/electron-updater/out/main.js'));
const executable = path.join(root, 'dist', 'win-unpacked', '随序.exe');
const requireSignature = process.argv.includes('--require-signature');
function authenticodeStatus(file) {
  const pathLiteral = file.replace(/'/g, "''");
  const shell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return execFileSync(shell, ['-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference = 'Stop'; Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1'); " +
    `(Get-AuthenticodeSignature -LiteralPath '${pathLiteral}').Status.ToString()`
  ], { encoding: 'utf8', windowsHide: true, timeout: 30000 }).trim();
}
const installerStatus = authenticodeStatus(installer);
const executableStatus = authenticodeStatus(executable);
for (const [label, status] of [['Installer', installerStatus], ['Application', executableStatus]]) {
  assert.ok(status === 'Valid' || (!requireSignature && status === 'NotSigned'), `${label} Authenticode: ${status}`);
}
assert.equal(installerStatus, executableStatus, 'Installer and application must both be signed or both be unsigned');
console.log(`PASS Authenticode: installer and application = ${installerStatus}`);
const manifest = {
  version, artifact: path.basename(installer), bytes: fs.statSync(installer).size, sha256, sha512,
  platform: 'win32', arch: 'x64', electron: '45.0.0', checkedSourceFiles: checked,
  checks: ['source-payload-byte-match', 'no-test-profile-or-obsolete-key-hook', 'installer-archive-crc',
    'updater-feed-and-sha512-match', 'original-font-and-license-sha256-in-nsis-payload',
    'required-production-dependency-closure', 'authenticode-verified-status'],
  fontSha256: fontSource.sha256, signature: installerStatus === 'Valid' ? 'valid' : 'unsigned', published: false,
  payloadSha256: fileHash(payload), executableSha256: fileHash(executable)
};
if (!process.argv.includes('--check-only')) fs.writeFileSync(path.join(root,'docs',`release-${version}.json`),JSON.stringify(manifest,null,2)+'\n');
console.log('PASS packaged source matches '+checked+' files; no private/test data or obsolete fallback; installer CRC verified');
console.log(JSON.stringify(manifest,null,2));
