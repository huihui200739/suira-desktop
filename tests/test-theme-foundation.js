'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const {violations,lint}=require('../tools/token-lint');
for(const value of ['#fff','#12345678','rgba(1,2,3,.5)','hsl(230 20% 40%)','color(display-p3 1 0 0)','white','aliceblue','var(--missing, blue)'])assert.ok(violations(`.x { color:${value}; }`,'fixture.css').length,value);
for(const source of ['#face { color:var(--ink); }','/* color:#fff */ .x{color:currentColor}','.x{color:color-mix(in srgb,var(--accent) 20%,transparent)}'])assert.equal(violations(source,'fixture.css').length,0,source);
assert.equal(violations(`const escape = '&#039;';`,'fixture.js').length,0);
assert.ok(violations('<div style="background:#fff">','fixture.html').length);
assert.ok(violations('<svg><path fill="#fff"/></svg>','fixture.html').length);
assert.equal(lint().length,0);
const root=path.resolve(__dirname,'..'),source=require('../src/vendor/foundation-sources.json');
for(const [name,hash] of [['MiSansVF.ttf',source.misans.sha256],['MiSans-LICENSE.pdf',source.misans.licenseSha256]])assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'assets/fonts',name))).digest('hex'),hash);
const themeTool=require('../tools/theme-css'),themeSource=fs.readFileSync(path.join(root,'src/theme.css'),'utf8');
assert.ok(themeTool.isCurrent(themeSource),'Generated theme scales match the checked-in stylesheet');
const crlfThemeSource=themeSource.replace(/\r\n?/g,'\n').replace(/\n/g,'\r\n');
assert.ok(themeTool.isCurrent(crlfThemeSource),'Generated theme scales remain valid after Windows CRLF checkout');
const requested=new Set();for(const file of ['index.html','pin.html','workspace.js']){
 const text=fs.readFileSync(path.join(root,'src',file),'utf8');for(const match of text.matchAll(/data-icon="([^"]+)"|suiraIcons\.svg\('([^']+)'\)/g))requested.add(match[1]||match[2]);
}
let exported;const sandbox={window:{},document:{readyState:'loading',addEventListener(){}}};vm.runInNewContext(fs.readFileSync(path.join(root,'src/icons.js'),'utf8'),sandbox);exported=sandbox.window.suiraIcons;
assert.deepEqual([...requested].sort(),Object.keys(source.fluent.icons).sort(),'Icon bundle must include only used icons');
for(const name of requested){const svg=exported.svg(name);assert.match(svg,/viewBox="0 0 24 24"/);assert.match(svg,/stroke-width="1.5"/);assert.match(svg,/aria-hidden="true"/);}
const exportedStyle=fs.readFileSync(path.join(root,'src/export.js'),'utf8');assert.ok(exportedStyle.includes('${exportedTheme}'),'Portable HTML must carry the computed palette');
console.log('PASS token lint rejection/acceptance, original font hashes, used-only Fluent icons and portable export palette');
