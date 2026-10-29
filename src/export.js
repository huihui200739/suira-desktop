'use strict';
window.renderExport = async ({title,text}) => {
  document.title=title;
  const content=document.getElementById('export-content');
  content.innerHTML=DOMPurify.sanitize(marked.parse(text,{gfm:true}),{USE_PROFILES:{html:true},FORBID_TAGS:['img','style','form','iframe','video','audio','input'],FORBID_ATTR:['style','id','name']});
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escape(title)}</title><style>${document.getElementById('export-style').textContent}</style></head><body><article>${content.innerHTML}</article></body></html>`;
  await document.fonts.ready;return html;
};
