'use strict';
/* 虚拟桌面几何：多屏并集、缩放、分块布局。 */

const assert = require('assert');
const { unionBounds, maxScaleFactor, tileLayout, sanitizeWindowBounds, quickPanelBounds, clipboardShelfBounds, roundedWindowShape } = require('../lib/display-geometry');

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log('  PASS  ' + n); pass++; } catch (e) { console.log('  FAIL  ' + n + ' -> ' + e.message); fail++; } };

const mk = (id, x, y, width, height, scaleFactor = 1) => ({ id, bounds: { x, y, width, height }, scaleFactor });

console.log('\n== 虚拟桌面并集 ==');
t('单屏：并集即自身', () => {
  const r = unionBounds([mk(1, 0, 0, 1920, 1080)]);
  assert.deepStrictEqual(r, { x: 0, y: 0, width: 1920, height: 1080 });
});
t('副屏在右侧：宽度相加', () => {
  const r = unionBounds([mk(1, 0, 0, 1920, 1080), mk(2, 1920, 0, 2560, 1440)]);
  assert.deepStrictEqual(r, { x: 0, y: 0, width: 4480, height: 1440 });
});
t('副屏在左侧：x 为负，宽度仍正确', () => {
  const r = unionBounds([mk(1, 0, 0, 1920, 1080), mk(2, -1280, 0, 1280, 1024)]);
  assert.strictEqual(r.x, -1280, 'x 应为 -1280');
  assert.strictEqual(r.width, 3200, '宽度应为 3200');
  assert.strictEqual(r.y, 0);
  assert.strictEqual(r.height, 1080);
});
t('副屏在上方：y 为负', () => {
  const r = unionBounds([mk(1, 0, 0, 1920, 1080), mk(2, 0, -1080, 1920, 1080)]);
  assert.strictEqual(r.y, -1080);
  assert.strictEqual(r.height, 2160);
});
t('四角分布的多屏', () => {
  const r = unionBounds([
    mk(1, 0, 0, 1920, 1080),
    mk(2, -1920, 0, 1920, 1080),
    mk(3, 0, -1080, 1920, 1080),
    mk(4, 1920, 1080, 1920, 1080)
  ]);
  assert.deepStrictEqual(r, { x: -1920, y: -1080, width: 5760, height: 3240 });
});
t('空数组返回 null', () => assert.strictEqual(unionBounds([]), null));
t('非数组返回 null', () => assert.strictEqual(unionBounds(null), null));
t('跳过缺 bounds 的项', () => {
  const r = unionBounds([mk(1, 0, 0, 800, 600), { id: 2 }]);
  assert.deepStrictEqual(r, { x: 0, y: 0, width: 800, height: 600 });
});

console.log('\n== 缩放比选择 ==');
t('混合 DPI 时取最大值', () => {
  assert.strictEqual(maxScaleFactor([mk(1, 0, 0, 1920, 1080, 1), mk(2, 0, 0, 2560, 1440, 1.5)]), 1.5);
});
t('全部 1x 时为 1', () => assert.strictEqual(maxScaleFactor([mk(1, 0, 0, 800, 600, 1)]), 1));
t('缺 scaleFactor 按 1 计', () => {
  assert.strictEqual(maxScaleFactor([{ id: 1, bounds: { x: 0, y: 0, width: 800, height: 600 } }]), 1);
});
t('空数组为 1', () => assert.strictEqual(maxScaleFactor([]), 1));
t('2x 屏与 1x 屏混合取 2', () => {
  assert.strictEqual(maxScaleFactor([mk(1, 0, 0, 800, 600, 1), mk(2, 0, 0, 800, 600, 2)]), 2);
});

console.log('\n== 分块布局 ==');
t('单屏 1x：位置归零', () => {
  const r = tileLayout([mk(1, 0, 0, 1920, 1080)], { x: 0, y: 0 }, 1);
  assert.deepStrictEqual(r, [{ id: 1, x: 0, y: 0, width: 1920, height: 1080 }]);
});
t('副屏在左：左侧块 x 为 0，主屏 x 为偏移量', () => {
  const displays = [mk(1, 0, 0, 1920, 1080), mk(2, -1280, 0, 1280, 1024)];
  const origin = unionBounds(displays);
  const r = tileLayout(displays, origin, 1);
  const left = r.find((x) => x.id === 2);
  const main = r.find((x) => x.id === 1);
  assert.strictEqual(left.x, 0, '最左侧块应从 0 开始');
  assert.strictEqual(main.x, 1280, '主屏应偏移 1280');
});
t('按 2x 缩放时尺寸翻倍', () => {
  const r = tileLayout([mk(1, 0, 0, 1920, 1080)], { x: 0, y: 0 }, 2);
  assert.strictEqual(r[0].width, 3840);
  assert.strictEqual(r[0].height, 2160);
});
t('混合 DPI：各块按统一缩放比放大', () => {
  const displays = [mk(1, 0, 0, 1920, 1080, 1), mk(2, 1920, 0, 1280, 720, 1.5)];
  const origin = unionBounds(displays);
  const r = tileLayout(displays, origin, 1.5);
  const a = r.find((x) => x.id === 1);
  const b = r.find((x) => x.id === 2);
  assert.strictEqual(a.width, 2880, '1920 × 1.5');
  assert.strictEqual(a.height, 1620);
  assert.strictEqual(b.x, 2880, '副屏从主屏右侧开始');
  assert.strictEqual(b.width, 1920, '1280 × 1.5');
});
t('分块不重叠且完整覆盖', () => {
  const displays = [mk(1, 0, 0, 1920, 1080), mk(2, 1920, 0, 1920, 1080)];
  const origin = unionBounds(displays);
  const r = tileLayout(displays, origin, 1);
  const total = r.reduce((sum, x) => sum + x.width * x.height, 0);
  assert.strictEqual(total, origin.width * origin.height, '面积应等于虚拟桌面面积');
});
t('尺寸至少为 1（防止零宽高）', () => {
  const r = tileLayout([mk(1, 0, 0, 0, 0)], { x: 0, y: 0 }, 1);
  assert.ok(r[0].width >= 1 && r[0].height >= 1);
});
t('非数组返回空', () => assert.deepStrictEqual(tileLayout(null, { x: 0, y: 0 }, 1), []));

console.log('\n== 主窗口状态恢复（sanitizeWindowBounds）==');
const mainScreen = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const secondScreen = { bounds: { x: -1280, y: 0, width: 1280, height: 720 }, workArea: { x: -1280, y: 0, width: 1280, height: 720 } };
const fallback = { width: 1180, height: 820 };

t('没有记忆时回落为居中默认尺寸', () => {
  const r = sanitizeWindowBounds(null, [mainScreen], fallback);
  assert.strictEqual(r.width, 1180);
  assert.strictEqual(r.height, 820);
  assert.strictEqual(r.x, 370, '(1920-1180)/2');
  assert.strictEqual(r.y, 110, '(1040-820)/2');
});
t('合法记忆原样保留', () => {
  const r = sanitizeWindowBounds({ x: 120, y: 80, width: 1000, height: 700 }, [mainScreen], fallback);
  assert.deepStrictEqual(r, { x: 120, y: 80, width: 1000, height: 700 });
});
t('记在已拔掉的副屏上：回落到主屏默认位置', () => {
  const r = sanitizeWindowBounds({ x: -3000, y: -2000, width: 1000, height: 700 }, [mainScreen], fallback);
  assert.strictEqual(r.x, 370);
  assert.strictEqual(r.width, 1180);
});
t('核心可见区域不足时同样回落（80×40 以下）', () => {
  const r = sanitizeWindowBounds({ x: 1900, y: 0, width: 1000, height: 700 }, [mainScreen], fallback);
  assert.strictEqual(r.x, 370);
});
t('只露出一条边也回落，不会让窗口半截在外面找不回来', () => {
  const r = sanitizeWindowBounds({ x: 0, y: 1030, width: 1000, height: 700 }, [mainScreen], fallback);
  assert.strictEqual(r.y, 110);
  // 恰好留出 40px（默认可见下限）时算「还能找回来」，不强制回落
  const edge = sanitizeWindowBounds({ x: 0, y: 1000, width: 1000, height: 700 }, [mainScreen], fallback);
  assert.strictEqual(edge.y, 1000);
});
t('宽高超过当前屏幕时夹到屏幕工作区', () => {
  const r = sanitizeWindowBounds({ x: 0, y: 0, width: 4000, height: 3000 }, [mainScreen], fallback);
  assert.strictEqual(r.width, 1920);
  assert.strictEqual(r.height, 1040);
});
t('NaN / 缺字段：回落默认而不是抛错', () => {
  for (const bad of [{}, { x: NaN, y: 0, width: 800, height: 600 }, { x: 0, y: 0, width: 'wide' }]) {
    const r = sanitizeWindowBounds(bad, [mainScreen], fallback);
    assert.strictEqual(r.width, 1180);
  }
});
t('记录在负坐标副屏上且仍存在：保留原位置', () => {
  const r = sanitizeWindowBounds({ x: -1100, y: 20, width: 900, height: 600 }, [mainScreen, secondScreen], fallback);
  assert.strictEqual(r.x, -1100);
  assert.strictEqual(r.width, 900);
});
t('优先使用 workArea（避开任务栏）', () => {
  const r = sanitizeWindowBounds({ x: 0, y: 0, width: 3000, height: 3000 }, [mainScreen], fallback);
  assert.strictEqual(r.height, 1040, '应夹到 workArea 高度而不是 bounds 高度');
});
t('没有显示器信息时给一个可用的默认值', () => {
  const r = sanitizeWindowBounds(null, [], fallback);
  assert.deepStrictEqual({ x: r.x, y: r.y, width: r.width, height: r.height }, { x: 0, y: 0, width: 1180, height: 820 });
});

console.log('\n== 加宽面板的工作区适配 ==');
t('标准屏幕居中显示加宽面板', () => {
  const bounds = quickPanelBounds({ x: 0, y: 0, width: 1920, height: 1040 });
  assert.strictEqual(bounds.width, 1160);
  assert.strictEqual(bounds.x, 380);
});
t('低分辨率、高 DPI 与负坐标副屏：四边都留在工作区内', () => {
  for (const area of [
    { x: 0, y: 0, width: 800, height: 560 },
    { x: -1280, y: -40, width: 1280, height: 680 },
    { x: 20, y: 30, width: 640, height: 480 }
  ]) {
    const b = quickPanelBounds(area);
    assert.ok(b.x >= area.x + 12);
    assert.ok(b.y >= area.y + 12);
    assert.ok(b.x + b.width <= area.x + area.width - 12);
    assert.ok(b.y + b.height <= area.y + area.height - 12);
  }
});

t('底部内容架跟随负坐标副屏、小屏和任务栏工作区，始终完整可见', () => {
  for (const area of [{x:0,y:0,width:1920,height:1040}, {x:-1280,y:-40,width:1280,height:680}, {x:20,y:40,width:640,height:480}]) {
    const b = clipboardShelfBounds(area);
    assert.ok(b.x >= area.x && b.y >= area.y);
    assert.ok(b.x + b.width <= area.x + area.width);
    assert.strictEqual(b.y + b.height, area.y + area.height - 16);
    assert.ok(b.width >= Math.min(1600, area.width - 32));
  }
});
t('原生圆角在四角都裁掉矩形底板，并保持中间连续', () => {
  const shape = roundedWindowShape(1160, 620);
  const covers = (x,y) => shape.some(r => x >= r.x && x < r.x+r.width && y >= r.y && y < r.y+r.height);
  for (const [x,y] of [[0,0],[1159,0],[0,619],[1159,619]]) assert.ok(!covers(x,y));
  for (let y=0;y<620;y++) assert.ok(covers(580,y));
  for (const r of shape) assert.ok(r.x>=0 && r.y>=0 && r.x+r.width<=1160 && r.y+r.height<=620);
});

console.log('\n========== ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
process.exit(fail ? 1 : 0);
