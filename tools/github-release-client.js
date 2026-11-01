'use strict';
// Maintainer-only helper; excluded from the Electron payload. Never print tokens.
const https=require('node:https'),fs=require('node:fs'),{spawnSync}=require('node:child_process');
const {HttpsProxyAgent}=require('https-proxy-agent');
function credential(){
  const supplied=process.env.UPDATE_RELEASE_TOKEN||process.env.GH_TOKEN;
  if(supplied)return supplied;
  const result=spawnSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'}});
  const password=result.stdout?.split(/\r?\n/).find(line=>line.startsWith('password='))?.slice(9);
  if(result.status!==0||!password)throw Error('GitHub credential unavailable; sign in to Git or set UPDATE_RELEASE_TOKEN for this process.');
  return password;
}
function client({anonymous=false}={}){
  const token=anonymous?'':credential(),proxy=process.env.HTTPS_PROXY||process.env.HTTP_PROXY;
  const agent=proxy?new HttpsProxyAgent(proxy):undefined;
  return async function request(method,endpoint,{body,file,allow404=false}={}){
    const url=new URL(endpoint.startsWith('https://')?endpoint:'https://api.github.com'+endpoint);
    if(!['api.github.com','uploads.github.com'].includes(url.hostname)||url.protocol!=='https:')throw Error('Unexpected GitHub API host');
    const data=body===undefined?null:Buffer.from(JSON.stringify(body));
    return new Promise((resolve,reject)=>{
      const headers={'User-Agent':'Suira-release-maintainer','Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
      if(token)headers.Authorization='Bearer '+token;
      if(file){headers['Content-Type']='application/octet-stream';headers['Content-Length']=fs.statSync(file).size;}
      else if(data){headers['Content-Type']='application/json';headers['Content-Length']=data.length;}
      const req=https.request(url,{method,agent,headers},res=>{
        let text='';res.setEncoding('utf8');res.on('data',chunk=>{text+=chunk;if(text.length>3000000)req.destroy(Error('Unexpected API response size'));});
        res.on('end',()=>{let value;try{value=text?JSON.parse(text):null;}catch{return reject(Error('GitHub API returned an invalid response'));}
          if(allow404&&res.statusCode===404)return resolve(null);
          if(res.statusCode<200||res.statusCode>=300)return reject(Error('GitHub API '+res.statusCode+': '+String(value?.message||'Request failed').replaceAll(token||'\0','[redacted]')));
          resolve(value);
        });
      });
      req.setTimeout(180000,()=>req.destroy(Error('GitHub API request timed out')));
      req.on('error',error=>reject(Error(String(error.message).replaceAll(token||'\0','[redacted]'))));
      if(file){const stream=fs.createReadStream(file);stream.on('error',error=>req.destroy(error));stream.pipe(req);}else req.end(data);
    });
  };
}
module.exports={client};
