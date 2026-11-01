'use strict';
// Explicit maintainer commands. Publish only an allowlisted, checksum-verified
// installation bundle; never mirror the private source tree into the public repo.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const yaml=require('js-yaml'),{client}=require('./github-release-client');
const root=path.resolve(__dirname,'..'),pkg=require('../package.json'),version=pkg.version;
const owner='huihui200739',repo='suira-updates',base=`/repos/${owner}/${repo}`,tag='v'+version;
const checksum=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function target(api){const value=await api('GET',base);assert.equal(value.full_name,owner+'/'+repo);assert.equal(value.private,false,'Distribution repository must be public');return value;}
function bundle(){
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'docs',`release-${version}.json`))),dir=path.join(root,'dist'),name=`Suira-${version}-x64.exe`;
  assert.equal(pkg.build.publish[0].repo,repo);assert.equal(pkg.build.publish[0].owner,owner);assert.equal(manifest.version,version);assert.equal(manifest.artifact,name);
  const installer=path.join(dir,name);assert.equal(fs.statSync(installer).size,manifest.bytes);assert.equal(checksum(installer).toUpperCase(),manifest.sha256);
  const sha512=crypto.createHash('sha512').update(fs.readFileSync(installer)).digest('base64'),feed=yaml.load(fs.readFileSync(path.join(dir,'latest.yml'),'utf8'));
  assert.equal(feed.version,version);assert.equal(feed.path,name);assert.equal(feed.sha512,sha512);assert.equal(manifest.sha512,sha512);
  assert.deepEqual(feed.files.map(file=>file.url),[name]);assert.equal(feed.files[0].sha512,sha512);assert.equal(feed.files[0].size,manifest.bytes);
  const config=yaml.load(fs.readFileSync(path.join(dir,'win-unpacked','resources','app-update.yml'),'utf8'));
  assert.equal(config.repo,repo);assert.equal(config.owner,owner);assert.equal(config.provider,'github');
  const files=[name,name+'.blockmap','latest.yml'].map(name=>({name,file:path.join(dir,name)}));
  fs.writeFileSync(path.join(dir,'SHA256SUMS.txt'),files.map(({name,file})=>checksum(file)+'  '+name).join('\n')+'\n');
  files.push({name:'SHA256SUMS.txt',file:path.join(dir,'SHA256SUMS.txt')});
  return files.map(value=>({...value,size:fs.statSync(value.file).size,digest:'sha256:'+checksum(value.file)}));
}
async function release(api){const values=await api('GET',base+'/releases?per_page=100');return values.find(value=>value.tag_name===tag)||null;}
function verifyAssets(value,files){
  assert.equal(value.tag_name,tag);assert.equal(value.prerelease,false);
  assert.equal(value.assets.length,files.length,'Release has unexpected assets; do not publish');
  for(const file of files){const asset=value.assets.find(asset=>asset.name===file.name);assert.ok(asset,'Missing '+file.name);assert.equal(asset.state,'uploaded');assert.equal(asset.size,file.size);assert.equal(asset.digest,file.digest,'Upload checksum mismatch: '+file.name);}
}
async function main(){
  const mode=process.argv[2];if(!['--init','--draft','--publish'].includes(mode))throw Error('Use --init (public README), --draft (upload verified bundle), or --publish (make verified draft public).');
  const api=client();
  if(mode==='--init'){
    const user=await api('GET','/user');assert.equal(user.login,owner,'Unexpected publishing account');
    let value=await api('GET',base,{allow404:true});
    if(!value)value=await api('POST','/user/repos',{body:{name:repo,description:'随序 SUIRA · Windows 随手工作台｜官方安装包、在线更新与版本说明',private:false,has_projects:false,has_wiki:false,has_issues:true,auto_init:false}});
    await target(api);
    const content=fs.readFileSync(path.join(root,'docs','distribution','README.md'));
    const existing=await api('GET',base+'/contents/README.md',{allow404:true});
    if(existing)assert.equal(Buffer.from(existing.content,'base64').toString(),content.toString(),'Public README differs; review it before changing.');
    else await api('PUT',base+'/contents/README.md',{body:{message:'Introduce Suira downloads and in-app updates',content:content.toString('base64')}});
    console.log('Public distribution repository ready: https://github.com/'+owner+'/'+repo);return;
  }
  const repository=await target(api),files=bundle();let value=await release(api);
  if(mode==='--draft'){
    if(!value)value=await api('POST',base+'/releases',{body:{tag_name:tag,target_commitish:repository.default_branch,name:'随序 SUIRA '+version,body:fs.readFileSync(path.join(root,'docs','distribution',version+'.md'),'utf8'),draft:true,prerelease:false}});
    if(!value.draft){verifyAssets(value,files);console.log('Published release already matches bundle: '+value.html_url);return;}
    for(const file of files){
      let existing=value.assets.find(asset=>asset.name===file.name);
      if(existing&&existing.state==='starter'&&existing.size===0){await api('DELETE',base+'/releases/assets/'+existing.id);existing=null;}
      if(existing){assert.equal(existing.size,file.size);assert.equal(existing.digest,file.digest,'Existing draft asset differs; never overwrite it automatically');continue;}
      console.log('Uploading '+file.name+' ('+file.size+' bytes)');
      await api('POST',value.upload_url.replace(/\{.*$/,'')+'?name='+encodeURIComponent(file.name),{file:file.file});
    }
    value=await release(api);verifyAssets(value,files);console.log('Draft complete, all four asset digests verified: '+value.html_url);return;
  }
  assert.ok(value,'Create a verified draft first');verifyAssets(value,files);
  if(value.draft)value=await api('PATCH',base+'/releases/'+value.id,{body:{draft:false,prerelease:false,make_latest:'true'}});
  assert.equal(value.draft,false);console.log('Published '+value.html_url);
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={bundle,verifyAssets};
