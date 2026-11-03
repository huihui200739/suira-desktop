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
  return { compactCapture };
});
