'use strict';
const {mergeLines,cleanText}=require('./actions');
const OPERATION_LABELS={clean:'清理多余空白',cjk:'去除中文之间的空格',compact:'紧凑段落与中文间距',merge:'合并段内换行',upper:'转换为大写',lower:'转换为小写',json:'JSON 格式化',simplified:'转为简体',traditional:'转为繁体',halfwidth:'转为半角',fullwidth:'转为全角',links:'提取链接',emails:'提取邮箱',phones:'提取电话','lines.unique':'按行去重','lines.sort':'按行排序','lines.unique-sort':'按行去重并排序','base64.encode':'Base64 编码','base64.decode':'Base64 解码','url.encode':'URL 编码','url.decode':'URL 解码'};
const OPERATIONS=new Set(Object.keys(OPERATION_LABELS));
const unique=values=>[...new Set(values)],converters={};
// Format original tokens so large integer digits are preserved.
function formatJson(text){
 try{JSON.parse(text);}catch{throw Error('JSON 格式无效，请检查引号、逗号和括号');}
 const tokens=text.match(/"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]/g)||[];
 let depth=0,output='';const line=()=>{output=output.trimEnd()+'\n'+'  '.repeat(depth);};
 tokens.forEach((token,i)=>{if(token==='{'||token==='['){output+=token;if(tokens[i+1]!== (token==='{'?'}':']')){if(depth>=128)throw Error('JSON 嵌套层数过多');depth++;line();}}
 else if(token==='}'||token===']'){if(tokens[i-1]!== (token==='}'?'{':'[')){depth--;line();}output+=token;}
 else if(token===','){output+=token;line();}else if(token===':')output+=': ';else output+=token;});return output;
}
function extractLinks(text){return unique((text.match(/https?:\/\/[^\s<>"'\u3000-\u303f\uff00-\uff65]+/gi)||[]).map(value=>value.replace(/[.,;!?)\]}]+$/g,'')).filter(value=>{try{return ['http:','https:'].includes(new URL(value).protocol);}catch{return false;}}));}
function convertText(text,operation='clean'){
 if(typeof text!=='string'||text.length>200000)throw Error('文字不能超过 20 万字符');
 if(!OPERATIONS.has(operation))throw Error('未知转换方式');
 if(operation==='json')return formatJson(text);
 if(operation==='simplified'||operation==='traditional'){converters[operation]??=require('opencc-js').Converter(operation==='simplified'?{from:'tw',to:'cn'}:{from:'cn',to:'tw'});return converters[operation](text);}
 if(operation==='halfwidth')return text.replace(/[\uff01-\uff5e]/g,char=>String.fromCharCode(char.charCodeAt(0)-0xfee0)).replace(/\u3000/g,' ');
 if(operation==='fullwidth')return text.replace(/[!-~]/g,char=>String.fromCharCode(char.charCodeAt(0)+0xfee0)).replace(/ /g,'\u3000');
 if(operation==='links')return extractLinks(text).join('\n');
 if(operation==='emails')return unique(text.match(/(?<![A-Z0-9.!#$%&'*+/=?^_`{|}~-])[A-Z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?){1,10}(?![A-Z0-9-])/gi)||[]).join('\n');
 if(operation==='phones')return unique((text.match(/(?<![\w])(?:\+?86[ -]?)?1[3-9]\d{9}(?!\d)|(?<![\w])(?:\+\d{1,3}[ -]?)?\(?\d{2,4}\)?[ -]\d{3,4}[ -]\d{4}(?!\d)|(?<![\w])\+\d{1,3}[ -]\d{7,12}(?!\d)|(?<![\w])\(?\d{2,4}\)?[- ]?\d{7,8}(?!\d)|(?<![\w])\+?\d{7,15}(?![\w])/g)||[]).map(v=>v.trim()).filter(v=>{const count=v.replace(/\D/g,'').length;return count>=7&&count<=15&&!/^(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(v)&&!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(v);})).join('\n');
 if(operation.startsWith('lines.')){let lines=text.replace(/\r\n?/g,'\n').split('\n');if(operation.includes('unique'))lines=unique(lines);if(operation.includes('sort'))lines.sort(new Intl.Collator('zh-CN',{numeric:true}).compare);return lines.join('\n');}
 if(operation==='base64.encode')return Buffer.from(text,'utf8').toString('base64');
 if(operation==='base64.decode'){const value=text.replace(/\s/g,'');if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw Error('Base64 格式无效');try{return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(value,'base64'));}catch{throw Error('解码内容不是有效的 UTF-8 文字');}}
 if(operation==='url.encode')return encodeURIComponent(text);
 if(operation==='url.decode'){try{return decodeURIComponent(text);}catch{throw Error('URL 编码无效，请检查百分号与 UTF-8 编码');}}
 if(operation==='merge')return mergeLines(text);
 if(operation==='upper')return text.toUpperCase();
 if(operation==='lower')return text.toLowerCase();
 let output=cleanText(text.replace(/\u00a0/g,' '));
 if(operation==='cjk'||operation==='compact')output=output.replace(/(?<=[\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff，。！？；：、])/gu,'').replace(/(?<=[，。！？；：、])[ \t]+(?=[\u3400-\u9fff])/gu,'');
 if(operation==='compact')output=output.replace(/\n[ \t]*\n+/g,'\n');
 return output;
}
function transformText(text,operation='clean'){const output=convertText(text,operation);if(output.length>200000)throw Error('转换结果超过 20 万字符，请缩短原文后重试');return output;}
module.exports={transformText,OPERATIONS,OPERATION_LABELS,extractLinks,formatJson};
