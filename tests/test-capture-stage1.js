'use strict';
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { normalizeSnapRects } = require('../lib/native-capture');
const tools = require('../src/overlay-annotations');
const { createPinWindows } = require('../lib/pin-windows');
const { OcrService, validatePngBuffer } = require('../lib/ocr');

function makePngChunk(type, data) {
  const bytes = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const size = Buffer.alloc(4), sum = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, bytes, sum]);
}

function makeCustomPng({ w = 4, h = 4, bitDepth = 8, colorType = 6, interlace = 0, plte = null, raw = null }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[12] = interlace;
  const payload = raw || (() => {
    const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
    const rowBytes = 1 + Math.ceil((w * ch * bitDepth) / 8);
    const buf = Buffer.alloc(h * rowBytes);
    return buf;
  })();
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), makePngChunk('IHDR', ihdr)];
  if (plte) parts.push(makePngChunk('PLTE', plte));
  parts.push(makePngChunk('IDAT', zlib.deflateSync(payload)));
  parts.push(makePngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

function makeValidPngBuffer(w = 4, h = 4) {
  const rows = Buffer.alloc(h * (1 + w * 4));
  rows.fill(255);
  for (let y = 0; y < h; y += 1) rows[y * (1 + w * 4)] = 0;
  return makeCustomPng({ w, h, bitDepth: 8, colorType: 6, interlace: 0, raw: rows });
}

(async () => {
  // 1. Native snap rect normalization: single-screen 150% DPI + mixed-DPI (100% + 150%) spanning window
  const toDip150 = (pt) => ({ x: Math.floor(pt.x / 1.5), y: Math.floor(pt.y / 1.5) });
  const rawWindows = [
    {
      x: 150, y: 150, width: 1200, height: 900,
      children: [
        { x: 150, y: 150, width: 1200, height: 900 },
        { x: 300, y: 300, width: 300, height: 150 },
        { x: 300, y: 300, width: 300, height: 150 },
        { x: 300, y: 300, width: 6, height: 6 }
      ]
    },
    { x: -100, y: 0, width: 600, height: 450, children: [] }
  ];
  const virtualBounds = { x: 0, y: 0, width: 1600, height: 900 };
  const normalized = normalizeSnapRects(rawWindows, virtualBounds, toDip150);
  assert.equal(normalized.length, 2);
  assert.deepEqual(normalized[0], {
    x: 100, y: 100, width: 800, height: 600,
    children: [{ x: 200, y: 200, width: 200, height: 100 }]
  });
  assert.equal(normalized[1].x, 0, 'Negative screen coord clamped to virtual left edge');
  assert.equal(normalized[1].width, 333);

  // Mixed-DPI spanning window: Display A (0..1920 @ 100%) + Display B (1920..4800 phys -> 1920..3840 DIP @ 150%)
  const mixedToDip = (pt) => pt.x < 1920
    ? { x: pt.x, y: pt.y }
    : { x: 1920 + Math.floor((pt.x - 1920) / 1.5), y: Math.floor(pt.y / 1.5) };
  const mixedBounds = { x: 0, y: 0, width: 3840, height: 1080 };
  const spanned = normalizeSnapRects([
    { x: 1000, y: 100, width: 1520, height: 600, children: [] },
    { x: 1800, y: 600, width: 300, height: 100, children: [] }
  ], mixedBounds, mixedToDip);
  assert.deepEqual(spanned[0], { x: 1000, y: 66, width: 1320, height: 634, children: [] }, 'Per-corner screenToDipPoint covers mixed-DPI span');
  assert.deepEqual(spanned[1], { x: 1800, y: 400, width: 240, height: 300, children: [] }, '300x100 window at y=600 across 100%/150% never vanishes');

  // 2. Smart snap hierarchy stack + real HWND parent/id sibling Z-order occlusion
  const displays = [{ id: 1, bounds: { x: 0, y: 0, width: 1600, height: 900 } }];
  const stack = tools.buildSnapStack({ x: 250, y: 240 }, normalized, displays, virtualBounds);
  assert.deepEqual(stack.map((s) => s.kind), ['control', 'window', 'screen']);

  // Front sibling (id:10, parent:1) completely encloses smaller behind sibling (id:11, parent:1),
  // AND has a real child (id:12, parent:10). Real child stays; behind sibling is occluded!
  const occludedWindows = [{
    id: 1, x: 0, y: 0, width: 500, height: 400,
    children: [
      { id: 10, parent: 1, x: 100, y: 100, width: 200, height: 160 }, // front sibling
      { id: 12, parent: 10, x: 120, y: 120, width: 80, height: 80 },  // real child of id:10 -> allowed
      { id: 11, parent: 1, x: 130, y: 130, width: 40, height: 40 }    // smaller behind sibling completely inside id:10 -> occluded!
    ]
  }];
  const occStack = tools.buildSnapStack({ x: 150, y: 150 }, occludedWindows, displays, virtualBounds);
  assert.deepEqual(occStack.map((s) => s.w), [80, 200, 500, 1600], 'Fully enclosed behind sibling is excluded via HWND parent chain');

  // Same-rect intermediate container deduplication preserves ancestor chain for true grandchild,
  // while keeping unrelated same-rect behind sibling's child occluded!
  const sameRectRaw = [{
    id: 1, x: 0, y: 0, width: 500, height: 400,
    children: [
      { id: 10, parent: 1, x: 100, y: 100, width: 200, height: 160 },  // outer kept
      { id: 20, parent: 10, x: 100, y: 100, width: 200, height: 160 }, // intermediate wrapper with identical rect -> deduplicated
      { id: 30, parent: 20, x: 120, y: 120, width: 80, height: 80 },   // grandchild of id:10 via id:20 -> MUST stay snap-able!
      { id: 40, parent: 1, x: 100, y: 100, width: 200, height: 160 },  // unrelated behind sibling with identical rect -> deduplicated
      { id: 41, parent: 40, x: 130, y: 130, width: 40, height: 40 }    // child of behind sibling -> MUST stay occluded by id:10!
    ]
  }];
  const sameRectNorm = normalizeSnapRects(sameRectRaw, virtualBounds);
  assert.equal(sameRectNorm[0].children.find((c) => c.id === 30)?.parent, 10, 'Grandchild parent remapped past same-rect wrapper to id:10');
  assert.equal(sameRectNorm[0].children.find((c) => c.id === 41)?.parent, 1, 'Behind sibling child remapped to window id:1, never front sibling');
  const sameRectStack = tools.buildSnapStack({ x: 150, y: 150 }, sameRectNorm, displays, virtualBounds);
  assert.deepEqual(sameRectStack.map((s) => s.w), [80, 200, 500, 1600], 'Grandchild survives same-rect wrapper dedup; behind sibling child occluded');

  // Deep chain (20 nested same-rect containers between id:10 and grandchild id:300) must never truncate at 16 hops
  const deepChildren = [{ id: 10, parent: 1, x: 100, y: 100, width: 200, height: 160 }];
  let prevId = 10;
  for (let depth = 0; depth < 20; depth += 1) {
    const wrapperId = 100 + depth;
    deepChildren.push({ id: wrapperId, parent: prevId, x: 100, y: 100, width: 200, height: 160 });
    prevId = wrapperId;
  }
  deepChildren.push({ id: 300, parent: prevId, x: 120, y: 120, width: 80, height: 80 });
  const deepNorm = normalizeSnapRects([{ id: 1, x: 0, y: 0, width: 500, height: 400, children: deepChildren }], virtualBounds);
  assert.equal(deepNorm[0].children.find((c) => c.id === 300)?.parent, 10, '20-deep same-rect wrapper chain remaps cleanly to id:10');
  const deepStack = tools.buildSnapStack({ x: 150, y: 150 }, deepNorm, displays, virtualBounds);
  assert.deepEqual(deepStack.map((s) => s.w), [80, 200, 500, 1600], 'Grandchild under 20 nested same-rect wrappers stays snap-able');

  // 3. Annotation hit-testing, cloning, translation (all types including new ones)
  const items = [
    { id: 1, type: 'rect', x: 100, y: 100, w: 120, h: 80, width: 4, color: '#f00' },
    { id: 2, type: 'ellipse', x: 300, y: 100, w: 100, h: 60, width: 4, color: '#0f0' },
    { id: 3, type: 'spotlight', x: 50, y: 250, w: 140, h: 90, width: 4, color: '#fff' },
    { id: 4, type: 'blur', x: 240, y: 250, w: 100, h: 50, width: 4, color: '#000' },
    { id: 5, type: 'highlighter', points: [{ x: 420, y: 260 }, { x: 520, y: 260 }], width: 4, color: '#ff0' },
    { id: 6, type: 'arrow', from: { x: 400, y: 340 }, to: { x: 500, y: 380 }, width: 4, color: '#00f' },
    { id: 7, type: 'steps', x: 600, y: 120, number: 1, width: 2, color: '#f00' },
    { id: 8, type: 'text', x: 600, y: 200, text: '随序标注', width: 4, color: '#000' }
  ];
  assert.equal(tools.hitTestAnnotations(items, { x: 100, y: 140 })?.id, 1);
  assert.equal(tools.hitTestAnnotations(items, { x: 160, y: 140 }), null);
  assert.equal(tools.hitTestAnnotations(items, { x: 350, y: 100 })?.id, 2);
  assert.equal(tools.hitTestAnnotations(items, { x: 100, y: 290 })?.id, 3);
  assert.equal(tools.hitTestAnnotations(items, { x: 280, y: 270 })?.id, 4);
  assert.equal(tools.hitTestAnnotations(items, { x: 470, y: 262 })?.id, 5);
  assert.equal(tools.hitTestAnnotations(items, { x: 450, y: 360 })?.id, 6);
  assert.equal(tools.hitTestAnnotations(items, { x: 604, y: 122 })?.id, 7);
  assert.equal(tools.hitTestAnnotations(items, { x: 620, y: 210 })?.id, 8);

  const cloned = tools.cloneAnnotation(items[5]);
  tools.translateAnnotation(cloned, 25, -10);
  assert.deepEqual(cloned.from, { x: 425, y: 330 });
  assert.deepEqual(items[5].from, { x: 400, y: 340 });

  // 4. Beautify layout computation (normal + 8000x5000 upper-bound clamp)
  const layout = tools.computeBeautifyLayout(400, 300, { padding: 48, radius: 18, windowChrome: true });
  assert.deepEqual(layout, {
    width: 496, height: 428, pad: 48, radius: 18, titleBar: 32,
    cardX: 48, cardY: 48, cardWidth: 400, cardHeight: 332, imageX: 48, imageY: 80, imageW: 400, imageH: 300
  });
  const hugeLayout = tools.computeBeautifyLayout(8000, 5000, { padding: 48, radius: 18, windowChrome: true });
  assert.ok(hugeLayout.width <= 16384 && hugeLayout.height <= 16384 && hugeLayout.width * hugeLayout.height <= 40_000_000,
    'Beautified 8000x5000 stays within export pixel budget: ' + JSON.stringify(hugeLayout));

  // 5. OcrService.recognizeBuffer rejects malformed/truncated PNG AND corrupt-IDAT PNG cleanly without crashing
  const ocrService = new OcrService();
  await assert.rejects(() => ocrService.recognizeBuffer(Buffer.from('iVBORw0KGgo=', 'base64')), /PNG|无效|不完整/);
  const corruptIdatPng = (() => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(4, 0); ihdr.writeUInt32BE(4, 4); ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      makePngChunk('IHDR', ihdr),
      makePngChunk('IDAT', Buffer.from([0x78, 0x9c, 0xff, 0xff, 0x00, 0x01])),
      makePngChunk('IEND', Buffer.alloc(0))
    ]);
  })();
  await assert.rejects(() => ocrService.recognizeBuffer(corruptIdatPng), /损坏/);
  // Interlaced Adam7 4x4 RGBA: 1-byte inflated payload rejected; exact 71-byte Adam7 accepted; bad pass filter rejected
  const shortAdam7 = makeCustomPng({ w: 4, h: 4, bitDepth: 8, colorType: 6, interlace: 1, raw: Buffer.from([0]) });
  await assert.rejects(() => ocrService.recognizeBuffer(shortAdam7), /长度/);
  const validAdam7 = makeCustomPng({ w: 4, h: 4, bitDepth: 8, colorType: 6, interlace: 1, raw: Buffer.alloc(71) });
  validatePngBuffer(validAdam7);
  const badFilterAdam7Raw = Buffer.alloc(71);
  badFilterAdam7Raw[10] = 9; // pass 5 scanline filter byte = 9 (invalid)
  const badFilterAdam7 = makeCustomPng({ w: 4, h: 4, bitDepth: 8, colorType: 6, interlace: 1, raw: badFilterAdam7Raw });
  await assert.rejects(() => ocrService.recognizeBuffer(badFilterAdam7), /滤镜/);
  // PLTE spec checks: 1-bit indexed with 3 entries (> 2^1) rejected; 2 entries accepted; grayscale with PLTE rejected
  const overPlte1Bit = makeCustomPng({ w: 4, h: 4, bitDepth: 1, colorType: 3, plte: Buffer.alloc(9) });
  await assert.rejects(() => ocrService.recognizeBuffer(overPlte1Bit), /调色板/);
  const validPlte1Bit = makeCustomPng({ w: 4, h: 4, bitDepth: 1, colorType: 3, plte: Buffer.alloc(6) });
  validatePngBuffer(validPlte1Bit);
  const grayWithPlte = makeCustomPng({ w: 4, h: 4, bitDepth: 8, colorType: 0, plte: Buffer.alloc(6) });
  await assert.rejects(() => ocrService.recognizeBuffer(grayWithPlte), /调色板/);
  // Bad chunk CRC & trailing bytes/IDAT after IEND must be rejected
  const badCrcPng = (() => {
    const valid = makeValidPngBuffer(4, 4);
    const idatIdx = valid.indexOf(Buffer.from('IDAT'));
    const len = valid.readUInt32BE(idatIdx - 4);
    const mutated = Buffer.from(valid);
    mutated[idatIdx + 4 + len] ^= 0x01; // flip 1 bit in IDAT CRC
    return mutated;
  })();
  await assert.rejects(() => ocrService.recognizeBuffer(badCrcPng), /校验/);
  const trailingAfterIend = Buffer.concat([makeValidPngBuffer(4, 4), makePngChunk('IDAT', Buffer.from([1, 2, 3]))]);
  await assert.rejects(() => ocrService.recognizeBuffer(trailingAfterIend), /结束块|多余/);
  // High-bit spoofed IEND (0xC9 0x45 0x4E 0x44 with valid recomputed CRC) & unknown critical chunk must be rejected
  const spoofedIend = (() => {
    const valid = makeValidPngBuffer(4, 4);
    const withoutIend = valid.subarray(0, valid.length - 12);
    const fakeType = Buffer.from([0xc9, 0x45, 0x4e, 0x44]);
    let crc = 0xffffffff;
    for (const byte of fakeType) {
      crc ^= byte;
      for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4), sum = Buffer.alloc(4);
    sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([withoutIend, size, fakeType, sum]);
  })();
  await assert.rejects(() => ocrService.recognizeBuffer(spoofedIend), /类型无效/);
  const unknownCritical = (() => {
    const valid = makeValidPngBuffer(4, 4);
    const iendPos = valid.length - 12;
    return Buffer.concat([valid.subarray(0, iendPos), makePngChunk('XXXX', Buffer.alloc(0)), valid.subarray(iendPos)]);
  })();
  await assert.rejects(() => ocrService.recognizeBuffer(unknownCritical), /未知关键/);

  // 6. Pin windows: passthrough, hover-unlock, collapse auto-unlock, toggleVisibility, OCR validation & cancellation
  const handlers = new Map();
  const listeners = new Map();
  const sent = [];
  const ignoreCalls = [];
  let copiedText = '';
  let ocrSeenBytes = 0;
  let ocrResolver = null;
  let fakeWin = null;
  const validPng = makeValidPngBuffer(8, 8);
  const validDataUrl = 'data:image/png;base64,' + validPng.toString('base64');

  const fakeWindowIpc = {
    create: (_role, opts) => {
      let bounds = { x: 100, y: 100, width: opts.width, height: opts.height };
      let visible = true, opacity = 1;
      fakeWin = {
        webContents: { send: (ch, v) => sent.push([ch, v]) },
        isDestroyed: () => false,
        isVisible: () => visible,
        hide: () => { visible = false; },
        showInactive: () => { visible = true; },
        getBounds: () => ({ ...bounds }),
        setBounds: (b) => { bounds = { ...b }; },
        getOpacity: () => opacity,
        setOpacity: (v) => { opacity = v; },
        setIgnoreMouseEvents: (ignore, options) => ignoreCalls.push([ignore, options || null]),
        loadFile: () => {},
        on: () => {}
      };
      return fakeWin;
    },
    handle: (ch, fn) => handlers.set(ch, fn),
    handleSync: (ch, fn) => handlers.set(ch, fn),
    on: (ch, fn) => listeners.set(ch, fn)
  };
  const fakeNativeImage = {
    createFromBuffer: (buf) => {
      const valid = buf.length >= 33 && buf.includes(Buffer.from('IEND'));
      return {
        isEmpty: () => !valid,
        getSize: () => ({ width: 8, height: 8 }),
        toPNG: () => buf
      };
    }
  };
  const pins = createPinWindows({
    windowIpc: fakeWindowIpc,
    BrowserWindow: { fromWebContents: () => fakeWin },
    screen: {
      getCursorScreenPoint: () => ({ x: 100, y: 100 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })
    },
    nativeImage: fakeNativeImage,
    dialog: {},
    app: {},
    findImage: () => null,
    onClosed: () => {},
    prepareFloatingSurface: () => {},
    toastToUser: () => {},
    writeClipboardText: async (text) => { copiedText = text; },
    writeClipboardImage: async () => {},
    recognizePinImage: async (buf) => {
      ocrSeenBytes = buf.length;
      if (ocrResolver) return new Promise((r) => { ocrResolver = () => r({ text: '迟到结果' }); });
      return { text: '钉图识别文字' };
    }
  });
  pins.registerIpc();
  pins.create(validDataUrl, { width: 320, height: 240 });
  const ev = { sender: fakeWin.webContents };

  const r1 = await handlers.get('pin:passthrough')(ev, { enabled: true });
  assert.deepEqual(r1, { ok: true, passthrough: true });
  assert.deepEqual(ignoreCalls.at(-1), [true, { forward: true }]);
  assert.deepEqual(sent.at(-1), ['pin:passthrough-changed', true]);

  const r2 = await handlers.get('pin:passthrough')(ev, { enabled: true, hoverUnlock: true });
  assert.deepEqual(r2, { ok: true, passthrough: true });
  assert.deepEqual(ignoreCalls.at(-1), [false, null]);

  const rToggle = pins.toggleVisibility();
  assert.equal(rToggle.passthroughCleared, 1);
  assert.deepEqual(sent.at(-1), ['pin:passthrough-changed', false]);

  await handlers.get('pin:passthrough')(ev, { enabled: true });
  listeners.get('pin:collapse')(ev, true);
  assert.deepEqual(sent.at(-1), ['pin:passthrough-changed', false]);
  assert.equal((await handlers.get('pin:passthrough')(ev, { enabled: true })).ok, false);
  listeners.get('pin:collapse')(ev, false);

  // Rejects bad URL and truncated PNG signature
  assert.equal((await handlers.get('pin:ocr')(ev, { dataUrl: 'http://evil.example/a.png' })).ok, false);
  assert.equal((await handlers.get('pin:ocr')(ev, { dataUrl: 'data:image/png;base64,iVBORw0KGgo=' })).ok, false, 'Rejects truncated PNG');

  // Accepts valid PNG and copies recognized text
  const goodOcr = await handlers.get('pin:ocr')(ev, { dataUrl: validDataUrl });
  assert.deepEqual(goodOcr, { ok: true, text: '钉图识别文字' });
  assert.ok(ocrSeenBytes >= validPng.length);
  assert.equal(copiedText, '钉图识别文字');

  // Collapse mid-flight cancels OCR and does NOT overwrite clipboard
  copiedText = 'keep-me';
  ocrResolver = () => {};
  const inflight = handlers.get('pin:ocr')(ev, { dataUrl: validDataUrl });
  await new Promise((r) => setTimeout(r, 10));
  listeners.get('pin:collapse')(ev, true);
  ocrResolver();
  const staleRes = await inflight;
  assert.equal(staleRes.canceled, true);
  assert.equal(copiedText, 'keep-me', 'Canceled pin OCR must not overwrite clipboard');

  console.log('PASS Stage 1 capture snap, mixed-DPI, occlusion, beautify cap, and pin passthrough/OCR');
})().catch((e) => { console.error(e); process.exitCode = 1; });
