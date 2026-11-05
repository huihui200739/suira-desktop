'use strict';
// First-party UI only. Vendor sources retain their upstream implementation.
const fs=require('node:fs'),path=require('node:path');
const allowed=new Set(['theme.css','tool-art.css']);
const literal=/(?<!&)#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*(?:[\d.+-]|(?:srgb|display-p3)\s+[\d.])/gi;
const colorNames='aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen';
const named=new RegExp('(?<![\\w-])(?:'+colorNames.split(' ').join('|')+')(?![\\w-])','gi');
function violations(source,file){
  // Keep line numbers while ignoring comments, URLs and escaped HTML entities.
  const text=source.replace(/\/\*[\s\S]*?\*\//g,m=>m.replace(/[^\n]/g,' ')).replace(/url\([^)]*\)/gi,m=>' '.repeat(m.length));
  const found=file.endsWith('.js')?[...text.matchAll(literal)].map(m=>({index:m.index,value:m[0]})):[];
  if(file.endsWith('.html'))for(const attribute of text.matchAll(/\b(?:fill|stroke|color)="([^"]*)"/gi)){
    for(const pattern of [literal,named])for(const m of attribute[1].matchAll(pattern))found.push({index:attribute.index+attribute[0].indexOf(attribute[1])+m.index,value:m[0]});
  }
  const styles=file.endsWith('.css')?[{text,offset:0}]:[...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>|\bstyle="([^"]*)"|\b(?:fill|stroke)="([^"]*)"/gi)].map(m=>{const value=m[1]??m[2]??m[3];return {text:value,offset:m.index+m[0].indexOf(value)};});
  for(const style of styles)for(const declaration of style.text.matchAll(/(?:^|[;{])\s*[\w-]+\s*:\s*([^;{}]+)/g)){
    const value=declaration[1].replace(/var\(\s*--[\w-]+\s*/g,m=>' '.repeat(m.length));
    const offset=style.offset+declaration.index+declaration[0].indexOf(declaration[1]);
    for(const pattern of [literal,named])for(const m of value.matchAll(pattern))found.push({index:offset+m.index,value:m[0]});
  }
  return found.map(m=>({file,line:1+text.slice(0,m.index).split('\n').length-1,value:m.value}));
}
function lint(root=path.resolve(__dirname,'../src')){
  const errors=[];
  function visit(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){
    if(item.name==='vendor')continue;
    const full=path.join(dir,item.name);
    if(item.isDirectory())visit(full);
    else if(/\.(css|html|js)$/.test(item.name)&&!allowed.has(item.name))errors.push(...violations(fs.readFileSync(full,'utf8'),path.relative(root,full)));
  }}visit(root);return errors;
}
if(require.main===module){const errors=lint();for(const e of errors)console.error(`${e.file}:${e.line} hardcoded colour ${e.value}`);if(errors.length)process.exitCode=1;else console.log('PASS authored UI uses shared colour tokens (theme and tool art own colour literals)');}
module.exports={lint,violations};
