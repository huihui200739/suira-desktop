'use strict';
const assert=require('node:assert/strict');
const {nativeDesktopTiles}=require('./lib/native-capture');
const dataUrl='data:image/png;base64,test';
const single=nativeDesktopTiles([{id:1,bounds:{x:0,y:0,width:1707,height:1067},scaleFactor:1.5}],[{x:0,y:0,width:2560,height:1600,dataUrl}],{x:0,y:0,width:1707,height:1067},1.5);
assert.equal(single.width,2560);assert.equal(single.height,1600);assert.equal(single.rawTiles[0].dataUrl,dataUrl);
const mixed=nativeDesktopTiles([{id:1,bounds:{x:0,y:0,width:1707,height:1067},nativeOrigin:{x:0,y:0},scaleFactor:1.5},{id:2,bounds:{x:-1280,y:0,width:1280,height:720},nativeOrigin:{x:-1280,y:0},scaleFactor:1}],
[{x:-1280,y:0,width:1280,height:720,dataUrl},{x:0,y:0,width:2560,height:1600,dataUrl}],{x:-1280,y:0,width:2987,height:1067},1.5);
assert.equal(mixed.rawTiles[0].pixelWidth,2560);assert.equal(mixed.rawTiles[1].pixelWidth,1280);assert.equal(mixed.rawTiles[1].x,0);
console.log('PASS 单屏保持真实物理尺寸；负坐标混合 DPI 屏幕保留各自原始像素');
