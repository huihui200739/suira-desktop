// Ported from MiaoYanCore/MarkdownEditing.swift (Tw93, MIT).
// Provenance and license: assets/licenses/miaoyan.txt.
const item = /^([ \t]*(?:>[ \t]*)*)([-*+]|\d{1,9}[.)])[ \t]+(\[[ xX]\](?:[ \t]+|$))?([\s\S]*)$/;
const quote = /^([ \t]*(?:>[ \t]*)*>[ \t]+)([\s\S]*)$/;
const rule = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const ordered = /^([ \t]*)(\d{1,9}[.)])([ \t]*)([\s\S]*)$/;
const blank = /^[\p{Zs}\t]*$/u;

function lineStart(text, offset) {
  if (offset <= 0) return 0;
  return Math.max(text.lastIndexOf('\n', offset - 1), text.lastIndexOf('\r', offset - 1)) + 1;
}

function lineEnd(text, offset) {
  while (offset < text.length && text[offset] !== '\r' && text[offset] !== '\n') offset++;
  return offset;
}

// Also recognize CommonMark tilde fences, matching indentation and longer
// closers. An unfinished fence stays code while the user is typing it.
export function inFencedCode(text, offset) {
  if (!text.includes('```') && !text.includes('~~~')) return false;
  const target = lineStart(text, offset);
  let fence = null;
  for (let start = 0; start <= target;) {
    const end = lineEnd(text, start);
    const line = text.slice(start, end);
    const token = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (start === target) return true;
      if (token && token[1][0] === fence[0] && token[1].length >= fence.length && /^[ \t]*$/.test(token[2])) fence = null;
    } else if (token && (token[1][0] === '~' || !token[2].includes('`'))) {
      fence = token[1];
    }
    if (end === text.length) break;
    start = end + (text.startsWith('\r\n', end) ? 2 : 1);
  }
  return Boolean(fence);
}

export function continueList(text, caret) {
  if (caret < 0 || caret > text.length || lineEnd(text, caret) !== caret) return null;
  const from = lineStart(text, caret);
  const line = text.slice(from, caret);
  const bullet = rule.test(line) ? null : item.exec(line);
  const quoted = bullet ? null : quote.exec(line);
  if ((!bullet && !quoted) || inFencedCode(text, caret)) return null;
  const content = bullet ? bullet[4] : quoted[2];
  if (blank.test(content)) return {from, to: caret, replacement: '', start: from, end: from};
  let prefix;
  if (bullet) {
    const [, indent, marker, task] = bullet;
    const next = marker.length === 1 ? marker : (Number(marker.slice(0, -1)) + 1) + marker.slice(-1);
    prefix = indent + next + ' ' + (task ? '[ ] ' : '');
  } else {
    prefix = quoted[1];
  }
  const replacement = (text.includes('\r\n') ? '\r\n' : '\n') + prefix;
  return {from: caret, to: caret, replacement, start: caret + replacement.length, end: caret + replacement.length};
}

function columns(whitespace, from = 0) {
  for (const char of whitespace) from += char === '\t' ? 4 - (from % 4) : 1;
  return from;
}

export function editLines(text, start, end, command) {
  const from = lineStart(text, start);
  const to = lineEnd(text, end > start && lineStart(text, end) === end ? end - (text.slice(end - 2, end) === '\r\n' ? 2 : 1) : end);
  let width = 2;
  if (from > 0 && command !== 'task') {
    const aboveEnd = from - (text.slice(from - 2, from) === '\r\n' ? 2 : 1);
    const above = ordered.exec(text.slice(lineStart(text, aboveEnd), aboveEnd));
    if (above) {
      const indent = columns(above[1]);
      const markerEnd = indent + above[2].length;
      const gap = columns(above[3], markerEnd) - markerEnd;
      const content = markerEnd + (above[4] && gap >= 1 && gap <= 4 ? gap : 1);
      const first = columns(/^[ \t]*/.exec(text.slice(from, to))[0]);
      if (command === 'indent' && first < content) width = content - first;
      if (command === 'outdent' && first > indent && first <= content) width = first - indent;
    }
  }
  const old = text.slice(from, to);
  const replacement = old.split(/(\r\n|\r|\n)/).map((line, index) => {
    if (index % 2 || !line) return line;
    if (command === 'indent') return ' '.repeat(width) + line;
    if (command === 'outdent') return line.startsWith('\t') ? line.slice(1) : line.slice(/^ */.exec(line.slice(0, width))[0].length);
    if (blank.test(line)) return line;
    const task = /^([ \t>]*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])/.exec(line);
    if (task) return task[1] + (task[2] === ' ' ? 'x' : ' ') + line.slice(task[0].length);
    const prefix = /^[ \t>]*(?:[-*+]|\d+[.)])[ \t]+/.exec(line);
    if (prefix) return prefix[0] + '[ ] ' + line.slice(prefix[0].length);
    const leading = /^[ \t>]*/.exec(line)[0];
    return leading + '- [ ] ' + line.slice(leading.length);
  }).join('');
  if (replacement === old) return null;
  const newEnd = from + replacement.length;
  const caret = Math.max(from, newEnd - (to - start));
  return {from, to, replacement, start: start === end ? caret : from, end: start === end ? caret : newEnd};
}
