'use strict';
const {captureTarget}=require('./return-target');
// 剪贴板的目标属于本次唤起，不能借用内容来源或上一次主窗口的返回记录。
function clipboardTarget(current, ownerPid, panelTarget=null) {
  if(current&&Number(current.pid)!==ownerPid)return captureTarget(current,{selectionMethod:'clipboard-current-window'});
  return panelTarget ? {...panelTarget,selectionMethod:'clipboard-panel-handoff'} : null;
}
function currentPasteTarget(current, ownerPid, sessionTarget, barActive) {
  if(current&&Number(current.pid)!==ownerPid)return clipboardTarget(current,ownerPid);
  return barActive&&current&&Number(current.pid)===ownerPid ? sessionTarget : null;
}
module.exports={clipboardTarget,currentPasteTarget};
