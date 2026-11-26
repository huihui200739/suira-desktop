'use strict';

const path = require('node:path');
const fsp = require('node:fs/promises');
const { fileURLToPath } = require('node:url');

const appRoot = path.resolve(__dirname, '..');

function pinFilePath(url) {
  if (typeof url !== 'string' || !url.startsWith('file:')) return null;
  try { return fileURLToPath(url); } catch { return null; }
}

function createPinWindows({
  windowIpc, BrowserWindow, screen, nativeImage, dialog, app, findImage, onClosed,
  prepareFloatingSurface, toastToUser, writeClipboardText, writeClipboardImage
}) {
  const pinWindows = new Set();
  const pinState = new WeakMap();

  // 每个钉图窗口的期望尺寸：透明窗在 Windows 上被拖动时可能被系统悄悄改大，
  // 移动/缩放后按这里记录的期望值核对，发现漂移立即拉回。
  const pinExpectedSize = new WeakMap();
  const PIN_COLLAPSED_HEIGHT = 60;

  function createPinWindow(dataUrl, size = {}, content = null) {
    const file = pinFilePath(dataUrl);
    if (!content && file) content = findImage(file);
    const display=screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const ratio=(size.height||600)/Math.max(1,size.width||800);
    const width=Math.max(100,Math.min(560,size.width||800,display.workArea.width-40,(display.workArea.height-60)/ratio));
    const height=Math.max(60,Math.round(width*ratio));
    const pin=windowIpc.create('pin',{
      // resizable 必须关：Windows 下 transparent + resizable 的无边框窗带 WS_THICKFRAME，
      // 程序化移动时系统会反复改写窗口尺寸，表现为「一拖就越来越大」。
      // 缩放一律走 zoom() → pin:resize 的 setBounds，不依赖原生边缘拖拽。
      width:Math.round(width),height,frame:false,alwaysOnTop:true,resizable:false,skipTaskbar:false,
      transparent:true,thickFrame:false,hasShadow:false,backgroundColor:'#00000000',title:'随序 · 钉图',
      webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,spellcheck:false,preload: path.join(appRoot, 'pin-preload.js')}
    });
    pin.__pinData={url:String(dataUrl||''),width:Math.round(width),height,kind:content?.kind||'image',text:content?.text||'',itemId:content?.id||''};
    pinExpectedSize.set(pin,{width:Math.round(width),height});
    prepareFloatingSurface(pin);
    pin.loadFile(path.join(appRoot, 'src', 'pin.html'));
    pinWindows.add(pin);
    pin.on('closed', () => {
      pinWindows.delete(pin);
      onClosed();
    });
    return pin;
  }

  function togglePinnedVisibility() {
    const windows = [...pinWindows].filter((win) => win && !win.isDestroyed());
    if (!windows.length) {
      toastToUser('还没有钉图窗口，先按 P 钉一张', 'warn');
      return { ok: false, error: '还没有钉图窗口' };
    }
    const visibleCount = windows.filter((win) => win.isVisible()).length;
    const shouldHide = visibleCount > 0;
    for (const win of windows) {
      if (shouldHide) win.hide();
      else win.showInactive();
    }
    toastToUser(shouldHide ? `已隐藏 ${windows.length} 张钉图` : `已恢复 ${windows.length} 张钉图`, 'info');
    return { ok: true, hidden: shouldHide, count: windows.length };
  }

  function referencedFiles() {
    return [...pinWindows].map(win => pinFilePath(win.__pinData?.url)).filter(Boolean);
  }

  function registerIpc() {
    const pinFromEvent = (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      return win && pinWindows.has(win) ? win : null;
    };

    const pinOnly = handler => async(event,payload)=>{
      const win=pinFromEvent(event);if(!win||win.isDestroyed())return {ok:false,error:'钉图已关闭'};
      try{return await handler(win,payload);}catch(error){return {ok:false,error:error.message};}
    };
    const pinImage = win => {
      const url=win.__pinData?.url||'';
      const image=url.startsWith('file:')?nativeImage.createFromPath(fileURLToPath(url)):nativeImage.createFromDataURL(url);
      if(image.isEmpty())throw Error('图片无法读取');return image;
    };
    windowIpc.handle('pin:data',pinOnly(win=>({ok:true,data:win.__pinData})));
    windowIpc.handle('pin:copy',pinOnly(async win=>{if(win.__pinData?.kind==='text')await writeClipboardText(win.__pinData.text);else await writeClipboardImage(pinImage(win));return {ok:true};}));
    windowIpc.handle('pin:save',pinOnly(async win=>{
      if(win.__pinData?.kind==='text'){
        const result=await dialog.showSaveDialog(win,{title:'保存文字',defaultPath:path.join(app.getPath('documents'),'随序文字.txt'),filters:[{name:'文字',extensions:['txt']}]});
        if(result.canceled||!result.filePath)return {ok:false,canceled:true};await fsp.writeFile(result.filePath,win.__pinData.text,'utf8');return {ok:true};
      }
      const image=pinImage(win);
      const result=await dialog.showSaveDialog(win,{title:'保存钉图',defaultPath:path.join(app.getPath('pictures'),'随序钉图.png'),filters:[{name:'PNG 图片',extensions:['png']}]});
      if(result.canceled||!result.filePath)return {ok:false,canceled:true};
      await fsp.writeFile(result.filePath,image.toPNG());return {ok:true,filePath:result.filePath};
    }));
    windowIpc.handle('pin:top',pinOnly(win=>{const value=!win.isAlwaysOnTop();win.setAlwaysOnTop(value);return {ok:true,alwaysOnTop:value};}));
    windowIpc.on('pin:move',(event,point)=>{
      const win=pinFromEvent(event);if(!win||win.isDestroyed()||![point?.x,point?.y].every(Number.isFinite))return;
      const x=Math.round(point.x),y=Math.round(point.y),area=screen.getDisplayNearestPoint({x,y}).workArea;
      const bounds=win.getBounds();
      win.setPosition(Math.max(area.x-bounds.width+40,Math.min(area.x+area.width-40,x)),Math.max(area.y,Math.min(area.y+area.height-40,y)));
      // 拖动后被系统改了尺寸（透明窗在部分环境下会这样）：立即按期望尺寸纠正
      const expected=pinExpectedSize.get(win);
      if(expected){
        const current=win.getBounds();
        if(current.width!==expected.width||current.height!==expected.height){
          win.setBounds({x:current.x,y:current.y,width:expected.width,height:expected.height});
        }
      }
    });

    windowIpc.on('pin:resize', (event, payload) => {
      const win = pinFromEvent(event);
      if (!win || win.isDestroyed()) return;
      if (pinState.get(win)?.collapsed) return;
      const width = Math.max(80, Math.min(4000, Math.round(Number(payload?.width) || 0)));
      const height = Math.max(60, Math.min(4000, Math.round(Number(payload?.height) || 0)));
      if (!width || !height) return;
      const bounds = win.getBounds();
      // 以左上角为锚点缩放，避免窗口跑到屏幕外
      win.setBounds({ x: bounds.x, y: bounds.y, width, height });
      pinExpectedSize.set(win, { width, height });
    });

    windowIpc.on('pin:opacity', (event, value) => {
      const win = pinFromEvent(event);
      if (!win || win.isDestroyed()) return;
      const opacity = Math.max(0.25, Math.min(1, Number(value) || 1));
      win.setOpacity(opacity);
    });

    windowIpc.on('pin:collapse', (event, collapsed) => {
      const win = pinFromEvent(event);
      if (!win || win.isDestroyed()) return;
      const state = pinState.get(win) || {};
      if (collapsed) {
        if (state.collapsed) return;
        state.savedBounds = win.getBounds();
        state.savedSize = pinExpectedSize.get(win) || { width: state.savedBounds.width, height: state.savedBounds.height };
        state.savedOpacity = win.getOpacity();
        state.collapsed = true;
        pinState.set(win, state);
        const b = state.savedBounds;
        // 收成一条细窄条，仍可见可点回
        const collapsedWidth = Math.max(72, Math.min(b.width, 120));
        win.setBounds({ x: b.x, y: b.y, width: collapsedWidth, height: PIN_COLLAPSED_HEIGHT });
        pinExpectedSize.set(win, { width: collapsedWidth, height: PIN_COLLAPSED_HEIGHT });
        win.setOpacity(0.85);
      } else {
        if (!state.collapsed) return;
        state.collapsed = false;
        pinState.set(win, state);
        if (state.savedBounds) {
          // 收起后的位置可以改变：展开时保留当前位置，只恢复原来的尺寸。
          const current = win.getBounds();
          const area = screen.getDisplayNearestPoint({ x: current.x, y: current.y }).workArea;
          const size = state.savedSize || state.savedBounds;
          win.setBounds({ width: size.width, height: size.height,
            x: Math.max(area.x, Math.min(current.x, area.x + area.width - size.width)),
            y: Math.max(area.y, Math.min(current.y, area.y + area.height - size.height)) });
          pinExpectedSize.set(win, { width: size.width, height: size.height });
        }
        win.setOpacity(state.savedOpacity || 1);
      }
    });

    windowIpc.handleSync('pin:bounds', (event) => {
      const win = pinFromEvent(event);
      return win && !win.isDestroyed() ? win.getBounds() : null;
    });

    windowIpc.on('pin:close', (event) => {
      const win = pinFromEvent(event);
      if (win && !win.isDestroyed()) win.close();
    });
  }

  return { create: createPinWindow, toggleVisibility: togglePinnedVisibility, referencedFiles, registerIpc };
}

module.exports = { createPinWindows };
