'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// Work in DIP until the renderer knows the captured video's actual pixel dimensions.
function recordingRegion(selection, bounds, displays) {
  if (![selection?.x, selection?.y, selection?.width, selection?.height, bounds?.x, bounds?.y].every(Number.isFinite)) throw Error('录屏区域无效');
  if (selection.width < 16 || selection.height < 16) throw Error('录屏区域至少需要 16 × 16');
  const area = { x: bounds.x + selection.x, y: bounds.y + selection.y, width: selection.width, height: selection.height };
  const display = displays.find(d => area.x >= d.bounds.x - .5 && area.y >= d.bounds.y - .5 && area.x + area.width <= d.bounds.x + d.bounds.width + .5 && area.y + area.height <= d.bounds.y + d.bounds.height + .5);
  if (!display) throw Error('请在同一块屏幕内选择录制区域');
  return { displayId: String(display.id), scaleFactor:Number(display.scaleFactor)||1, displayBounds: { ...display.bounds }, area: { x: Math.max(0, area.x - display.bounds.x), y: Math.max(0, area.y - display.bounds.y), width: Math.min(area.width, display.bounds.width), height: Math.min(area.height, display.bounds.height) } };
}

// Stream recording chunks to disk in order. The visible .webm only appears after commit.
class RecordingWriter {
  constructor(directory) { this.directory = directory; this.current = null; }
  async begin() {
    if (this.current) throw Error('已有录制正在保存');
    const id = crypto.randomUUID();
    const day = new Intl.DateTimeFormat('sv-SE', { timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date());
    const filePath = path.join(this.directory, `随序录屏-${day}-${id.slice(0, 8)}.webm`);
    const session = { id, filePath, partial: filePath + '.partial', bytes: 0, queue: Promise.resolve(), error: null, finishing: false };
    // Reserve before awaiting open so two starts cannot race.
    this.current = session;
    session.opening = fs.mkdir(this.directory, { recursive: true }).then(() => fs.open(session.partial, 'wx'));
    try {
      session.file = await session.opening;
      if(session.finishing) throw Error('录制已取消');
    }
    catch (error) { if(this.current===session&&!session.finishing)this.current = null; throw error; }
    return { id, filePath };
  }
  append(id, value) {
    const session = this.current;
    if (!session || session.id !== id || session.finishing || !session.file) return Promise.reject(Error('录制会话已结束'));
    const bytes = Buffer.isBuffer(value) ? value : value instanceof ArrayBuffer ? Buffer.from(value) : null;
    if (!bytes?.length || bytes.length > 32 * 1024 * 1024) return Promise.reject(Error('录制数据块无效'));
    // Bound one chunk; do not buffer the entire movie in main or renderer memory.
    session.queue = session.queue.then(async () => {
      if (session.error) throw session.error;
      let offset = 0;
      while (offset < bytes.length) {
        const result = await session.file.write(bytes, offset, bytes.length - offset);
        if (!result.bytesWritten) throw Error('录屏文件写入失败');
        offset += result.bytesWritten;
      }
      session.bytes += bytes.length;
    }).catch(error => { session.error = error; });
    return session.queue.then(() => { if (session.error) throw session.error; return { bytes: session.bytes }; });
  }
  async finish(id) {
    const session = this.current;
    if (!session || session.id !== id || session.finishing) throw Error('录制会话已结束');
    session.finishing = true;
    session.completion = (async()=>{ try {
      await session.queue;
      await session.file.close();
      if (session.error) throw session.error;
      if (!session.bytes) { await fs.unlink(session.partial); throw Error('录制没有生成视频，请重新开始'); }
      await fs.rename(session.partial, session.filePath);
      return { filePath: session.filePath, bytes: session.bytes };
    } finally { if(this.current===session)this.current = null; } })();
    return session.completion;
  }
  async abandon() {
    const session = this.current;
    if (!session) return;
    if(session.completion){await session.completion.catch(()=>{});return;}
    session.finishing = true;
    await session.queue;
    const file=await session.opening.catch(()=>null);
    await file?.close().catch(() => {});
    // Keep a nonempty partial recording for recovery after a crash.
    if (!session.bytes) await fs.unlink(session.partial).catch(() => {});
    if(this.current===session)this.current = null;
  }
}
module.exports = { recordingRegion, RecordingWriter };
