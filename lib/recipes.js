'use strict';

/**
 * 配方（动作链）执行器。
 *
 * 对应开发方案第 8 节：
 *   Recipe = id + version + accepts + steps[] + commit
 *   step   = { action, onError: 'stop' | 'continue' }
 *
 * 关键约束（文档 5.3 / 第 8 节）：
 * - 生成内容以新版本保存，不覆盖原始捕获（由 actions.execute 保证）
 * - 失败后停在当前步骤，可更换动作继续
 * - 副作用只在最终提交时发生，预览阶段不执行
 * - 取消后丢弃过期异步结果
 */

const RECIPES = [
  {
    id: 'capture-to-clean-text',
    version: 1,
    title: '截图提字并整理',
    description: '截图 → 识别文字 → 合并换行，结果可直接复制',
    accepts: ['image'],
    steps: [
      { action: 'ocr.local', onError: 'stop' },
      { action: 'text.merge-lines', onError: 'stop' },
      { action: 'text.clean', onError: 'continue' }
    ],
    commit: { action: 'output.copy', explicit: true }
  },
  {
    id: 'clean-text',
    version: 1,
    title: '整理文字',
    description: '合并换行并清理多余空格',
    accepts: ['text', 'link'],
    steps: [
      { action: 'text.merge-lines', onError: 'stop' },
      { action: 'text.clean', onError: 'continue' }
    ],
    commit: { action: 'output.copy', explicit: true }
  },
  {
    id: 'collect-to-shelf',
    version: 1,
    title: '收进任务匣',
    description: '把当前内容加入任务匣的临时收集',
    accepts: ['text', 'link', 'image', 'files'],
    steps: [
      { action: 'output.shelf', onError: 'stop' }
    ],
    commit: { action: 'output.shelf', explicit: true }
  }
];

const recipeIndex = new Map(RECIPES.map((recipe) => [recipe.id, recipe]));

function getRecipe(id) {
  return recipeIndex.get(String(id || '')) || null;
}

function listRecipes(kind) {
  if (!kind) return RECIPES.slice();
  return RECIPES.filter((recipe) => recipe.accepts.includes(kind));
}

/**
 * 执行一条配方。
 *
 * @param {object} deps { execute: (itemId, actionId) => Promise<{ok, output?, error?}> }
 * @param {string} itemId
 * @param {string} recipeId
 * @param {{signal?: AbortSignal, commit?: boolean}} [options]
 * @returns {Promise<{ok:boolean, recipeId:string, steps:Array, current:object|null, output:object|null, error:string, canceled:boolean, stoppedAt:string}>}
 */
async function runRecipe(deps, itemId, recipeId, options = {}) {
  const recipe = getRecipe(recipeId);
  if (!recipe) {
    return { ok: false, recipeId, steps: [], current: null, output: null, error: '配方不存在', canceled: false, stoppedAt: '' };
  }

  const steps = [];
  let currentId = itemId;
  let currentItem = null;
  let canceled = false;

  for (const step of recipe.steps) {
    if (options.signal?.aborted) {
      canceled = true;
      break;
    }
    let result;
    try {
      result = await deps.execute(currentId, step.action);
    } catch (error) {
      result = { ok: false, error: error?.message || String(error) };
    }
    if (options.signal?.aborted) {
      // 迟到结果：动作已取消，丢弃输出，不推进下一步
      canceled = true;
      steps.push({ action: step.action, ok: false, canceled: true, error: '已取消' });
      break;
    }
    steps.push({ action: step.action, ok: Boolean(result?.ok), error: result?.ok ? '' : (result?.error || '执行失败') });
    if (!result?.ok) {
      if (step.onError === 'stop') {
        return { ok: false, recipeId, steps, current: currentItem, output: null, error: result?.error || '执行失败', canceled: false, stoppedAt: step.action };
      }
      continue;
    }
    if (result.output) {
      currentItem = result.output;
      currentId = result.output.id;
    }
  }

  if (canceled) {
    return { ok: false, recipeId, steps, current: currentItem, output: null, error: '已取消', canceled: true, stoppedAt: '' };
  }

  // 提交阶段：仅显式请求时执行副作用
  if (options.commit && recipe.commit?.action) {
    const commitResult = await deps.execute(currentId, recipe.commit.action);
    steps.push({ action: recipe.commit.action, ok: Boolean(commitResult?.ok), error: commitResult?.ok ? '' : (commitResult?.error || '提交失败') });
    if (!commitResult?.ok) {
      return { ok: false, recipeId, steps, current: currentItem, output: null, error: commitResult?.error || '提交失败', canceled: false, stoppedAt: recipe.commit.action };
    }
  }

  return { ok: true, recipeId, steps, current: currentItem, output: currentItem, error: '', canceled: false, stoppedAt: '' };
}

module.exports = { RECIPES, getRecipe, listRecipes, runRecipe };
