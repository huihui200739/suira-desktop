'use strict';
const assert=require('node:assert/strict'),{performance}=require('node:perf_hooks'),{transformText,formatJson}=require('../lib/text-tools');
const source='这 是 一 段 中 文 。\r\n\r\n\r\nHello   world\r\n\r\n下一段';
assert.equal(transformText(source,'compact'),'这是一段中文。\nHello world\n下一段');
assert.equal(transformText('中文 English words 混排','cjk'),'中文 English words 混排');
assert.equal(transformText('Hello\nworld\n\n第二\n段','merge'),'Hello world\n\n第二段');
assert.equal(transformText('ß hello 中文','upper'),'SS HELLO 中文');
assert.equal(transformText('HELLO 中文','lower'),'hello 中文');
assert.throws(()=>transformText('text','unknown'));assert.throws(()=>transformText('x'.repeat(200001)));
// 旧断言 `source.includes('\r\n')` 检查的是字符串常量本身，永远为真，没有任何回归价值。
// 换成真正覆盖格式化与错误路径的行为断言。
assert.equal(formatJson('{}'),'{}');assert.equal(formatJson('[]'),'[]');
assert.equal(formatJson('[1,2,{"a":3}]'),'[\n  1,\n  2,\n  {\n    "a": 3\n  }\n]');
assert.equal(formatJson('{"id":9007199254740993}'),'{\n  "id": 9007199254740993\n}','格式化必须保留大整数原字面量');
assert.equal(transformText('A B','url.encode'),'A%20B');
assert.throws(()=>transformText('\ud800','url.encode'),/URL 编码失败：文字包含无效的 Unicode 字符/);
// mergeLines 曾在每轮用 result.slice(-1) 摊平整条 ConsString，4 万行文本退化成 O(n²)（约 1s+）。
const bigLines='a\nb\n'.repeat(20000),mergeStart=performance.now();
assert.equal(transformText(bigLines,'merge').length,79999);
assert.ok(performance.now()-mergeStart<200,'合并段落必须保持线性：'+bigLines.length+' 字符');
console.log('PASS explicit text conversion, CJK spacing, JSON formatting, big integer literals and Unicode error paths');
