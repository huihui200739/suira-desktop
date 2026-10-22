'use strict';
/*
 * 出图脚本（二）：随手面板 + 截图覆盖层 + 悬停工具栏。
 * 复用 test-render.js 的 mock 思路，但输出 PNG。
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
if (!CHROME) { console.log('未找到 Chrome'); process.exit(1); }

const FIX = path.join(__dirname, '..', 'src');
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const fileUrl = (p) => 'file:///' + path.resolve(p).replace(/\\/g, '/');

const MOCK = `
const now = Date.now();
const items = [
  { id:'i1', kind:'text', title:'产品需求摘要', text:'随序的核心承诺是顺手接住，让工作继续。', source:{type:'clipboard',appName:'Word',confidence:'inferred'}, createdAt:now-120000, parentIds:[], meta:{}, pinned:true },
  { id:'i2', kind:'image', title:'屏幕截图', text:'', filePath:'x.png', thumbnail:'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="480" height="260"><rect width="480" height="260" fill="%23dfe5ef"/><rect x="40" y="40" width="400" height="60" rx="8" fill="%23fff"/><text x="60" y="80" font-family="sans-serif" font-size="20" fill="%23506f9e">季度数据看板</text><rect x="40" y="130" width="180" height="90" rx="8" fill="%23b7cbea"/><rect x="240" y="130" width="200" height="90" rx="8" fill="%23e8edf5"/></svg>', source:{type:'screenshot',confidence:'certain'}, createdAt:now-300000, parentIds:[], meta:{width:1920,height:1080}, pinned:false },
  { id:'i3', kind:'text', title:'识别文字', text:'这是从截图识别出的文字内容，可以继续整理成自然段。', source:{type:'ocr',confidence:'certain'}, createdAt:now-280000, parentIds:['i2'], meta:{derivedBy:'ocr.local'}, pinned:false },
  { id:'i4', kind:'link', title:'Windows App SDK', text:'https://learn.microsoft.com/windows/apps/windows-app-sdk/', source:{type:'clipboard',appName:'Edge',confidence:'inferred'}, createdAt:now-900000, parentIds:[], meta:{}, pinned:false }
];
const tasks = [{ id:'t1', title:'临时收集', itemIds:['i2','i3','i1'], createdAt:now-3600000, updatedAt:now-60000, archived:false, items:[items[1],items[2],items[0]] }];
const settings = { recordClipboard:true, retentionDays:30, maxItems:2000, theme:'system', ocrLangs:'chi_sim+eng', pauseSensitive:true, pasteAfterCopy:false, encryptContent:true };
const handlers = {};
const on = (ch) => (cb) => { (handlers[ch] = handlers[ch] || []).push(cb); return () => {}; };
window.suira = {
  window:{ minimize(){}, maximize(){}, close(){}, hide(){}, isMaximized:async()=>false },
  quick:{ hide:async()=>({ok:true}), show:async()=>({ok:true}), toggle:async()=>({ok:true}), capture:async()=>({ok:true}), openMain:async()=>({ok:true}), showMain:async()=>({ok:true}), onShown:on('quick:shown') },
  app:{ info:async()=>({name:'随序 SUIRA',version:'0.2.0',userData:'C:\\\\Users\\\\demo\\\\AppData\\\\Roaming\\\\随序',dataPath:'C:\\\\Users\\\\demo\\\\AppData\\\\Roaming\\\\随序\\\\suira-data.json',runtime:'electron'}), openDataDir:async()=>{}, onNavigate:on('app:navigate'), onToast:on('app:toast') },
  capture:{ start:async()=>({ok:true}), getData:async()=>null, finish:async()=>({ok:true}), cancel:async()=>({ok:true}) },
  content:{ list:async(o={})=>items.slice(0,(o.limit||80)), get:async(id)=>items.find(x=>x.id===id), addText:async(p)=>({ok:true,item:{id:'new',...p}}), remove:async()=>({ok:true}), togglePin:async()=>({ok:true}), onChanged:on('content:changed') },
  actions:{ list:async(id)=>({i2:[{id:'ocr.local',label:'提取文字',hint:'本地离线 OCR'},{id:'image.pin',label:'钉在桌面',hint:'保持图片置顶'},{id:'output.copy',label:'复制',hint:'复制到剪贴板'},{id:'output.shelf',label:'加入任务匣',hint:'暂存到临时收集'}],i1:[{id:'output.copy',label:'复制',hint:'复制到剪贴板'},{id:'text.merge-lines',label:'合并换行',hint:'把断行接成自然段'},{id:'text.clean',label:'清理文字',hint:'去掉多余空格和空行'},{id:'output.shelf',label:'加入任务匣',hint:'暂存到临时收集'}],i4:[{id:'output.copy',label:'复制',hint:'复制到剪贴板'}]}[id]||[]), run:async()=>({ok:true,message:'已复制'}) },
  ocr:{ recognizeItem:async()=>({ok:true,output:{id:'o1',text:'识别结果'}}), onProgress:on('ocr:progress') },
  tasks:{ list:async()=>tasks, create:async(t)=>({ok:true,task:{id:'tn',title:t,itemIds:[],items:[]}}), rename:async()=>({ok:true}), remove:async()=>({ok:true}), addItem:async()=>({ok:true}), removeItem:async()=>({ok:true}), copyText:async()=>({ok:true}), export:async()=>({ok:true,filePath:'x.md'}), onChanged:on('tasks:changed') },
  executions:{ list:async()=>[], onChanged:on('executions:changed') },
  settings:{ get:async()=>settings, update:async(p)=>({ok:true,settings}), onChanged:on('settings:changed') },
  search:{ query: async (q) => {
    var all = [
      { id:'cmd.capture', kind:'command', title:'区域截图', subtitle:'框选屏幕区域并标注', action:'capture' },
      { id:'cmd.shelf', kind:'command', title:'任务匣', subtitle:'接住待处理的内容', action:'navigate:shelf' },
      { id:'cmd.ocr', kind:'command', title:'截图提字', subtitle:'截图后离线识别文字', action:'recipe:capture-to-text' }
    ];
    return q ? all : [];
  } },
  shortcuts:{ get:async()=>({ bindings:{ quick:'CommandOrControl+Alt+Space', capture:'CommandOrControl+Shift+A' }, status:{ quick:{ok:true,accelerator:'CommandOrControl+Alt+Space',error:'',reserved:null}, capture:{ok:true,accelerator:'CommandOrControl+Shift+A',error:'',reserved:null} } }), set:async()=>({ok:true}), onChanged:on('shortcuts:changed') },
  recipes:{ list:async()=>[{id:'capture-to-text',name:'截图提到文字',description:'截图 → 提字 → 合并换行'}], run:async()=>({ok:true,steps:[{action:'text.merge-lines',ok:true}],output:null}) },
  clipboard:{ list:async()=>[], copy:async()=>({ok:true}), remove:async()=>({ok:true}), clear:async()=>({ok:true}), togglePin:async()=>({ok:true}), onChanged:on('content:changed') },
  returnTo:{
    target: async () => ({ hwnd:'854172', pid:28748, processName:'WINWORD', title:'季度报告.docx', processStartedAt:1792597649451, elevated:false }),
    commit: async () => ({ ok:true, copied:true, canPaste:false, message:'已复制，请手动粘贴到原窗口' })
  },
  quick_openApp: async () => ({ ok:true })
};
window.suira.quick.openApp = async () => ({ ok: true });
`;

function shoot(htmlFile, png, query = '', size = '1180,820', extra = []) {
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--virtual-time-budget=6000',
    `--window-size=${size}`,
    '--force-device-scale-factor=2',
    ...extra,
    `--screenshot=${png}`,
    fileUrl(htmlFile) + query
  ];
  execFileSync(CHROME, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 90000 });
  return fs.existsSync(png) ? fs.statSync(png).size : 0;
}

try {
  // --- 随手面板：默认态 + 拼音搜索态 ---
  fs.writeFileSync(path.join(FIX, '__sh2_mock.js'), MOCK, 'utf8');

  const showPanel = `
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    var cbs = (handlers['quick:shown'] || []);
    for (var i = 0; i < cbs.length; i++) { try { cbs[i](); } catch (e) {} }
  }, 300);
});
</script>`;

  const qpHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'quickpanel.html'), 'utf8')
    .replace('<script src="quickpanel.js"></script>', '<script src="__sh2_mock.js"></script><script src="quickpanel.js"></script>')
    .replace('</body>', showPanel + '</body>');
  fs.writeFileSync(path.join(FIX, '__sh2_qp.html'), qpHtml, 'utf8');

  console.log('05-quick-panel.png ' + shoot(path.join(FIX, '__sh2_qp.html'), path.join(OUT, '05-quick-panel.png'), '', '660,620') + ' bytes');

  // 拼音首字母搜索态
  const qpHtml2 = fs.readFileSync(path.join(__dirname, '..', 'src', 'quickpanel.html'), 'utf8')
    .replace('<script src="quickpanel.js"></script>', '<script src="__sh2_mock.js"></script><script src="quickpanel.js"></script>')
    .replace('</body>', showPanel + `
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    var input = document.getElementById('search');
    if (input) {
      input.value = 'rwx';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, 800);
});
</script>` + '</body>');
  fs.writeFileSync(path.join(FIX, '__sh2_qp2.html'), qpHtml2, 'utf8');
  console.log('06-quick-panel-pinyin.png ' + shoot(path.join(FIX, '__sh2_qp2.html'), path.join(OUT, '06-quick-panel-pinyin.png'), '', '660,620') + ' bytes');

  // --- 截图覆盖层 ---
  const overlayMock = `
<script src="__sh2_mock.js"></script>
<script>
window.suira.capture.getData = async function () {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="810">'
    + '<rect width="1440" height="810" fill="#e8edf5"/>'
    + '<rect x="0" y="0" width="1440" height="120" fill="#ffffff"/>'
    + '<text x="60" y="72" font-family="sans-serif" font-size="26" fill="#3a4657">随序 SUIRA — 工作台</text>'
    + '<rect x="60" y="170" width="420" height="220" rx="14" fill="#ffffff"/>'
    + '<text x="92" y="222" font-family="sans-serif" font-size="22" fill="#506f9e">季度数据看板</text>'
    + '<text x="92" y="262" font-family="sans-serif" font-size="16" fill="#6f7b8d">收入环比 +12.4%</text>'
    + '<rect x="92" y="290" width="356" height="70" rx="8" fill="#b7cbea"/>'
    + '<rect x="520" y="170" width="420" height="220" rx="14" fill="#ffffff"/>'
    + '<text x="552" y="222" font-family="sans-serif" font-size="22" fill="#506f9e">内容收集</text>'
    + '<rect x="552" y="250" width="356" height="26" rx="6" fill="#e7ebf3"/>'
    + '<rect x="552" y="290" width="280" height="26" rx="6" fill="#e7ebf3"/>'
    + '<rect x="980" y="170" width="400" height="220" rx="14" fill="#ffffff"/>'
    + '<text x="1012" y="222" font-family="sans-serif" font-size="22" fill="#506f9e">快捷键</text>'
    + '<text x="1012" y="268" font-family="sans-serif" font-size="18" fill="#3a4657">Ctrl + Alt + Space</text>'
    + '</svg>';
  return { dataUrl: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
           displayId: 1, bounds:{x:0,y:0,width:1440,height:810},
           size:{width:1440,height:810}, scaleFactor:1, source:'test' };
};
</script>
<script src="overlay.js"></script>
<script>
window.addEventListener('load', function () {
  // 模拟已经拖出一个选区，让工具栏与尺寸提示显示出来
  setTimeout(function () {
    try {
      if (typeof state !== 'undefined' && state.image) {
        state.selection = { x: 380, y: 150, width: 700, height: 420 };
        state.dragging = false;
        if (typeof render === 'function') render();
        if (typeof updateToolbar === 'function') updateToolbar();
        document.dispatchEvent(new Event('selectionchange'));
      }
    } catch (e) {}
  }, 900);
});
</script>
`;
  const ovHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'overlay.html'), 'utf8')
    .replace('<script src="overlay.js"></script>', overlayMock)
    .replace('</body>', '<script></script></body>');
  fs.writeFileSync(path.join(FIX, '__sh2_ov.html'), ovHtml, 'utf8');
  console.log('07-capture-overlay.png ' + shoot(path.join(FIX, '__sh2_ov.html'), path.join(OUT, '07-capture-overlay.png'), '', '1440,810') + ' bytes');
} finally {
  for (const n of ['__sh2_mock.js', '__sh2_qp.html', '__sh2_qp2.html', '__sh2_ov.html']) {
    try { fs.rmSync(path.join(FIX, n), { force: true }); } catch {}
  }
}




