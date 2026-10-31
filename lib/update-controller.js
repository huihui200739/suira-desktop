'use strict';
const {EventEmitter}=require('node:events');
class UpdateController extends EventEmitter{
  constructor({version,supported,factory,beforeInstall=async()=>{}}){super();this.factory=factory;this.beforeInstall=beforeInstall;this.supported=supported;this.state={phase:'idle',current:version,version:'',percent:0,message:''};}
  snapshot(){return {...this.state};}
  set(patch){Object.assign(this.state,patch);this.emit('state',this.snapshot());return this.snapshot();}
  fail(error){const missing=/ERR_UPDATER_(NO_PUBLISHED_VERSIONS|LATEST_VERSION_NOT_FOUND|CHANNEL_FILE_NOT_FOUND)/.test(String(error?.code||error));return this.set({phase:'error',message:missing?'尚未发布可更新版本，请等待正式发布。':'更新失败，请检查网络后重试。',percent:0});}
  engine(){if(this.updater)return this.updater;const u=this.factory();this.updater=u;u.autoDownload=false;u.autoInstallOnAppQuit=false;u.allowDowngrade=false;u.allowPrerelease=false;
    u.on('update-available',info=>this.set({phase:'available',version:String(info.version),message:'发现新版本，可下载后重启安装。'}));
    u.on('update-not-available',()=>this.set({phase:'current',message:'当前已是最新正式版本。'}));
    u.on('download-progress',progress=>this.set({phase:'downloading',percent:Math.max(0,Math.min(100,Number(progress.percent)||0))}));
    u.on('update-downloaded',info=>this.set({phase:'ready',version:String(info.version),percent:100,message:'下载与校验完成，保存草稿后即可重启更新。'}));
    u.on('error',error=>this.fail(error));return u;
  }
  async check(){if(['checking','downloading','preparing','installing','ready'].includes(this.state.phase))return this.snapshot();if(!this.supported())return this.set({phase:'unsupported',message:'在线更新适用于 Windows 安装版；开发与便携模式请使用安装包。'});
    this.set({phase:'checking',message:'正在检查正式版本…',percent:0,version:''});try{await this.engine().checkForUpdates();}catch(error){this.fail(error);}return this.snapshot();}
  async download(){if(this.state.phase!=='available')return this.snapshot();this.set({phase:'downloading',message:'正在下载并校验更新…',percent:0});try{await this.engine().downloadUpdate();}catch(error){this.fail(error);}return this.snapshot();}
  async install(){if(this.state.phase!=='ready')return this.snapshot();this.set({phase:'preparing',message:'正在保存草稿…'});try{await this.beforeInstall();this.set({phase:'installing',message:'正在退出并安装更新…'});this.engine().quitAndInstall(true,true);}catch(error){this.set({phase:'ready',message:'草稿未能保存，已取消安装。请先保存文档后重试。'});}return this.snapshot();}
}
module.exports={UpdateController};
