'use strict';
/* 出图（三）：截图覆盖层，带真实选区（调用 overlay.js 的 setSelection） */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].find((p) => fs.existsSync(p));
if (!CHROME) { console.log('未找到 Chrome'); process.exit(1); }

const FIX = path.join(__dirname, '..', 'src');
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
const url = (p) => 'file:///' + path.resolve(p).replace(/\\/g, '/');

const BG = `
<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="900">
  <rect width="1440" height="900" fill="#eef1f6"/>
  <rect x="0" y="0" width="1440" height="110" fill="#ffffff"/>
  <circle cx="60" cy="55" r="18" fill="#506f9e"/>
  <text x="92" y="64" font-family="Microsoft YaHei,sans-serif" font-size="22" fill="#2b3442">随序 SUIRA — 工作台</text>
  <text x="1120" y="64" font-family="Microsoft YaHei,sans-serif" font-size="17" fill="#6f7b8d">Ctrl + Alt + Space</text>
  <rect x="60" y="150" width="420" height="240" rx="14" fill="#ffffff"/>
  <text x="92" y="200" font-family="Microsoft YaHei,sans-serif" font-size="21" fill="#506f9e">季度数据看板</text>
  <text x="92" y="240" font-family="Microsoft YaHei,sans-serif" font-size="16" fill="#6f7b8d">收入环比 +12.4%，超预期</text>
  <rect x="92" y="270" width="356" height="90" rx="8" fill="#b7cbea"/>
  <rect x="520" y="150" width="420" height="240" rx="14" fill="#ffffff"/>
  <text x="552" y="200" font-family="Microsoft YaHei,sans-serif" font-size="21" fill="#506f9e">内容收集</text>
  <rect x="552" y="228" width="356" height="24" rx="6" fill="#e7ebf3"/>
  <rect x="552" y="266" width="300" height="24" rx="6" fill="#e7ebf3"/>
  <rect x="552" y="304" width="330" height="24" rx="6" fill="#e7ebf3"/>
  <rect x="980" y="150" width="400" height="240" rx="14" fill="#ffffff"/>
  <text x="1012" y="200" font-family="Microsoft YaHei,sans-serif" font-size="21" fill="#506f9e">快捷键</text>
  <text x="1012" y="246" font-family="Microsoft YaHei,sans-serif" font-size="17" fill="#3a4657">Ctrl + Alt + Space  随手面板</text>
  <text x="1012" y="286" font-family="Microsoft YaHei,sans-serif" font-size="17" fill="#3a4657">Ctrl + Shift + A    区域截图</text>
  <rect x="60" y="430" width="1320" height="380" rx="14" fill="#ffffff"/>
  <text x="92" y="486" font-family="Microsoft YaHei,sans-serif" font-size="21" fill="#2b3442">本月工作概览</text>
  <rect x="92" y="520" width="1256" height="1" fill="#e7ebf3"/>
  <text x="92" y="576" font-family="Microsoft YaHei,sans-serif" font-size="17" fill="#6f7b8d">截图 128 张 · 提字 64 次 · 入匣 39 条 · 导出 12 份</text>
  <rect x="92" y="614" width="240" height="150" rx="10" fill="#f4f6fa"/>
  <rect x="356" y="614" width="240" height="150" rx="10" fill="#f4f6fa"/>
  <rect x="620" y="614" width="240" height="150" rx="10" fill="#f4f6fa"/>
</svg>`;

const mock = `
<script>
window.suira = window.suira || {};
window.suira.capture = window.suira.capture || {};
window.suira.capture.getData = async function () {
  var svg = ${JSON.stringify(BG)};
  return { dataUrl: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
           displayId: 1, bounds:{x:0,y:0,width:1440,height:900},
           size:{width:1440,height:900}, scaleFactor:1, source:'test' };
};
window.suira.capture.finish = async function () { return { ok:true, item:{id:'cap1'} }; };
window.suira.capture.cancel = async function () { return { ok:true }; };
window.suira.ocr = window.suira.ocr || {};
window.suira.ocr.recognizeItem = async function () { return { ok:true, output:{ id:'o1', text:'季度数据看板' } }; };
</script>`;

const drive = `
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    try {
      if (typeof setSelection === 'function') {
        setSelection({ x: 184, y: 300, w: 800, h: 330 });
      }
      if (typeof renderSelection === 'function') renderSelection();
      // 用真实鼠标事件驱动放大镜，避免出图时停留在未初始化的黑块状态
      var root = document.getElementById('overlay') || document.body;
      var ev = new MouseEvent('mousemove', {
        clientX: 584, clientY: 465, bubbles: true, cancelable: true, view: window
      });
      (root.dispatchEvent ? root : document).dispatchEvent(ev);
      document.dispatchEvent(ev);
      window.dispatchEvent(ev);
      if (typeof drawMagnifier === 'function') {
        drawMagnifier({ x: 584, y: 465 });
      }
    } catch (e) {}
  }, 1200);
});
</script>`;

let html = fs.readFileSync(path.join(__dirname, '..', 'src', 'overlay.html'), 'utf8')
  .replace('<script src="overlay.js"></script>', mock + '<script src="overlay.js"></script>' + drive);

// 覆盖层里引用了不存在的 assets/screenshot.png，出图时替换成真实图标
html = html.replace('../assets/screenshot.png', '../assets/icon.png');

fs.writeFileSync(path.join(FIX, '__sh3_ov.html'), html, 'utf8');

const png = path.join(OUT, '07-capture-overlay.png');
execFileSync(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--virtual-time-budget=6000', '--window-size=1440,900',
  '--force-device-scale-factor=1.5',
  `--screenshot=${png}`,
  url(path.join(FIX, '__sh3_ov.html'))
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 90000 });

fs.rmSync(path.join(FIX, '__sh3_ov.html'), { force: true });
console.log('07-capture-overlay.png ' + fs.statSync(png).size + ' bytes');




