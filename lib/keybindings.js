'use strict';

/**
 * 38 键动作面板的键位模型。
 *
 * 对应《浮引复刻-差距与改版方案》第一批：
 * - 固定键位布局：数字行 12 键 + 字母 26 键 = 38 键，行间错位与键盘一致；
 * - 绑定模型：每个键位至多绑定一个动作；未绑定的键显示「绑定」占位，
 *   不放假按钮（未实现的能力宁可显示未绑定，也不显示点了没反应的图标）；
 * - 键位与动作解耦：动作 id 由主进程的 panel:action 通道解释。
 */

/** 键盘行布局。每行的键按物理顺序排列，行首缩进由渲染层控制。 */
const KEY_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='],
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M']
];

const KEY_COUNT = KEY_ROWS.reduce((sum, row) => sum + row.length, 0); // 38

/**
 * 动作目录。
 * implemented: true  → 面板显示彩色图标与名称，按键/点击立即执行；
 * implemented: false → 只作为文档占位，绝不渲染成可用按钮。
 */
const PANEL_ACTIONS = {
  capture: { key: 'Z', label: '截图', hint: '框选屏幕区域并标注', implemented: true },
  annotate: { key: 'B', label: '标注', hint: '截图后在覆盖层中标注', implemented: true },
  ocr: { key: 'O', label: '提取文字', hint: '对最近一张图片离线 OCR', implemented: true },
  pin: { key: 'P', label: '钉图文', hint: '把最近的图片钉在桌面', implemented: true },
  clipboard: { key: 'X', label: '剪贴板', hint: '打开内容库查看历史', implemented: true },
  'text-clean': { key: 'V', label: '文本转换', hint: '整理最近的文字：合并换行、去多余空格', implemented: true },
  desktop: { key: 'D', label: '回到桌面', hint: '显示桌面', implemented: true },
  lock: { key: 'L', label: '锁屏', hint: '锁定当前会话', implemented: true },
  // 已在浮引中存在、随序尚未实现的能力：保留键位语义，但明确「未实现」。
  record: { key: 'S', label: '录屏', hint: '尚未实现', implemented: false },
  'long-capture': { key: 'G', label: '长截图', hint: '尚未实现', implemented: false },
  translate: { key: 'T', label: '文本翻译', hint: '尚未实现', implemented: false },
  wallpaper: { key: 'W', label: '壁纸', hint: '尚未实现', implemented: false },
  'edit-image': { key: 'I', label: '改图', hint: '尚未实现', implemented: false },
  calendar: { key: 'F', label: '日历', hint: '尚未实现', implemented: false },
  note: { key: 'N', label: '速记', hint: '尚未实现', implemented: false },
  markdown: { key: 'M', label: 'Markdown', hint: '尚未实现', implemented: false }
};

/** 键位 → 动作 id。只登记 implemented 动作与语义占位；未列出的键即「未绑定」。 */
const DEFAULT_KEY_BINDINGS = Object.fromEntries(
  Object.entries(PANEL_ACTIONS).map(([actionId, action]) => [action.key, actionId])
);

/** 按键位大写字母归一化；数字行与符号原样返回。 */
function normalizeKey(key) {
  const value = String(key || '');
  if (value.length === 1) return value.toUpperCase();
  return value;
}

/**
 * 返回渲染层需要的完整键位表。
 * @param {(actionId: string) => boolean} [isReady] 动作在当前环境下是否真正可用
 */
function keyLayout(isReady) {
  const ready = typeof isReady === 'function' ? isReady : () => true;
  const keys = [];
  for (let rowIndex = 0; rowIndex < KEY_ROWS.length; rowIndex += 1) {
    for (const key of KEY_ROWS[rowIndex]) {
      const actionId = DEFAULT_KEY_BINDINGS[key] || '';
      const action = actionId ? PANEL_ACTIONS[actionId] : null;
      const usable = Boolean(action && action.implemented && ready(actionId));
      keys.push({
        key,
        row: rowIndex,
        actionId,
        label: action ? action.label : '',
        hint: action ? action.hint : '',
        // 未绑定 / 未实现 都渲染为「绑定」占位，点击时提示原因
        state: usable ? 'bound' : action && !action.implemented ? 'unimplemented' : 'unbound'
      });
    }
  }
  return { rows: KEY_ROWS, keys, count: KEY_COUNT };
}

/** 工具箱目录：集中入口，未完成的工具显示明确状态。 */
const TOOLBOX_TOOLS = [
  { id: 'capture', label: '截图', hint: '框选屏幕区域', implemented: true },
  { id: 'ocr', label: '提取文字', hint: '离线 OCR', implemented: true },
  { id: 'clipboard', label: '剪贴板', hint: '历史与来源', implemented: true },
  { id: 'pin', label: '钉图文', hint: '图片置顶', implemented: true },
  // 第三批：文件中转（浮引岛）。不是任务匣的替代品，也不是页面跳转——
  // 它是一块常驻的暂存浮层，工具箱里点一下显示/收起。
  { id: 'island', label: '浮引岛', hint: '文件中转暂存', implemented: true, toggleIsland: true },
  { id: 'text-clean', label: '文本转换', hint: '合并换行 / 清理', implemented: true },
  { id: 'shelf', label: '任务匣', hint: '临时收集与整理', implemented: true, open: 'shelf' },
  { id: 'library', label: '内容库', hint: '全部捕获内容', implemented: true, open: 'library' },
  { id: 'settings', label: '设置', hint: '快捷键 / 保留策略', implemented: true, open: 'settings' },
  { id: 'record', label: '录屏', hint: '尚未实现', implemented: false },
  { id: 'long-capture', label: '长截图', hint: '尚未实现', implemented: false },
  { id: 'translate', label: '翻译', hint: '尚未实现', implemented: false },
  { id: 'note', label: '速记', hint: '尚未实现', implemented: false }
];

module.exports = {
  KEY_ROWS,
  KEY_COUNT,
  PANEL_ACTIONS,
  DEFAULT_KEY_BINDINGS,
  TOOLBOX_TOOLS,
  normalizeKey,
  keyLayout
};
