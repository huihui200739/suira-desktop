'use strict';
// Original scalable objects; no external assets, fonts or network requests.
(() => {
  const objects = {
  "translate": "<span class=\"suira-art translation\" aria-hidden=\"true\"><span class=\"card-back\"><b>中</b></span><span class=\"card-front\"><b>A</b></span></span>",
  "capture": "<span class=\"suira-art capture\" aria-hidden=\"true\"><span class=\"camera\"></span><span class=\"photo\"><span class=\"sun\"></span><span class=\"mountain\"></span></span><span class=\"bracket tl\"></span><span class=\"bracket tr\"></span><span class=\"bracket bl\"></span><span class=\"bracket br\"></span></span>",
  "calendar": "<span class=\"suira-art calendar\" aria-hidden=\"true\"><span class=\"calendar-page\"><span class=\"binding\"></span><span class=\"date\">1</span></span><span class=\"ring left\"></span><span class=\"ring right\"></span></span>",
  "markdown": "<span class=\"suira-art markdown\" aria-hidden=\"true\"><span class=\"cover\"></span><span class=\"paper\"></span><span class=\"fold\"></span><span class=\"md\">MD</span><span class=\"rule\"></span></span>",
  "desktop": "<span class=\"suira-art desktop\" aria-hidden=\"true\"><span class=\"stem\"></span><span class=\"stand\"></span><span class=\"monitor\"><span class=\"screen\"></span></span><span class=\"window-back\"></span><span class=\"window-front\"></span></span>"
};
  const object=(kind,body)=>'<span class="suira-art '+kind+'" aria-hidden="true">'+body+'</span>';
  const sheet='<span class="sheet"><span class="paper-lines"></span></span>';
  const pencil='<span class="pencil"><span class="pencil-tip"></span><span class="pencil-band"></span></span>';
  const tray='<span class="tray-back"></span><span class="tray-folder"></span><span class="tray-front"></span>';
  Object.assign(objects,{
    'long-capture':object('scroll',sheet+'<span class="scroll-top"></span><span class="scroll-bottom"></span><span class="scroll-arrow"></span>'),
    annotate:object('annotation',sheet+pencil),
    'capture-translate':object('capture-translation','<span class="translation-frame"></span><span class="translation-letter">A</span>'),
    'edit-image':objects.capture.replace('suira-art capture','suira-art capture image-edit').replace(/<\/span>$/,pencil+'</span>'),
    ocr:object('recognition',sheet+'<span class="scan-corner tl"></span><span class="scan-corner tr"></span><span class="scan-corner bl"></span><span class="scan-corner br"></span><span class="scan-beam"></span>'),
    pin:object('pinned',sheet+'<span class="pin-needle"></span><span class="pin-head"></span><span class="pin-top"></span>'),
    clipboard:object('clipboard-object','<span class="board"></span>'+sheet+'<span class="clip"><span class="clip-hole"></span></span>'),
    'text-clean':object('text-object',sheet+'<span class="eraser"></span><span class="clean-check"></span>'),
    lock:object('lock-object','<span class="shackle"></span><span class="lock-body"><span class="keyhole"></span></span>'),
    note:object('note-object',sheet+'<span class="note-fold"></span><span class="note-ink"></span>'),
    island:object('tray-object',tray+'<span class="tray-arrow"></span>'),
    shelf:object('tray-object organizer',tray+'<span class="folder-tab"></span>'),
    library:object('books','<span class="book first"></span><span class="book second"></span><span class="book third"></span>'),
    settings:object('gear-object','<span class="gear"><span class="gear-inset"><span class="gear-hole"></span></span></span>'),
    folder:object('folder-object','<span class="folder-back"></span><span class="folder-paper"></span><span class="folder-front"></span>'),
    file:object('file-object',sheet+'<span class="file-fold"></span>'),
    url:object('web-object','<span class="globe"><span class="meridian"></span><span class="equator"></span></span><span class="globe-base"></span>'),
    app:object('app-object','<span class="app-base"><span class="app-square a"></span><span class="app-square b"></span><span class="app-square c"></span><span class="app-square d"></span></span>')
  });
  // The desktop action is a fan of collapsing windows, rather than a monitor.
  objects.desktop=object('desktop window-deck','<span class="deck-window back"></span><span class="deck-window middle"></span><span class="deck-window front"><span class="deck-pane"></span></span><span class="deck-base"></span>');
  const families={
    capture:'blue','capture-translate':'blue','long-capture':'blue',ocr:'jade',pin:'blue',
    clipboard:'amber',note:'amber',markdown:'amber',folder:'amber',
    translate:'jade',calendar:'orange',
    'edit-image':'blue',desktop:'slate',lock:'iris',
    annotate:'blue','text-clean':'jade',island:'blue',shelf:'amber',library:'iris',settings:'slate',
    url:'blue',file:'blue',app:'iris'
  };
  const api = {
    has: id => Object.prototype.hasOwnProperty.call(objects,id),
    render(id) {
      let markup=objects[id] || '';
      if(!markup)return '';
      if(id==='calendar')markup=markup.replace('class="date">1<','class="date">'+new Date().getDate()+'<');
      // Keep every object inside one colored body, with neutral UI around it.
      const split=markup.indexOf('>')+1;
      return markup.slice(0,split).replace('suira-art ','suira-art vivid family-'+families[id]+' ')+'<span class="art-object">'+markup.slice(split,-7)+'</span></span>';
    },
    mount(root=document) {
      root.querySelectorAll('[data-tool-object]').forEach(node=>{
        if(node.dataset.artMounted===node.dataset.toolObject)return;
        const markup=api.render(node.dataset.toolObject);if(!markup)return;
        node.innerHTML=markup;node.dataset.artMounted=node.dataset.toolObject;
      });
    }
  };
  if(typeof module==='object' && module.exports) module.exports=api;
  if(typeof window==='object') {
    window.SuiraToolArt=api;
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>api.mount(),{once:true});
    else api.mount();
  }
})();
