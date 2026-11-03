import {Editor} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {Markdown} from '@tiptap/markdown';
import {TableKit} from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import {TextStyle,Color,BackgroundColor,FontSize} from '@tiptap/extension-text-style';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';

// Standard Markdown has no color/size syntax. These optional styles serialize
// as inert, allowlisted inline HTML so reopening/exporting keeps the formatting.
const StyledText=TextStyle.extend({
 renderMarkdown(node,helpers){
  const attrs=node.attrs||{},style=[];
  if(attrs.color)style.push('color:'+attrs.color);
  if(attrs.backgroundColor)style.push('background-color:'+attrs.backgroundColor);
  if(attrs.fontSize)style.push('font-size:'+attrs.fontSize);
  const content=helpers.renderChildren(node);
  return style.length?`<span style="${style.join(';').replaceAll('"','&quot;')}">${content}</span>`:content;
 },
});
// Imported image references remain editable/exportable without silently loading
// remote resources. The user can open the reference explicitly.
const ReferencedImage=Image.extend({
 renderHTML({node}){return ['span',{'data-image-reference':node.attrs.src,class:'md-image-reference'},node.attrs.alt||'图片'];},
 addNodeView(){return ({node})=>{const dom=document.createElement('span');dom.className='md-image-reference';dom.contentEditable='false';dom.textContent='图片 · '+(node.attrs.alt||node.attrs.src||'未命名');dom.title=node.attrs.src||'';if(validURL(node.attrs.src||'')){const button=document.createElement('button');button.type='button';button.textContent='打开引用';button.onclick=event=>{event.preventDefault();window.suira.workspace.openLink(node.attrs.src);};dom.append(button);}return {dom};};},
});
const colors=[['默认',''],['石墨','#242a32'],['灰色','#5b6472'],['红色','#b93836'],['橙色','#a85812'],['绿色','#237345'],['蓝色','#1c65b5'],['紫色','#7852ab']];
const highlights=[['无',''],['浅黄','#fff0ad'],['浅绿','#d8efdf'],['浅蓝','#dbeaff'],['浅紫','#eadffc'],['浅红','#f8dedd']];
const validURL=value=>/^(?:https?:\/\/|mailto:|#)/i.test(value.trim());
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={bold:'<b>B</b>',italic:'<i>I</i>',underline:'<u>U</u>',code:'&lt;/&gt;',link:'链接',color:'A',style:'正文⌄'};

window.SuiraRichDocument={create({element,onChange,onSelection,notify,openLink,readClipboard}){
 let editor,menu,bubble,savedSelection,slashRange=null,menuKind='',suppress=false,compositionPending=false,disposed=false;
 const closeMenu=(restore=false)=>{if(menu)menu.remove();menu=null;menuKind='';slashRange=null;if(restore)editor.commands.focus();};
 const hideBubble=()=>{if(bubble)bubble.hidden=true;};
 const position=(node,x,y,above=false)=>{const r=node.getBoundingClientRect();node.style.left=Math.max(8,Math.min(x,innerWidth-r.width-8))+'px';node.style.top=Math.max(8,Math.min(above?y-r.height-8:y,innerHeight-r.height-8))+'px';};
 const selection=()=>({from:editor.state.selection.from,to:editor.state.selection.to});
 const prepare=()=>{let chain=editor.chain().focus();if(savedSelection)chain=chain.setTextSelection(savedSelection);if(slashRange)chain=chain.deleteRange(slashRange);return chain;};
 const emit=()=>{
  if(suppress||disposed)return;
  if(editor.view.composing){compositionPending=true;return;}
  const text=editor.getMarkdown();
  if(text.length>200000){suppress=true;editor.commands.undo();suppress=false;notify('正文不能超过 20 万字符');return;}
  onChange(text);onSelection?.();
 };
 function apply(command,value){
  const chain=prepare();let result;
  switch(command){
   case 'bold':result=chain.toggleBold().run();break;
   case 'italic':result=chain.toggleItalic().run();break;
   case 'underline':result=chain.toggleUnderline().run();break;
   case 'strike':result=chain.toggleStrike().run();break;
   case 'inlineCode':result=chain.toggleCode().run();break;
   case 'heading':result=chain.setHeading({level:Number(value)||2}).run();break;
   case 'paragraph':result=chain.setParagraph().run();break;
   case 'list':result=chain.toggleBulletList().run();break;
   case 'ordered':result=chain.toggleOrderedList().run();break;
   case 'task':result=chain.toggleTaskList().run();break;
   case 'quote':result=chain.toggleBlockquote().run();break;
   case 'code':result=chain.toggleCodeBlock().run();break;
   case 'table':result=chain.insertTable({rows:3,cols:3,withHeaderRow:true}).run();break;
   case 'rule':result=chain.setHorizontalRule().run();break;
   case 'color':result=(value?chain.setColor(value):chain.unsetColor()).run();break;
   case 'highlight':result=(value?chain.setBackgroundColor(value):chain.unsetBackgroundColor()).run();break;
   case 'size':result=(value?chain.setFontSize(value):chain.unsetFontSize()).run();break;
   case 'clear':result=chain.unsetAllMarks().clearNodes().run();break;
   case 'undo':result=editor.commands.undo();break;
   case 'redo':result=editor.commands.redo();break;
   case 'selectAll':result=chain.selectAll().run();break;
   case 'addRow':result=chain.addRowAfter().run();break;
   case 'addColumn':result=chain.addColumnAfter().run();break;
   case 'deleteRow':result=chain.deleteRow().run();break;
   case 'deleteColumn':result=chain.deleteColumn().run();break;
   case 'deleteTable':result=chain.deleteTable().run();break;
   case 'unlink':result=chain.unsetLink().run();break;
   case 'link':case 'image':openMenu(command);return;
   case 'copy':case 'cut':{
    prepare().run();const copied=document.execCommand('copy');if(copied&&command==='cut')editor.commands.deleteSelection();if(!copied)notify('请使用 Ctrl+C 复制选中的内容');result=copied;break;
   }
   case 'paste':{
    const target=savedSelection||selection();closeMenu();readClipboard().then(value=>{if(disposed)return;editor.chain().focus().setTextSelection(target).insertContent(value.text||'',{contentType:'markdown'}).run();}).catch(error=>notify(error.message));return;
   }
   default:return;
  }
  closeMenu();hideBubble();savedSelection=null;return result;
 }
 const button=(label,command,value='',hint='')=>`<button type="button" role="menuitem" data-command="${command}" data-value="${escape(value)}"><span>${label}</span>${hint?'<small>'+hint+'</small>':''}</button>`;
 function renderMenu(kind,query=''){
  if(kind==='style')return '<div class="md-menu-label">文本样式</div>'+button('正文','paragraph')+[1,2,3,4,5,6].map(n=>button(n+' 级标题','heading',n)).join('');
  if(kind==='size')return '<div class="md-menu-label">字号</div>'+button('自动','size')+[12,14,16,18,20,24,28,32].map(n=>button(n+' px','size',n+'px')).join('');
  if(kind==='color'||kind==='highlight')return '<div class="md-menu-label">'+(kind==='color'?'文字颜色':'文字高亮')+'</div><div class="md-color-grid">'+(kind==='color'?colors:highlights).map(([label,color])=>`<button type="button" role="menuitem" data-command="${kind}" data-value="${color}" aria-label="${label}"><span class="md-swatch" style="background:${color||'transparent'}"></span>${label}</button>`).join('')+'</div>';
  if(kind==='link'||kind==='image')return `<form class="md-link-form"><label>${kind==='image'?'插入图片引用':'插入 / 修改链接'}<input aria-label="${kind==='image'?'图片地址':'链接地址'}" type="url" placeholder="https://" value="${kind==='link'?escape(editor.getAttributes('link').href||''):''}" required></label><p>支持 http / https 地址</p><div><button type="button" data-dismiss>取消</button><button type="submit">插入</button></div></form>`;
  if(kind==='insert'){
   const entries=[['正文','paragraph','','text zhengwen'],['一级标题','heading','1','h1 biaoti'],['二级标题','heading','2','h2 biaoti'],['三级标题','heading','3','h3 biaoti'],['无序列表','list','','bullet liebiao'],['有序列表','ordered','','number liebiao'],['待办清单','task','','todo daiban'],['引用','quote','','blockquote yinyong'],['代码块','code','','code daima'],['表格','table','','table biaoge'],['分割线','rule','','divider fenge'],['链接','link','','link lianjie'],['图片引用','image','','image tupian']].filter(([label,,,aliases])=>!query||(label+' '+aliases).toLowerCase().includes(query.toLowerCase()));
   return '<div class="md-menu-label">插入内容'+(query?' · '+escape(query):'')+'</div>'+entries.map(([label,command,value])=>button(label,command,value)).join('')+(entries.length?'':'<p class="md-menu-empty">没有匹配的内容</p>');
  }
  return '<div class="md-menu-label">编辑文档</div><div class="md-menu-format">'+button('<b>加粗</b>','bold')+button('<i>斜体</i>','italic')+button('<u>下划线</u>','underline')+'</div>'+button('撤销','undo','','Ctrl Z')+button('重做','redo','','Ctrl Shift Z')+'<hr>'+button('复制','copy','','Ctrl C')+button('剪切','cut','','Ctrl X')+button('粘贴','paste','','Ctrl V')+'<hr>'+['style','color','highlight','size','insert'].map((k,i)=>`<button type="button" role="menuitem" data-submenu="${k}"><span>${['正文与标题','文字颜色','文字高亮','字号','插入内容'][i]}</span><small>›</small></button>`).join('')+button('清除格式','clear')+(editor.isActive('link')?button('移除链接','unlink'):'')+(editor.isActive('table')?'<hr>'+button('下方插入行','addRow')+button('右侧插入列','addColumn')+button('删除当前行','deleteRow')+button('删除当前列','deleteColumn')+button('删除表格','deleteTable'):'')+'<hr>'+button('全选','selectAll','','Ctrl A');
 }
 function openMenu(kind='main',anchor,coords,query=''){
  const old=menu?.getBoundingClientRect();if(!menu)savedSelection=selection();
  if(menu)menu.remove();hideBubble();menuKind=kind;
  menu=document.createElement('div');menu.className='md-context-menu';menu.setAttribute('role',kind==='link'||kind==='image'?'dialog':'menu');menu.setAttribute('aria-label','文档编辑菜单');menu.innerHTML=renderMenu(kind,query);document.body.append(menu);
  const rect=anchor?.getBoundingClientRect(),caret=editor.view.coordsAtPos(editor.state.selection.from);position(menu,coords?.x??rect?.left??old?.left??caret.left,coords?.y??rect?.bottom??old?.top??caret.bottom+4);
  menu.addEventListener('mousedown',e=>{if(!e.target.closest('input'))e.preventDefault();});
  menu.addEventListener('click',e=>{const sub=e.target.closest('[data-submenu]');if(sub){openMenu(sub.dataset.submenu);menu.querySelector('button')?.focus();return;}const b=e.target.closest('[data-command]');if(b)apply(b.dataset.command,b.dataset.value);if(e.target.closest('[data-dismiss]'))closeMenu(true);});
  const form=menu.querySelector('form');if(form){form.onsubmit=e=>{e.preventDefault();const value=form.querySelector('input').value.trim();if(!/^https?:\/\//i.test(value)||!validURL(value)){notify('请输入有效的 http / https 地址');return;}const chain=prepare();if(kind==='link')chain.setLink({href:value}).run();else chain.setImage({src:value,alt:'图片'}).run();closeMenu();};form.querySelector('input').focus();}
 }
 function updateBubble(){
  if(!editor||menu||editor.view.composing||!editor.isFocused||editor.state.selection.empty||!element.getClientRects().length){hideBubble();return;}
  if(!bubble){bubble=document.createElement('div');bubble.className='md-selection-tools';bubble.setAttribute('role','toolbar');bubble.setAttribute('aria-label','选中文字格式');bubble.innerHTML=Object.entries(icons).map(([key,icon])=>`<button type="button" data-format="${key}" aria-label="${{bold:'加粗',italic:'斜体',underline:'下划线',code:'行内代码',link:'插入链接',color:'文字颜色',style:'正文与标题'}[key]}">${icon}</button>`).join('');document.body.append(bubble);bubble.onmousedown=e=>e.preventDefault();bubble.onclick=e=>{const b=e.target.closest('[data-format]');if(!b)return;savedSelection=selection();const key=b.dataset.format;if(['style','color'].includes(key))openMenu(key,b);else apply(key==='code'?'inlineCode':key);};}
  bubble.hidden=false;for(const b of bubble.querySelectorAll('[data-format]'))b.setAttribute('aria-pressed',String(editor.isActive(b.dataset.format)));
  const {from,to}=editor.state.selection,a=editor.view.coordsAtPos(from),b=editor.view.coordsAtPos(to);position(bubble,(a.left+b.right)/2-bubble.offsetWidth/2,Math.min(a.top,b.top),true);
 }
 function updateSlash(){
  if(!editor||editor.view.composing||!editor.state.selection.empty)return;
  const {$from}=editor.state.selection,match=$from.parent.isTextblock&&$from.parent.textBetween(0,$from.parentOffset,'','').match(/^\/([^\s/]{0,20})$/);
  if(!match){if(slashRange)closeMenu();return;}
  const range={from:$from.start(),to:$from.pos};openMenu('insert',undefined,undefined,match[1]);slashRange=range;savedSelection=selection();
 }
 const popupKeys=e=>{if(!menu)return false;const buttons=[...menu.querySelectorAll('button:not(:disabled)')];if(e.key==='Escape'){e.preventDefault();closeMenu(true);return true;}if(e.key==='Tab'){closeMenu();return false;}if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();let i=buttons.indexOf(document.activeElement);i=e.key==='Home'?0:e.key==='End'?buttons.length-1:e.key==='ArrowDown'?(i+1)%buttons.length:(i-1+buttons.length)%buttons.length;buttons[i]?.focus();return true;}if(e.key==='Enter'&&slashRange&&!menu.contains(document.activeElement)){e.preventDefault();buttons[0]?.click();return true;}return false;};
 editor=new Editor({element,extensions:[StarterKit.configure({link:{openOnClick:false,autolink:true,protocols:['http','https','mailto'],isAllowedUri:uri=>validURL(uri)}}),Markdown.configure({markedOptions:{gfm:true}}),TableKit.configure({table:{resizable:false}}),TaskList,TaskItem.configure({nested:true}),StyledText,Color,BackgroundColor,FontSize,ReferencedImage.configure({allowBase64:false}),Placeholder.configure({placeholder:'写下想法，输入 / 插入内容…'})],content:'',contentType:'markdown',
  editorProps:{attributes:{class:'md-write-content',role:'textbox','aria-label':'可视化文档正文','aria-multiline':'true'},transformPastedHTML:html=>window.SuiraMarkdown.safeHTML(html),
   handleKeyDown(_view,event){if(event.isComposing)return false;return popupKeys(event);},
   handleDOMEvents:{contextmenu(view,event){if(view.composing)return false;event.preventDefault();if(view.state.selection.empty){const hit=view.posAtCoords({left:event.clientX,top:event.clientY});if(hit)editor.commands.setTextSelection(hit.pos);}savedSelection=selection();openMenu('main',undefined,{x:event.clientX,y:event.clientY});return true;},click(_view,event){const a=event.target.closest('a');if(a){event.preventDefault();if(validURL(a.getAttribute('href')||''))openLink(a.getAttribute('href'));return true;}return false;},compositionend(){if(compositionPending){compositionPending=false;setTimeout(emit,0);}return false;}},
  },onUpdate(){emit();updateSlash();},onSelectionUpdate(){onSelection?.();updateBubble();},onBlur(){setTimeout(()=>{if(!menu)hideBubble();},0);},onFocus(){updateBubble();}});
 const outside=e=>{if(!menu?.contains(e.target)&&!bubble?.contains(e.target)&&!e.target.closest('[data-document-menu]'))closeMenu();};
 const reposition=()=>{hideBubble();closeMenu();};
 const key=e=>{if(!editor.view.dom.contains(e.target)&&menu?.contains(e.target))popupKeys(e);};
 document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);window.addEventListener('resize',reposition);element.addEventListener('scroll',reposition);
 return {
  load(text){suppress=true;closeMenu();hideBubble();editor.chain().setContent(text,{contentType:'markdown',emitUpdate:false}).setTextSelection(1).setMeta('addToHistory',false).run();suppress=false;},
  async commit(){if(compositionPending){await new Promise(r=>setTimeout(r,0));if(!editor.view.composing){compositionPending=false;emit();}}},
  apply,openMenu,focus:()=>editor.commands.focus(),getMarkdown:()=>editor.getMarkdown(),getJSON:()=>editor.getJSON(),
  headings(){const list=[];editor.state.doc.descendants((node,pos)=>{if(node.type.name==='heading')list.push({level:node.attrs.level,text:node.textContent,pos});});return list;},
  jump(index){const h=this.headings()[index];if(h){editor.chain().focus().setTextSelection(h.pos+1).run();editor.view.nodeDOM(h.pos)?.scrollIntoView({block:'start'});}},
  selection:()=>selection(),setSelection:(from,to=from)=>editor.commands.setTextSelection({from,to}),
  destroy(){disposed=true;closeMenu();bubble?.remove();document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);window.removeEventListener('resize',reposition);element.removeEventListener('scroll',reposition);editor.destroy();},
 };
}};
