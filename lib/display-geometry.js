'use strict';

/**
 * 虚拟桌面几何计算。
 *
 * 多显示器时，副屏可能在主屏左侧或上方，坐标为负值。
 * 这段计算直接决定截图覆盖范围，抽成纯函数以便测试。
 */

/**
 * 计算所有显示器组成的虚拟桌面并集。
 *
 * @param {Array<{bounds:{x:number,y:number,width:number,height:number}}>} displays
 * @returns {{x:number,y:number,width:number,height:number}|null}
 */
function unionBounds(displays) {
  if (!Array.isArray(displays) || displays.length === 0) return null;
  const valid = displays.filter((d) => d && d.bounds);
  if (valid.length === 0) return null;

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const display of valid) {
    const { x, y, width, height } = display.bounds;
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + width);
    bottom = Math.max(bottom, y + height);
  }

  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * 取所有显示器中最大的 scaleFactor，用于合成时保持最清晰屏幕的分辨率。
 * @param {Array} displays
 * @returns {number}
 */
function maxScaleFactor(displays) {
  if (!Array.isArray(displays) || displays.length === 0) return 1;
  return displays.reduce((max, d) => Math.max(max, Number(d?.scaleFactor) || 1), 1);
}

/**
 * 计算每个显示器画面在合成图中的位置与尺寸。
 *
 * @param {Array} displays
 * @param {{x:number,y:number}} origin 虚拟桌面左上角
 * @param {number} scale 统一缩放比
 * @returns {Array<{id:any,x:number,y:number,width:number,height:number}>}
 */
function tileLayout(displays, origin, scale) {
  if (!Array.isArray(displays)) return [];
  const s = Number(scale) || 1;
  const ox = Number(origin?.x) || 0;
  const oy = Number(origin?.y) || 0;
  return displays
    .filter((d) => d && d.bounds)
    .map((d) => ({
      id: d.id,
      x: Math.round((d.bounds.x - ox) * s),
      y: Math.round((d.bounds.y - oy) * s),
      width: Math.max(1, Math.round(d.bounds.width * s)),
      height: Math.max(1, Math.round(d.bounds.height * s))
    }));
}

/**
 * 校验并修复记忆中的主窗口边界。
 *
 * 为什么要单独做：显示器可能被拔掉、分辨率可能改、窗口可能被记在已经不在的副屏上。
 * 直接 setBounds 到不存在的坐标会让窗口「消失」，用户只能去任务栏找。
 *
 * 规则：
 * - 边界必须与至少一个显示器的工作区有明显交集（默认至少 80×40 可见），否则回落到默认值；
 * - 尺寸夹到 [minWidth, 该屏宽度] / [minHeight, 该屏高度]；
 * - 位置保证窗口左上角在虚拟桌面范围内。
 *
 * @param {{x:number,y:number,width:number,height:number}} bounds 记忆的边界
 * @param {Array<{bounds:{x:number,y:number,width:number,height:number},workArea?:object}>} displays
 * @param {{width:number,height:number,minVisibleWidth?:number,minVisibleHeight?:number}} fallback 默认尺寸
 * @returns {{x:number,y:number,width:number,height:number}}
 */
function sanitizeWindowBounds(bounds, displays, fallback = {}) {
  const defaultWidth = Math.max(320, Number(fallback.width) || 1180);
  const defaultHeight = Math.max(240, Number(fallback.height) || 820);
  const minVisibleWidth = Number(fallback.minVisibleWidth) || 80;
  const minVisibleHeight = Number(fallback.minVisibleHeight) || 40;
  const list = Array.isArray(displays) ? displays.filter((d) => d && (d.workArea || d.bounds)) : [];
  const areaOf = (display) => display.workArea || display.bounds;
  const makeDefault = () => {
    if (!list.length) return { x: 0, y: 0, width: defaultWidth, height: defaultHeight };
    const area = areaOf(list[0]);
    return {
      x: Math.round(area.x + Math.max(0, (area.width - defaultWidth) / 2)),
      y: Math.round(area.y + Math.max(0, (area.height - defaultHeight) / 2)),
      width: Math.min(defaultWidth, area.width),
      height: Math.min(defaultHeight, area.height)
    };
  };

  if (!bounds || typeof bounds !== 'object') return makeDefault();
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const width = Number(bounds.width);
  const height = Number(bounds.height);
  if (![x, y, width, height].every((value) => Number.isFinite(value)) || width < 200 || height < 150) {
    return makeDefault();
  }

  // 找与窗口重叠面积最大的显示器工作区
  let best = null;
  let bestOverlap = 0;
  for (const display of list) {
    const area = areaOf(display);
    const overlapWidth = Math.max(0, Math.min(x + width, area.x + area.width) - Math.max(x, area.x));
    const overlapHeight = Math.max(0, Math.min(y + height, area.y + area.height) - Math.max(y, area.y));
    const overlap = overlapWidth * overlapHeight;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = area;
    }
  }

  const visibleWidth = best ? Math.min(x + width, best.x + best.width) - Math.max(x, best.x) : 0;
  const visibleHeight = best ? Math.min(y + height, best.y + best.height) - Math.max(y, best.y) : 0;
  if (!best || visibleWidth < minVisibleWidth || visibleHeight < minVisibleHeight) return makeDefault();

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(320, Math.min(Math.round(width), best.width)),
    height: Math.max(240, Math.min(Math.round(height), best.height))
  };
}

// 与预览工具共用尺寸；工作区单位是 DIP，不额外乘显示器缩放比。
const QUICK_PANEL_SIZE = Object.freeze({ width: 1160, height: 620 });
const CLIPBOARD_SHELF_SIZE = Object.freeze({ width: 1600, height: 282 });

function clipboardShelfBounds(area) {
  const margin = Math.min(16, Math.floor(Math.min(area.width, area.height) / 8));
  const width = Math.max(1, Math.min(CLIPBOARD_SHELF_SIZE.width, area.width - margin * 2));
  const height = Math.max(1, Math.min(CLIPBOARD_SHELF_SIZE.height, area.height - margin * 2));
  return { x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + area.height - height - margin), width, height };
}

// 裁的是原生 HWND，而非只在页面里画圆角：亚克力也不会露出矩形底板。
function roundedWindowShape(width, height, radius = 24) {
  const r = Math.max(0, Math.min(Math.round(radius), Math.floor(width / 2), Math.floor(height / 2)));
  if (!r) return [{ x: 0, y: 0, width, height }];
  const rects = [{ x: 0, y: r, width, height: height - r * 2 }];
  for (let row = 0; row < r; row++) {
    const dy = r - row - .5;
    const inset = Math.ceil(r - Math.sqrt(r * r - dy * dy));
    rects.push({ x: inset, y: row, width: width - inset * 2, height: 1 },
      { x: inset, y: height - row - 1, width: width - inset * 2, height: 1 });
  }
  return rects.filter(rect => rect.width > 0 && rect.height > 0);
}

function quickPanelBounds(area) {
  const width = Math.max(1, Math.min(QUICK_PANEL_SIZE.width, area.width - 24));
  const height = Math.max(1, Math.min(QUICK_PANEL_SIZE.height, area.height - 24));
  const freeHeight = Math.max(0, area.height - height);
  const top = Math.min(110, Math.max(48, freeHeight * 0.24), freeHeight / 2);
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + top),
    width,
    height
  };
}

module.exports = { unionBounds, maxScaleFactor, tileLayout, sanitizeWindowBounds, QUICK_PANEL_SIZE, quickPanelBounds,
  CLIPBOARD_SHELF_SIZE, clipboardShelfBounds, roundedWindowShape };
