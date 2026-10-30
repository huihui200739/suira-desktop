'use strict';
const EDGES = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);
function resizeBounds(bounds, edge, dx, dy, minWidth, minHeight) {
  if (!EDGES.has(edge) || !Number.isFinite(dx) || !Number.isFinite(dy)) return { ...bounds };
  let { x, y, width, height } = bounds;
  if (edge.includes('e')) width = Math.max(minWidth, width + dx);
  if (edge.includes('s')) height = Math.max(minHeight, height + dy);
  if (edge.includes('w')) { const next = Math.max(minWidth, width - dx); x += width - next; width = next; }
  if (edge.includes('n')) { const next = Math.max(minHeight, height - dy); y += height - next; height = next; }
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}
module.exports = { EDGES, resizeBounds };
