'use strict';
// Markdown remains the persisted document. Only these inline presentation styles
// may survive rendering/pasting; no arbitrary CSS, images or active HTML is used.
(() => {
 const sizes=new Set(['12px','14px','16px','18px','20px','24px','28px','32px']);
 const color=value=>/^(?:#[\da-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i.test(value)&&CSS.supports('color',value)?value:'';
 function safeHTML(html){
  html=html.replace(/<img\b[^>]*\bsrc=[\"'](suira-image:\/\/[-\w]+)[\"'][^>]*>/gi,(_tag,url)=>'<a href="'+url+'">查看截图</a>');
  const fragment=DOMPurify.sanitize(html,{RETURN_DOM_FRAGMENT:true,ALLOWED_URI_REGEXP:/^(?:https?:\/\/|mailto:|#|suira-image:\/\/[-\w]+$)/i,USE_PROFILES:{html:true},FORBID_TAGS:['img','style','form','video','audio','iframe','svg','math'],FORBID_ATTR:['id','name']});
  fragment.querySelectorAll('[style]').forEach(node=>{
   const declarations=[];
   if(node.tagName==='SPAN'){
    for(const key of ['color','background-color']){const value=color(node.style.getPropertyValue(key).trim());if(value)declarations.push(key+':'+value);}
    const size=node.style.fontSize;if(sizes.has(size))declarations.push('font-size:'+size);
   }
   node.removeAttribute('style');if(declarations.length)node.setAttribute('style',declarations.join(';'));
  });
  fragment.querySelectorAll('a').forEach(link=>{if(!/^(?:https?:\/\/|mailto:|#|suira-image:\/\/[-\w]+$)/i.test(link.getAttribute('href')||''))link.removeAttribute('href');link.removeAttribute('target');});
  const box=document.createElement('div');box.append(fragment);return box.innerHTML;
 }
 // Source offsets used by the outline; fenced code is deliberately excluded.
 function sourceHeadings(text){
  const result=[];let offset=0,fence=null,previous=null;
  for(const line of text.split('\n')){
   const start=offset;offset+=line.length+1;
   const marker=line.match(/^ {0,3}(`{3,}|~{3,})/);
   if(fence){if(marker&&marker[1][0]===fence.char&&marker[1].length>=fence.length&&line.slice(marker[0].length).trim()==='')fence=null;previous=null;continue;}
   if(marker){fence={char:marker[1][0],length:marker[1].length};previous=null;continue;}
   const atx=line.match(/^ {0,3}(#{1,6})(?:[\t ]+(.+?)|[\t ]*)$/);
   if(atx){result.push({level:atx[1].length,text:(atx[2]||'').replace(/[\t ]+#+[\t ]*$/,''),offset:start});previous=null;continue;}
   if(previous&&/^ {0,3}(?:=+|-+)\s*$/.test(line)){result.push({level:line.trim()[0]==='='?1:2,text:previous.text,offset:previous.offset});previous=null;continue;}
   previous=line.trim()&&!/^ {4}|^\t|^\s*[>|*-]\s/.test(line)?{text:line.trim(),offset:start}:null;
  }
  return result;
 }
 window.SuiraMarkdown={safeHTML,sourceHeadings};
})();
