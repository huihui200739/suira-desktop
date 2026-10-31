'use strict';
const assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{UpdateController}=require('../lib/update-controller');
(async()=>{
 const engine=new EventEmitter();let checks=0,downloads=0,installs=0,saves=0;
 engine.checkForUpdates=async()=>{checks++;engine.emit('update-available',{version:'9.0.0'});};
 engine.downloadUpdate=async()=>{downloads++;engine.emit('download-progress',{percent:45});engine.emit('update-downloaded',{version:'9.0.0'});};
 engine.quitAndInstall=(silent,restart)=>{assert.ok(silent&&restart);assert.equal(saves,1);installs++;};
 const controller=new UpdateController({version:'0.2.12',supported:()=>true,factory:()=>engine,beforeInstall:async()=>{saves++;}});
 await controller.install();assert.equal(installs,0);await controller.check();assert.equal(controller.snapshot().phase,'available');assert.equal(downloads,0);assert.equal(engine.autoInstallOnAppQuit,false);
 await controller.download();assert.equal(controller.snapshot().phase,'ready');await controller.install();assert.equal(installs,1);assert.equal(checks,1);
 const failed=new UpdateController({version:'1',supported:()=>true,factory:()=>engine,beforeInstall:async()=>{throw Error('save failed');}});failed.set({phase:'ready'});await failed.install();assert.equal(failed.snapshot().phase,'ready');assert.equal(installs,1);
 engine.checkForUpdates=async()=>{const e=Error('not published');e.code='ERR_UPDATER_NO_PUBLISHED_VERSIONS';throw e;};controller.set({phase:'idle'});await controller.check();assert.ok(controller.snapshot().message.includes('尚未发布'));assert.equal(controller.snapshot().phase,'error');
 const dev=new UpdateController({version:'1',supported:()=>false,factory:()=>{throw Error('must not load');}});await dev.check();assert.equal(dev.snapshot().phase,'unsupported');
 console.log('PASS updater explicit download, progress/ready lifecycle, save-before-install, failure protection, unpublished feed and unsupported mode');
})().catch(e=>{console.error(e);process.exitCode=1;});
