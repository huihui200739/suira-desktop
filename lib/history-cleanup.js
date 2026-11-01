'use strict';
const HISTORY_SOURCES=new Set(['clipboard','screenshot','scroll-capture','long-capture','ocr','derived','image-edit']);
function historyCleanup(items,tasks=[]){const referenced=new Set([...tasks.flatMap(task=>task.itemIds||[]),...items.filter(item=>item.pinned).map(item=>item.id)]);const removed=[],kept=[];
 let expanded=true;while(expanded){expanded=false;for(const item of items){if(referenced.has(item.id)&&item.meta?.originItemId&&!referenced.has(item.meta.originItemId)){referenced.add(item.meta.originItemId);expanded=true;}}}
 for(const item of items){if(HISTORY_SOURCES.has(item.source?.type)&&!item.pinned&&!referenced.has(item.id)&&!item.meta?.workspace)removed.push(item);else kept.push(item);}
 return {removed,kept,protectedCount:items.filter(item=>HISTORY_SOURCES.has(item.source?.type)&&(item.pinned||referenced.has(item.id))).length};
}
module.exports={historyCleanup};
