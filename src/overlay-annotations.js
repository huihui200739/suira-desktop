'use strict';
/**
 * Shared pure-logic helpers for screenshot overlay & image editor:
 * - Smart window / child-control snap hierarchy resolution
 * - Annotation geometry, hit-testing, translation, and cloning (secondary editing)
 * - CleanShot-X-style beautify frame geometry & preset definitions (color tokens only)
 *
 * Works both in browser (window.SuiraOverlayTools) and Node unit tests (module.exports).
 */
(function (root) {
  function rectArea(r) {
    return Math.max(0, r.width) * Math.max(0, r.height);
  }

  function pointInRect(p, r) {
    return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
  }

  function rectKey(r) {
    return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`;
  }

  function rectContains(outer, inner) {
    return outer.x <= inner.x + 1 && outer.y <= inner.y + 1
      && outer.x + outer.width >= inner.x + inner.width - 1
      && outer.y + outer.height >= inner.y + inner.height - 1;
  }

  /**
   * Build the snap hierarchy stack under cursor `p` (from deepest non-occluded child control -> parent window -> display).
   * Respects front-to-back Z-order for both top-level windows and sibling child controls.
   */
  function buildSnapStack(p, snapRects, displays, virtualBounds) {
    const stack = [];
    const seen = new Set();
    const push = (rect, kind) => {
      if (!rect || rect.width < 12 || rect.height < 12) return;
      const key = rectKey(rect);
      if (seen.has(key)) return;
      seen.add(key);
      stack.push({ x: rect.x, y: rect.y, w: rect.width, h: rect.height, kind });
    };

    if (Array.isArray(snapRects)) {
      const topWindow = snapRects.find((win) => pointInRect(p, win));
      if (topWindow) {
        const allChildren = Array.isArray(topWindow.children) ? topWindow.children : [];
        const parentById = new Map();
        for (const c of allChildren) if (c && c.id !== undefined) parentById.set(c.id, c.parent);
        const isDescendant = (child, ancestor) => {
          if (child?.id === undefined || ancestor?.id === undefined) return rectContains(ancestor, child);
          let cur = child.parent;
          const walked = new Set();
          while (cur !== undefined && !walked.has(cur)) {
            if (cur === ancestor.id) return true;
            walked.add(cur);
            cur = parentById.get(cur);
          }
          return false;
        };
        const hitInZOrder = allChildren.filter((child) => pointInRect(p, child));
        const visibleChain = [];
        for (const child of hitInZOrder) {
          // An earlier sibling in Z-order that covers `p` and is not a real HWND ancestor occludes `child`.
          const occluded = visibleChain.some((earlier) => !isDescendant(child, earlier));
          if (!occluded) visibleChain.push(child);
        }
        visibleChain.sort((a, b) => rectArea(a) - rectArea(b));
        for (const child of visibleChain) push(child, 'control');
        push(topWindow, 'window');
      }
    }

    if (Array.isArray(displays) && virtualBounds) {
      for (const display of displays) {
        if (!display?.bounds) continue;
        const local = {
          x: display.bounds.x - virtualBounds.x,
          y: display.bounds.y - virtualBounds.y,
          width: display.bounds.width,
          height: display.bounds.height
        };
        if (pointInRect(p, local)) {
          push(local, 'screen');
          break;
        }
      }
    }
    return stack;
  }

  function annotationBounds(item) {
    if (!item) return null;
    if (item.type === 'pen' || item.type === 'highlighter') {
      if (!item.points?.length) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const pt of item.points) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }
      const pad = Math.max(4, (item.width || 4) / 2);
      return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    }
    if (item.type === 'arrow') {
      const minX = Math.min(item.from.x, item.to.x);
      const minY = Math.min(item.from.y, item.to.y);
      const maxX = Math.max(item.from.x, item.to.x);
      const maxY = Math.max(item.from.y, item.to.y);
      const pad = Math.max(8, (item.width || 4) * 2);
      return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    }
    if (item.type === 'steps') {
      const r = 14 * (item.unit || 1);
      return { x: item.x - r, y: item.y - r, w: r * 2, h: r * 2 };
    }
    if (item.type === 'text') {
      const unit = item.unit || 1;
      const fontSize = Math.max(14 * unit, (item.width || 4) * 4);
      const lines = String(item.text || '').split('\n');
      const maxChars = Math.max(1, ...lines.map((line) => {
        let units = 0;
        for (const ch of line) units += ch.charCodeAt(0) > 255 ? 1 : 0.6;
        return units;
      }));
      const width = Math.max(28 * unit, Math.ceil(maxChars * fontSize));
      const height = Math.max(fontSize * 1.35, lines.length * fontSize * 1.35);
      return { x: item.x, y: item.y, w: width, h: height };
    }
    const x = Math.min(item.x, item.x + item.w);
    const y = Math.min(item.y, item.y + item.h);
    return { x, y, w: Math.abs(item.w), h: Math.abs(item.h) };
  }

  function distToSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  function hitTestSingle(item, p, tolerance = 8) {
    if (!item || !p) return false;
    if (item.type === 'pen' || item.type === 'highlighter') {
      const pts = item.points || [];
      if (!pts.length) return false;
      const hit = Math.max(tolerance, (item.width || 4) / 2 + 4);
      if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= hit;
      for (let i = 1; i < pts.length; i += 1) {
        if (distToSegment(p, pts[i - 1], pts[i]) <= hit) return true;
      }
      return false;
    }
    if (item.type === 'arrow') {
      return distToSegment(p, item.from, item.to) <= Math.max(tolerance + 2, (item.width || 4) * 2);
    }
    if (item.type === 'steps') {
      const r = 14 * (item.unit || 1) + 4;
      return Math.hypot(p.x - item.x, p.y - item.y) <= r;
    }
    if (item.type === 'rect') {
      const b = annotationBounds(item);
      const hit = Math.max(tolerance, (item.width || 4) / 2 + 4);
      const inOuter = p.x >= b.x - hit && p.x <= b.x + b.w + hit && p.y >= b.y - hit && p.y <= b.y + b.h + hit;
      if (!inOuter) return false;
      if (b.w <= hit * 2 || b.h <= hit * 2) return true;
      const inInner = p.x >= b.x + hit && p.x <= b.x + b.w - hit && p.y >= b.y + hit && p.y <= b.y + b.h - hit;
      return !inInner;
    }
    if (item.type === 'ellipse') {
      const b = annotationBounds(item);
      const rx = b.w / 2, ry = b.h / 2;
      if (rx < 1 || ry < 1) return false;
      const cx = b.x + rx, cy = b.y + ry;
      const hit = Math.max(tolerance, (item.width || 4) / 2 + 4);
      const nxOuter = (p.x - cx) / (rx + hit), nyOuter = (p.y - cy) / (ry + hit);
      if (nxOuter * nxOuter + nyOuter * nyOuter > 1) return false;
      if (rx <= hit || ry <= hit) return true;
      const nxInner = (p.x - cx) / (rx - hit), nyInner = (p.y - cy) / (ry - hit);
      return nxInner * nxInner + nyInner * nyInner >= 1;
    }
    const b = annotationBounds(item);
    if (!b) return false;
    return p.x >= b.x - 4 && p.x <= b.x + b.w + 4 && p.y >= b.y - 4 && p.y <= b.y + b.h + 4;
  }

  function hitTestAnnotations(annotations, p, tolerance = 8) {
    if (!Array.isArray(annotations)) return null;
    for (let i = annotations.length - 1; i >= 0; i -= 1) {
      if (hitTestSingle(annotations[i], p, tolerance)) return annotations[i];
    }
    return null;
  }

  function cloneAnnotation(item) {
    if (!item) return null;
    const copy = { ...item };
    if (Array.isArray(item.points)) copy.points = item.points.map((pt) => ({ x: pt.x, y: pt.y }));
    if (item.from) copy.from = { x: item.from.x, y: item.from.y };
    if (item.to) copy.to = { x: item.to.x, y: item.to.y };
    return copy;
  }

  function translateAnnotation(item, dx, dy) {
    if (!item || (!dx && !dy)) return item;
    if (item.type === 'pen' || item.type === 'highlighter') {
      if (Array.isArray(item.points)) {
        for (const pt of item.points) {
          pt.x += dx;
          pt.y += dy;
        }
      }
      return item;
    }
    if (item.type === 'arrow') {
      if (item.from) { item.from.x += dx; item.from.y += dy; }
      if (item.to) { item.to.x += dx; item.to.y += dy; }
      return item;
    }
    if (Number.isFinite(item.x)) item.x += dx;
    if (Number.isFinite(item.y)) item.y += dy;
    return item;
  }

  const BEAUTIFY_PRESETS = [
    { id: 'aurora', label: '晨雾极光', start: 'beautify-1-a', end: 'beautify-1-b', angle: 135 },
    { id: 'sunset', label: '暖霞橘粉', start: 'beautify-2-a', end: 'beautify-2-b', angle: 135 },
    { id: 'ocean', label: '深海青蓝', start: 'beautify-3-a', end: 'beautify-3-b', angle: 135 },
    { id: 'mint', label: '青岚薄荷', start: 'beautify-4-a', end: 'beautify-4-b', angle: 135 },
    { id: 'obsidian', label: '夜幕石板', start: 'beautify-5-a', end: 'beautify-5-b', angle: 135 },
    { id: 'paper', label: '纯白留白', start: 'beautify-6-a', end: 'beautify-6-b', angle: 135 }
  ];

  const MAX_EXPORT_SIDE = 16384;
  const MAX_EXPORT_PIXELS = 40_000_000;

  function computeBeautifyLayout(contentWidth, contentHeight, config) {
    let pad = Math.max(0, Math.round(Number(config?.padding) || 0));
    let radius = Math.max(0, Math.round(Number(config?.radius) || 0));
    let titleBar = config?.windowChrome ? 32 : 0;
    let imageW = Math.max(1, Math.round(contentWidth));
    let imageH = Math.max(1, Math.round(contentHeight));
    let width = imageW + pad * 2;
    let height = imageH + titleBar + pad * 2;
    let scale = 1;
    if (width > MAX_EXPORT_SIDE) scale = Math.min(scale, MAX_EXPORT_SIDE / width);
    if (height > MAX_EXPORT_SIDE) scale = Math.min(scale, MAX_EXPORT_SIDE / height);
    if (width * height * scale * scale > MAX_EXPORT_PIXELS) {
      scale = Math.min(scale, Math.sqrt(MAX_EXPORT_PIXELS / (width * height)));
    }
    if (scale < 1) {
      pad = Math.floor(pad * scale);
      titleBar = titleBar ? Math.max(16, Math.floor(titleBar * scale)) : 0;
      imageW = Math.max(1, Math.floor(imageW * scale));
      imageH = Math.max(1, Math.floor(imageH * scale));
      radius = Math.floor(radius * scale);
      width = imageW + pad * 2;
      height = imageH + titleBar + pad * 2;
      while ((width > MAX_EXPORT_SIDE || height > MAX_EXPORT_SIDE || width * height > MAX_EXPORT_PIXELS) && imageW > 1 && imageH > 1) {
        if (pad > 0) pad -= 1;
        else { imageW = Math.max(1, imageW - 1); imageH = Math.max(1, imageH - 1); }
        width = imageW + pad * 2;
        height = imageH + titleBar + pad * 2;
      }
    }
    const cardWidth = imageW;
    const cardHeight = imageH + titleBar;
    return {
      width,
      height,
      pad,
      radius: Math.min(radius, Math.floor(Math.min(cardWidth, cardHeight) / 2)),
      titleBar,
      cardX: pad,
      cardY: pad,
      cardWidth,
      cardHeight,
      imageX: pad,
      imageY: pad + titleBar,
      imageW,
      imageH
    };
  }

  const api = {
    buildSnapStack,
    annotationBounds,
    hitTestSingle,
    hitTestAnnotations,
    cloneAnnotation,
    translateAnnotation,
    BEAUTIFY_PRESETS,
    computeBeautifyLayout
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SuiraOverlayTools = api;
})(typeof window !== 'undefined' ? window : globalThis);
