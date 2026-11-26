'use strict';
/**
 * Pure-logic Markdown slide splitter (MiaoYan-style `---` presentation mode)
 * and CJK/Latin reading-time estimator.
 * Works in both browser (`window.SuiraSlides`) and Node tests (`module.exports`).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SuiraSlides = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const THEMATIC_BREAK = /^[ \t]{0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
  const SETEXT_DASH = /^[ \t]{0,3}-+[ \t]*$/;
  const NON_PARAGRAPH_START = /^[ \t]{0,3}(?:#{1,6}(?:[ \t]|$)|>|[-*+][ \t]|\d{1,9}[.)][ \t]|`{3,}|~{3,}|\|)/;
  const GFM_TABLE_BREAK = /^[ \t]{0,3}(?:#{1,6}(?:[ \t]|$)|>|[-*+][ \t]|\d{1,9}[.)][ \t]|`{3,}|~{3,})/;
  const GFM_DELIM_CELL = /^[ \t]*:?-{1,}:?[ \t]*$/;

  function splitGfmRow(line) {
    let trimmed = String(line || '').trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
    if (trimmed.endsWith('|')) {
      let slashes = 0;
      for (let k = trimmed.length - 2; k >= 0 && trimmed[k] === '\\'; k -= 1) slashes += 1;
      if (slashes % 2 === 0) trimmed = trimmed.slice(0, -1);
    }
    const cells = [];
    let current = '';
    for (let i = 0; i < trimmed.length; i += 1) {
      if (trimmed[i] === '\\' && trimmed[i + 1] === '|') {
        current += '|';
        i += 1;
        continue;
      }
      if (trimmed[i] === '|') {
        cells.push(current);
        current = '';
        continue;
      }
      current += trimmed[i];
    }
    cells.push(current);
    return cells;
  }

  function isGfmTableDelimiter(line) {
    if (!line || (!line.includes('|') && !line.includes(':'))) return false;
    const cells = splitGfmRow(line);
    return cells.length >= 1 && cells.every((cell) => GFM_DELIM_CELL.test(cell));
  }

  function isGfmTableHeader(line) {
    if (!line || !line.trim()) return false;
    if (THEMATIC_BREAK.test(line) || GFM_TABLE_BREAK.test(line)) return false;
    return splitGfmRow(line).length >= 1;
  }

  function isYamlFrontmatter(block) {
    const lines = block.split('\n');
    if (!lines.length || !lines[0].trim() || /^#/.test(lines[0].trim())) return false;
    let hasKey = false;
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (/^[A-Za-z0-9_.-]+[ \t]*:(?:[ \t]+.*|[ \t]*)$/.test(rawLine)) { hasKey = true; continue; }
      if (/^(?:[ \t]+|-[ \t])/.test(rawLine)) continue;
      return false;
    }
    return hasKey;
  }

  function isInsideGfmTable(lines, idx) {
    if (idx < 0) return false;
    for (let j = idx; j >= 0 && lines[j].trim().length > 0; j -= 1) {
      if (isGfmTableDelimiter(lines[j])) {
        if (
          j > 0 &&
          isGfmTableHeader(lines[j - 1]) &&
          splitGfmRow(lines[j - 1]).length === splitGfmRow(lines[j]).length
        ) {
          return true;
        }
      }
      if (THEMATIC_BREAK.test(lines[j]) || GFM_TABLE_BREAK.test(lines[j])) {
        return false;
      }
    }
    return false;
  }

  function extractSlideTitle(markdown, fallback) {
    const lines = markdown.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      const atx = trimmed.match(/^#{1,6}\s+(.+?)(?:\s+#+\s*)?$/);
      if (atx) return atx[1].replace(/[*_`~[\]]/g, '').trim().slice(0, 48) || fallback;
      if (i + 1 < lines.length && /^[ \t]{0,3}(?:=+|-+)[ \t]*$/.test(lines[i + 1])) {
        return trimmed.replace(/[*_`~[\]]/g, '').trim().slice(0, 48) || fallback;
      }
      const plain = trimmed.replace(/^>\s*/, '').replace(/^[-*+]\s+(?:\[[ xX]\]\s+)?/, '').replace(/[*_`~]/g, '').trim();
      if (plain) return plain.slice(0, 48);
    }
    return fallback;
  }

  function splitSlides(text, documentTitle = '') {
    let source = String(text ?? '').replace(/\r\n?/g, '\n');
    let frontmatter = '';
    let frontmatterTitle = '';
    const fm = source.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
    if (fm && isYamlFrontmatter(fm[1])) {
      frontmatter = fm[1];
      const titleMatch = frontmatter.match(/^[ \t]*title\s*:\s*(.+?)[ \t]*$/m);
      if (titleMatch) frontmatterTitle = titleMatch[1].replace(/^["']|["']$/g, '').trim();
      source = source.slice(fm[0].length);
    }

    const lines = source.split('\n');
    const chunks = [];
    let current = [];
    let fenceChar = '';
    let fenceLen = 0;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (fenceChar) {
        current.push(line);
        if (new RegExp(`^[ \\t]{0,3}${fenceChar}{${fenceLen},}[ \\t]*$`).test(line)) {
          fenceChar = '';
          fenceLen = 0;
        }
        continue;
      }
      const openFence = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
      if (openFence) {
        fenceChar = openFence[1][0];
        fenceLen = openFence[1].length;
        current.push(line);
        continue;
      }

      if (THEMATIC_BREAK.test(line)) {
        // CommonMark rule: `Title\n---` directly after a paragraph line is a Setext H2, NOT a slide divider.
        // GFM tables, lists, headings, blockquotes, and blank lines are NOT paragraphs.
        const prev = i > 0 ? lines[i - 1] : '';
        const isSetextH2 = SETEXT_DASH.test(line)
          && prev.trim().length > 0
          && !THEMATIC_BREAK.test(prev)
          && !NON_PARAGRAPH_START.test(prev)
          && !isInsideGfmTable(lines, i - 1);
        if (!isSetextH2) {
          const joined = current.join('\n').trim();
          if (joined) chunks.push(joined);
          current = [];
          continue;
        }
      }
      current.push(line);
    }

    const tail = current.join('\n').trim();
    if (tail) chunks.push(tail);

    const fallbackTitle = frontmatterTitle || String(documentTitle || '').trim() || '空白页';
    if (!chunks.length) {
      return {
        frontmatter,
        slides: [{ index: 0, markdown: '', title: fallbackTitle }]
      };
    }

    return {
      frontmatter,
      slides: chunks.map((markdown, index) => ({
        index,
        markdown,
        title: extractSlideTitle(markdown, index === 0 ? fallbackTitle : `第 ${index + 1} 页`)
      }))
    };
  }

  function readingMinutes(text) {
    const clean = String(text || '').replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`~[\]()!-]/g, ' ');
    const cjkCount = (clean.match(/[\u3400-\u9fff\u3040-\u30ff]/g) || []).length;
    const latinWords = (clean.replace(/[\u3400-\u9fff\u3040-\u30ff]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
    if (!cjkCount && !latinWords) return 0;
    return Math.max(1, Math.ceil(cjkCount / 400 + latinWords / 220));
  }

  return { splitSlides, readingMinutes };
});
