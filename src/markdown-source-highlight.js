'use strict';
// Styling roles adapted from MiaoYan's MarkdownRuleHighlighter (MIT).
// Keep the native textarea in charge of IME, selection, scrolling and undo.
window.SuiraSourceHighlight = (() => {
  const escape = text => text.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);
  const span = (role, text) => `<span class="md-syntax-${role}">${escape(text)}</span>`;
  const inlinePattern = /(`+)([^`]+)\1|!?\[[^\]\n]*\]\([^\n)]*\)|\[\[[^\]\n]+\]\]|(?:\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~)|\*[^*\n]+\*|_[^_\n]+_|\\[^\s]/g;
  function inline(text) {
    let end = 0;
    let html = '';
    for (const match of text.matchAll(inlinePattern)) {
      const token = match[0];
      html += escape(text.slice(end, match.index));
      const role = token.startsWith('`') ? 'code' : /^[![]/.test(token) ? 'link' : token.startsWith('\\') ? 'marker' : 'emphasis';
      html += span(role, token);
      end = match.index + token.length;
    }
    return html + escape(text.slice(end));
  }
  function highlight(text) {
    let fence = '';
    return text.split('\n').map(line => {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length && /^ {0,3}(?:`+|~+)[ \t]*$/.test(line)) {
          fence = '';
          return span('marker', line);
        }
        return span('code', line);
      }
      if (marker) {
        fence = marker;
        return span('marker', line);
      }
      const heading = /^( {0,3}#{1,6})(?:([ \t]+)(.*))?$/.exec(line);
      if (heading) return span('marker', heading[1]) + escape(heading[2] || '') + span('heading', heading[3] || '');
      if (/^ {0,3}>/.test(line)) return span('quote', line);
      const list = /^(\s*(?:[-+*]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)(.*)$/.exec(line);
      if (list) return span('marker', list[1]) + inline(list[2]);
      return inline(line);
    }).join('\n');
  }
  function attach(editor, mirror) {
    let lastText = null;
    let frame = 0;
    let composing = false;
    function scroll() {
      mirror.scrollTop = editor.scrollTop;
      mirror.scrollLeft = editor.scrollLeft;
    }
    function refresh() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (composing || !editor.getClientRects().length) return;
      if (editor.value !== lastText) {
        lastText = editor.value;
        mirror.innerHTML = highlight(lastText) + (lastText.endsWith('\n') ? ' ' : '');
      }
      editor.parentElement.classList.add('md-source-ready');
      scroll();
    }
    function schedule() {
      if (!frame && !composing) frame = requestAnimationFrame(refresh);
    }
    editor.addEventListener('scroll', scroll, { passive:true });
    editor.addEventListener('compositionstart', () => {
      composing = true;
      editor.parentElement.classList.add('md-source-composing');
    });
    editor.addEventListener('compositionend', () => {
      composing = false;
      refresh();
      editor.parentElement.classList.remove('md-source-composing');
    });
    return { refresh, schedule };
  }
  return { attach };
})();
