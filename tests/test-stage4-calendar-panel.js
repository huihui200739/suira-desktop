'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// 1. CalendarData.clock() formats exact HH:mm:ss (00:00:00..23:59:59, never 24:xx:xx)
{
  const src = read('src/calendar-data.js');
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox);
  const { clock } = sandbox.window.CalendarData;
  assert.equal(typeof clock, 'function');
  assert.equal(clock(new Date(2026, 0, 1, 0, 0, 0)), '00:00:00');
  assert.equal(clock(new Date(2026, 0, 1, 0, 5, 9)), '00:05:09');
  assert.equal(clock(new Date(2026, 5, 15, 9, 8, 7)), '09:08:07');
  assert.equal(clock(new Date(2026, 11, 31, 23, 59, 59)), '23:59:59');
}

// 2. Behavioral test: calendar wheel inertia lock + idle-gap & reversal unlock (extracted from src/workspace.js)
{
  const ws = read('src/workspace.js');
  const start = ws.indexOf('  let wheelLast = 0,');
  const end = ws.indexOf("  document.addEventListener('keydown'", start);
  assert.ok(start > 0 && end > start, 'wheel handler block must exist in src/workspace.js');
  const wheelCode = ws.slice(start, end);

  let nowMs = 1000;
  let listener = null;
  let month = new Date(2026, 10, 1); // 2026-11
  const grid = {
    classes: new Set(),
    offsetWidth: 400,
    classList: {
      remove(...xs) { xs.forEach((x) => grid.classes.delete(x)); },
      add(...xs) { xs.forEach((x) => grid.classes.add(x)); }
    },
    addEventListener(type, fn) { if (type === 'wheel') listener = fn; }
  };
  const sandbox = {
    calendarView: 'month',
    month,
    calendar() {},
    $: (id) => (id === 'calendar-grid' ? grid : null),
    performance: { now: () => nowMs }
  };
  vm.runInNewContext(wheelCode, sandbox);
  assert.equal(typeof listener, 'function');

  const fireWheel = (deltaY, t) => {
    nowMs = t;
    let prevented = false;
    listener({ deltaX: 0, deltaY, deltaMode: 0, ctrlKey: false, metaKey: false, preventDefault: () => { prevented = true; } });
    return prevented;
  };
  const ym = () => `${sandbox.month.getFullYear()}-${String(sandbox.month.getMonth() + 1).padStart(2, '0')}`;

  // Inertial 6-frame same-direction gesture spaced 50ms apart -> advances ONLY 1 month
  for (let i = 0; i < 6; i++) fireWheel(100, 1000 + i * 50);
  assert.equal(ym(), '2026-12', 'inertial single gesture (6 frames @ 50ms) must advance only 1 month');
  assert.ok(grid.classes.has('is-month-next'));

  // Pause 180ms (> 160ms gap) and scroll again -> smoothly advances 2nd month
  fireWheel(100, 1250 + 180);
  assert.equal(ym(), '2027-01', 'deliberate scroll after gesture idle gap must advance 2nd month');

  // Immediate direction reversal (80ms later) -> steps back immediately
  fireWheel(-100, 1430 + 80);
  assert.equal(ym(), '2026-12', 'opposite-direction scroll must unlock immediately');
  assert.ok(grid.classes.has('is-month-prev'));

  // Small-amplitude reverse touchpad frames (+20 x 6 @ 35ms) -> accumulates to >=48, advances 1 month, then stays locked
  for (let i = 0; i < 6; i++) fireWheel(20, 1510 + 35 * (i + 1));
  assert.equal(ym(), '2027-01', 'small-amplitude reverse frames must accumulate across frames and step once');
  assert.ok(grid.classes.has('is-month-next'));

  // Small-amplitude reverse back (-20 x 6 @ 35ms) -> accumulates to <=-48, steps back 1 month, then stays locked
  for (let i = 0; i < 6; i++) fireWheel(-20, 1720 + 35 * (i + 1));
  assert.equal(ym(), '2026-12', 'small-amplitude negative reverse frames must accumulate and step back once');
  assert.ok(grid.classes.has('is-month-prev'));
}

// 3. Behavioral test: strict second-boundary clock alignment (23:59:59.980 -> 20ms delay, pauses when hidden)
{
  const ws = read('src/workspace.js');
  const clockStart = ws.indexOf('      let tick;');
  const clockEnd = ws.indexOf('      updateClock();', clockStart);
  assert.ok(clockStart > 0 && clockEnd > clockStart, 'clock block must exist');
  const clockCode = ws.slice(clockStart, clockEnd) + '\n      updateClock();';

  let scheduledDelay = null;
  let hidden = false;
  const clockEl = { dateTime: '', textContent: '' };
  class FakeDate extends Date {
    constructor() { super(2026, 11, 31, 23, 59, 59, 980); }
  }
  const listeners = {};
  const sandbox = {
    Date: FakeDate,
    clock: clockEl,
    clearTimeout() { scheduledDelay = null; },
    setTimeout(_fn, delay) { scheduledDelay = delay; return 1; },
    document: {
      get hidden() { return hidden; },
      addEventListener(type, fn) { listeners[type] = fn; }
    },
    window: {
      CalendarData: { clock: (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}` },
      addEventListener() {}
    }
  };
  vm.runInNewContext(clockCode, sandbox);
  assert.equal(clockEl.textContent, '23:59:59');
  assert.equal(scheduledDelay, 20, '23:59:59.980 must schedule exact 20ms to 00:00:00.000');

  hidden = true;
  listeners.visibilitychange();
  assert.equal(scheduledDelay, null, 'hidden document must clear timer and not reschedule');
}

// 4. Static regression invariants on calendar quick-add, QuickPanel shortcuts & overlays
{
  const ws = read('src/workspace.js');
  const css = read('src/styles.css');
  const html = read('src/quickpanel.html');
  const qcss = read('src/quickpanel.css');
  const qjs = read('src/quickpanel.js');

  assert.match(ws, /const submitMode = agendaMode;/, 'quick-add captures submitMode before async save');
  assert.match(ws, /请选择有效的目标日期/, 'empty countdown date is rejected instead of defaulting');
  assert.match(ws, /倒数日请选择今天或之后的日期/);
  assert.match(ws, /if \(!savedOk && hadFocus\) quickTitle\.focus/, 'failed quick-add restores focus to title input');
  assert.match(css, /\.tool-window \.calendar-clock \{[^}]*font-variant-numeric:\s*tabular-nums/);
  assert.match(css, /\.calendar-quick-form/);
  assert.match(css, /@keyframes calendar-month-next/);
  assert.match(css, /@keyframes calendar-month-prev/);

  assert.match(html, /Alt\+1~9 直达/);
  assert.match(qcss, /\.command-hotkey/);
  assert.match(qcss, /\.panel\[data-presentation="window"\] \.app-launch-number:not\(:empty\)/);
  assert.match(qcss, /\.panel \.key\.is-key-triggered \.key-card/);
  assert.match(qjs, /const isModeSwitchKey = \(event\) =>/);
  assert.match(qjs, /if\(isModeSwitchKey\(event\)\)return;/, 'more menu lets Ctrl+1..3 / Ctrl+Tab bubble to mode switch');
  assert.match(qjs, /const hasBlockingOverlay = \(\) =>/);
  assert.match(qjs, /if \(event\.isComposing \|\| state\.composing \|\| hasBlockingOverlay\(\)\) return;/, 'search input blocks Alt+1..9 while OCR/overlay open');
  assert.doesNotMatch(qjs, /presentation==='fullscreen'&&state\.mode==='apps'&&!state\.query&&!event\.ctrlKey&&!event\.altKey&&!event\.metaKey&&\/\^\[1-9\]\$\/\.test\(event\.key\)/, 'focused search box in fullscreen apps mode must not hijack bare digits');
}

console.log('Stage 4 calendar & quickpanel checks passed.');
