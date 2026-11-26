'use strict';
/**
 * Pure-logic utilities for Clipboard History Bar (Stage 3):
 * - Automatic color detection & lossless-roundtrip HEX / RGB / HSL conversion
 *   (supports #RGB/#RGBA/#RRGGBB/#RRGGBBAA, rgb/rgba with numbers or percentages,
 *    hsl/hsla with deg/rad/grad/turn angle units, CSS Color 4 space/slash syntax)
 * - Plain-text normalization for Shift+Enter unformatted paste
 * - Custom tag sanitization
 * Works in both browser (`window.SuiraClipboardColor`) and Node (`module.exports`).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SuiraClipboardColor = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const NUM = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)';
  const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  const RGB_COMMA_RE = new RegExp(`^rgba?\\(\\s*(${NUM}%?)\\s*,\\s*(${NUM}%?)\\s*,\\s*(${NUM}%?)(?:\\s*,\\s*(${NUM}%?))?\\s*\\)$`, 'i');
  const RGB_SPACE_RE = new RegExp(`^rgba?\\(\\s*(${NUM}%?)\\s+(${NUM}%?)\\s+(${NUM}%?)(?:\\s*\\/\\s*(${NUM}%?))?\\s*\\)$`, 'i');
  const HSL_COMMA_RE = new RegExp(`^hsla?\\(\\s*(${NUM})(deg|rad|grad|turn)?\\s*,\\s*(${NUM})%\\s*,\\s*(${NUM})%(?:\\s*,\\s*(${NUM}%?))?\\s*\\)$`, 'i');
  const HSL_SPACE_RE = new RegExp(`^hsla?\\(\\s*(${NUM})(deg|rad|grad|turn)?\\s+(${NUM})%\\s+(${NUM})%(?:\\s*\\/\\s*(${NUM}%?))?\\s*\\)$`, 'i');

  function parseAlpha(raw) {
    if (raw == null || raw === '') return 1;
    const s = String(raw).trim();
    const isPct = s.endsWith('%');
    const n = Number(isPct ? s.slice(0, -1) : s);
    if (!Number.isFinite(n)) return NaN;
    const v = isPct ? n / 100 : n;
    if (v < 0 || v > 1) return NaN;
    return v;
  }

  function parseRgbChannels(rawR, rawG, rawB) {
    const rPct = rawR.endsWith('%');
    const gPct = rawG.endsWith('%');
    const bPct = rawB.endsWith('%');
    // CSS Color 4 forbids mixing numbers and percentages in rgb().
    if (rPct !== gPct || gPct !== bPct) return null;
    const r = Number(rPct ? rawR.slice(0, -1) : rawR);
    const g = Number(gPct ? rawG.slice(0, -1) : rawG);
    const b = Number(bPct ? rawB.slice(0, -1) : rawB);
    const max = rPct ? 100 : 255;
    if ([r, g, b].some((v) => !Number.isFinite(v) || v < 0 || v > max)) return null;
    return rPct
      ? { r: (r / 100) * 255, g: (g / 100) * 255, b: (b / 100) * 255 }
      : { r, g, b };
  }

  function parseHueDegrees(rawNum, rawUnit) {
    const n = Number(rawNum);
    if (!Number.isFinite(n)) return NaN;
    const unit = String(rawUnit || 'deg').toLowerCase();
    if (unit === 'deg') return n;
    if (unit === 'rad') return (n * 180) / Math.PI;
    if (unit === 'grad') return n * 0.9;
    if (unit === 'turn') return n * 360;
    return NaN;
  }

  function formatNumber(n, decimals) {
    const rounded = Number(n.toFixed(decimals));
    return String(Object.is(rounded, -0) ? 0 : rounded);
  }

  function hexByte(n) {
    return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();
  }

  function rgbToHsl(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    const d = max - min;
    let h = 0;
    let s = 0;
    if (d !== 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === rn) h = 60 * (((gn - bn) / d) % 6);
      else if (max === gn) h = 60 * ((bn - rn) / d + 2);
      else h = 60 * ((rn - gn) / d + 4);
    }
    if (h < 0) h += 360;
    const hueRounded = Number(h.toFixed(2)) % 360;
    return {
      h: Object.is(hueRounded, -0) ? 0 : hueRounded,
      s: Number((s * 100).toFixed(2)),
      l: Number((l * 100).toFixed(2))
    };
  }

  function hslToRgb(h, sPct, lPct) {
    const hue = ((h % 360) + 360) % 360;
    const s = sPct / 100;
    const l = lPct / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0;
    let g = 0;
    let b = 0;
    if (hue < 60) { r = c; g = x; }
    else if (hue < 120) { r = x; g = c; }
    else if (hue < 180) { g = c; b = x; }
    else if (hue < 240) { g = x; b = c; }
    else if (hue < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255)
    };
  }

  function relativeLuminance(r, g, b) {
    const toLinear = (c) => {
      const n = c / 255;
      return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  }

  function buildColorResult(r, g, b, a) {
    const cr = Math.max(0, Math.min(255, Math.round(r)));
    const cg = Math.max(0, Math.min(255, Math.round(g)));
    const cb = Math.max(0, Math.min(255, Math.round(b)));
    const ca = Math.max(0, Math.min(1, a));
    const alphaByte = Math.round(ca * 255);
    const hasAlpha = alphaByte < 255 || ca < 0.99995;
    const hex = '#' + hexByte(cr) + hexByte(cg) + hexByte(cb) + (hasAlpha ? hexByte(alphaByte) : '');
    // 4 decimal places preserves every 8-bit alpha step (1/255 = 0.0039) with lossless round-trip!
    const alphaStr = formatNumber(ca, 4);
    const rgb = hasAlpha ? `rgba(${cr}, ${cg}, ${cb}, ${alphaStr})` : `rgb(${cr}, ${cg}, ${cb})`;
    const { h, s, l } = rgbToHsl(cr, cg, cb);
    const hStr = formatNumber(h, 2);
    const sStr = formatNumber(s, 2);
    const lStr = formatNumber(l, 2);
    const hsl = hasAlpha ? `hsla(${hStr}, ${sStr}%, ${lStr}%, ${alphaStr})` : `hsl(${hStr}, ${sStr}%, ${lStr}%)`;
    const luminance = relativeLuminance(cr, cg, cb);
    return {
      r: cr,
      g: cg,
      b: cb,
      a: hasAlpha ? Number(alphaStr) : 1,
      hex,
      rgb,
      hsl,
      css: rgb,
      luminance,
      isLight: hasAlpha ? luminance * ca + (1 - ca) > 0.52 : luminance > 0.52
    };
  }

  function parseColor(raw) {
    const text = String(raw || '').trim();
    if (!text || text.length > 64 || /[\r\n]/.test(text)) return null;

    const hexMatch = HEX_RE.exec(text);
    if (hexMatch) {
      const digits = hexMatch[1];
      if (digits.length === 3 || digits.length === 4) {
        const r = parseInt(digits[0] + digits[0], 16);
        const g = parseInt(digits[1] + digits[1], 16);
        const b = parseInt(digits[2] + digits[2], 16);
        const a = digits.length === 4 ? parseInt(digits[3] + digits[3], 16) / 255 : 1;
        return buildColorResult(r, g, b, a);
      }
      const r = parseInt(digits.slice(0, 2), 16);
      const g = parseInt(digits.slice(2, 4), 16);
      const b = parseInt(digits.slice(4, 6), 16);
      const a = digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1;
      return buildColorResult(r, g, b, a);
    }

    const rgbMatch = RGB_COMMA_RE.exec(text) || RGB_SPACE_RE.exec(text);
    if (rgbMatch) {
      const channels = parseRgbChannels(rgbMatch[1], rgbMatch[2], rgbMatch[3]);
      const a = parseAlpha(rgbMatch[4]);
      if (!channels || Number.isNaN(a)) return null;
      return buildColorResult(channels.r, channels.g, channels.b, a);
    }

    const hslMatch = HSL_COMMA_RE.exec(text) || HSL_SPACE_RE.exec(text);
    if (hslMatch) {
      const h = parseHueDegrees(hslMatch[1], hslMatch[2]);
      const s = Number(hslMatch[3]);
      const l = Number(hslMatch[4]);
      const a = parseAlpha(hslMatch[5]);
      if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l) || s < 0 || s > 100 || l < 0 || l > 100 || Number.isNaN(a)) {
        return null;
      }
      const { r, g, b } = hslToRgb(h, s, l);
      return buildColorResult(r, g, b, a);
    }

    return null;
  }

  function normalizePlainText(raw) {
    return String(raw ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
      .replace(/\u00A0/g, ' ')
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/g, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function sanitizeTags(rawTags) {
    if (!Array.isArray(rawTags)) return [];
    const seen = new Set();
    const out = [];
    for (const raw of rawTags) {
      const tag = String(raw ?? '')
        .replace(/[\u0000-\u001F\u007F]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 16);
      if (!tag) continue;
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(tag);
      if (out.length >= 5) break;
    }
    return out;
  }

  return { parseColor, normalizePlainText, sanitizeTags };
});
