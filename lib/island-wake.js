'use strict';

const { spawn } = require('node:child_process');

const SLEEP_SIZE = Object.freeze({ width: 440, height: 36 });

function contains(rect, point) {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
}

function receiverBounds(area) {
  const width = Math.max(1, Math.min(SLEEP_SIZE.width, area.width - 24));
  return { x:Math.round(area.x + (area.width - width) / 2), y:area.y, width, height:Math.min(SLEEP_SIZE.height, area.height) };
}

// 原生窗口只覆盖贴边托盘本身，不为 CSS 阴影多留一圈矩形底板。
function edgeWindowShape(width, height, radius = 16) {
  const r = Math.min(radius, Math.floor(width / 2), height);
  const rects = [{ x:0, y:0, width, height:height - r }];
  for (let row = 0; row < r; row++) {
    const inset = Math.ceil(r - Math.sqrt(r * r - (row + .5) ** 2));
    rects.push({x:inset, y:height-r+row, width:width-inset*2, height:1});
  }
  return rects.filter(rect => rect.width > 0 && rect.height > 0);
}

// Only a held pointer in a top-centre zone can arm a receiver. This is NOT file
// detection: the renderer must still verify dataTransfer.types includes Files.
function receiverDisplay(displays, point) {
  if (!point?.down) return null;
  return displays.find(display => contains(receiverBounds(display.workArea), point)) || null;
}

class IslandPointerProbe {
  constructor({ executable, spawnImpl = spawn, onPointer = () => {}, onError = () => {}, readyTimeout = 5000 }) {
    Object.assign(this, { executable, spawnImpl, onPointer, onError, readyTimeout });
    this.status = 'idle';
    this.child = null;
    this.buffer = '';
  }

  async start() {
    if (this.starting) return this.starting;
    if (this.status === 'watching') return Promise.resolve(true);
    this.status = 'starting';
    this.starting = new Promise(resolve => {
      this.resolve = resolve;
      this.timer = setTimeout(() => this.fail('拖动侦测启动超时'), this.readyTimeout);
      try {
        const child = this.spawnImpl(this.executable, [], { windowsHide:true, stdio:['pipe','pipe','pipe'] });
        this.child = child;
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', chunk => {
          if (child !== this.child) return;
          this.buffer += chunk;
          if (this.buffer.length > 16384) { this.fail('拖动侦测输出异常'); return; }
          let index;
          while ((index = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, index).trim();
            this.buffer = this.buffer.slice(index + 1);
            if (line === 'READY') {
              this.status = 'watching';
              clearTimeout(this.timer);
              this.resolve?.(true);
              this.resolve = null;
            } else if (this.status === 'watching') {
              const match = /^POINTER (-?\d+) (-?\d+) (DOWN|UP)$/.exec(line);
              if (match) {
                try { this.onPointer({ x:Number(match[1]), y:Number(match[2]), down:match[3] === 'DOWN' }); }
                catch (error) { this.fail(error.message); }
              }
            }
          }
        });
        child.stderr.on('data', () => {});
        child.on('error', error => { if (child === this.child) this.fail(error.message); });
        child.on('exit', () => { if (child === this.child) this.fail('拖动侦测进程已退出'); });
      } catch (error) { this.fail(error.message); }
    });
    const started = await this.starting;
    this.starting = null;
    return started;
  }

  fail(message) {
    if (this.status === 'stopped' || this.status === 'error') return;
    this.status = 'error';
    this.disposeChild();
    this.resolve?.(false);
    this.resolve = null;
    try { this.onError(message); } catch {}
  }

  disposeChild() {
    clearTimeout(this.timer);
    const child = this.child;
    this.child = null;
    this.buffer = '';
    if (child) {
      try { child.stdin.end(); } catch {}
      try { child.kill(); } catch {}
    }
  }

  stop() {
    this.status = 'stopped';
    this.disposeChild();
    this.resolve?.(false);
    this.resolve = null;
  }
}

module.exports = { SLEEP_SIZE, contains, receiverBounds, receiverDisplay, edgeWindowShape, IslandPointerProbe };
