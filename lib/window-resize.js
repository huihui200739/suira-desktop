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
// All values are DIP. Reserve the shell work area on any taskbar edge.
function fitWorkArea(bounds, area, margin = 0) {
  if (!area || ![area.x,area.y,area.width,area.height].every(Number.isFinite) || area.width<=0 || area.height<=0) return {...bounds};
  const gap=Number.isFinite(margin)?Math.max(0,Math.min(margin,area.width/4,area.height/4)):0;
  area={x:area.x+gap,y:area.y+gap,width:area.width-gap*2,height:area.height-gap*2};
  const width=Math.min(bounds.width,area.width),height=Math.min(bounds.height,area.height);
  return {x:Math.round(Math.max(area.x,Math.min(bounds.x,area.x+area.width-width))),
    y:Math.round(Math.max(area.y,Math.min(bounds.y,area.y+area.height-height))),width:Math.round(width),height:Math.round(height)};
}
function clipToWorkAreas(shape, bounds, areas) {
  const result=[];
  for(const rect of shape)for(const area of areas){
    const x=Math.max(rect.x,area.x-bounds.x),y=Math.max(rect.y,area.y-bounds.y);
    const right=Math.min(rect.x+rect.width,area.x+area.width-bounds.x),bottom=Math.min(rect.y+rect.height,area.y+area.height-bounds.y);
    if(right>x&&bottom>y)result.push({x,y,width:right-x,height:bottom-y});
  }
  // Electron interprets an empty array as resetting the shape to a rectangle.
  return result.length?result:[{x:0,y:0,width:0,height:0}];
}
module.exports = { EDGES, resizeBounds, fitWorkArea, clipToWorkAreas };
