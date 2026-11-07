'use strict';
function calculate(source){
 const text=String(source).trim().replace(/[×]/g,'*').replace(/[÷]/g,'/').replace(/[−]/g,'-');
 if(!text||text.length>500)throw Error('表达式太长或为空');
 const tokens=text.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[()+*/%-]/gi)||[];
 if(tokens.join('')!==text.replace(/\s/g,'')||tokens.length>256)throw Error('只支持数字、括号和四则运算');
 let i=0,depth=0;
 function factor(){if(++depth>32)throw Error('括号层数过多');let value,token=tokens[i++];if(token==='+'||token==='-'){value=factor()*(token==='-'?-1:1);}else if(token==='('){value=expression();if(tokens[i++]!==')')throw Error('括号不匹配');}else if(token&&/^(?:\d|\.)/.test(token)){value=Number(token);if(/^\d+$/.test(token)&&!Number.isSafeInteger(value))throw Error('数字过大，超出精确计算范围');}else throw Error('表达式不完整');depth--;return value;}
 function product(){let value=factor();while(['*','/','%'].includes(tokens[i])){const op=tokens[i++],rhs=factor();if((op==='/'||op==='%')&&rhs===0)throw Error('不能除以零');value=op==='*'?value*rhs:op==='/'?value/rhs:value%rhs;}return value;}
 function expression(){let value=product();while(['+','-'].includes(tokens[i])){const op=tokens[i++],rhs=product();value=op==='+'?value+rhs:value-rhs;}return value;}
 const result=expression();if(i!==tokens.length||!Number.isFinite(result))throw Error('表达式无效或结果超出范围');if(Number.isInteger(result)&&!Number.isSafeInteger(result))throw Error('计算结果超出精确范围，请缩小数值');return Object.is(result,-0)?0:result;
}
// 12 位有效数字的截断只对小数有意义；整数一律原样输出，
// 否则 1234567890123 会被静默改成 1234567890120。
const formatNumber=value=>{if(!Number.isFinite(value))throw Error('数值超出范围');return Number.isInteger(value)&&Number.isSafeInteger(value)?String(value):String(Number(value.toPrecision(12)));};
const UNITS={};
function units(dimension,definitions){for(const [aliases,factor,offset=0] of definitions)for(const alias of aliases.split('|'))UNITS[alias]={dimension,factor,offset};}
units('length',[['m|米',1],['cm|厘米',.01],['mm|毫米',.001],['km|千米|公里',1000],['in|inch|英寸',.0254],['ft|foot|英尺',.3048],['yd|码',.9144],['mi|mile|英里',1609.344]]);
units('mass',[['kg|千克|公斤',1],['g|克',.001],['mg|毫克',.000001],['lb|lbs|磅',.45359237],['oz|盎司',.028349523125]]);
units('volume',[['l|L|升',1],['ml|mL|毫升',.001],['m3|m³|立方米',1000]]);
units('area',[['m2|m²|平方米',1],['cm2|cm²|平方厘米',.0001],['km2|km²|平方千米',1000000],['ha|公顷',10000],['亩',2000/3]]);
units('time',[['s|秒',1],['min|分钟',60],['h|小时',3600],['d|天',86400]]);
units('data',[['B|byte|字节',1],['KB|kB',1000],['MB',1000000],['GB',1000000000],['KiB',1024],['MiB',1048576],['GiB',1073741824]]);
units('speed',[['m/s|米/秒',1],['km/h|千米/小时',1/3.6],['mph',.44704]]);
units('temperature',[['C|℃|°C|摄氏度',1,273.15],['F|℉|°F|华氏度',5/9,255.3722222222222],['K|开尔文',1]]);
function parseConversion(query){const match=String(query).trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(\S+)\s+(?:to|in|转|换算|->|→|=)\s*(\S+)$/i);if(!match)return null;const amount=Number(match[1]);if(!Number.isFinite(amount))throw Error('数值超出范围');if(/^\d+$/.test(match[1])&&!Number.isSafeInteger(amount))throw Error('数值过大，超出精确换算范围');return {amount,from:match[2],to:match[3]};}
function unitConversion(query){const parsed=parseConversion(query);if(!parsed)return null;const lookup=name=>UNITS[name]||UNITS[Object.keys(UNITS).find(key=>key.toLowerCase()===name.toLowerCase())];const from=lookup(parsed.from),to=lookup(parsed.to);if(!from||!to)return null;if(from.dimension!==to.dimension)throw Error('这两个单位不能互相换算');const base=parsed.amount*from.factor+from.offset;if(from.dimension==='temperature'&&base< -1e-9)throw Error('温度不能低于绝对零度');return {...parsed,value:(base-to.offset)/to.factor};}
function searchCommand(query,{exchangeEnabled=false}={}){
 const source=String(query||'').trim();if(!source||source.length>20000)return null;
 const translate=source.match(/^fy\s+([\s\S]+)$/i);if(translate)return {type:'translate',text:translate[1],title:'翻译：'+translate[1].slice(0,80),subtitle:'Enter 打开翻译 · 执行后发送到翻译服务'};
 try{
  const converted=unitConversion(source);if(converted){if(!Number.isFinite(converted.value))throw Error('换算结果超出范围');return {type:'copy',value:formatNumber(converted.value),title:formatNumber(converted.value)+' '+converted.to,subtitle:source+' · Enter 复制结果'};}
  const currency=parseConversion(source.replace(/^(?:fx|汇率)\s+/i,''));if(currency&&/^[A-Za-z]{3}$/.test(currency.from)&&/^[A-Za-z]{3}$/.test(currency.to))return {...currency,from:currency.from.toUpperCase(),to:currency.to.toUpperCase(),type:exchangeEnabled?'currency':'disabled',title:exchangeEnabled?'查询汇率：'+source:'汇率换算默认关闭',subtitle:exchangeEnabled?'Enter 联网查询 Frankfurter 日参考汇率':'在设置中开启 · 只发送币种，不发送正文'};
  if(/^[\s\d.eE()+*/%×÷−-]+$/.test(source)&&/\d/.test(source)&&(/[()+*/%×÷−-]/.test(source)||source.includes('+'))){const value=formatNumber(calculate(source));return {type:'copy',value,title:value,subtitle:source+' · Enter 复制结果'};}
 }catch(error){return {type:'error',title:error.message,subtitle:'请调整表达式或单位后重试'};}
 return null;
}
function commandCandidate(query,options){const result=searchCommand(query,options);return result?{id:'search.command',kind:'command',title:result.title,subtitle:result.subtitle,action:result.type==='disabled'?'navigate:settings':result.type==='error'?'search-error':'search-execute',query:String(query)}:null;}
function createCurrencyService({fetchImpl=global.fetch,now=Date.now,timeout=8000}={}){
 const cache=new Map();return {async convert({amount,from,to},enabled){
  if(!enabled)return {ok:false,error:'汇率换算尚未开启'};
  if(!Number.isFinite(amount)||Math.abs(amount)>1e15||!(/^[A-Z]{3}$/.test(from)&&/^[A-Z]{3}$/.test(to)))return {ok:false,error:'币种或金额无效'};
  if(from===to)return {ok:true,text:formatNumber(amount)+' '+to,date:'',provider:'Frankfurter'};
  const key=from+to,stored=cache.get(key);let rate=stored&&now()-stored.at<3600000?stored:null;
  if(!rate){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);try{const response=await fetchImpl('https://api.frankfurter.dev/v2/rate/'+from+'/'+to,{signal:controller.signal,redirect:'error'});if(!response.ok)throw Error('rate');const value=await response.json();if(value.base!==from||value.quote!==to||!Number.isFinite(value.rate)||value.rate<=0||!/^\d{4}-\d{2}-\d{2}$/.test(value.date))throw Error('payload');rate={rate:value.rate,date:value.date,at:now()};if(cache.size>=100)cache.clear();cache.set(key,rate);}catch{return {ok:false,error:controller.signal.aborted?'汇率查询超时':'汇率暂不可用或不支持这个币种'};}finally{clearTimeout(timer);}}
  const value=amount*rate.rate;if(!Number.isFinite(value))return {ok:false,error:'换算结果超出范围'};return {ok:true,text:formatNumber(value)+' '+to,date:rate.date,provider:'Frankfurter'};
 }};
}
module.exports={calculate,unitConversion,searchCommand,commandCandidate,createCurrencyService,formatNumber};
