(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SuiraTranslateLanguage = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  function detectLang(text) {
    const source = String(text || '');
    if (!source.trim()) return 'auto';
    let han = 0;
    let kana = 0;
    let hangul = 0;
    let latin = 0;
    for (const char of source) {
      const code = char.codePointAt(0);
      if ((code >= 0x3040 && code <= 0x30ff)) kana += 1;
      else if (code >= 0x4e00 && code <= 0x9fff) han += 1;
      else if (code >= 0xac00 && code <= 0xd7af) hangul += 1;
      else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) latin += 1;
    }
    const total = han + kana + hangul + latin;
    if (!total) return 'auto';
    // 日文里汉字与假名混排，先看假名：有假名就按日文处理
    if (kana / total > 0.05) return 'ja';
    if (hangul / total > 0.2) return 'ko';
    if (han / total > 0.2) return 'zh';
    if (latin / total > 0.5) return 'en';
    return 'auto';
  }
  function defaultTarget(text, preferred = 'zh') {
    return preferred === 'zh' && detectLang(text) === 'zh' ? 'en' : preferred;
  }
  return { detectLang, defaultTarget };
});
