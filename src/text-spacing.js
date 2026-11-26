(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SuiraTextSpacing = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  // Plain captured text only. Never apply this to Markdown source or stored originals.
  function compactCapture(text) {
    return String(text || '').replace(/\r\n?/g, '\n').replace(/[\u00a0\u3000]/g, ' ')
      .replace(/(?<=[\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff，。！？；：、])/gu, '')
      .replace(/(?<=[，。！？；：、])[ \t]+(?=[\u3400-\u9fff])/gu, '')
      .split('\n').map(line => line.trimEnd()).filter(line => line.trim()).join('\n').trim();
  }

  const CJK = '[\\u2e80-\\u2eff\\u2f00-\\u2fdf\\u3040-\\u309f\\u30a0-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff]';
  const CJK_BEFORE_LATIN = new RegExp(`(${CJK})([A-Za-z0-9])`, 'gu');
  const LATIN_BEFORE_CJK = new RegExp(`([A-Za-z0-9%])(${CJK})`, 'gu');
  const BARE_URL = /^(?:https?:\/\/|mailto:|suira-image:\/\/)[^\s<>)\]]+/i;
  const LINK_REF_HEAD = /^[ \t]{0,3}\[([^\]]+)\]:[ \t]*(.*)$/;
  const LINK_REF_TITLE_LINE = /^[ \t]*(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\((?:\\.|[^)])*\))[ \t]*$/;

  function normalizeRefLabel(raw) {
    return String(raw || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function spacePlainSegment(segment) {
    return segment
      .replace(CJK_BEFORE_LATIN, '$1 $2')
      .replace(LATIN_BEFORE_CJK, '$1 $2');
  }

  function findClosingBracket(line, start) {
    let depth = 1;
    let i = start;
    while (i < line.length) {
      const ch = line[i];
      if (ch === '\\' && i + 1 < line.length) { i += 2; continue; }
      if (ch === '`') {
        let ticks = 1;
        while (line[i + ticks] === '`') ticks += 1;
        const close = line.indexOf('`'.repeat(ticks), i + ticks);
        if (close >= 0) { i = close + ticks; continue; }
        i += ticks;
        continue;
      }
      if (ch === '[') depth += 1;
      else if (ch === ']') {
        depth -= 1;
        if (depth === 0) return i;
      }
      i += 1;
    }
    return -1;
  }

  function findClosingParen(line, start) {
    let depth = 1;
    let i = start;
    let inAngle = false;
    while (i < line.length) {
      const ch = line[i];
      if (ch === '\\' && i + 1 < line.length) { i += 2; continue; }
      if (!inAngle && ch === '<' && i === start) { inAngle = true; i += 1; continue; }
      if (inAngle) {
        if (ch === '>') inAngle = false;
        i += 1;
        continue;
      }
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) return i;
      }
      i += 1;
    }
    return -1;
  }

  function spaceMarkdownLine(line, state, refLabels) {
    if (state.inHtmlComment) {
      const end = line.indexOf('-->');
      if (end < 0) return line;
      state.inHtmlComment = false;
      return line.slice(0, end + 3) + spaceMarkdownLine(line.slice(end + 3), state, refLabels);
    }
    let out = '';
    let plain = '';
    const flushPlain = () => {
      if (plain) {
        out += spacePlainSegment(plain);
        plain = '';
      }
    };
    let i = 0;
    while (i < line.length) {
      if (line.startsWith('<!--', i)) {
        flushPlain();
        const end = line.indexOf('-->', i + 4);
        if (end < 0) {
          state.inHtmlComment = true;
          out += line.slice(i);
          return out;
        }
        out += line.slice(i, end + 3);
        i = end + 3;
        continue;
      }
      if (line[i] === '`') {
        let ticks = 1;
        while (line[i + ticks] === '`') ticks += 1;
        const close = line.indexOf('`'.repeat(ticks), i + ticks);
        if (close >= 0) {
          flushPlain();
          out += line.slice(i, close + ticks);
          i = close + ticks;
          continue;
        }
      }
      if (line[i] === '<') {
        const tagMatch = line.slice(i).match(/^<\/?[A-Za-z!][^>\r\n]*>/);
        if (tagMatch) {
          flushPlain();
          out += tagMatch[0];
          i += tagMatch[0].length;
          continue;
        }
      }
      if ((line[i] === 'h' || line[i] === 'H' || line[i] === 'm' || line[i] === 'M' || line[i] === 's' || line[i] === 'S')) {
        const urlMatch = line.slice(i).match(BARE_URL);
        if (urlMatch) {
          flushPlain();
          out += urlMatch[0];
          i += urlMatch[0].length;
          continue;
        }
      }
      const isImage = line[i] === '!' && line[i + 1] === '[';
      if (isImage || line[i] === '[') {
        const labelStart = i + (isImage ? 2 : 1);
        const labelEnd = findClosingBracket(line, labelStart);
        if (labelEnd >= 0) {
          const label = line.slice(labelStart, labelEnd);
          const prefix = isImage ? '![' : '[';
          if (line[labelEnd + 1] === '(') {
            const urlEnd = findClosingParen(line, labelEnd + 2);
            if (urlEnd >= 0) {
              flushPlain();
              const innerState = { inHtmlComment: false };
              out += prefix + spaceMarkdownLine(label, innerState, refLabels) + ']' + line.slice(labelEnd + 1, urlEnd + 1);
              i = urlEnd + 1;
              continue;
            }
          } else if (line[labelEnd + 1] === '[') {
            const refEnd = findClosingBracket(line, labelEnd + 2);
            if (refEnd >= 0) {
              flushPlain();
              const refRaw = line.slice(labelEnd + 2, refEnd);
              if (!refRaw) {
                // Collapsed reference `[label][]`: label IS the reference key, keep verbatim.
                out += line.slice(i, refEnd + 1);
              } else {
                // Full reference `[label][ref]`: space label only, keep `[ref]` verbatim.
                const innerState = { inHtmlComment: false };
                out += prefix + spaceMarkdownLine(label, innerState, refLabels) + ']' + line.slice(labelEnd + 1, refEnd + 1);
              }
              i = refEnd + 1;
              continue;
            }
          } else if (refLabels && refLabels.has(normalizeRefLabel(label))) {
            // Shortcut reference `[ref]` matching a defined label: keep verbatim.
            flushPlain();
            out += line.slice(i, labelEnd + 1);
            i = labelEnd + 1;
            continue;
          }
        }
      }
      plain += line[i];
      i += 1;
    }
    flushPlain();
    return out;
  }

  function isYamlFrontmatter(block) {
    const lines = block.split(/\r?\n/);
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

  function scanReferenceDefinitions(parts) {
    const refLabels = new Set();
    const protectedLines = new Set();
    let fenceChar = '';
    let fenceLen = 0;
    let fenceQuoteDepth = 0;
    let inHtmlComment = false;
    const stripQuote = (raw) => {
      const m = raw.match(/^((?:[ \t]{0,3}>[ \t]?)*)/);
      const prefix = m ? m[1] : '';
      return { prefix, depth: (prefix.match(/>/g) || []).length, inner: raw.slice(prefix.length) };
    };
    for (let i = 0; i < parts.length; i += 2) {
      const { prefix: quotePrefix, depth: quoteDepth, inner } = stripQuote(parts[i]);
      if (fenceChar) {
        if (quoteDepth < fenceQuoteDepth) {
          fenceChar = ''; fenceLen = 0; fenceQuoteDepth = 0;
        } else {
          if (new RegExp(`^[ \\t]{0,3}${fenceChar}{${fenceLen},}[ \\t]*$`).test(inner)) {
            fenceChar = ''; fenceLen = 0; fenceQuoteDepth = 0;
          }
          continue;
        }
      }
      if (inHtmlComment) {
        if (inner.includes('-->')) inHtmlComment = false;
        continue;
      }
      const fenceMatch = inner.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
      if (fenceMatch) {
        fenceChar = fenceMatch[1][0];
        fenceLen = fenceMatch[1].length;
        fenceQuoteDepth = quoteDepth;
        continue;
      }
      if (inner.includes('<!--') && !inner.includes('-->')) {
        inHtmlComment = true;
        continue;
      }
      // Single-line or multi-line link reference definition: `[label\npart]: dest`
      let defEndIdx = i;
      let labelRaw = '';
      let rest = '';
      let matchedDef = false;
      const single = inner.match(LINK_REF_HEAD);
      if (single) {
        labelRaw = single[1];
        rest = single[2].trim();
        matchedDef = true;
      } else if (/^[ \t]{0,3}\[[^\]]*$/.test(inner)) {
        const openIdx = inner.indexOf('[');
        const collected = [inner.slice(openIdx + 1)];
        for (let k = i + 2; k < parts.length; k += 2) {
          const next = stripQuote(parts[k]);
          if (next.prefix !== quotePrefix || !next.inner.trim()) break;
          const closeMatch = next.inner.match(/^([^\]]*)\]:[ \t]*(.*)$/);
          if (closeMatch) {
            collected.push(closeMatch[1]);
            labelRaw = collected.join('\n');
            rest = closeMatch[2].trim();
            defEndIdx = k;
            matchedDef = true;
            break;
          }
          if (next.inner.includes(']')) break;
          collected.push(next.inner);
        }
      }
      if (matchedDef) {
        const key = normalizeRefLabel(labelRaw);
        const markRange = (toIdx) => {
          for (let p = i; p <= toIdx; p += 2) protectedLines.add(p);
        };
        if (rest) {
          if (key) refLabels.add(key);
          markRange(defEndIdx);
          if (defEndIdx + 2 < parts.length) {
            const nextInner = stripQuote(parts[defEndIdx + 2]).inner;
            if (LINK_REF_TITLE_LINE.test(nextInner)) protectedLines.add(defEndIdx + 2);
          }
          i = defEndIdx;
        } else if (defEndIdx + 2 < parts.length) {
          const nextInner = stripQuote(parts[defEndIdx + 2]).inner;
          if (nextInner.trim() && !/^[ \t]{0,3}(?:`{3,}|~{3,}|#{1,6}[ \t])/.test(nextInner)) {
            if (key) refLabels.add(key);
            markRange(defEndIdx + 2);
            if (defEndIdx + 4 < parts.length) {
              const titleInner = stripQuote(parts[defEndIdx + 4]).inner;
              if (LINK_REF_TITLE_LINE.test(titleInner)) protectedLines.add(defEndIdx + 4);
            }
            i = defEndIdx + 2;
          }
        }
      }
    }
    return { refLabels, protectedLines };
  }

  /**
   * Explicit user-triggered Pangu CJK-Latin spacing for Markdown source.
   * Preserves YAML frontmatter, fenced code blocks (including blockquoted fences),
   * inline code, multi-line HTML comments, HTML tags, single/multi-line reference
   * link definitions & multi-line reference identifiers, balanced-paren URLs,
   * and bare URLs verbatim.
   */
  function panguMarkdown(text) {
    const source = String(text ?? '');
    if (!source) return '';
    let prefix = '';
    let body = source;
    const fm = source.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
    if (fm && isYamlFrontmatter(fm[1])) {
      prefix = fm[0];
      body = source.slice(prefix.length);
    }
    const parts = body.split(/(\r?\n)/);
    const { refLabels, protectedLines } = scanReferenceDefinitions(parts);
    let fenceChar = '';
    let fenceLen = 0;
    let fenceQuoteDepth = 0;
    const lineState = { inHtmlComment: false };
    let chunk = [];
    let chunkQuote = '';
    const flushChunk = () => {
      if (!chunk.length) return;
      const joined = chunk.map((entry) => entry.inner).join('\n');
      const spaced = spaceMarkdownLine(joined, lineState, refLabels).split('\n');
      if (spaced.length === chunk.length) {
        for (let k = 0; k < chunk.length; k += 1) {
          parts[chunk[k].idx] = chunk[k].quotePrefix + spaced[k];
        }
      } else {
        for (const entry of chunk) {
          parts[entry.idx] = entry.quotePrefix + spaceMarkdownLine(entry.inner, lineState, refLabels);
        }
      }
      chunk = [];
      chunkQuote = '';
    };
    for (let i = 0; i < parts.length; i += 2) {
      const line = parts[i];
      const quotePrefixMatch = line.match(/^((?:[ \t]{0,3}>[ \t]?)*)/);
      const quotePrefix = quotePrefixMatch ? quotePrefixMatch[1] : '';
      const quoteDepth = (quotePrefix.match(/>/g) || []).length;
      const inner = line.slice(quotePrefix.length);
      if (fenceChar) {
        flushChunk();
        if (quoteDepth < fenceQuoteDepth) {
          fenceChar = '';
          fenceLen = 0;
          fenceQuoteDepth = 0;
        } else {
          const closeMatch = inner.match(new RegExp(`^[ \\t]{0,3}${fenceChar}{${fenceLen},}[ \\t]*$`));
          if (closeMatch) {
            fenceChar = '';
            fenceLen = 0;
            fenceQuoteDepth = 0;
          }
          continue;
        }
      }
      if (!lineState.inHtmlComment) {
        const fenceMatch = inner.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
        if (fenceMatch) {
          flushChunk();
          fenceChar = fenceMatch[1][0];
          fenceLen = fenceMatch[1].length;
          fenceQuoteDepth = quoteDepth;
          continue;
        }
      }
      if (protectedLines.has(i) || !inner.trim()) {
        flushChunk();
        if (!protectedLines.has(i) && lineState.inHtmlComment) {
          parts[i] = quotePrefix + spaceMarkdownLine(inner, lineState, refLabels);
        }
        continue;
      }
      if (chunk.length && quotePrefix !== chunkQuote) flushChunk();
      chunkQuote = quotePrefix;
      chunk.push({ idx: i, quotePrefix, inner });
    }
    flushChunk();
    return prefix + parts.join('');
  }

  return { compactCapture, panguMarkdown };
});
