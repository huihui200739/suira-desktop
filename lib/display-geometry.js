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

module.exports = { unionBounds, maxScaleFactor, tileLayout, sanitizeWindowBounds };
