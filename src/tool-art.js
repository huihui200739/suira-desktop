'use strict';
// Original Suira luminous crystal-glass SVG tool icons; zero external assets or hardcoded color literals.
(() => {
  let seq = 0;

  const families = {
    capture: 'blue',
    'capture-translate': 'blue',
    'long-capture': 'blue',
    ocr: 'jade',
    pin: 'blue',
    clipboard: 'amber',
    note: 'amber',
    markdown: 'amber',
    folder: 'amber',
    translate: 'jade',
    calendar: 'orange',
    'edit-image': 'iris',
    desktop: 'slate',
    lock: 'iris',
    annotate: 'blue',
    'text-clean': 'jade',
    island: 'blue',
    shelf: 'amber',
    library: 'iris',
    settings: 'slate',
    url: 'blue',
    file: 'blue',
    app: 'iris',
    voice: 'blue'
  };

  const kinds = {
    translate: 'translation',
    capture: 'capture',
    calendar: 'calendar',
    markdown: 'markdown',
    desktop: 'desktop window-deck',
    'long-capture': 'scroll',
    voice: 'voice-object',
    annotate: 'annotation',
    'capture-translate': 'capture-translation',
    'edit-image': 'capture image-edit',
    ocr: 'recognition',
    pin: 'pinned',
    clipboard: 'clipboard-object',
    'text-clean': 'text-object',
    lock: 'lock-object',
    note: 'note-object',
    island: 'tray-object',
    shelf: 'tray-object organizer',
    library: 'books',
    settings: 'gear-object',
    folder: 'folder-object',
    file: 'file-object',
    url: 'web-object',
    app: 'app-object'
  };

  function glyph(id, u) {
    const gl = `url(#sa-gl-${u})`;
    const gh = `url(#sa-gh-${u})`;
    switch (id) {
      case 'capture':
        return (
          '<path class="art-stroke-92" stroke-width="2.4" d="M11.5 18.5v-3.5a3.5 3.5 0 0 1 3.5-3.5h3.5M36.5 18.5v-3.5a3.5 3.5 0 0 0-3.5-3.5h-3.5M11.5 29.5V33a3.5 3.5 0 0 0 3.5 3.5h3.5M36.5 29.5V33a3.5 3.5 0 0 1-3.5 3.5h-3.5"/>' +
          `<rect class="art-rim-hi" x="15.5" y="16.5" width="17" height="15" rx="4" fill="${gh}"/>` +
          '<circle class="art-ink" cx="24" cy="24" r="3.4"/>' +
          '<circle class="art-aperture-core" cx="24" cy="24" r="1.4"/>'
        );

      case 'long-capture':
        return (
          `<rect class="art-rim-soft" x="13" y="10" width="22" height="21" rx="5" fill="${gl}"/>` +
          '<line class="art-stroke-92" stroke-width="2.2" x1="17.5" y1="16" x2="30.5" y2="16"/>' +
          '<line class="art-stroke-68" stroke-width="2.1" x1="17.5" y1="21" x2="27.5" y2="21"/>' +
          '<line class="art-stroke-48" stroke-width="2.1" x1="17.5" y1="26" x2="24" y2="26"/>' +
          '<path class="art-stroke" stroke-width="2.6" d="M19 33.5l5 4.6 5-4.6"/>' +
          '<path class="art-stroke" stroke-width="2.4" d="M24 28.5v8.8"/>'
        );

      case 'capture-translate':
        return (
          '<path class="art-stroke-88" stroke-width="2.3" d="M11 18v-3.5a3.5 3.5 0 0 1 3.5-3.5H18M37 18v-3.5a3.5 3.5 0 0 0-3.5-3.5H30M11 30v3.5a3.5 3.5 0 0 0 3.5 3.5H18"/>' +
          '<rect class="art-card-solid art-rim-white" x="15.5" y="15.5" width="19.5" height="19.5" rx="5.5"/>' +
          '<text class="art-cut art-label-lg" x="25.3" y="30.2" text-anchor="middle">A</text>'
        );

      case 'translate':
        return (
          '<path class="art-glass-deep art-rim-soft" d="M12.5 10.5h12.5a3.5 3.5 0 0 1 3.5 3.5v7.5a3.5 3.5 0 0 1-3.5 3.5h-8.8l-3.7 2.8v-3a3.5 3.5 0 0 1-3.5-3.3V14a3.5 3.5 0 0 1 3.5-3.5z"/>' +
          '<text class="art-ink art-label-zh" x="17.8" y="20.6" text-anchor="middle">文</text>' +
          '<path class="art-card-solid art-rim-white" d="M22.5 21h12.5a3.5 3.5 0 0 1 3.5 3.5V32a3.5 3.5 0 0 1-3.5 3.5h-1v3l-4-3h-7.5A3.5 3.5 0 0 1 19 32v-7.5a3.5 3.5 0 0 1 3.5-3.5z"/>' +
          '<text class="art-cut art-label-md" x="28.8" y="32.2" text-anchor="middle">A</text>'
        );

      case 'ocr':
        return (
          `<rect class="art-rim-soft" x="13" y="11" width="22" height="26" rx="5.5" fill="${gl}"/>` +
          '<line class="art-stroke-92" stroke-width="2.1" x1="17.5" y1="17" x2="30.5" y2="17"/>' +
          '<line class="art-stroke-68" stroke-width="2" x1="17.5" y1="22" x2="27.5" y2="22"/>' +
          '<line class="art-stroke-55" stroke-width="2" x1="17.5" y1="30.5" x2="29" y2="30.5"/>' +
          '<rect class="art-ink" x="9.5" y="24.2" width="29" height="3.2" rx="1.6"/>'
        );

      case 'text-clean':
        return (
          `<rect class="art-rim-soft" x="11" y="12.5" width="24" height="24" rx="6" fill="${gl}"/>` +
          '<line class="art-stroke" stroke-width="2.3" x1="15.5" y1="19.5" x2="26" y2="19.5"/>' +
          '<line class="art-stroke-84" stroke-width="2.3" x1="15.5" y1="24.8" x2="30.5" y2="24.8"/>' +
          '<line class="art-stroke-62" stroke-width="2.3" x1="15.5" y1="30" x2="25.5" y2="30"/>' +
          '<path class="art-ink" d="M33 9.5l1.2 3.4 3.4 1.2-3.4 1.2-1.2 3.4-1.2-3.4-3.4-1.2 3.4-1.2z"/>'
        );

      case 'pin':
        return (
          `<rect class="art-rim-soft" x="11" y="21" width="18" height="16" rx="4.5" fill="${gl}"/>` +
          '<g transform="translate(26.5,21.5) rotate(36)">' +
            '<rect class="art-ink" x="-5.5" y="-11.5" width="11" height="3.6" rx="1.8"/>' +
            `<path class="art-rim-white" fill="${gh}" d="M-3.5-8h7l1.8 6.5h-10.6z"/>` +
            '<rect class="art-ink" x="-7" y="-2" width="14" height="3.6" rx="1.8"/>' +
            '<path class="art-stroke" stroke-width="2.4" d="M0 1.6v8.2"/>' +
          '</g>'
        );

      case 'voice':
        return (
          '<rect class="art-ink" x="19" y="10.5" width="10" height="16.5" rx="5"/>' +
          '<path class="art-stroke-88" stroke-width="2.4" d="M14.5 22.5a9.5 9.5 0 0 0 19 0"/>' +
          '<path class="art-stroke" stroke-width="2.4" d="M24 32v5.5M19.5 37.5h9"/>' +
          '<path class="art-stroke-52" stroke-width="1.9" d="M11 16.5a5 5 0 0 0 0 6M37 16.5a5 5 0 0 1 0 6"/>'
        );

      case 'calendar':
        return (
          '<rect class="calendar-page art-card-solid art-rim-white" x="11" y="13.5" width="26" height="24" rx="6.5"/>' +
          '<path class="art-cal-band" d="M11 19.8v-1.3a5 5 0 0 1 5-5h16a5 5 0 0 1 5 5v1.3z"/>' +
          '<rect class="art-ink" x="16.5" y="9.5" width="3.4" height="7" rx="1.7"/>' +
          '<rect class="art-ink" x="28.1" y="9.5" width="3.4" height="7" rx="1.7"/>' +
          `<text class="date art-cut art-label-date" x="24" y="33.2" text-anchor="middle">${new Date().getDate()}</text>`
        );

      case 'clipboard':
        return (
          '<rect class="art-ink-20 art-rim-faint" x="15.5" y="15" width="20.5" height="23" rx="5"/>' +
          `<rect class="art-rim-mid" x="11.5" y="12.5" width="21" height="23.5" rx="5" fill="${gh}"/>` +
          '<rect class="art-ink" x="16.8" y="9.2" width="10.4" height="5.4" rx="2.6"/>' +
          '<line class="art-stroke" stroke-width="2.2" x1="16" y1="21" x2="28" y2="21"/>' +
          '<line class="art-stroke-78" stroke-width="2.2" x1="16" y1="26.2" x2="25.5" y2="26.2"/>' +
          '<line class="art-stroke-54" stroke-width="2.2" x1="16" y1="31" x2="22.5" y2="31"/>'
        );

      case 'markdown':
        return (
          `<rect class="art-rim-soft" x="10.5" y="13" width="27" height="22" rx="6" fill="${gl}"/>` +
          '<path class="art-stroke" stroke-width="2.4" d="M15.2 29V19l4.2 5 4.2-5v10"/>' +
          '<path class="art-stroke" stroke-width="2.3" d="M30.5 19v9.5M27.6 25.8l2.9 3.1 2.9-3.1"/>'
        );

      case 'note':
        return (
          `<rect class="art-rim-soft" x="11" y="12" width="23" height="25" rx="5.5" fill="${gl}"/>` +
          '<line class="art-stroke-84" stroke-width="2.1" x1="15.5" y1="19" x2="25" y2="19"/>' +
          '<line class="art-stroke-62" stroke-width="2.1" x1="15.5" y1="24.5" x2="23.5" y2="24.5"/>' +
          '<line class="art-stroke-48" stroke-width="2.1" x1="15.5" y1="30" x2="21.5" y2="30"/>' +
          '<path class="art-ink" d="M35.2 14.2a2.2 2.2 0 0 1 3.1 3.1L27.8 27.8l-4.2 1.1 1.1-4.2z"/>'
        );

      case 'edit-image':
        return (
          `<rect class="art-rim-soft" x="10.5" y="13.5" width="22.5" height="22.5" rx="5.5" fill="${gl}"/>` +
          '<circle class="art-ink-90" cx="17.5" cy="20" r="2.3"/>' +
          '<path class="art-ink-52" d="M12 32.5l6.5-6.2 4 3.6 3.5-3.2 5.5 5.8z"/>' +
          '<path class="art-ink" d="M33 10.5l1.3 3.7 3.7 1.3-3.7 1.3-1.3 3.7-1.3-3.7-3.7-1.3 3.7-1.3z"/>' +
          '<path class="art-stroke" stroke-width="3.2" d="M35.5 24.5l-9.2 9.2"/>'
        );

      case 'lock':
        return (
          '<path class="art-stroke" stroke-width="3" d="M18 20v-4a6 6 0 0 1 12 0v4"/>' +
          `<path class="art-rim-hi" fill="${gh}" d="M13 21.5a3.5 3.5 0 0 1 3.5-3.5h15a3.5 3.5 0 0 1 3.5 3.5v6.2c0 5.4-4.2 9.1-11 11.3-6.8-2.2-11-5.9-11-11.3z"/>` +
          '<circle class="art-cut" cx="24" cy="26.8" r="2.3"/>' +
          '<path class="art-cut-stroke" stroke-width="2.2" d="M24 28.4v3.4"/>'
        );

      case 'desktop':
        return (
          `<rect class="art-rim-mid" x="10.5" y="11.5" width="27" height="19.5" rx="5" fill="${gl}"/>` +
          '<rect class="art-ink" x="15.5" y="25.2" width="17" height="3" rx="1.5"/>' +
          '<path class="art-stroke" stroke-width="2.5" d="M24 31.2v4.5M18 36.2h12"/>'
        );

      case 'annotate':
        return (
          `<rect class="art-rim-soft" x="10.5" y="12.5" width="23.5" height="23.5" rx="6" fill="${gl}"/>` +
          '<rect class="art-ink-52" x="14.5" y="28.2" width="14.5" height="3.6" rx="1.8"/>' +
          '<path class="art-ink" d="M33.2 11.8l4.4 4.4-11.8 11.8-5.4 1.4 1.4-5.4z"/>'
        );

      case 'folder':
        return (
          `<path class="art-rim-soft" fill="${gl}" d="M10.5 16a4 4 0 0 1 4-4h6.4l3 3.2h9.6a4 4 0 0 1 4 4v12.8a4 4 0 0 1-4 4h-19a4 4 0 0 1-4-4z"/>` +
          '<rect class="art-ink-90" x="14.5" y="17.5" width="19" height="4" rx="2"/>' +
          `<rect class="art-rim-hi" x="10.5" y="20" width="27" height="16" rx="4.5" fill="${gh}"/>`
        );

      case 'island':
        return (
          `<rect class="art-rim-hi" x="10" y="14.5" width="28" height="13.5" rx="6.75" fill="${gh}"/>` +
          '<circle class="art-ink" cx="17.2" cy="21.25" r="2.6"/>' +
          '<rect class="art-ink" x="22.5" y="19.4" width="10.5" height="3.7" rx="1.85"/>' +
          '<path class="art-stroke-84" stroke-width="2.4" d="M19.5 34.2l4.5-4.2 4.5 4.2"/>'
        );

      case 'shelf':
        return (
          '<rect class="art-ink-90" x="15.5" y="12" width="17" height="11.5" rx="3.2"/>' +
          `<path class="art-rim-hi" fill="${gh}" d="M10.5 21.5h7.6a2.5 2.5 0 0 1 2.2 1.4l.9 1.8a2.5 2.5 0 0 0 2.2 1.4h1.2a2.5 2.5 0 0 0 2.2-1.4l.9-1.8a2.5 2.5 0 0 1 2.2-1.4h7.6v10.5a4.5 4.5 0 0 1-4.5 4.5h-18a4.5 4.5 0 0 1-4.5-4.5z"/>`
        );

      case 'library':
        return (
          `<rect class="art-rim-soft" x="11" y="12.5" width="7.2" height="23.5" rx="2.4" fill="${gl}"/>` +
          `<rect class="art-rim-hi" x="19.8" y="11" width="7.8" height="25" rx="2.5" fill="${gh}"/>` +
          '<line class="art-stroke" stroke-width="1.8" x1="21.8" y1="16.5" x2="25.6" y2="16.5"/>' +
          '<line class="art-stroke-78" stroke-width="1.8" x1="21.8" y1="30.5" x2="25.6" y2="30.5"/>' +
          `<rect class="art-rim-soft" x="29.4" y="13.5" width="7.2" height="22.5" rx="2.4" transform="rotate(-8 33 25)" fill="${gl}"/>`
        );

      case 'settings':
        return (
          '<line class="art-stroke-55" stroke-width="2.6" x1="12.5" y1="16" x2="35.5" y2="16"/>' +
          '<circle class="art-ink" cx="19.5" cy="16" r="3.4"/>' +
          '<line class="art-stroke-55" stroke-width="2.6" x1="12.5" y1="24" x2="35.5" y2="24"/>' +
          '<circle class="art-ink" cx="29.5" cy="24" r="3.4"/>' +
          '<line class="art-stroke-55" stroke-width="2.6" x1="12.5" y1="32" x2="35.5" y2="32"/>' +
          '<circle class="art-ink" cx="21.5" cy="32" r="3.4"/>'
        );

      case 'url':
        return (
          '<path class="art-stroke-78" stroke-width="3.2" d="M21 27l-2.6 2.6a5.4 5.4 0 0 1-7.6-7.6l4.6-4.6a5.4 5.4 0 0 1 7.6 0"/>' +
          '<path class="art-stroke" stroke-width="3.2" d="M27 21l2.6-2.6a5.4 5.4 0 0 1 7.6 7.6l-4.6 4.6a5.4 5.4 0 0 1-7.6 0"/>' +
          '<path class="art-stroke" stroke-width="2.6" d="M20.5 27.5l7-7"/>'
        );

      case 'file':
        return (
          `<path class="art-rim-soft" fill="${gl}" d="M13.5 10.5h13.8l7.2 7.2v15.8a4 4 0 0 1-4 4h-17a4 4 0 0 1-4-4v-19a4 4 0 0 1 4-4z"/>` +
          '<path class="art-ink-52" d="M27.3 10.5v4.7a2.5 2.5 0 0 0 2.5 2.5h4.7z"/>' +
          '<line class="art-stroke" stroke-width="2.2" x1="17" y1="22.5" x2="30" y2="22.5"/>' +
          '<line class="art-stroke-78" stroke-width="2.2" x1="17" y1="27.5" x2="28" y2="27.5"/>' +
          '<line class="art-stroke-54" stroke-width="2.2" x1="17" y1="32.2" x2="24.5" y2="32.2"/>'
        );

      case 'app':
        return (
          '<rect class="art-ink" x="12" y="12" width="10.5" height="10.5" rx="3.4"/>' +
          `<rect class="art-rim-hi" x="25.5" y="12" width="10.5" height="10.5" rx="3.4" fill="${gh}"/>` +
          `<rect class="art-rim-hi" x="12" y="25.5" width="10.5" height="10.5" rx="3.4" fill="${gh}"/>` +
          '<rect class="art-ink" x="25.5" y="25.5" width="10.5" height="10.5" rx="3.4"/>'
        );

      default:
        return '';
    }
  }

  function buildSvg(id) {
    const u = ++seq;
    const body = glyph(id, u);
    if (!body) return '';
    return (
      '<svg class="art-svg" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
        '<defs>' +
          `<linearGradient id="sa-bg-${u}" x1="0.15" y1="0" x2="0.85" y2="1">` +
            '<stop offset="0%" class="art-stop-1"/>' +
            '<stop offset="52%" class="art-stop-2"/>' +
            '<stop offset="100%" class="art-stop-3"/>' +
          '</linearGradient>' +
          `<radialGradient id="sa-bl-${u}" cx="0.28" cy="0.15" r="0.72">` +
            '<stop offset="0%" class="art-stop-bloom" stop-opacity="0.62"/>' +
            '<stop offset="55%" class="art-stop-bloom" stop-opacity="0.12"/>' +
            '<stop offset="100%" class="art-stop-bloom" stop-opacity="0"/>' +
          '</radialGradient>' +
          `<linearGradient id="sa-rm-${u}" x1="0" y1="0" x2="0" y2="1">` +
            '<stop offset="0%" class="art-stop-hi" stop-opacity="0.74"/>' +
            '<stop offset="50%" class="art-stop-hi" stop-opacity="0.18"/>' +
            '<stop offset="100%" class="art-stop-lo" stop-opacity="0.15"/>' +
          '</linearGradient>' +
          `<linearGradient id="sa-gl-${u}" x1="0" y1="0" x2="0" y2="1">` +
            '<stop offset="0%" class="art-stop-hi" stop-opacity="0.46"/>' +
            '<stop offset="100%" class="art-stop-hi" stop-opacity="0.18"/>' +
          '</linearGradient>' +
          `<linearGradient id="sa-gh-${u}" x1="0" y1="0" x2="0" y2="1">` +
            '<stop offset="0%" class="art-stop-hi" stop-opacity="0.72"/>' +
            '<stop offset="100%" class="art-stop-hi" stop-opacity="0.34"/>' +
          '</linearGradient>' +
        '</defs>' +
        `<rect class="art-base" x="2" y="2" width="44" height="44" rx="12.5" fill="url(#sa-bg-${u})"/>` +
        `<rect class="art-bloom" x="2" y="2" width="44" height="44" rx="12.5" fill="url(#sa-bl-${u})"/>` +
        `<rect class="art-rim" x="2.7" y="2.7" width="42.6" height="42.6" rx="11.8" fill="none" stroke="url(#sa-rm-${u})" stroke-width="1.4"/>` +
        body +
      '</svg>'
    );
  }

  const api = {
    has: id => Object.prototype.hasOwnProperty.call(families, id),
    render(id) {
      if (!api.has(id)) return '';
      const svg = buildSvg(id);
      if (!svg) return '';
      const fam = families[id];
      const kind = kinds[id] || id;
      return `<span class="suira-art vivid family-${fam} ${kind}" data-art-id="${id}" aria-hidden="true"><span class="art-object">${svg}</span></span>`;
    },
    refresh(root) {
      if (!root || !root.querySelectorAll) return;
      const targets = root.matches?.('.suira-art[data-art-id]')
        ? [root]
        : Array.from(root.querySelectorAll('.suira-art[data-art-id]'));
      targets.forEach(node => {
        const id = node.dataset.artId;
        const markup = api.render(id);
        if (!markup) return;
        const tpl = document.createElement('template');
        tpl.innerHTML = markup;
        const next = tpl.content.firstElementChild;
        if (next) node.replaceWith(next);
      });
    },
    mount(root = document) {
      root.querySelectorAll('[data-tool-object]').forEach(node => {
        if (node.dataset.artMounted === node.dataset.toolObject) return;
        const markup = api.render(node.dataset.toolObject);
        if (!markup) return;
        node.innerHTML = markup;
        node.dataset.artMounted = node.dataset.toolObject;
      });
    }
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window === 'object') {
    window.SuiraToolArt = api;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => api.mount(), { once: true });
    } else {
      api.mount();
    }
  }
})();
