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

const RECIPE_STEP_LABELS={'ocr.local':'提取文字','text.merge-lines':'合并换行','text.clean':'清理文字','text.translate':'翻译（发送到翻译服务）',...Object.fromEntries(Object.entries(require('./text-tools').OPERATION_LABELS).map(([id,label])=>['text.convert.'+id,label]))};
function cleanRecipe(input){
  if(!input||!/^user\.[a-zA-Z0-9_-]{1,80}$/.test(input.id||''))return null;
  const title=String(input.title||'').trim().slice(0,60),raw=input.steps;
  if(!title||!Array.isArray(raw)||raw.length<1||raw.length>12)return null;
  const steps=[];for(const [index,step] of raw.entries()){if(!RECIPE_STEP_LABELS[step?.action]||(step.action==='ocr.local'&&index!==0))return null;steps.push({action:step.action,onError:step.onError==='continue'?'continue':'stop'});}
  const commitAction=input.commit?.action||'';if(!['','output.copy','output.shelf'].includes(commitAction))return null;
  return {id:input.id,version:Math.max(1,Math.min(100000,Number(input.version)||1)),title,description:steps.map(step=>RECIPE_STEP_LABELS[step.action]).join(' → '),accepts:steps[0].action==='ocr.local'?['image']:['text','link'],steps,commit:commitAction?{action:commitAction,explicit:true}:null};
}
function getRecipe(id,custom=[]) {
  return recipeIndex.get(String(id || '')) || custom.map(cleanRecipe).find(recipe=>recipe?.id===id) || null;
}

function listRecipes(kind,custom=[]) {
  const values=[...RECIPES,...custom.map(cleanRecipe).filter(Boolean)];
  return kind?values.filter(recipe=>recipe.accepts.includes(kind)):values;
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
  const recipe = getRecipe(recipeId,deps.recipes||[]);
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
    if(step.action.startsWith('output.')){
      // Output effects belong to the explicit commit phase, exactly once.
      if(step.action===recipe.commit?.action||!options.commit)continue;
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

  if(!currentItem&&steps.some(step=>!step.ok)){
    const failed=steps.filter(step=>!step.ok).at(-1);
    return {ok:false,recipeId,steps,current:null,output:null,error:'没有生成结果：'+failed.error,canceled:false,stoppedAt:failed.action};
  }

  // 提交阶段：仅显式请求时执行副作用
  if (options.commit && recipe.commit?.action) {
    let commitResult;
    try {
      commitResult = await deps.execute(currentId, recipe.commit.action);
    } catch (error) {
      commitResult = { ok: false, error: error?.message || String(error) };
    }
    if (options.signal?.aborted) {
      // As with a processing step, a late commit result must not be reported
      // as a successful run. Already-started external effects cannot be undone.
      steps.push({ action: recipe.commit.action, ok: false, canceled: true, error: '已取消' });
      return { ok: false, recipeId, steps, current: currentItem, output: null, error: '已取消', canceled: true, stoppedAt: '' };
    }
    steps.push({ action: recipe.commit.action, ok: Boolean(commitResult?.ok), error: commitResult?.ok ? '' : (commitResult?.error || '提交失败') });
    if (!commitResult?.ok) {
      return { ok: false, recipeId, steps, current: currentItem, output: null, error: commitResult?.error || '提交失败', canceled: false, stoppedAt: recipe.commit.action };
    }
  }

  return { ok: true, recipeId, steps, current: currentItem, output: currentItem, error: '', canceled: false, stoppedAt: '' };
}

module.exports = { RECIPES, getRecipe, listRecipes, runRecipe,cleanRecipe,RECIPE_STEP_LABELS };
