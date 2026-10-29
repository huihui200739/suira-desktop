'use strict';
/*
 * 38 键动作面板的动作执行层。
 *
 * 为什么单独成模块：这是面板按键唯一的执行入口，键盘直达与鼠标点击都走它。
 * 放进 main.js 就只能靠正则断言「接线存在」，无法真正验证「进入工具 → 完成操作
 * → 关闭或返回」这条链路是否跑得通。这里用依赖注入，让测试能拿到真实逻辑，
 * 同时把副作用（截图、钉图、锁屏）挡在可替换的接口后面。
 *
 * 约定：每个动作返回 { ok, message?, error?, closePanel?, openPage?, ocr? }
 *  - closePanel：动作会接管屏幕（截图 / 钉图 / 锁屏），面板必须先收起
 *  - openPage：动作结果是「去主窗口某个页面看」，不是停在面板里
 *  - ocr：识别结果要回填到面板的 OCR 结果区，而不是弹个 toast 就结束
 */

const { PANEL_ACTIONS } = require('./keybindings');

/**
 * @param {object} deps
 * @param {(intent:string)=>Promise<{ok:boolean,error?:string}>} deps.capture 开始截图
 * @param {object} deps.store 内容存储
 * @param {object} deps.actions 动作注册表（lib/actions.js）
 * @param {(filePath:string,size:object)=>void} deps.pin 钉图
 * @param {()=>{ok:boolean,message?:string,error?:string}} deps.switchToDesktop 显示桌面
 * @param {()=>{ok:boolean,message?:string,error?:string}} deps.lockWorkstation 锁屏
 * @param {()=>Promise<{ok:boolean,error?:string}>} deps.openNote 打开速记（无则新建）
 */
function createPanelActions(deps) {
  const { store, actions } = deps;

  /** 最近一条指定类型的内容。 */
  function latestOfKind(kind) {
    return store.listItems({ limit: 20, kinds: [kind] })[0] || null;
  }

  /** 最近一条文字内容（文本转换的输入）。 */
  function latestText() {
    return store.listItems({ limit: 5, kinds: ['text', 'link'] })[0] || null;
  }

  /** 截图类动作共用：进入覆盖层并收起面板。 */
  async function startCapture(intent) {
    const result = await deps.capture(intent);
    if (!result?.ok) return { ok: false, error: result?.error || '暂时无法开始截图' };
    // 截图要独占屏幕，面板必须先收起；覆盖层关闭后由主进程恢复
    return { ok: true, closePanel: true };
  }

  async function run(actionId) {
    const meta = PANEL_ACTIONS[actionId];
    // 未实现的动作在主进程也拒绝一次：渲染层的状态可能过期，
    // 不能让一个「未实现」的键因为状态不同步而真的跑起来
    if (!meta || !meta.implemented) {
      return { ok: false, error: `「${meta?.label || actionId}」尚未实现` };
    }

    switch (actionId) {
      case 'calendar':
      case 'markdown': return {ok:true,openPage:actionId};
      case 'long-capture': return startCapture('long');
      case 'edit-image': {
        const result = await deps.openImageEditor();
        return result?.ok ? {ok:true,closePanel:true} : {ok:false,error:result?.error||'无法打开图片编辑器'};
      }
      case 'capture':
      case 'annotate':
        // 标注在覆盖层的工具栏里完成：先框选，再选画笔 / 箭头 / 文字
        return startCapture('copy');

      case 'ocr':
        // 按 O 进来就该是「截一张然后提字」：框完自动识别，
        // 不用先有图片再回头找入口
        return startCapture('ocr');

      case 'pin': {
        // 钉图有两种入口：手上有图就钉最近这张，没有就直接截一张来钉
        const item = latestOfKind('image');
        if (!item || !item.filePath) return startCapture('pin');
        const size = item.meta?.width && item.meta?.height
          ? { width: item.meta.width, height: item.meta.height }
          : {};
        deps.pin(item.filePath, size);
        return { ok: true, message: '已钉在桌面', closePanel: true };
      }

      case 'translate': {
        // 图片取词翻译的入口：手上有文字就翻文字，没有文字就翻最近一张图
        const text = latestText();
        const image = text ? null : latestOfKind('image');
        const target = text || image;
        if (!target) return { ok: false, error: '还没有可翻译的内容：先复制一段文字，或截一张带字的图' };
        const result = await actions.execute(target.id, 'text.translate');
        if (!result?.ok) return { ok: false, error: result?.error || '翻译失败' };
        const meta = result.output?.meta || {};
        return {
          ok: true,
          // 结果回填到面板的翻译区，而不是让用户自己去内容库找
          translate: {
            text: result.output?.text || '',
            source: meta.sourceText || target.text || '',
            // 原图入口要用输入项本身（图片），不是 OCR 派生出来的文字条目
            itemId: target.id,
            outputId: result.output?.id || '',
            provider: meta.translateProvider || '',
            from: meta.from || 'auto',
            to: meta.to || '',
            // 只有图片来源才给「查看原图」入口
            hasImage: target.kind === 'image'
          }
        };
      }

      case 'clipboard':
        return { ok: true, openClipboardBar: true, closePanel: true };

      case 'text-clean': {
        const item = latestText();
        if (!item) return { ok: false, error: '还没有文字内容可以整理，先复制一段文字' };
        const result = await actions.execute(item.id, 'text.merge-lines');
        if (!result?.ok) return { ok: false, error: result?.error || '整理失败' };
        // 生成的是派生内容：让用户直接看到结果，而不是只收到一句提示
        return {
          ok: true,
          message: '已生成整理后的文字',
          openPage: 'library',
          closePanel: true,
          outputId: result.output?.id || ''
        };
      }

      case 'note': {
        // 速记接着上一次的写：有最近一条就打开它，没有才新建。
        // 每次都新建会留下一堆空笔记，那不是"顺手"，是制造垃圾。
        const result = await deps.openNote();
        if (!result?.ok) return { ok: false, error: result?.error || '暂时无法打开速记' };
        return { ok: true, closePanel: true };
      }

      case 'desktop':
        return deps.switchToDesktop();

      case 'lock':
        return deps.lockWorkstation();

      default:
        return { ok: false, error: `「${meta.label}」尚未实现` };
    }
  }

  return { run, latestOfKind, latestText };
}

module.exports = { createPanelActions };
