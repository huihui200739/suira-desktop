'use strict';
const a=require('node:assert/strict'),t=require('../lib/translate');
(async()=>{const config={provider:'openai',apiKey:'test-key',baseUrl:'https://provider.example/v1'};let url;
 const r=await t.listModels(config,async(u,options)=>{url=u;a.equal(options.headers.Authorization,'Bearer test-key');return {ok:true,json:async()=>({data:[{id:'deepseek-v4.1-flash'},{id:'deepseek-v4.1-flash'},{id:17}]})};});
 a.equal(url,'https://provider.example/v1/models');a.deepEqual(r.models,['deepseek-v4.1-flash']);a.equal(t.matchModel('deepseek-v4.1 flash',r.models),'deepseek-v4.1-flash');a.equal(t.matchModel('unknown model',r.models),'unknown model');
 a.equal((await t.listModels(config,async()=>({ok:false,status:401,json:async()=>({})}))).ok,false);
 a.match((await t.listModels(config,async()=>({ok:true,json:async()=>{throw Error('HTML');}}))).error,/网页/);
 console.log('PASS model discovery, exact provider ID matching, authentication and non-JSON error paths');
})().catch(e=>{console.error(e);process.exitCode=1;});
