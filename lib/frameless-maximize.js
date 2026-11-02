'use strict';
// Transparent Windows HWNDs do not implement Electron's native maximize path.
// Keep one explicit presentation state and normal bounds; use the work area,
// leaving the actual alpha surface intact instead of adding an opaque frame.
function installFramelessMaximize(win,screen){
  if(win.__framelessMaximize)return;win.__framelessMaximize=true;
  const native={maximize:win.maximize.bind(win),unmaximize:win.unmaximize.bind(win),isMaximized:win.isMaximized.bind(win),getNormalBounds:win.getNormalBounds.bind(win)};
  let normal=null;
  const area=()=>({...screen.getDisplayMatching(win.getBounds()).workArea});
  win.isMaximized=()=>Boolean(win.__customMaximized)||native.isMaximized();
  win.getNormalBounds=()=>win.__customMaximized?{...normal}:native.getNormalBounds();
  win.maximize=()=>{
    if(win.isDestroyed()||win.isMaximized())return;
    normal={...win.getBounds()};win.__customMaximized=true;win.__restorePhysicalSize=null;
    win.setBounds(area());win.emit('maximize');
  };
  win.unmaximize=()=>{
    if(!win.__customMaximized){native.unmaximize();return;}
    win.__customMaximized=false;if(normal)win.setBounds({...normal});win.emit('unmaximize');
  };
  const reflow=()=>{if(!win.isDestroyed()&&win.__customMaximized)win.setBounds(area());};
  screen.on('display-metrics-changed',reflow);screen.on('display-removed',reflow);
  win.on('will-move',(event)=>{
    if(!win.__customMaximized)return;
    event.preventDefault();const old=win.getBounds(),point=screen.getCursorScreenPoint();
    const ratio=Math.max(.1,Math.min(.9,(point.x-old.x)/old.width));
    win.unmaximize();win.setBounds({...normal,x:Math.round(point.x-normal.width*ratio),y:Math.round(point.y-20)});
  });
  win.once('closed',()=>{screen.removeListener('display-metrics-changed',reflow);screen.removeListener('display-removed',reflow);});
}
module.exports={installFramelessMaximize};
