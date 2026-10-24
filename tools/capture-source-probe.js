'use strict';
const {connect}=require('./runtime-client');
(async()=>{const main=await connect(9319);try{
  console.log(JSON.stringify(await main.evaluate(`(async()=>{
    const {screen,desktopCapturer}=process.mainModule.require('electron');const d=screen.getAllDisplays();
    const {unionBounds,maxScaleFactor}=process.mainModule.require('./lib/display-geometry');const b=unionBounds(d),s=maxScaleFactor(d);
    const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(b.width*s),height:Math.round(b.height*s)},fetchWindowIcons:false});
    const dimensions=buf=>({width:buf.readUInt32BE(16),height:buf.readUInt32BE(20)});
    return {displays:d.map(x=>({id:x.id,bounds:x.bounds,size:x.size,scale:x.scaleFactor})),sources:sources.map(x=>({id:x.display_id,size:x.thumbnail.getSize(),scales:x.thumbnail.getScaleFactors(),png:dimensions(x.thumbnail.toPNG()),resizedPng:dimensions(x.thumbnail.resize({width:Math.round(b.width*s),height:Math.round(b.height*s),quality:'best'}).toPNG())}))};
  })()`)));}finally{main.ws.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
