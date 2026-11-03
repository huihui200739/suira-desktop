'use strict';
const {mergeLines,cleanText}=require('./actions');
const OPERATIONS=new Set(['clean','cjk','merge','compact','upper','lower']);
function transformText(text,operation='clean'){
 if(typeof text!=='string'||text.length>200000)throw Error('文字不能超过 20 万字符');
 if(!OPERATIONS.has(operation))throw Error('未知转换方式');
 if(operation==='merge')return mergeLines(text);
 if(operation==='upper')return text.toUpperCase();
 if(operation==='lower')return text.toLowerCase();
 let output=cleanText(text.replace(/\u00a0/g,' '));
 if(operation==='cjk'||operation==='compact')output=output.replace(/(?<=[\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff，。！？；：、])/gu,'').replace(/(?<=[，。！？；：、])[ \t]+(?=[\u3400-\u9fff])/gu,'');
 if(operation==='compact')output=output.replace(/\n[ \t]*\n+/g,'\n');
 return output;
}
module.exports={transformText,OPERATIONS};
