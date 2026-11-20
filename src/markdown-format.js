'use strict';
// Markdown remains the persisted document. Only these inline presentation styles
// may survive rendering/pasting. Preview inserts approved local images after sanitization.
(() => {
 const sizes=new Set(['12px','14px','16px','18px','20px','24px','28px','32px']);
 const color=value=>/^(?:#[\da-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i.test(value)&&CSS.supports('color',value)?value:'';
 function safeHTML(html, { taskBoxes = false } = {}) {
  html=html.replace(/<img\b[^>]*\bsrc=[\"'](suira-image:\/\/[-\w]+)[\"'][^>]*>/gi,(_tag,url)=>'<a href="'+url+'">查看截图</a>');
  const fragment=DOMPurify.sanitize(html,{RETURN_DOM_FRAGMENT:true,ALLOWED_URI_REGEXP:/^(?:https?:\/\/|mailto:|#|suira-image:\/\/[-\w]+$)/i,USE_PROFILES:{html:true},FORBID_TAGS:['img','style','form','video','audio','iframe','svg','math'],FORBID_ATTR:['id','name'],ADD_URI_SAFE_ATTR:taskBoxes?['type']:[]});
  for (const input of fragment.querySelectorAll('input')) {
   if (!taskBoxes || input.type !== 'checkbox') { input.remove(); continue; }
   const checkbox = document.createElement('input');
   checkbox.type = 'checkbox';
   checkbox.disabled = true;
   checkbox.toggleAttribute('checked', input.checked);
   input.replaceWith(checkbox);
  }
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
 // Use the same tokens for the preview and source offsets so quoted headings,
 // fenced examples and multiline Setext titles cannot shift later outline links.
 function renderWithOutline(text, { localImages = false } = {}) {
  const options = { gfm: true, breaks: false };
  const tokens = window.marked.lexer(text, options);
  const indexes = new Map(), headings = [];
  let offset = 0;
  for (const token of tokens) {
   if (token.type === 'heading') {
    indexes.set(token, headings.length);
    headings.push({ level: token.depth, offset });
   }
   offset += token.raw.length;
  }
  const renderer = new window.marked.Renderer(options);
  const images = new Set();
  if (localImages && window.SuiraLocalImage) {
   const { localImageReference, maxLocalImageReferences } = window.SuiraLocalImage;
   renderer.image = function (token) {
    const url = token.href;
    if (!localImageReference(url)) return window.marked.Renderer.prototype.image.call(this, token);
    const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    if (!images.has(url) && images.size >= maxLocalImageReferences) return escape(token.text);
    images.add(url);
    return `<span data-md-local-image="${escape(url)}">${escape(token.text)}</span>`;
   };
  }
  renderer.heading = function (token) {
   const html = window.marked.Renderer.prototype.heading.call(this, token);
   const index = indexes.get(token);
   return index === undefined ? html : html.replace('>', ` data-md-heading="${index}">`);
  };
  return { html: safeHTML(window.marked.parser(tokens, { ...options, renderer }), { taskBoxes:true }), headings, images:[...images] };
 }
 window.SuiraMarkdown = { safeHTML, renderWithOutline };
})();
