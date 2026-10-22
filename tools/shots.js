'use strict';
/*
 * 出图脚本：用无头 Chrome 加载真实页面（注入 mock 桥），逐页截图。
 * 与 test-render.js 共用同一套 fixture 思路，但输出 PNG。
 * 用法：node shots.js
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
const CHROME = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!CHROME) { console.log('未找到 Chrome/Edge'); process.exit(1); }

const FIX = path.join(__dirname, '..', 'src');
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const fileUrl = (p) => 'file:///' + path.resolve(p).replace(/\\/g, '/');

const MOCK = `
const now = Date.now();
const items = [
  { id:'i1', kind:'text', title:'产品需求摘要', text:'随序的核心承诺是顺手接住，让工作继续。截图、文字、剪贴板与任务匣共用一套内容与动作。', source:{type:'clipboard',appName:'Word',confidence:'inferred'}, createdAt:now-120000, parentIds:[], meta:{}, pinned:true },
  { id:'i2', kind:'image', title:'屏幕截图', text:'', filePath:'x.png', thumbnail:'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="480" height="260"><rect width="480" height="260" fill="%23dfe5ef"/><rect x="40" y="40" width="400" height="60" rx="8" fill="%23fff"/><text x="60" y="80" font-family="sans-serif" font-size="20" fill="%23506f9e">季度数据看板</text><rect x="40" y="130" width="180" height="90" rx="8" fill="%23b7cbea"/><rect x="240" y="130" width="200" height="90" rx="8" fill="%23e8edf5"/></svg>', source:{type:'screenshot',confidence:'certain'}, createdAt:now-300000, parentIds:[], meta:{width:1920,height:1080}, pinned:false },
  { id:'i3', kind:'text', title:'识别文字', text:'这是从截图识别出的文字内容，可以继续整理成自然段。', source:{type:'ocr',confidence:'certain'}, createdAt:now-280000, parentIds:['i2'], meta:{derivedBy:'ocr.local'}, pinned:false },
  { id:'i4', kind:'link', title:'Windows App SDK', text:'https://learn.microsoft.com/windows/apps/windows-app-sdk/', source:{type:'clipboard',appName:'Edge',confidence:'inferred'}, createdAt:now-900000, parentIds:[], meta:{}, pinned:false },
  { id:'i5', kind:'files', title:'季度报告.pdf', text:'', filePath:'C:\\\\demo\\\\季度报告.pdf', source:{type:'user',confidence:'certain'}, createdAt:now-1800000, parentIds:[], meta:{}, pinned:false }
];
const tasks = [
  { id:'t1', title:'临时收集', itemIds:['i2','i3','i1'], createdAt:now-3600000, updatedAt:now-60000, archived:false, items:[items[1],items[2],items[0]] },
  { id:'t2', title:'竞品研究', itemIds:['i4'], createdAt:now-7200000, updatedAt:now-1800000, archived:false, items:[items[3]] },
  { id:'t3', title:'本周周报', itemIds:[], createdAt:now-86400000, updatedAt:now-86400000, archived:false, items:[] }
];
const executions = [
  { id:'e1', jobId:'j1', actionId:'ocr.local', inputIds:['i2'], outputIds:['i3'], status:'done', startedAt:now-280000, finishedAt:now-279000, error:'' },
  { id:'e2', jobId:'j2', actionId:'text.merge-lines', inputIds:['i3'], outputIds:[], status:'done', startedAt:now-270000, finishedAt:now-269500, error:'' },
  { id:'e3', jobId:'j3', actionId:'output.copy', inputIds:['i1'], outputIds:[], status:'done', startedAt:now-60000, finishedAt:now-59900, error:'' },
  { id:'e4', jobId:'j4', actionId:'ocr.local', inputIds:['i2'], outputIds:[], status:'failed', startedAt:now-50000, finishedAt:now-49000, error:'没有识别到文字' }
];
const settings = { recordClipboard:true, retentionDays:30, maxItems:2000, theme:'system', ocrLangs:'chi_sim+eng', pauseSensitive:true, pasteAfterCopy:false, encryptContent:true };
const handlers = {};
const on = (ch) => (cb) => { (handlers[ch] = handlers[ch] || []).push(cb); return () => {}; };
window.suira = {
  window:{ minimize(){}, maximize(){}, close(){}, hide(){}, isMaximized:async()=>false },
  quick:{ hide:async()=>({ok:true}), show:async()=>({ok:true}), toggle:async()=>({ok:true}), capture:async()=>({ok:true}), openMain:async()=>({ok:true}), showMain:async()=>({ok:true}), onShown:on('quick:shown') },
  app:{ info:async()=>({name:'随序 SUIRA',version:'0.2.0',userData:'C:\\\\Users\\\\demo\\\\AppData\\\\Roaming\\\\随序',dataPath:'C:\\\\Users\\\\demo\\\\AppData\\\\Roaming\\\\随序\\\\suira-data.json',runtime:'electron'}), openDataDir:async()=>{}, onNavigate:on('app:navigate'), onToast:on('app:toast') },
  capture:{ start:async()=>({ok:true}), getData:async()=>null, finish:async()=>({ok:true}), cancel:async()=>({ok:true}) },
  content:{ list:async(o={})=>items.slice(0,(o.limit||80)), get:async(id)=>items.find(x=>x.id===id), addText:async(p)=>({ok:true,item:{id:'new',...p}}), remove:async()=>({ok:true}), togglePin:async()=>({ok:true}), onChanged:on('content:changed') },
  actions:{ list:async(id)=>({i2:[{id:'ocr.local',label:'提取文字',hint:'本地离线 OCR'},{id:'image.pin',label:'钉在桌面',hint:'保持图片置顶'},{id:'output.copy',label:'复制',hint:'复制到剪贴板'},{id:'output.shelf',label:'加入任务匣',hint:'暂存到临时收集'}],i1:[{id:'output.copy',label:'复制',hint:'复制到剪贴板'},{id:'text.merge-lines',label:'合并换行',hint:'把断行接成自然段'},{id:'text.clean',label:'清理文字',hint:'去掉多余空格和空行'},{id:'output.shelf',label:'加入任务匣',hint:'暂存到临时收集'}],i5:[{id:'files.reveal',label:'定位文件',hint:'在资源管理器中显示'}]}[id]||[]), run:async()=>({ok:true,message:'已复制'}) },
  ocr:{ recognizeItem:async()=>({ok:true,output:{id:'o1',text:'识别结果'}}), onProgress:on('ocr:progress') },
  tasks:{ list:async()=>tasks, create:async(t)=>({ok:true,task:{id:'tn',title:t,itemIds:[],items:[]}}), rename:async()=>({ok:true}), remove:async()=>({ok:true}), addItem:async()=>({ok:true}), removeItem:async()=>({ok:true}), copyText:async()=>({ok:true}), export:async()=>({ok:true,filePath:'x.md'}), onChanged:on('tasks:changed') },
  executions:{ list:async()=>executions, onChanged:on('executions:changed') },
  settings:{ get:async()=>settings, update:async(p)=>({ok:true,settings}), onChanged:on('settings:changed') },
  search:{ query:async()=>[] },
  shortcuts:{ get:async()=>({ bindings:{ quick:'CommandOrControl+Alt+Space', capture:'CommandOrControl+Shift+A' }, status:{ quick:{ok:true,accelerator:'CommandOrControl+Alt+Space',error:'',reserved:null}, capture:{ok:true,accelerator:'CommandOrControl+Shift+A',error:'',reserved:null} } }), set:async()=>({ok:true}), onChanged:on('shortcuts:changed') },
  recipes:{ list:async()=>[], run:async()=>({ok:true,steps:[{action:'text.merge-lines',ok:true}],output:null}) },
  clipboard:{ list:async()=>[], copy:async()=>({ok:true}), remove:async()=>({ok:true}), clear:async()=>({ok:true}), togglePin:async()=>({ok:true}), onChanged:on('content:changed') }
};
`;

function shoot(htmlFile, png, query = '', size = '1180,820') {
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--virtual-time-budget=6000',
    `--window-size=${size}`,
    '--force-device-scale-factor=2',
    `--screenshot=${png}`,
    fileUrl(htmlFile) + query
  ];
  execFileSync(CHROME, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 90000 });
  return fs.existsSync(png) ? fs.statSync(png).size : 0;
}

try {
  fs.writeFileSync(path.join(FIX, '__sh_mock.js'), MOCK, 'utf8');

  const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8')
    .replace('<script src="app.js"></script>', '<script src="__sh_mock.js"></script><script src="app.js"></script>')
    .replace('</body>', `<script>
window.addEventListener('DOMContentLoaded', function () {
  var m = location.search.match(/page=([a-z]+)/);
  var target = m ? m[1] : 'shelf';
  setTimeout(function () {
    var nav = document.querySelector('.nav-item[data-page="' + target + '"]');
    if (nav) nav.click();
  }, 150);
});
</script></body>`);
  fs.writeFileSync(path.join(FIX, '__sh_main.html'), indexHtml, 'utf8');

  const pages = [
    ['shelf', '01-task-shelf.png'],
    ['library', '02-content-library.png'],
    ['trail', '03-process-trail.png'],
    ['settings', '04-settings.png']
  ];
  for (const [page, name] of pages) {
    const out = path.join(OUT, name);
    const size = shoot(path.join(FIX, '__sh_main.html'), out, `?page=${page}`);
    console.log(`${name}  ${size} bytes`);
  }
} finally {
  for (const n of ['__sh_mock.js', '__sh_main.html']) {
    try { fs.rmSync(path.join(FIX, n), { force: true }); } catch {}
  }
}




