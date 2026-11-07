'use strict';
// Local calendar dates; never use UTC conversion for a user's spoken date.
const dateKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function number(s){if(/^\d+$/.test(s))return +s;const n={零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};if(s==='十')return 10;if(s.includes('十')){const [a,b]=s.split('十');return (a?n[a]:1)*10+(b?n[b]:0);}return n[s];}
function parseDate(text,now=new Date()){
  text=String(text||'');
  // now 可能来自持久化的 ISO 之外的数字字符串（如 '1700000000000'），
  // new Date('1700000000000') 是 Invalid Date，会让日期识别无声失败。
  if(typeof now==='string'&&/^\d+$/.test(now))now=Number(now);
  now=new Date(now);if(!Number.isFinite(+now))return null;
  let date=new Date(now.getFullYear(),now.getMonth(),now.getDate()),match,phrase='';
  const absolute=/(?:(\d{4})[年\/-])?(\d{1,2})[月\/-](\d{1,2})(?:日|号)?/.exec(text);
  if(absolute){const [,year,m,d]=absolute;let y=year?+year:now.getFullYear();date=new Date(y,+m-1,+d);if(date.getMonth()!==+m-1||date.getDate()!==+d)return null;if(!year&&date<new Date(now.getFullYear(),now.getMonth(),now.getDate()))date=new Date(++y,+m-1,+d);if(date.getMonth()!==+m-1||date.getDate()!==+d)return null;phrase=absolute[0];}
  else if((match=/(大后天|后天|明天|今天)/.exec(text))){date.setDate(date.getDate()+{今天:0,明天:1,后天:2,大后天:3}[match[0]]);phrase=match[0];}
  else if((match=/(下下|下|本|这)?(?:周|星期|礼拜)([一二三四五六日天])/.exec(text))){const target='一二三四五六日'.indexOf(match[2]==='天'?'日':match[2]),today=(date.getDay()+6)%7;let delta=target-today;if(match[1]==='下')delta+=7;else if(match[1]==='下下')delta+=14;else if(!match[1]&&delta<0)delta+=7;date.setDate(date.getDate()+delta);phrase=match[0];}
  else return null;
  let time='',timePhrase='',warning='';
  const clock=/(上午|早上|凌晨|中午|下午|晚上|晚间)?\s*([\d零〇一二两三四五六七八九十]{1,3})(?:[:：]([0-9]{1,2})|[点时](?:([\d零〇一二两三四五六七八九十]{1,3})分?|([半整]))?)/.exec(text);
  if(clock){let hour=number(clock[2]),minute=clock[3]!==undefined?+clock[3]:clock[4]?number(clock[4]):clock[5]==='半'?30:0;const period=clock[1];if(!Number.isFinite(hour)||!Number.isFinite(minute)||hour>23||minute>59)return null;if(period){if(hour>12)return null;if(['下午','晚上','晚间'].includes(period)&&hour<12)hour+=12;if(period==='中午'&&hour<11)hour+=12;if(['凌晨','上午','早上'].includes(period)&&hour===12)hour=0;}time=String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0');timePhrase=clock[0];if(!period&&hour>0&&hour<12)warning='未说明上午或下午，请核对时间。';}
  const title=text.replace(phrase,'').replace(timePhrase,'').replace(/^[\s，,。:：;；-]+|[\s，,。:：;；-]+$/g,'').slice(0,120)||'新日程';
  return {title,text,date:dateKey(date),time,category:'work',priority:'normal',location:'',draft:true,recognized:true,matched:[phrase,timePhrase].filter(Boolean).join(' '),warning};
}
function calendarDraft(text,now=new Date()){return parseDate(text,now)||{title:String(text||'').trim().slice(0,120)||'新日程',text:String(text||''),date:dateKey(new Date(now)),time:'',category:'work',priority:'normal',location:'',draft:true,recognized:false,warning:'没有识别到明确日期，请选择日期后保存。'};}
module.exports={parseDate,calendarDraft,dateKey};
