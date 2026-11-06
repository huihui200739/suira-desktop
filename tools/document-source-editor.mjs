import {renderMenu,validURL,escape} from './document-menu.mjs';

// The source, split and preview views share the visual editor's command model.
// Source mutations stay in the native textarea undo history and never parse or
// reserialize the rest of a document (including extension syntax/frontmatter).
window.SuiraSourceDocument={create({element,preview,enabled,readOnly,activate,onChange,notify,readClipboard,capture}){
 let menu=null,saved=null,slash=null,composing=false;
 const selection=()=>({from:element.selectionStart,to:element.selectionEnd});
 const close=(focus=false)=>{menu?.remove();menu=null;slash=null;saved=null;if(focus&&!readOnly())element.focus();};
 const replace=(text,from,to)=>{
  activate();element.focus();element.setSelectionRange(from,to);
  const previous=element.value;
  if(!document.execCommand('insertText',false,text)){element.setRangeText(text,from,to,'end');onChange();}
  else if(element.value===previous)onChange();
 };
 function apply(command,value=''){
  const target=saved||selection(),range=slash||target;
  if(command==='capture'||command==='capture-text'){
   const before=element.value;close();capture(command==='capture-text'?'text':'image').then(result=>{if(result.canceled)return;if(!result.ok)throw Error(result.error||'截图失败');if(element.value!==before||!enabled())throw Error('截图期间文档发生变化，请重新插入');replace(command==='capture-text'?result.text:'![截图]('+result.url+')',range.from,range.to);}).catch(error=>notify(error.message));return;
  }
  if(command==='link'||command==='image'){openMenu(command);return;}
  if(command==='paste'){
   close();readClipboard().then(result=>{if(enabled())replace(result.text||'',range.from,range.to);}).catch(error=>notify(error.message));return;
  }
  activate();
  if(['undo','redo','copy','cut','selectAll'].includes(command)){
   element.focus();element.setSelectionRange(target.from,target.to);
   if(command==='selectAll')element.select();else document.execCommand(command);
   close();return;
  }
  const text=slash?'':element.value.slice(target.from,target.to);
  let output,from=range.from,to=range.to;
  const wraps={bold:['**','**'],italic:['*','*'],underline:['<u>','</u>'],strike:['~~','~~'],inlineCode:['`','`']};
  if(wraps[command])output=wraps[command][0]+text+wraps[command][1];
  else if(['color','highlight','size'].includes(command)){
   const property={color:'color',highlight:'background-color',size:'font-size'}[command];
   output=value?`<span style="${property}:${escape(value)}">${text}</span>`:text.replace(/<\/?span\b[^>]*>/gi,'');
  }else if(['paragraph','heading','list','ordered','task','quote'].includes(command)){
   from=element.value.lastIndexOf('\n',range.from-1)+1;const end=element.value.indexOf('\n',range.to);to=end<0?element.value.length:end;
   const selected=slash?element.value.slice(from,slash.from)+element.value.slice(slash.to,to):element.value.slice(from,to);
   const prefix={paragraph:'',heading:'#'.repeat(Number(value)||2)+' ',list:'- ',ordered:'1. ',task:'- [ ] ',quote:'> '}[command];
   output=selected.split('\n').map((line,i)=>(command==='ordered'?(i+1)+'. ':prefix)+line.replace(/^(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/,'')).join('\n');
  }else if(command==='code')output='\n```\n'+text+'\n```\n';
  else if(command==='table')output='\n| 列一 | 列二 | 列三 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n';
  else if(command==='rule')output='\n\n---\n\n';
  else if(command==='clear')output=text.replace(/<\/?(?:span|u)\b[^>]*>/gi,'').replace(/(\*\*|~~|`)/g,'');
  else return;
  close();replace(output,from,to);saved=null;
 }
 function openMenu(kind='main',anchor,coords,query=''){
  if(!enabled())return;
  if(!menu)saved=selection();const previous=menu?.getBoundingClientRect();menu?.remove();
  menu=document.createElement('div');menu.className='md-context-menu';menu.setAttribute('role',['link','image'].includes(kind)?'dialog':'menu');menu.setAttribute('aria-label','文档编辑菜单');
  menu.innerHTML=(kind==='insert'&&readOnly()?'<input class="md-command-query" type="search" aria-label="搜索插入内容" placeholder="搜索标题、表格、待办…"><div class="md-command-results">'+renderMenu(kind,query)+'</div>':renderMenu(kind,query));document.body.append(menu);
  const rect=anchor?.getBoundingClientRect()||element.getBoundingClientRect(),bounds=menu.getBoundingClientRect();
  const x=coords?.x??previous?.left??rect.left,y=coords?.y??previous?.top??rect.bottom;
  menu.style.left=Math.max(8,Math.min(x,innerWidth-bounds.width-8))+'px';menu.style.top=Math.max(8,Math.min(y,innerHeight-bounds.height-8))+'px';
  menu.onmousedown=e=>{if(!e.target.closest('input'))e.preventDefault();};
  menu.onclick=e=>{const sub=e.target.closest('[data-submenu]'),button=e.target.closest('[data-command]');if(sub){openMenu(sub.dataset.submenu);return;}if(button)apply(button.dataset.command,button.dataset.value);if(e.target.closest('[data-dismiss]'))close(true);};
  const input=menu.querySelector('.md-command-query');if(input){input.oninput=()=>menu.querySelector('.md-command-results').innerHTML=renderMenu('insert',input.value);input.focus();}
  const form=menu.querySelector('form');if(form){form.onsubmit=e=>{e.preventDefault();const url=form.querySelector('input').value.trim();if(!/^https?:\/\//i.test(url)||!validURL(url)){notify('请输入有效的 http / https 地址');return;}const range=slash||saved,label=slash?'':element.value.slice(saved.from,saved.to),output=(kind==='image'?'!':'')+'['+(label|| (kind==='image'?'图片':'链接')).replace(/\]/g,'\\]')+']('+url+')';close();replace(output,range.from,range.to);};form.querySelector('input').focus();}
 }
 function updateSlash(){
  if(!enabled()||readOnly()||composing||element.selectionStart!==element.selectionEnd)return;
  const end=element.selectionStart,line=element.value.slice(element.value.lastIndexOf('\n',end-1)+1,end),match=line.match(/(?:^|\s)\/([^\s/]{0,32})$/);
  const fences=element.value.slice(0,end).split('\n');let fence='';for(const line of fences){const token=line.match(/^\s{0,3}(`{3,}|~{3,})/);if(token){if(!fence)fence=token[1][0];else if(token[1][0]===fence)fence='';}}
  if(!match||fence){if(slash)close();return;}
  // Native textarea does not expose caret bounds. A short-lived mirror gives
  // the real wrapped-line position without changing focus, selection or scroll.
  const style=getComputedStyle(element),mirror=document.createElement('div');mirror.style.cssText=style.cssText;
  for(const key of ['font','lineHeight','padding','border','boxSizing','letterSpacing','tabSize'])mirror.style[key]=style[key];
  const r=element.getBoundingClientRect();Object.assign(mirror.style,{position:'fixed',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:'auto',visibility:'hidden',whiteSpace:'pre-wrap',overflowWrap:'break-word'});
  mirror.textContent=element.value.slice(0,end);const caret=document.createElement('span');caret.textContent='\u200b';mirror.append(caret);document.body.append(mirror);const c=caret.getBoundingClientRect();mirror.remove();
  openMenu('insert',null,{x:c.left,y:c.bottom-element.scrollTop+4},match[1]);slash={from:end-match[1].length-1,to:end};saved=selection();
 }
 const input=()=>{if(!composing)updateSlash();};
 const context=e=>{if(!enabled()||composing)return;e.preventDefault();if(readOnly()){const text=window.getSelection()?.toString();if(text){const index=element.value.indexOf(text);if(index>=0)element.setSelectionRange(index,index+text.length);}}openMenu('main',null,{x:e.clientX,y:e.clientY});};
 const key=e=>{
  if(!enabled()||e.isComposing||composing)return;
  if(menu&&(menu.contains(e.target)||e.target===element)){
   const buttons=[...menu.querySelectorAll('button:not(:disabled)')];
   if(e.key==='Escape'){e.preventDefault();close(true);return;}
   if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)&&!e.target.closest('form')){e.preventDefault();let i=buttons.indexOf(document.activeElement);i=e.key==='Home'?0:e.key==='End'?buttons.length-1:e.key==='ArrowDown'?(i+1)%buttons.length:(i-1+buttons.length)%buttons.length;buttons[i]?.focus();return;}
   if(e.key==='Enter'&&!e.target.closest('form')){const focused=buttons.find(b=>b===document.activeElement);if(focused||slash||e.target.matches('.md-command-query')){e.preventDefault();(focused||buttons[0])?.click();return;}}
   if(e.key==='Tab')close();
  }
  if(readOnly()&&e.key==='/'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.target.closest('input,textarea,[contenteditable],.md-context-menu')){e.preventDefault();openMenu('insert',null,{x:preview.getBoundingClientRect().left+32,y:preview.getBoundingClientRect().top+48});}
  if(e.target===element&&(e.ctrlKey||e.metaKey)&&['b','i','k'].includes(e.key.toLowerCase())){e.preventDefault();saved=selection();apply({b:'bold',i:'italic',k:'link'}[e.key.toLowerCase()]);}
 };
 const outside=e=>{if(!menu?.contains(e.target)&&!e.target.closest('[data-document-menu],[data-rich-format]'))close();};
 element.addEventListener('input',input);element.addEventListener('compositionstart',()=>{composing=true;close();});element.addEventListener('compositionend',()=>{composing=false;updateSlash();});element.addEventListener('contextmenu',context);preview.addEventListener('contextmenu',context);
 document.addEventListener('keydown',key);document.addEventListener('pointerdown',outside);window.addEventListener('resize',()=>close());element.addEventListener('scroll',()=>close());
 return {apply,openMenu,close};
}};
