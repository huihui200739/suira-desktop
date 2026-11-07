'use strict';
const assert=require('node:assert/strict'),{parseDate,calendarDraft}=require('../lib/date-parse');
const now=new Date(2026,10,6,10,20);
for(const [text,date,time,title] of [
 ['明天下午3点 开会','2026-11-07','15:00','开会'],['11月8日 14:30 复盘','2026-11-08','14:30','复盘'],['下周五提交报告','2026-11-13','','提交报告'],
 ['后天上午九点半看牙','2026-11-08','09:30','看牙'],['今天中午12点吃饭','2026-11-06','12:00','吃饭'],['明天凌晨零点提醒','2026-11-07','00:00','提醒'],
 ['12月31日23:59 倒数','2026-12-31','23:59','倒数'],['1月1日 元旦','2027-01-01','','元旦'],['2028年2月29日 闰日','2028-02-29','','闰日'],
 ['这周日休息','2026-11-08','','休息'],['下下周一出发','2026-11-16','','出发']
]){const draft=parseDate(text,now);assert.ok(draft,text);assert.equal(draft.date,date,text);assert.equal(draft.time,time,text);assert.equal(draft.title,title,text);assert.equal(draft.draft,true);}
for(const text of ['没有日期','11月31日','2026年2月29日','明天25点','明天14:80','明天下午15点'])assert.equal(parseDate(text,now),null,text);
assert.equal(parseDate('下周五',new Date(2026,10,8)).date,'2026-11-13','Sunday still uses the following Monday-based week');
assert.equal(parseDate('明天3点开会',now).warning.length>0,true);assert.equal(calendarDraft('未定时间的事',now).recognized,false);
assert.equal(calendarDraft('未定时间的事',now).date,'2026-11-06');assert.equal(parseDate('明天',new Date(NaN)),null);
assert.equal(parseDate('明天','1700000000000').date,'2023-11-16','数字字符串时间戳也要能作为基准时间');
assert.equal(parseDate('明天',1700000000000).date,'2023-11-16');
console.log('PASS Chinese relative/absolute dates, weekdays, Chinese times, numeric timestamps, rollover, invalid inputs and confirmation-only drafts');
