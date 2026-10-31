'use strict';

/**
 * 搜索与候选排序。
 *
 * 对应开发方案 5.1：搜索命令、应用、收藏与本地内容；支持拼音与首字母。
 * 对应 5.1「面板打开后冻结候选顺序」：排序结果一旦产出即固定，
 * 由调用方缓存，异步补充只追加到指定区域而不重排。
 */

/*
 * pinyin-pro 带一份完整词库，顶层 require 会让主进程常驻内存多出十几 MB。
 * 搜索面板第一次用到拼音时才加载，之后复用同一个模块实例。
 */
let pinyinModule = null;
function loadPinyin() {
  if (!pinyinModule) pinyinModule = require('pinyin-pro');
  return pinyinModule.pinyin;
}
const { RECIPES } = require('./recipes');

const CJK = /[\u3400-\u9fff]/;

/** 预计算一个字符串的拼音全拼与首字母（含中文原串），结果按字符串缓存。 */
const pinyinCache = new Map();
const PINYIN_CACHE_LIMIT = 4000;

function pinyinForms(text) {
  const source = String(text || '');
  if (!source) return { full: '', initials: '', plain: '' };
  const cached = pinyinCache.get(source);
  if (cached) return cached;
  let forms;
  if (!CJK.test(source)) {
    forms = { full: '', initials: '', plain: source.toLowerCase() };
  } else {
    try {
      const toPinyin = loadPinyin();
      const full = toPinyin(source, { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('').toLowerCase();
      const initials = toPinyin(source, { pattern: 'first', toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('').toLowerCase();
      forms = { full, initials, plain: source.toLowerCase() };
    } catch {
      forms = { full: '', initials: '', plain: source.toLowerCase() };
    }
  }
  if (pinyinCache.size >= PINYIN_CACHE_LIMIT) pinyinCache.clear();
  pinyinCache.set(source, forms);
  return forms;
}

/**
 * 计算一条候选对查询串的匹配得分。0 表示不匹配，分值越高越靠前。
 * 支持：中文子串、拼音全拼前缀/包含、首字母前缀、连续子序列。
 */
function scoreText(query, text) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return 1;
  const target = String(text || '');
  if (!target) return 0;

  const lower = target.toLowerCase();
  if (lower === q) return 100;
  if (lower.startsWith(q)) return 90;
  if (lower.includes(q)) return 70;

  const forms = pinyinForms(target);
  if (!forms.full && !forms.initials) return 0;

  if (forms.full === q) return 88;
  if (forms.full.startsWith(q)) return 80;
  if (forms.initials === q) return 78;
  if (forms.initials.startsWith(q)) return 74;
  if (forms.full.includes(q)) return 50;
  if (forms.initials.includes(q)) return 46;

  // 首字母子序列，例如 "rwx" 命中「任务匣」
  if (q.length >= 2 && isSubsequence(q, forms.initials)) return 30;
  return 0;
}

function isSubsequence(needle, haystack) {
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}

const KIND_BONUS = { command: 12, favorite: 10, app: 6, content: 4, task: 2 };

/**
 * 从候选集合里检索。
 * @param {string} query
 * @param {Array<{id:string,kind:string,title:string,subtitle?:string,keywords?:string}>} candidates
 * @param {{limit?:number}} [options]
 */
function searchCandidates(query, candidates, options = {}) {
  const limit = Number(options.limit) || 50;
  const scored = [];
  for (const candidate of candidates || []) {
    if (!candidate || !candidate.id) continue;
    const haystack = [candidate.title, candidate.subtitle, candidate.keywords]
      .filter(Boolean)
      .join(' ');
    const score = scoreText(query, haystack) || scoreText(query, candidate.title);
    if (!score) continue;
    scored.push({ candidate, score: score + (KIND_BONUS[candidate.kind] || 0) });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // 同分时保持稳定顺序：收藏优先，其次按原始次序
    const fa = a.candidate.kind === 'favorite' ? 1 : 0;
    const fb = b.candidate.kind === 'favorite' ? 1 : 0;
    if (fa !== fb) return fb - fa;
    return 0;
  });
  return scored.slice(0, limit).map((entry) => entry.candidate);
}

// An application name must match on its own. Including the generic “应用”
// subtitle and duplicate shortcut name can create unrelated pinyin subsequences.
function searchAppCandidates(query,candidates,options={}) {
  const value=String(query||'').trim();
  const matches=(candidates||[]).filter(candidate=>!value||scoreText(value,candidate.title)>=46||scoreText(value,candidate.keywords)>=46);
  return searchCandidates(value,matches,options);
}

/**
 * 命令表里用到的配方 id 统一从配方定义取，不手写字符串。
 * 曾因手写 'capture-to-text'（实际是 'capture-to-clean-text'）导致
 * 搜索命令按 Enter 必定报「配方不存在」。
 */
const RECIPE_IDS = {
  cleanText: RECIPES.find((recipe) => recipe.title === '整理文字').id,
  captureToCleanText: RECIPES.find((recipe) => recipe.title === '截图提字并整理').id
};

/** 内置命令表。id 与动作或导航目标对应。 */
const COMMANDS = [
  {id:'cmd.long-capture',kind:'command',title:'长截图',subtitle:'框选滚动区域，停稳后自动拼接',keywords:'scroll long screenshot changjietu 长截图 滚动截图',action:'long-capture'},
  { id:'cmd.edit-image',kind:'command',title:'改图',subtitle:'打开图片并标注、复制或另存为',keywords:'image edit gaitu 图片 编辑 改图',action:'edit-image' },
  { id: 'cmd.capture', kind: 'command', title: '区域截图', subtitle: '框选屏幕区域并标注', keywords: 'screenshot capture jietu 截图', action: 'capture' },
  { id: 'cmd.quick', kind: 'command', title: '动作面板', subtitle: '打开 38 键动作面板', keywords: 'quick panel suishou 面板', action: 'quick' },
  { id: 'cmd.clipboard', kind: 'command', title: '剪贴板历史', subtitle: '查看最近复制的内容', keywords: 'clipboard jiqieban 剪贴板', action: 'navigate:library' },
  { id: 'cmd.shelf', kind: 'command', title: '任务匣', subtitle: '接住待处理的内容', keywords: 'task shelf renwuxia 任务', action: 'navigate:shelf' },
  { id: 'cmd.trail', kind: 'command', title: '处理轨迹', subtitle: '查看每一步动作记录', keywords: 'trail history guiji 轨迹', action: 'navigate:trail' },
  { id: 'cmd.settings', kind: 'command', title: '设置', subtitle: '记录、保留与快捷键', keywords: 'settings shezhi 设置', action: 'navigate:settings' },
  { id: 'cmd.merge', kind: 'command', title: '整理文字', subtitle: '合并换行并清理多余空格', keywords: 'merge lines hebing 换行 整理', action: `recipe:${RECIPE_IDS.cleanText}` },
  { id: 'cmd.ocr', kind: 'command', title: '截图提字', subtitle: '截图后离线识别并整理文字', keywords: 'ocr shibie 提字 识别', action: `recipe:${RECIPE_IDS.captureToCleanText}` },
  { id: 'cmd.export', kind: 'command', title: '导出任务', subtitle: '把任务内容导出为 Markdown', keywords: 'export daochu 导出', action: 'navigate:shelf' },
  // 第三批：速记。搜索「suji / 速记 / note」都能直接开一条
  { id: 'cmd.note', kind: 'command', title: '速记', subtitle: '随手记一笔，可钉在桌面', keywords: 'note suji biji 速记 笔记', action: 'note' }
];

module.exports = { pinyinForms, scoreText, searchCandidates, searchAppCandidates, COMMANDS, RECIPE_IDS, isSubsequence };
