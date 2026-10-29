'use strict';
const escapeICS = value => String(value||'').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
function fold(line) {
  const result=[];let part='';
  for(const char of line){if(Buffer.byteLength(part+char)>74){result.push(part);part=' ';}part+=char;}
  result.push(part);return result.join('\r\n');
}
function calendarICS(events) {
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//SUIRA//Calendar//ZH','CALSCALE:GREGORIAN'];
  for(const event of events){
    const date=event.meta.date.replace(/-/g,'');
    lines.push('BEGIN:VEVENT',`UID:${escapeICS(event.id)}@suira.local`,`DTSTAMP:${new Date(event.updatedAt).toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z')}`);
    lines.push(event.meta.time?`DTSTART:${date}T${event.meta.time.replace(':','')}00`:`DTSTART;VALUE=DATE:${date}`,
      `SUMMARY:${escapeICS(event.title)}`,`DESCRIPTION:${escapeICS(event.text)}`,`LOCATION:${escapeICS(event.meta.location)}`,'END:VEVENT');
  }
  return [...lines,'END:VCALENDAR'].map(fold).join('\r\n')+'\r\n';
}
module.exports={calendarICS};
