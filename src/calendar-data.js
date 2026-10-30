'use strict';
// Calendar library is loaded only in the calendar renderer. Cache plain date
// labels, not the much larger Lunar/Solar object graphs.
window.CalendarData=(()=>{
 let loading;const cache=new Map();
 const ready=()=>loading||(loading=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='vendor/lunar.js';s.onload=resolve;s.onerror=()=>{loading=null;reject(Error('日历数据加载失败'));};document.head.append(s);}));
 function day(date){
  const key=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  if(cache.has(key))return cache.get(key);
  const solar=Solar.fromYmd(date.getFullYear(),date.getMonth()+1,date.getDate()),lunar=solar.getLunar();
  // Statutory work/rest flags are shown only for the verified 2026 schedule.
  // https://www.gov.cn/zhengce/content/202511/content_7047090.htm
  const holiday=date.getFullYear()===2026?HolidayUtil.getHoliday(date.getFullYear(),date.getMonth()+1,date.getDate()):null;
  const festivals=[...solar.getFestivals(),...lunar.getFestivals()];
  const info={key,lunar:lunar.getDayInChinese(),month:lunar.getMonthInChinese()+'月',term:lunar.getJieQi(),festival:holiday&&!holiday.isWork()?holiday.getName():festivals[0]||'',work:holiday?holiday.isWork():null};
  if(cache.size>=512)cache.delete(cache.keys().next().value);cache.set(key,info);return info;
 }
 function upcoming(date){const result=[];for(let i=0;i<90;i++){const d=new Date(date.getFullYear(),date.getMonth(),date.getDate()+i),v=day(d);if(v.term)result.push({title:v.term,date:v.key,kind:'term'});if(v.festival)result.push({title:v.festival,date:v.key,kind:'holiday'});}return result;}
 function week(date){const d=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()));d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));return Math.ceil((((d-new Date(Date.UTC(d.getUTCFullYear(),0,1)))/86400000)+1)/7);}
 return {ready,day,upcoming,week};
})();
