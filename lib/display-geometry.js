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

module.exports = { unionBounds, maxScaleFactor, tileLayout };
