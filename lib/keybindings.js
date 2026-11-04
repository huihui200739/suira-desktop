'use strict';

/**
 * 38 键动作面板的键位模型。
 *
 * 对应《浮引复刻-差距与改版方案》第一批：
 * - 固定键位布局：数字行 12 键 + 字母 26 键 = 38 键，行间错位与键盘一致；
 * - 绑定模型：每个键位至多绑定一个动作；未绑定的键只显示字母本身，
 *   点击时说明「还没有绑定动作」；未实现的动作渲染成灰底虚线卡 + tooltip，
 *   不放假按钮（宁可显示未实现，也不显示点了没反应的图标）；
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
  capture: { key: 'C', label: '截图', hint: '框选屏幕区域并标注', implemented: true },
  'capture-translate': { key: 'B', label: '截图翻译', hint: '框选后识别并翻译', implemented: true },
  annotate: { key: '', label: '标注', hint: '截图后在覆盖层中标注', implemented: true },
  ocr: { key: 'O', label: '提取文字', hint: '对最近一张图片离线 OCR', implemented: true },
  pin: { key: 'P', label: '钉图文', hint: '把最近的图片钉在桌面', implemented: true },
  clipboard: { key: 'V', label: '剪贴板', hint: '打开屏幕底部的剪贴板历史横栏', implemented: true },
  'text-clean': { key: 'X', label: '文本转换', hint: '整理最近的文字：合并换行、去多余空格', implemented: true },
  desktop: { key: 'D', label: '回到桌面', hint: '显示桌面', implemented: true },
  lock: { key: 'L', label: '锁屏', hint: '锁定当前会话', implemented: true },
  'long-capture': { key: 'G', label: '长截图', hint: '框选后向上或向下滚动，回车完成并复制', implemented: true },
  translate: { key: 'T', label: '翻译', hint: '打开翻译窗口，输入文字或截图提字', implemented: true },
  'edit-image': { key: 'I', label: '改图', hint: '打开、拖入或粘贴图片，标注后复制或另存为', implemented: true },
  calendar: { key: 'F', label: '日历', hint: '月视图与本地日程', implemented: true },
  // 第三批第 4 项：速记（纯文本）。多窗口多页，可钉在桌面，位置随笔记记住
  note: { key: 'N', label: '速记', hint: '随手记一笔，可钉在桌面', implemented: true },
  markdown: { key: 'M', label: 'Markdown', hint: '本地文档、实时预览与导出', implemented: true }
};

/** 键位 → 动作 id。只登记 implemented 动作与语义占位；未列出的键即「未绑定」。 */
const DEFAULT_KEY_BINDINGS = Object.fromEntries(
  Object.entries(PANEL_ACTIONS).filter(([, action]) => action.key).map(([actionId, action]) => [action.key, actionId])
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
 * @param {object} [customBindings] 用户自定义覆盖表（lib/panel-bindings.js 的形态）；
 *   键位出现在表里就以表为准（type:'none' 表示显式清空），否则回落出厂默认。
 */
function keyLayout(isReady, customBindings) {
  const ready = typeof isReady === 'function' ? isReady : () => true;
  const overrides = customBindings && typeof customBindings === 'object' ? customBindings : {};
  const keys = [];
  for (let rowIndex = 0; rowIndex < KEY_ROWS.length; rowIndex += 1) {
    for (const key of KEY_ROWS[rowIndex]) {
      const override = Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : null;
      let actionId = DEFAULT_KEY_BINDINGS[key] || '';
      let custom = null;
      if (override && override.type === 'action') {
        actionId = PANEL_ACTIONS[override.id] ? override.id : '';
      } else if (override && override.type === 'none') {
        actionId = '';
      } else if (override) {
        actionId = '';
        custom = override;
      }
      const action = actionId ? PANEL_ACTIONS[actionId] : null;
      const usable = Boolean(action && action.implemented && ready(actionId));
      keys.push({
        key,
        row: rowIndex,
        actionId,
        // 自定义绑定显示自己的名字（应用/文件夹/网页），内置动作显示动作名
        label: custom ? String(custom.name || '') : action ? action.label : '',
        ...(custom?.type === 'app' ? { appPath: custom.target } : {}),
        hint: custom
          ? { app: '打开应用', folder: '打开文件夹', url: '打开网页', file: '打开文件' }[custom.type] || '打开'
          : action ? action.hint : '',
        // 未绑定 / 未实现都渲染为占位；自定义绑定是独立状态，点击直接执行
        state: custom ? 'custom' : usable ? 'bound' : action && !action.implemented ? 'unimplemented' : 'unbound'
      });
    }
  }
  return { rows: KEY_ROWS, keys, count: KEY_COUNT };
}

/** 绑定编辑器可分配的内置动作目录：只列真正可执行的。 */
function implementedPanelActions() {
  return Object.entries(PANEL_ACTIONS)
    .filter(([, action]) => action.implemented)
    .map(([id, action]) => ({ id, label: action.label, hint: action.hint }));
}

/** 工具箱目录：集中入口，未完成的工具显示明确状态。 */
const TOOLBOX_TOOLS = [
  { id: 'calendar', label: '日历', hint: '安排日程与待办', implemented: true },
  { id: 'markdown', label: 'Markdown', hint: '编辑、预览与导出', implemented: true },
  { id: 'capture', label: '截图', hint: '框选屏幕区域', implemented: true },
  { id: 'edit-image', label: '改图', hint: '打开图片并标注', implemented: true },
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
  { id: 'long-capture', label: '长截图', hint: '上下滚动拼接，回车完成并复制', implemented: true },
  { id: 'translate', label: '翻译', hint: '取词翻译 / 文本翻译', implemented: true },
  { id: 'note', label: '速记', hint: '随手记一笔，可钉桌面', implemented: true }
];

module.exports = {
  KEY_ROWS,
  KEY_COUNT,
  PANEL_ACTIONS,
  DEFAULT_KEY_BINDINGS,
  TOOLBOX_TOOLS,
  normalizeKey,
  keyLayout,
  implementedPanelActions
};
