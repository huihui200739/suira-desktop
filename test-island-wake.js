'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { IslandPointerProbe, receiverBounds, receiverDisplay, edgeWindowShape } = require('./lib/island-wake');
const { ensureNativeHost, findCsc } = require('./lib/key-watch');

let passed = 0;
const check = async (name, test) => { await test(); passed++; console.log('  PASS  ' + name); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stdin = { end() {} };
  child.kill = () => { child.killed = true; };
  return child;
}

(async () => {
  const displays = [
    {id:1,workArea:{x:0,y:0,width:1920,height:1040}},
    {id:2,workArea:{x:-1280,y:-40,width:1280,height:984}}
  ];
  await check('不按住鼠标时，顶部经过也不启用接收', () => {
    assert.equal(receiverDisplay(displays, {x:960,y:2,down:false}), null);
  });
  await check('原生形状顶部贴边、底部裁圆角，没有外圈矩形', () => {
    const shape = edgeWindowShape(520,148);
    assert.deepEqual(shape[0], {x:0,y:0,width:520,height:132});
    assert.ok(shape.at(-1).x > 0);
    assert.equal(shape.at(-1).y + shape.at(-1).height,148);
    assert.ok(shape.every(r=>r.x>=0 && r.y>=0 && r.x+r.width<=520 && r.y+r.height<=148));
  });
  await check('拖动到顶部中央才启用接收，其他区域不启用', () => {
    assert.equal(receiverDisplay(displays, {x:960,y:2,down:true}).id, 1);
    assert.equal(receiverDisplay(displays, {x:400,y:2,down:true}), null);
    assert.equal(receiverDisplay(displays, {x:960,y:200,down:true}), null);
  });
  await check('负坐标副屏与顶部任务栏使用各自工作区', () => {
    assert.equal(receiverDisplay(displays, {x:-640,y:-38,down:true}).id, 2);
    const area = {x:30,y:48,width:320,height:400};
    const b = receiverBounds(area);
    assert.equal(b.y, 48);
    assert.ok(b.width <= area.width);
    assert.ok(b.x >= area.x);
  });

  await check('READY / 分段输出 / DOWN-UP 边沿与停止清理', async () => {
    const child = fakeChild();
    const points = [];
    const probe = new IslandPointerProbe({executable:'fixture',spawnImpl:()=>child,onPointer:p=>points.push(p)});
    const ready = probe.start();
    child.stdout.emit('data', 'REA');
    child.stdout.emit('data', 'DY\nPOINTER -640 -38 DO');
    child.stdout.emit('data', 'WN\ninvalid\nPOINTER -640 -38 UP\n');
    assert.equal(await ready, true);
    assert.deepEqual(points, [{x:-640,y:-38,down:true},{x:-640,y:-38,down:false}]);
    probe.stop();
    child.stdout.emit('data', 'POINTER 960 4 DOWN\n');
    assert.equal(points.length, 2);
    assert.equal(child.killed, true);
    assert.equal(probe.status, 'stopped');
  });
  await check('超时、进程退出和回调异常都有明确失败，不遗留接收器', async () => {
    for (const failure of ['timeout','exit','callback']) {
      const child = fakeChild();
      const errors = [];
      const probe = new IslandPointerProbe({executable:'fixture',spawnImpl:()=>child,readyTimeout:15,
        onPointer:()=>{throw new Error('callback failed');},onError:e=>errors.push(e)});
      const ready = probe.start();
      if (failure === 'exit') child.emit('exit', 1);
      if (failure === 'callback') child.stdout.emit('data', 'READY\nPOINTER 960 4 DOWN\n');
      await ready;
      if (failure === 'timeout') await wait(20);
      assert.equal(probe.status, 'error');
      assert.equal(errors.length, 1);
      assert.equal(child.killed, true);
    }
  });

  if (process.platform === 'win32' && findCsc()) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'suira-island-wake-'));
    try {
      const executable = await ensureNativeHost({sourcePath:path.join(__dirname,'assets','island-pointer-host.cs'),targetPath:path.join(dir,'pointer.exe')});
      await check('系统 C# 编译器能构建真实宿主，协议自测支持负坐标', () => {
        assert.ok(executable, '拖动侦测宿主编译失败');
        const lines = execFileSync(executable, ['-SelfTest'], {encoding:'utf8',windowsHide:true,timeout:5000});
        assert.match(lines, /READY/);
        assert.match(lines, /POINTER -1280 4 DOWN/);
        assert.match(lines, /POINTER -1270 8 UP/);
      });
      await check('真实 Windows 侦测宿主就绪并可随父进程停止', async () => {
        const samples = [];
        const probe = new IslandPointerProbe({executable,onPointer:p=>samples.push(p)});
        try {
          assert.equal(await probe.start(), true);
          await wait(160);
          assert.ok(samples.length > 0);
          assert.equal(typeof samples[0].down, 'boolean');
        } finally { probe.stop(); }
        await wait(120);
      });
    } finally {
      // 清理是收尾动作，不是验收项：受管控环境里删除临时 exe 可能被拒绝（EPERM）。
      // 这时记一行提示即可，不能让「删不掉临时文件」把整轮测试判成失败。
      try {
        if (path.dirname(dir) === path.resolve(os.tmpdir())) fs.rmSync(dir, {recursive:true,force:true,maxRetries:2});
      } catch (error) {
        console.log('  NOTE  临时目录清理未完成（可忽略）：' + error.code + ' ' + dir);
      }
    }
  }
  console.log(`\n========== ${passed} 通过 / 0 失败 ==========`);
})().catch(error => { console.error(error); process.exitCode = 1; });
