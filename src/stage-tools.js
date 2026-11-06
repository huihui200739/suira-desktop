'use strict';
(() => {
 const api=window.suira,$=id=>document.getElementById(id);if(!$('recipe-settings')||!api.recipes?.catalog)return;
 let catalog={},recipes=[],currentId='',steps=[{action:'text.clean',onError:'stop'}];
 const message=(text,error=false)=>{$('recipe-status').textContent=text;$('recipe-status').dataset.error=String(error);};
 function renderSteps(){
  const host=$('recipe-steps');host.replaceChildren();
  steps.forEach((step,index)=>{const row=document.createElement('div');row.className='recipe-step';const action=document.createElement('select'),policy=document.createElement('select'),controls=document.createElement('div');controls.className='recipe-step-controls';action.setAttribute('aria-label','第 '+(index+1)+' 步动作');policy.setAttribute('aria-label','第 '+(index+1)+' 步失败处理');
   for(const [id,label] of Object.entries(catalog))action.add(new Option(label,id));action.value=step.action;action.onchange=()=>{step.action=action.value;};
   policy.add(new Option('失败时停止','stop'));policy.add(new Option('失败时继续','continue'));policy.value=step.onError;policy.onchange=()=>step.onError=policy.value;
   for(const [label,delta] of [['上移',-1],['下移',1],['移除',0]]){const button=document.createElement('button');button.className='quiet-btn';button.type='button';button.textContent=label;button.setAttribute('aria-label','第 '+(index+1)+' 步'+label);button.disabled=delta?index+delta<0||index+delta>=steps.length:steps.length===1;button.onclick=()=>{if(delta)[steps[index],steps[index+delta]]=[steps[index+delta],steps[index]];else steps.splice(index,1);renderSteps();};controls.append(button);}
   row.append(action,policy,controls);host.append(row);
  });$('recipe-add-step').disabled=steps.length>=12;
 }
 function load(id=''){const recipe=recipes.find(recipe=>recipe.id===id);currentId=recipe?.id||'';$('recipe-existing').value=currentId;$('recipe-name').value=recipe?.title||'';$('recipe-commit').value=recipe?.commit?.action||'';steps=(recipe?.steps||[{action:'text.clean',onError:'stop'}]).map(step=>({...step}));$('recipe-delete').disabled=!currentId;renderSteps();message('可以将已保存的组合动作绑定到面板空键。');}
 async function refresh(){recipes=(await api.recipes.list()).filter(recipe=>recipe.id.startsWith('user.'));const selected=$('recipe-existing').value;$('recipe-existing').replaceChildren(new Option('新建组合动作',''),...recipes.map(recipe=>new Option(recipe.title,recipe.id)));$('recipe-existing').value=selected;}
 async function refreshColors(){try{const colors=await api.colors.list(),host=$('color-history');host.replaceChildren();if(!colors.length){host.textContent='截图时按 Shift+C 取色，最近 24 种颜色显示在这里。';return;}for(const color of colors){const button=document.createElement('button'),swatch=document.createElement('i'),label=document.createElement('span');button.type='button';swatch.style.setProperty('--sample-color',color.hex);label.textContent=color.hex;const rgb=[1,3,5].map(at=>parseInt(color.hex.slice(at,at+2),16));button.title='RGB '+rgb.join(', ')+' · 点击复制';button.onclick=async()=>{try{const result=await api.colors.pick(color.hex);if(!result.ok)throw Error(result.error);$('color-status').textContent=color.hex+' 已复制';}catch(error){$('color-status').textContent=error.message;}};button.append(swatch,label);host.append(button);}}catch(error){$('color-status').textContent=error.message;}}
 $('recipe-existing').onchange=()=>load($('recipe-existing').value);$('recipe-new').onclick=()=>load();$('recipe-add-step').onclick=()=>{if(steps.length<12){steps.push({action:'text.clean',onError:'stop'});renderSteps();}};
 $('recipe-save').onclick=async()=>{try{const id=currentId||'user.'+crypto.randomUUID();const result=await api.recipes.save({id,title:$('recipe-name').value,steps,commit:{action:$('recipe-commit').value}});if(!result.ok)throw Error(result.error);await refresh();load(result.recipe.id);message('已保存。面板右键 → 组合动作，即可绑定。');}catch(error){message(error.message,true);}};
 $('recipe-delete').onclick=()=>{const recipe=recipes.find(recipe=>recipe.id===currentId);if(!recipe)return;openModal('删除组合动作','输入「'+recipe.title+'」确认删除',async()=>{await api.recipes.remove(recipe.id);await refresh();load();},{expect:recipe.title});};
 $('setting-currency').onchange=async event=>{const result=await api.settings.update({currencyEnabled:event.target.checked});if(!result?.ok){event.target.checked=!event.target.checked;$('currency-status').textContent=result?.error||'设置失败';}};
 api.settings.get().then(settings=>$('setting-currency').checked=settings.currencyEnabled===true).catch(()=>{});api.settings.onChanged?.(settings=>$('setting-currency').checked=settings.currencyEnabled===true);
 api.colors.onChanged?.(refreshColors);$('color-refresh').onclick=refreshColors;
 Promise.all([api.recipes.catalog(),refresh()]).then(([values])=>{catalog=values;load();}).catch(error=>message(error.message,true));refreshColors();
})();
