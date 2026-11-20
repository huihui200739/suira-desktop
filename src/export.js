'use strict';
window.renderExport = async ({title,text}) => {
  document.title=title;
  const content=document.getElementById('export-content');
  content.innerHTML=SuiraMarkdown.safeHTML(marked.parse(text,{gfm:true}), {taskBoxes:true});
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const computed=getComputedStyle(document.documentElement);
  const tokens=['ink','paper-raised','paper-soft','line','line-strong','ink-soft','accent','font-ui'];
  const exportedTheme=':root{'+tokens.map(name=>'--'+name+':'+computed.getPropertyValue('--'+name).trim()+';').join('')+'}';
  const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escape(title)}</title><style>${exportedTheme}${document.getElementById('export-style').textContent}</style></head><body><article>${content.innerHTML}</article></body></html>`;
  await document.fonts.ready;return html;
};
