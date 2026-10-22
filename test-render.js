'use strict';
/*
 * 渲染层验证：用无头 Chrome 真实加载页面，断言 DOM 结构与 canvas 像素。
 * 自带 fixture（运行时生成到 src/.render-fixtures，结束后清理）。
 * 用法：node test-render.js
 */
const assert = require('assert');
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
if (!CHROME) {
  console.log('跳过渲染验证：未找到 Chrome/Edge');
  process.exit(0);
}

const FIXTURES = path.join(__dirname, 'src');
const url = (p) => 'file:///' + path.resolve(p).replace(/\\/g, '/');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + ' -> ' + e.message); fail++; } };

const MOCK = `
const now = Date.now();
// 用查询参数切换「按住型侦测是否在运行」，便于验证降级文案
const momentaryWatching = location.search.indexOf('momentary=off') < 0;
const items = [
  { id:'i1', kind:'text', title:'产品需求摘要', text:'随序的核心承诺是顺手接住，让工作继续。', source:{type:'clipboard',confidence:'inferred'}, createdAt:now-120000, parentIds:[], meta:{}, pinned:true },
  { id:'i2', kind:'image', title:'屏幕截图', text:'', filePath:'x.png', thumbnail:'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="240" height="130"><rect width="240" height="130" fill="%23dfe5ef"/></svg>', source:{type:'screenshot',confidence:'certain'}, createdAt:now-300000, parentIds:[], meta:{width:1920,height:1080} },
  { id:'i3', kind:'text', title:'识别文字', text:'这是从截图识别出的文字内容。', source:{type:'ocr',confidence:'certain'}, createdAt:now-280000, parentIds:['i2'], meta:{derivedBy:'ocr.local'} },
  { id:'i4', kind:'link', title:'Windows App SDK', text:'https://learn.microsoft.com/windows/apps/windows-app-sdk/', source:{type:'clipboard',confidence:'inferred'}, createdAt:now-900000, parentIds:[], meta:{} },
  { id:'i5', kind:'files', title:'季度报告.pdf', text:'', filePath:'C:\\\\demo\\\\季度报告.pdf', source:{type:'user',confidence:'certain'}, createdAt:now-1800000, parentIds:[], meta:{} }
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
const settings = { recordClipboard:true, retentionDays:30, maxItems:2000, theme:'system', ocrLangs:'chi_sim+eng', pauseSensitive:true, pasteAfterCopy:false };
const handlers = {};
const on = (ch) => (cb) => { (handlers[ch] = handlers[ch] || []).push(cb); return () => {}; };
window.suira = {
  window:{ minimize(){}, maximize(){}, close(){}, hide(){}, isMaximized:async()=>false },
  quick:{ hide:async()=>({ok:true}), show:async()=>({ok:true}), toggle:async()=>({ok:true}), capture:async()=>({ok:true}), openMain:async()=>({ok:true}), showMain:async()=>({ok:true}), onShown:on('quick:shown'), onMode:on('quick:mode') },
  island:{ toggle:async()=>({ok:true}), getState:async()=>({items:[],expanded:false}), onState:on('island:state'), onExpanded:on('island:expanded') },
  app:{ info:async()=>({name:'随序 SUIRA',version:'0.2.0',userData:'C:\\\\demo\\\\Suira',dataPath:'C:\\\\demo\\\\Suira\\\\suira-data.json',runtime:'test'}), openDataDir:async()=>{}, onNavigate:on('app:navigate'), onToast:on('app:toast') },
  capture:{ start:async()=>({ok:true}), getData:async()=>null, finish:async()=>({ok:true}), cancel:async()=>({ok:true}) },
  content:{ list:async(o={})=>items.slice(0,(o.limit||80)), get:async(id)=>items.find(x=>x.id===id), addText:async(p)=>({ok:true,item:{id:'new',...p}}), remove:async()=>({ok:true}), togglePin:async()=>({ok:true}), onChanged:on('content:changed') },
  actions:{ list:async(id)=>({i2:[{id:'ocr.local',label:'提取文字',hint:'本地离线 OCR'},{id:'image.pin',label:'钉在桌面',hint:'保持图片置顶'},{id:'output.copy',label:'复制',hint:'复制到剪贴板'},{id:'output.shelf',label:'加入任务匣',hint:'暂存到临时收集'}],i1:[{id:'output.copy',label:'复制',hint:'复制到剪贴板'},{id:'text.merge-lines',label:'合并换行',hint:'把断行接成自然段'},{id:'text.clean',label:'清理文字',hint:'去掉多余空格和空行'},{id:'output.shelf',label:'加入任务匣',hint:'暂存到临时收集'}],i5:[{id:'files.reveal',label:'定位文件',hint:'在资源管理器中显示'}]}[id]||[]), run:async()=>({ok:true,message:'已复制'}) },
  returnTo:{ target:async()=>null, commit:async(p)=>{ window.__lastCommit = p; return p && p.itemId==='i5' ? {ok:false,error:'目标窗口已关闭'} : {ok:true,copied:true,verdict:'copy-only',canPaste:false,message:'已复制，切回目标后粘贴'}; } },
  ocr:{ recognizeItem:async()=>({ok:true,output:{id:'o1',text:'识别结果'}}), onProgress:on('ocr:progress') },
  tasks:{ list:async()=>tasks, create:async(t)=>({ok:true,task:{id:'tn',title:t,itemIds:[],items:[]}}), rename:async()=>({ok:true}), remove:async()=>({ok:true}), addItem:async()=>({ok:true}), removeItem:async()=>({ok:true}), copyText:async()=>({ok:true}), export:async()=>({ok:true,filePath:'x.md'}), onChanged:on('tasks:changed') },
  executions:{ list:async()=>executions, retry:async(id)=>{ window.__lastRetry = id; return {ok:true,output:{id:'r-'+id}}; }, onChanged:on('executions:changed') },
  settings:{ get:async()=>settings, update:async(p)=>({ok:true,settings}), onChanged:on('settings:changed') },
  search:{ query:async()=>[] },
  shortcuts:{ get:async()=>({ bindings:{ quick:'CommandOrControl+Alt+Space', capture:'CommandOrControl+Shift+A', momentary:'CommandOrControl+Alt+Shift+Space', panelCycle:'CommandOrControl+Alt+Q', pinnedToggle:'CommandOrControl+Alt+H', clipboardBar:'CommandOrControl+Alt+V' }, status:{ quick:{ok:true,accelerator:'CommandOrControl+Alt+Space',error:'',reserved:null}, capture:{ok:false,accelerator:'CommandOrControl+Shift+A',error:'无法注册，可能已被占用',reserved:null}, momentary:{ok:momentaryWatching,accelerator:'CommandOrControl+Alt+Shift+Space',error:momentaryWatching ? '' : '按住型侦测未运行',reserved:null,watching:momentaryWatching}, panelCycle:{ok:true,accelerator:'CommandOrControl+Alt+Q',error:'',reserved:null}, pinnedToggle:{ok:true,accelerator:'CommandOrControl+Alt+H',error:'',reserved:null}, clipboardBar:{ok:true,accelerator:'CommandOrControl+Alt+V',error:'',reserved:null} } }), set:async()=>({ok:true}), clear:async()=>({ok:true}), restoreDefault:async()=>({ok:true}), onChanged:on('shortcuts:changed') },
  recipes:{ list:async()=>[], run:async()=>({ok:true,steps:[{action:'text.merge-lines',ok:true}],output:null}) },
  clipboard:{ list:async()=>[], copy:async()=>({ok:true}), remove:async()=>({ok:true}), clear:async()=>({ok:true}), togglePin:async()=>({ok:true}), onChanged:on('content:changed') }
};
`;

const PROBE_MAIN = `
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    var r = {
      activePage: (document.querySelector('.page.is-active')||{}).id,
      taskRows: document.querySelectorAll('.task-row').length,
      shelfCards: document.querySelectorAll('.shelf-card').length,
      derivedCards: document.querySelectorAll('.derived-card').length,
      timelineSteps: document.querySelectorAll('.trail-step').length,
      libraryCards: document.querySelectorAll('.library-card').length,
      pinMarks: document.querySelectorAll('.pin-mark').length,
      fixButtons: document.querySelectorAll('[data-fix]').length,
      fixButtonTexts: Array.from(document.querySelectorAll('[data-fix]')).map((b) => b.textContent.trim()),
      clearButton: !!document.getElementById('library-clear'),
      maximizeIcon: (() => {
        const b = document.getElementById('maximize');
        return b ? b.innerHTML.length : 0;
      })(),
      trailRows: document.querySelectorAll('.trail-row').length,
      summaryCards: document.querySelectorAll('.summary-card').length,
      failedRows: document.querySelectorAll('.trail-row.is-failed').length,
      navActive: document.querySelectorAll('.nav-item.is-active').length,
      bodyOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      visiblePageCount: document.querySelectorAll('.page.is-active').length,
      recipeButtons: document.querySelectorAll('[data-recipe]').length,
      previewCards: document.querySelectorAll('[data-preview]').length,
      pasteButtons: document.querySelectorAll('[data-paste]').length,
      pasteButtonTexts: Array.from(document.querySelectorAll('[data-paste]')).map((b) => b.textContent.trim()),
      revealButtons: document.querySelectorAll('[data-reveal]').length,
      retryButtons: document.querySelectorAll('[data-retry]').length,
      retryButtonTexts: Array.from(document.querySelectorAll('[data-retry]')).map((b) => b.textContent.trim()),
      previewOverlay: !!document.getElementById('preview'),
      previewHidden: !!(document.getElementById('preview') || {}).hidden,
      previewBody: !!document.getElementById('preview-body'),
      hasSearchApi: typeof window.suira.search.query === 'function',
      shortcutInputs: document.querySelectorAll('.shortcut-input').length,
      quickKeyValue: (document.getElementById('setting-key-quick') || {}).value || '',
      quickStatus: (document.getElementById('status-quick') || {}).textContent || '',
      captureStatus: (document.getElementById('status-capture') || {}).textContent || '',
      captureStatusClass: (document.getElementById('status-capture') || {}).className || '',
      momentaryKeyValue: (document.getElementById('setting-key-momentary') || {}).value || '',
      momentaryStatus: (document.getElementById('status-momentary') || {}).textContent || '',
      momentaryStatusClass: (document.getElementById('status-momentary') || {}).className || '',
      panelCycleStatus: (document.getElementById('status-panelCycle') || {}).textContent || '',
      pinnedToggleStatus: (document.getElementById('status-pinnedToggle') || {}).textContent || '',
      clipboardBarStatus: (document.getElementById('status-clipboardBar') || {}).textContent || '',
      hasMomentaryStatus: !!document.getElementById('status-momentary'),
      hasPanelCycleStatus: !!document.getElementById('status-panelCycle'),
      hasPinnedToggleStatus: !!document.getElementById('status-pinnedToggle'),
      hasClipboardBarStatus: !!document.getElementById('status-clipboardBar'),
      clipboardBarKeyValue: (document.getElementById('setting-key-clipboardBar') || {}).value || '',
      momentaryClear: !!document.querySelector('[data-shortcut-clear="momentary"]'),
      panelCycleClear: !!document.querySelector('[data-shortcut-clear="panelCycle"]'),
      pinnedToggleClear: !!document.querySelector('[data-shortcut-clear="pinnedToggle"]'),
      clipboardBarClear: !!document.querySelector('[data-shortcut-clear="clipboardBar"]'),
      restoreTitle: (document.getElementById('shortcut-restore') || {}).title || '',
      hasEncryptToggle: !!document.getElementById('setting-encrypt'),
      encryptChecked: (document.getElementById('setting-encrypt') || {}).checked
    };
    var pre = document.createElement('pre');
    pre.textContent = 'P:' + JSON.stringify(r);
    document.body.appendChild(pre);
  }, 2200);
});
</script>
`;

const OVERLAY_MOCK = `
<script src="__fx_mock.js"></script>
<script>
window.suira.capture.getData = async function () {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="810">'
    + '<rect width="1440" height="810" fill="#e8edf5"/>'
    + '<rect x="60" y="60" width="1320" height="120" rx="10" fill="#ffffff"/>'
    + '<text x="90" y="130" font-family="sans-serif" font-size="28" fill="#4a5568">SAMPLE</text>'
    + '</svg>';
  return { dataUrl: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
           displayId: 1, bounds:{x:0,y:0,width:1440,height:810},
           size:{width:1440,height:810}, scaleFactor:1, source:'test' };
};
window.suira.capture.finish = async function () { return { ok:true, item:{id:'cap1'}, output:{ id:'o1', text:'OCR' } }; };
</script>
<script src="overlay.js"></script>
`;

const PROBE_OVERLAY = `
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    var sc = document.getElementById('screen-canvas');
    var g = sc.getContext('2d');
    function px(x,y){ var d=g.getImageData(x,y,1,1).data; return [d[0],d[1],d[2],d[3]]; }
    var out = {
      canvasW: sc.width, canvasH: sc.height,
      hasImage: !!(typeof state!=='undefined' && state.image),
      topLeft: px(2,2),
      ocrPanelExists: !!document.getElementById('ocr-result')
    };
    var pre = document.createElement('pre');
    pre.textContent = 'R:' + JSON.stringify(out);
    document.body.appendChild(pre);
  }, 2200);
});
</script>
`;

const PROBE_FLOW = `
<script>
window.addEventListener('load', function () {
  var pageMatch = location.search.match(/page=([a-z]+)/);
  var page = pageMatch ? pageMatch[1] : 'shelf';
  var out = {};
  function previewState() {
    var preview = document.getElementById('preview');
    return {
      opened: preview ? !preview.hidden : false,
      title: (document.getElementById('preview-title') || {}).textContent || '',
      kind: (document.getElementById('preview-kind') || {}).textContent || '',
      text: ((document.getElementById('preview-body') || {}).textContent || '').slice(0, 160)
    };
  }
  function emit() {
    var pre = document.createElement('pre');
    pre.textContent = 'L:' + JSON.stringify(out);
    document.body.appendChild(pre);
  }
  if (page === 'library') {
    setTimeout(function () {
      var first = document.querySelector('.library-card');
      if (!first) { emit(); return; }
      var target = first.querySelector('.shelf-card-head b') || first;
      // 1. 点卡片主体打开预览
      target.click();
      out.preview = previewState();
      // 预览层里的提示必须盖在遮罩之上（toast z-index 高于 preview）
      out.previewZ = Number(getComputedStyle(document.getElementById('preview')).zIndex) || 0;
      out.toastZ = Number(getComputedStyle(document.getElementById('global-toast')).zIndex) || 0;
      // 2. Esc 只关预览层
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      out.closedByEsc = (document.getElementById('preview') || {}).hidden === true;
      // 3. 重新打开后点遮罩关闭
      target.click();
      out.reopened = previewState().opened;
      document.getElementById('preview').click();
      out.closedByMask = (document.getElementById('preview') || {}).hidden === true;
      // 4. 粘贴成功路径（commit 文案回显到 toast）
      first.querySelector('[data-paste]').click();
      setTimeout(function () {
        out.pasteToast = (document.getElementById('global-toast') || {}).textContent || '';
        out.commitPayload = window.__lastCommit || null;
        // 5. 粘贴失败路径（主进程返回 error）
        var filesCard = document.querySelector('.library-card[data-id="i5"]');
        if (filesCard) filesCard.querySelector('[data-paste]').click();
        setTimeout(function () {
          out.pasteErrorToast = (document.getElementById('global-toast') || {}).textContent || '';
          emit();
        }, 200);
      }, 200);
    }, 1200);
  } else if (page === 'trail') {
    setTimeout(function () {
      var retry = document.querySelector('[data-retry]');
      if (retry) retry.click();
      setTimeout(function () {
        out.retryToast = (document.getElementById('global-toast') || {}).textContent || '';
        out.retriedId = window.__lastRetry || '';
        out.rowsAfterRetry = document.querySelectorAll('.trail-row').length;
        emit();
      }, 300);
    }, 1200);
  }
});
</script>
`;

function buildFixtures() {
  fs.writeFileSync(path.join(FIXTURES, '__fx_mock.js'), MOCK, 'utf8');

  const indexHtml = fs.readFileSync(path.join(__dirname, 'src', 'index.html'), 'utf8')
    .replace('<script src="app.js"></script>', '<script src="__fx_mock.js"></script><script src="app.js"></script>')
    .replace('</body>', `<script>
window.addEventListener('DOMContentLoaded', function () {
  var m = location.search.match(/page=([a-z]+)/);
  var target = m ? m[1] : 'shelf';
  setTimeout(function () {
    var nav = document.querySelector('.nav-item[data-page="' + target + '"]');
    if (nav) nav.click();
  }, 120);
});
</script>` + PROBE_MAIN + PROBE_FLOW + '</body>');
  fs.writeFileSync(path.join(FIXTURES, '__fx_main.html'), indexHtml, 'utf8');

  const overlayHtml = fs.readFileSync(path.join(__dirname, 'src', 'overlay.html'), 'utf8')
    .replace('<script src="overlay.js"></script>', OVERLAY_MOCK)
    .replace('</body>', PROBE_OVERLAY + '</body>');
  fs.writeFileSync(path.join(FIXTURES, '__fx_overlay.html'), overlayHtml, 'utf8');

  const qpMock = MOCK.replace(
    "search:{ query: async()=>[] }",
    ''
  ) + `
window.suira.search = { query: async (q) => {
  var all = [
    { id:'cmd.capture', kind:'command', title:'区域截图', subtitle:'框选屏幕区域并标注', action:'capture' },
    { id:'cmd.shelf', kind:'command', title:'任务匣', subtitle:'接住待处理的内容', action:'navigate:shelf' },
    { id:'cmd.ocr', kind:'command', title:'截图提字', subtitle:'截图后离线识别文字', action:'recipe:capture-to-text' }
  ];
  return q ? all : [];
} };
window.suira.recipes = { list: async()=>[], run: async()=>({ ok:true, steps:[], output:null }) };
window.suira.returnTo = {
  target: async () => ({ hwnd:'854172', pid:28748, processName:'WINWORD', title:'季度报告.docx', processStartedAt:1792597649451, elevated:false }),
  commit: async () => ({ ok:true, copied:true, canPaste:false, message:'已复制，请手动粘贴到原窗口' })
};
window.suira.quick.openApp = async () => ({ ok:true });
// 38 键面板的键位表由主进程 lib/keybindings.js 提供，fixture 里照抄同一份布局
window.suira.panel = {
  state: async () => {
    var rows = [
      ['1','2','3','4','5','6','7','8','9','0','-','='],
      ['Q','W','E','R','T','Y','U','I','O','P'],
      ['A','S','D','F','G','H','J','K','L'],
      ['Z','X','C','V','B','N','M']
    ];
    var bound = { O:'ocr', P:'pin', D:'desktop', L:'lock', Z:'capture', X:'clipboard', V:'text-clean', B:'annotate' };
    var planned = { S:'录屏', G:'长截图', T:'文本翻译', W:'壁纸', I:'改图', F:'日历', N:'速记', M:'Markdown' };
    var keys = [];
    rows.forEach(function (row, rowIndex) {
      row.forEach(function (key) {
        var actionId = bound[key] || '';
        var plannedLabel = planned[key] || '';
        keys.push({
          key: key, row: rowIndex, actionId: actionId,
          label: plannedLabel || (actionId ? actionId : ''),
          hint: '', state: actionId ? 'bound' : plannedLabel ? 'unimplemented' : 'unbound'
        });
      });
    });
    return { rows: rows, keys: keys, count: 38, tools: [
      { id:'capture', label:'截图', hint:'框选屏幕区域', implemented:true },
      { id:'ocr', label:'提取文字', hint:'离线 OCR', implemented:true },
      { id:'shelf', label:'任务匣', hint:'临时收集', implemented:true, open:'shelf' },
      { id:'record', label:'录屏', hint:'尚未实现', implemented:false }
    ] };
  },
  run: async (actionId) => ({ ok: true, message: '已执行 ' + actionId })
};
window.suira.apps = {
  list: async () => ([
    { name:'计算器', filePath:'C:\\Demo\\calc.lnk' },
    { name:'记事本', filePath:'C:\\Demo\\notepad.lnk' },
    { name:'Visual Studio Code', filePath:'C:\\Demo\\vscode.lnk' }
  ]),
  icons: async () => ({})
};
`;
  const qpHtml = fs.readFileSync(path.join(__dirname, 'src', 'quickpanel.html'), 'utf8')
    .replace('<script src="quickpanel.js"></script>', '<script src="__fx_qp_mock.js"></script><script src="quickpanel.js"></script>')
    .replace('</body>', `<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    // 模拟面板被唤起：主进程已记录目标窗口，面板收到 quick:shown
    var cbs = (handlers['quick:shown'] || []);
    for (var i = 0; i < cbs.length; i++) { try { cbs[i](); } catch (e) {} }
  }, 300);
});
</script>
<script>
// 记录空白态：38 键面板应在未搜索时完整显示
window.addEventListener('load', function () {
  setTimeout(function () {
    window.__before = {
      keys: document.querySelectorAll('.key').length,
      rows: document.querySelectorAll('.key-row').length,
      boundKeys: document.querySelectorAll('.key.is-bound').length,
      keysHidden: document.getElementById('key-grid').hidden,
      commandHidden: document.getElementById('command-section').hidden,
      modeChip: (document.getElementById('mode-chip') || {}).textContent || ''
    };
    // 空格切到应用面板
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    setTimeout(function () {
      window.__apps = {
        appItems: document.querySelectorAll('.app-item').length,
        appsHidden: document.getElementById('apps-panel').hidden,
        keysHidden: document.getElementById('key-grid').hidden,
        modeChip: (document.getElementById('mode-chip') || {}).textContent || ''
      };
      // 再按空格切回动作面板
      document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      setTimeout(function () {
        window.__back = {
          keysHidden: document.getElementById('key-grid').hidden,
          appsHidden: document.getElementById('apps-panel').hidden
        };
        // 工具箱
        document.getElementById('toolbox').click();
        setTimeout(function () {
          window.__tools = {
            toolItems: document.querySelectorAll('.tool-item').length,
            todoItems: document.querySelectorAll('.tool-item.is-todo').length,
            toolboxHidden: document.getElementById('toolbox-panel').hidden
          };
          document.getElementById('toolbox').click();
          setTimeout(function () {
            var input = document.getElementById('search');
            input.value = 'rwx';
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }, 120);
        }, 200);
      }, 200);
    }, 200);
  }, 900);
});
</script>
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    var out = {
      before: window.__before || {},
      apps: window.__apps || {},
      back: window.__back || {},
      tools: window.__tools || {},
      commandSectionHidden: document.getElementById('command-section').hidden,
      commandItems: document.querySelectorAll('.command-item').length,
      hasSourceCard: !!document.getElementById('source-card'),
      returnBarHidden: document.getElementById('return-bar').hidden,
      returnTargetText: document.getElementById('return-target-text').textContent,
      hasReturnCommit: !!document.getElementById('return-commit')
    };
    var pre = document.createElement('pre');
    pre.textContent = 'Q:' + JSON.stringify(out);
    document.body.appendChild(pre);
  }, 3000);
});
</script>
</body>`);
  fs.writeFileSync(path.join(FIXTURES, '__fx_qp.html'), qpHtml, 'utf8');
  fs.writeFileSync(path.join(FIXTURES, '__fx_qp_mock.js'), qpMock, 'utf8');
}

function runChrome(file, extraArgs = [], query = '') {
  return execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--virtual-time-budget=6000', '--window-size=1180,820', '--dump-dom',
    ...extraArgs,
    url(path.join(FIXTURES, file)) + query
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 90000 });
}

function probe(html, prefix) {
  const marker = prefix + ':{';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('未找到探针输出（页面可能渲染失败）');
  const from = start + prefix.length + 1;
  // 按大括号配对提取，避免嵌套对象被非贪婪正则截断
  let depth = 0, inString = false, escaped = false, end = -1;
  for (let i = from; i < html.length; i += 1) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end < 0) throw new Error('探针输出不完整');
  return JSON.parse(html.slice(from, end));
}

try {
  buildFixtures();

  console.log('\n== 主窗口四页面渲染断言 ==');
  const shelf = probe(runChrome('__fx_main.html', [], '?page=shelf'), 'P');
  t('任务匣：3 个任务行', () => assert.strictEqual(shelf.taskRows, 3));
  t('任务匣：3 张内容卡', () => assert.strictEqual(shelf.shelfCards, 3));
  t('任务匣：派生内容卡存在（截图→识别文字）', () => assert.strictEqual(shelf.derivedCards, 1));
  t('任务匣：处理轨迹步骤条有 5 步', () => assert.strictEqual(shelf.timelineSteps, 5));
  t('任务匣：任意时刻只显示一个页面', () => assert.strictEqual(shelf.visiblePageCount, 1));
  t('任务匣：无横向溢出', () => assert.strictEqual(shelf.bodyOverflowX, 0));
  t('任务匣：导航高亮唯一', () => assert.strictEqual(shelf.navActive, 1));
  t('任务匣：文字与派生文字卡都有「整理文字」按钮', () => assert.ok(shelf.recipeButtons >= 2, 'recipeButtons=' + shelf.recipeButtons));
  t('主窗口可用拼音搜索接口', () => assert.strictEqual(shelf.hasSearchApi, true));

  const lib = probe(runChrome('__fx_main.html', [], '?page=library'), 'P');
  t('内容库：渲染 5 张内容卡', () => assert.strictEqual(lib.libraryCards, 5));
  t('内容库：每张卡都有固定按钮', () => assert.strictEqual(lib.fixButtons, 5));
  t('内容库：已固定的条目显示「固定」标记', () => assert.strictEqual(lib.pinMarks, 1));
  t('内容库：固定按钮文案随状态切换', () => {
    assert.ok(lib.fixButtonTexts.includes('取消固定'), '已固定项应显示「取消固定」');
    assert.ok(lib.fixButtonTexts.filter((x) => x === '固定').length >= 1, '未固定项应显示「固定」');
  });
  t('内容库：有「清空剪贴板记录」按钮', () => assert.strictEqual(lib.clearButton, true));
  t('内容库：当前页正确', () => assert.strictEqual(lib.activePage, 'page-library'));
  t('内容库：每张卡片主体都能打开预览', () => assert.strictEqual(lib.previewCards, 5));
  t('内容库：每张卡都有「粘贴」按钮', () => {
    assert.strictEqual(lib.pasteButtons, 5);
    assert.ok(lib.pasteButtonTexts.every((x) => x === '粘贴'), '实际: ' + lib.pasteButtonTexts.join(','));
  });
  t('内容库：文件条目额外提供「所在文件夹」', () => assert.strictEqual(lib.revealButtons, 1));
  t('内容库：预览层已挂载且默认隐藏', () => {
    assert.strictEqual(lib.previewOverlay, true);
    assert.strictEqual(lib.previewHidden, true);
    assert.strictEqual(lib.previewBody, true);
  });

  const trail = probe(runChrome('__fx_main.html', [], '?page=trail'), 'P');
  t('处理轨迹：4 条记录', () => assert.strictEqual(trail.trailRows, 4));
  t('处理轨迹：4 张统计卡', () => assert.strictEqual(trail.summaryCards, 4));
  t('处理轨迹：失败记录有独立样式', () => assert.strictEqual(trail.failedRows, 1));
  t('处理轨迹：只有失败行带「重试」按钮', () => {
    assert.strictEqual(trail.retryButtons, 1);
    assert.deepStrictEqual(trail.retryButtonTexts, ['重试']);
  });

  console.log('\n== 内容库预览 / 粘贴 / 轨迹重试交互断言 ==');
  const libFlow = probe(runChrome('__fx_main.html', [], '?page=library'), 'L');
  t('内容库：点卡片主体打开预览并显示全文', () => {
    assert.strictEqual(libFlow.preview.opened, true);
    assert.strictEqual(libFlow.preview.kind, '文字');
    assert.ok(libFlow.preview.title.includes('产品需求摘要'), '实际标题: ' + libFlow.preview.title);
    assert.ok(libFlow.preview.text.includes('顺手接住'), '预览正文应包含全文: ' + libFlow.preview.text);
  });
  t('内容库：Esc 只关闭预览层', () => {
    assert.strictEqual(libFlow.closedByEsc, true);
  });
  t('内容库：点遮罩关闭预览层', () => {
    assert.strictEqual(libFlow.reopened, true);
    assert.strictEqual(libFlow.closedByMask, true);
  });
  t('内容库：预览层里的 toast 提示层级高于遮罩', () => {
    assert.ok(libFlow.toastZ > libFlow.previewZ, `toast=${libFlow.toastZ} preview=${libFlow.previewZ}`);
  });
  t('内容库：「粘贴」调用 returnTo.commit({intent:"return-and-paste"})', () => {
    assert.ok(libFlow.commitPayload, '未调用 returnTo.commit');
    assert.strictEqual(libFlow.commitPayload.itemId, 'i1');
    assert.strictEqual(libFlow.commitPayload.intent, 'return-and-paste');
  });
  t('内容库：粘贴成功 toast 显示主进程 message', () => {
    assert.strictEqual(libFlow.pasteToast, '已复制，切回目标后粘贴');
  });
  t('内容库：粘贴失败 toast 显示主进程 error', () => {
    assert.strictEqual(libFlow.pasteErrorToast, '目标窗口已关闭');
  });

  const trailFlow = probe(runChrome('__fx_main.html', [], '?page=trail'), 'L');
  t('处理轨迹：点重试调用 executions.retry 并提示「已重试」', () => {
    assert.strictEqual(trailFlow.retriedId, 'e4');
    assert.strictEqual(trailFlow.retryToast, '已重试');
    assert.strictEqual(trailFlow.rowsAfterRetry, 4);
  });

  const set = probe(runChrome('__fx_main.html', [], '?page=settings'), 'P');
  t('设置：当前页正确', () => assert.strictEqual(set.activePage, 'page-settings'));
  t('设置：渲染出六个改键输入框', () => assert.strictEqual(set.shortcutInputs, 6));
  t('设置：改键框显示当前键位（Ctrl + Alt + Space）', () => {
    assert.ok(set.quickKeyValue.includes('Ctrl'), '实际: ' + set.quickKeyValue);
    assert.ok(set.quickKeyValue.includes('Space'), '实际: ' + set.quickKeyValue);
  });
  t('设置：注册成功的键显示「已生效」', () => assert.match(set.quickStatus, /已生效/));
  t('设置：注册失败的键显示错误并带错误样式', () => {
    assert.match(set.captureStatus, /占用|失败/);
    assert.ok(set.captureStatusClass.includes('is-error'), '实际 class: ' + set.captureStatusClass);
  });
  t('设置：按住型唤起输入框与状态元素存在', () => {
    assert.ok(set.momentaryKeyValue.includes('Ctrl'), '实际: ' + set.momentaryKeyValue);
    assert.ok(set.momentaryKeyValue.includes('Space'), '实际: ' + set.momentaryKeyValue);
    assert.strictEqual(set.hasMomentaryStatus, true);
    assert.match(set.momentaryStatus, /按住生效，松手收起/);
  });
  t('设置：面板布局轮换状态元素存在且已生效', () => {
    assert.strictEqual(set.hasPanelCycleStatus, true);
    assert.match(set.panelCycleStatus, /已生效/);
  });
  t('设置：钉图显隐状态元素存在且已生效', () => {
    assert.strictEqual(set.hasPinnedToggleStatus, true);
    assert.match(set.pinnedToggleStatus, /已生效/);
  });
  t('设置：剪贴板历史条输入框与状态元素存在且已生效', () => {
    assert.strictEqual(set.hasClipboardBarStatus, true);
    assert.ok(set.clipboardBarKeyValue.includes('Ctrl'), '实际: ' + set.clipboardBarKeyValue);
    assert.ok(set.clipboardBarKeyValue.includes('V'), '实际: ' + set.clipboardBarKeyValue);
    assert.match(set.clipboardBarStatus, /已生效/);
  });
  t('设置：新增四个键位都有「清除绑定」', () => {
    assert.strictEqual(set.momentaryClear, true);
    assert.strictEqual(set.panelCycleClear, true);
    assert.strictEqual(set.pinnedToggleClear, true);
    assert.strictEqual(set.clipboardBarClear, true);
  });
  t('设置：恢复默认按钮覆盖全部快捷键', () => assert.match(set.restoreTitle, /全部快捷键/));
  t('设置：加密开关存在且默认开启', () => {
    assert.strictEqual(set.hasEncryptToggle, true);
    assert.strictEqual(set.encryptChecked, true);
  });

  const setOff = probe(runChrome('__fx_main.html', [], '?page=settings&momentary=off'), 'P');
  t('设置：按住型侦测未运行时显示原因与警告/错误样式', () => {
    assert.match(setOff.momentaryStatus, /按住型侦测未运行/);
    assert.ok(!/按住型侦测未运行：按住型侦测未运行/.test(setOff.momentaryStatus), '不应重复拼接同一句：' + setOff.momentaryStatus);
    assert.ok(/is-error|is-warn/.test(setOff.momentaryStatusClass), '实际 class: ' + setOff.momentaryStatusClass);
  });

  console.log('\n== 截图覆盖层渲染断言 ==');
  const ov = probe(runChrome('__fx_overlay.html', ['--window-size=1440,810']), 'R');
  t('屏幕画面已绘制（canvas 非默认 300x150）', () => {
    assert.ok(ov.canvasW > 1000, 'canvasW=' + ov.canvasW);
    assert.ok(ov.canvasH > 500, 'canvasH=' + ov.canvasH);
  });
  t('canvas 像素等于注入的截图背景色 #E8EDF5', () => {
    assert.deepStrictEqual(ov.topLeft.slice(0, 3), [232, 237, 245]);
  });
  t('截图图像已成功加载', () => assert.strictEqual(ov.hasImage, true));
  t('OCR 结果面板已挂载', () => assert.strictEqual(ov.ocrPanelExists, true));

  console.log('\n== 38 键动作面板渲染断言 ==');
  const qp = probe(runChrome('__fx_qp.html', ['--window-size=720,620']), 'Q');
  t('面板渲染 38 个键位', () => assert.strictEqual(qp.before.keys, 38));
  t('键位按 4 行排列（12/10/9/7）', () => assert.strictEqual(qp.before.rows, 4));
  t('已实现动作显示为彩色绑定键', () => assert.strictEqual(qp.before.boundKeys, 8));
  t('未搜索时键位面板可见', () => assert.strictEqual(qp.before.keysHidden, false));
  t('未搜索时命令区隐藏', () => assert.strictEqual(qp.before.commandHidden, true));
  t('默认模式标记为「动作」', () => assert.strictEqual(qp.before.modeChip, '动作'));
  t('空格切到应用面板：应用图标网格渲染 3 个', () => assert.strictEqual(qp.apps.appItems, 3));
  t('空格切到应用面板：应用面板可见、键位面板隐藏', () => {
    assert.strictEqual(qp.apps.appsHidden, false);
    assert.strictEqual(qp.apps.keysHidden, true);
  });
  t('空格切到应用面板：模式标记变为「应用」', () => assert.strictEqual(qp.apps.modeChip, '应用'));
  t('再按空格返回动作面板', () => {
    assert.strictEqual(qp.back.keysHidden, false);
    assert.strictEqual(qp.back.appsHidden, true);
  });
  t('工具箱是独立入口，渲染工具网格', () => assert.ok(qp.tools.toolItems >= 4, 'toolItems=' + qp.tools.toolItems));
  t('未实现的工具显示明确状态（不放假按钮）', () => assert.strictEqual(qp.tools.todoItems, 1));
  t('输入拼音首字母后显示命令区', () => assert.strictEqual(qp.commandSectionHidden, false));
  t('命令结果渲染出 3 条', () => assert.strictEqual(qp.commandItems, 3));
  t('最近内容卡存在', () => assert.strictEqual(qp.hasSourceCard, true));
  t('放回条已显示（记录到目标窗口）', () => assert.strictEqual(qp.returnBarHidden, false));
  t('放回条显示目标进程与标题', () => {
    assert.ok(qp.returnTargetText.includes('WINWORD'), '实际: ' + qp.returnTargetText);
    assert.ok(qp.returnTargetText.includes('季度报告'), '实际: ' + qp.returnTargetText);
  });
  t('放回按钮存在', () => assert.strictEqual(qp.hasReturnCommit, true));

  console.log('\n== 配色与开关实现断言 ==');
  const css = fs.readFileSync(path.join(__dirname, 'src', 'styles.css'), 'utf8');
  t('浅色底：银白 #F4F6FA', () => assert.ok(/#f4f6fa/i.test(css)));
  t('深色底：冷石墨 #1E242D', () => assert.ok(/#1e242d/i.test(css)));
  t('强调色：雾蓝 #506F9E', () => assert.ok(/#506f9e/i.test(css)));
  t('强调色：冰蓝 #B7CBEA', () => assert.ok(/#b7cbea/i.test(css)));
  t('开关用 background-image 实现，不依赖伪元素', () => {
    assert.ok(/input\[type="checkbox"\]\s*\{[\s\S]*?background-image/.test(css));
    assert.ok(!/input\[type="checkbox"\]::after/.test(css), '不应依赖 ::after');
  });
} finally {
  for (const name of ['__fx_mock.js', '__fx_main.html', '__fx_overlay.html', '__fx_qp.html', '__fx_qp_mock.js']) {
    try { fs.rmSync(path.join(FIXTURES, name), { force: true }); } catch {}
  }
}

console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
process.exit(fail ? 1 : 0);

