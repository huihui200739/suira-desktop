'use strict';
const {connect}=require('./runtime-client');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const root=await connect(9318,t=>t.url.endsWith('/island.html'));let panel;try{
  await root.evaluate('window.suira.quick.show()');await wait(350);panel=await connect(9318,t=>t.url.endsWith('/quickpanel.html'));
  for(let i=0;i<40;i++){if(await panel.evaluate("document.querySelectorAll('.key').length===38"))break;await wait(100);}
  await panel.evaluate("document.getElementById('mode-apps').click()");await wait(1500);
  console.log(JSON.stringify(await panel.evaluate(`(async()=>{
    const results=[];for(const id of ['apps-next','apps-prev','apps-next']){
      const start=performance.now();document.getElementById(id).click();
      for(let i=0;i<100;i++){const images=Array.from(document.querySelectorAll('.app-icon img'));if(images.filter(x=>x.complete&&x.naturalWidth>0).length>=20)break;await new Promise(r=>setTimeout(r,16));}
      results.push({page:document.getElementById('apps-pager').textContent,ms:Math.round(performance.now()-start),icons:document.querySelectorAll('.app-icon img').length});
    }return results;
  })()`)));
}finally{await root.evaluate('window.suira.quick.hide()').catch(()=>{});root.ws.close();panel?.ws.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
