'use strict';
// Local documents share the existing encrypted content store and retention rules.
const TYPES = new Set(['calendar','markdown']);
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const date = new Date(value+'T12:00:00');
  return !Number.isNaN(+date) && date.getFullYear() === +value.slice(0,4) && date.getMonth()+1 === +value.slice(5,7) && date.getDate() === +value.slice(8,10);
}
function createWorkspace(store) {
  const list = type => store.data.items.filter(item=>item.meta?.workspace===type).sort((a,b)=>b.updatedAt-a.updatedAt);
  function save(type, payload={}) {
    if (!TYPES.has(type)) throw Error('未知的工作台类型');
    const previous=payload.id ? store.getItem(String(payload.id)) : null;
    if (payload.id && previous?.meta?.workspace!==type) throw Error('内容不存在或类型不符');
    if (!previous && list(type).length>=1000) throw Error('已达到 1000 条上限，请先整理旧内容');
    const title=String(payload.title||'').trim().slice(0,120);
    if (!title) throw Error('请填写标题');
    const text=String(payload.text||'');
    if(text.length>200000) throw Error('正文不能超过 20 万字符');
    const meta={workspace:type};
    if (type === 'markdown' && previous?.meta?.recentHidden) meta.recentHidden = true;
    if(type==='markdown' && previous?.meta?.externalPath) for(const key of ['externalPath','externalHash','externalTextHash']) meta[key]=previous.meta[key];
    if(type==='calendar') {
      if(!validDate(payload.date)) throw Error('请选择有效日期');
      if(payload.time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(payload.time)) throw Error('时间格式应为 HH:mm');
      const category=['work','personal','study'].includes(payload.category)?payload.category:'work';
      Object.assign(meta,{date:payload.date,time:payload.time||'',done:Boolean(payload.done),category,priority:payload.priority==='high'?'high':'normal',location:String(payload.location||'').trim().slice(0,200)});
    }
    return store.addItem({...previous,kind:'text',title,text,pinned:true,source:{type:'user',acquisitionMethod:type,confidence:'certain'},meta});
  }
  function remove(type,id) {
    if(!TYPES.has(type)||store.getItem(id)?.meta?.workspace!==type) throw Error('内容不存在');
    return store.removeItem(id);
  }
  return {list,save,remove};
}
module.exports={createWorkspace,validDate};
