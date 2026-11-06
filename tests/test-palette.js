'use strict';
const assert=require('node:assert/strict');
const p=require('../lib/palette');
const pixels=color=>Buffer.from(Array.from({length:64*64},()=>[...p.rgb(color),255]).flat());
for(const color of ['#4985af','#ff0000','#00ff00','#0000ff','#ffffff','#000000']){
  assert.equal(p.dominantColor(pixels(color)),color);
  const palette=p.generatePalette(p.dominantColor(pixels(color))),[,s,l]=p.hsl(palette.dominant);
  assert.ok(s>=.395&&s<=.755&&l>=.445&&l<=.605,'Clamped dominant '+color);
  for(const mode of ['light','dark']){
    const {slate,accent}=palette[mode];assert.equal(slate.length,12);assert.equal(accent.length,12);
    for(const ink of [slate[10],slate[11],accent[10],accent[11]])for(const bg of slate.slice(0,4))assert.ok(p.contrast(ink,bg)>=4.5,`${color} ${mode} ${ink}/${bg}`);
    assert.ok(p.contrast(accent[8],'#ffffff')>=4.5,'Generated primary supports white text');
    assert.ok(p.contrast(accent[8],p.solidInk(accent[8]))>=4.5);
  }
}
const split=Buffer.concat([pixels('#000000'),pixels('#ffffff')]);assert.deepEqual(p.generatePalette(p.dominantColor(split)),p.generatePalette(p.dominantColor(split)));
const mostly=Buffer.concat([pixels('#00ff00'),pixels('#00ff00'),pixels('#ff0000')]);assert.equal(p.dominantColor(mostly),'#00ff00','Median cut preserves the dominant cluster');
assert.equal(p.dominantColor(Buffer.alloc(64*64*4)),'#5b5bd6','Transparent sample has a usable fallback');
assert.equal(p.dominantColor(Buffer.from([0,0,255,255]),{order:'bgra'}),'#ff0000');
assert.equal(p.presetPalette('paper').light.slate[1],'#f6f2ea');assert.equal(p.presetPalette('paper').light.slate[11],'#2a251f');
assert.equal(p.presetPalette('ink').dark.slate[1],'#111113');assert.equal(p.presetPalette('midnight').dark.slate[1],'#0f1722');
for(const name of p.PRESET_NAMES)for(const mode of ['light','dark']){
  const palette=p.presetPalette(name)[mode];
  for(const ink of [palette.slate[10],palette.slate[11],palette.accent[10],palette.accent[11]])for(const bg of palette.slate.slice(0,3))assert.ok(p.contrast(ink,bg)>=4.5,`${name}/${mode}/${ink}/${bg}`);
  assert.ok(p.contrast(palette.accent[8],p.solidInk(palette.accent[8]))>=4.5);
}
console.log('PASS median cut, solid/saturated/monochrome wallpapers, 12-step palettes, contrast and preset anchors');
