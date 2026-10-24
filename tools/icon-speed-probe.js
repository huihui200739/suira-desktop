'use strict';
const {connect}=require('./runtime-client');
(async()=>{const root=await connect(9318,t=>t.url.endsWith('/island.html'));let panel;
try{await root.evaluate('window.suira.quick.show()');await new Promise(r=>setTimeout(r,400));panel=await connect(9318,t=>t.url.endsWith('/quickpanel.html'));
console.log(JSON.stringify(await panel.evaluate(`(async()=>{const apps=await window.suira.apps.list(),out=[];for(const page of [0,1,0,2]){const paths=apps.slice(page*28,(page+1)*28).map(a=>a.filePath),start=performance.now();const result=await window.suira.apps.icons(paths);out.push({page:page+1,ms:Math.round(performance.now()-start),icons:Object.values(result).filter(Boolean).length});}return out;})()`)));
}finally{await root.evaluate('window.suira.quick.hide()').catch(()=>{});root.ws.close();panel?.ws.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
