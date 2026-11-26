'use strict';

const path = require('node:path');
const voiceInput = require('./voice-input');

const appRoot = path.resolve(__dirname, '..');
const PARTITION = 'suira-voice';
const VOICE_KEY_AAD = 'settings:voiceApiKey';

function voiceSettingsSummary(settings) {
  return {
    voiceApiKeySet: Boolean(settings.voiceApiKeyEnc),
    voiceCanReuseTranslateKey: voiceInput.canReuseApiKey({
      targetUrl: settings.voiceBaseUrl || settings.translateBaseUrl || '',
      sourceUrl: settings.translateBaseUrl,
      sourceProvider: settings.translateProvider,
      hasSourceKey: Boolean(settings.translateApiKeyEnc)
    })
  };
}

function createVoiceWindow({
  windowIpc, BrowserWindow, screen, session, getSettings, decryptSecret,
  getMainWindow, getPanelWindow, getForeground, captureTarget, hideQuickPanel,
  showSettings, writeClipboardText, pasteTo, fetchImpl, transcribe = voiceInput.transcribe
}) {
  let voiceWindow = null;
  let voiceSessionTarget = null;
  let voiceRequestController = null;
  let voicePermissionSession = null;

  function isVoiceSender(event) {
    return Boolean(voiceWindow && BrowserWindow.fromWebContents(event.sender) === voiceWindow);
  }

  function voiceConfig() {
    const settings = getSettings() || {};
    const format = settings.voiceProvider === 'openai' ? 'openai' : 'deepseek';
    const baseUrl = String(settings.voiceBaseUrl || settings.translateBaseUrl || (format === 'deepseek' ? 'https://api.deepseek.com/v1' : '')).trim();
    let apiKey = decryptSecret(settings.voiceApiKeyEnc, VOICE_KEY_AAD);
    if (!apiKey && settings.translateProvider === 'openai' && settings.translateApiKeyEnc) {
      const share = voiceInput.canReuseApiKey({ targetUrl: baseUrl, sourceUrl: settings.translateBaseUrl,
        sourceProvider: settings.translateProvider, hasSourceKey: true });
      if (share) apiKey = decryptSecret(settings.translateApiKeyEnc);
    }
    return { format, baseUrl,
      model: String(settings.voiceModel || '').trim(), apiKey };
  }

  function voiceStatus() {
    const settings = getSettings() || {};
    const config = voiceConfig();
    const hasVoiceKey = Boolean(settings.voiceApiKeyEnc);
    const canReuseTranslateKey = voiceInput.canReuseApiKey({ targetUrl: config.baseUrl, sourceUrl: settings.translateBaseUrl,
      sourceProvider: settings.translateProvider, hasSourceKey: Boolean(settings.translateApiKeyEnc) });
    const endpoint = voiceInput.buildEndpoint(config.baseUrl, config.format);
    return { ok: true, provider: config.format, model: config.model,
      hasVoiceKey, canReuseTranslateKey, configured: Boolean(config.apiKey && endpoint.ok && (config.format !== 'openai' || config.model)) };
  }

  function installVoicePermissionHandlers() {
    const voiceSession = session.fromPartition(PARTITION);
    if (voicePermissionSession === voiceSession) return;
    const isVoiceFrame = (contents, permission, details) => contents === voiceWindow?.webContents
      && permission === 'media' && details.isMainFrame === true;
    voiceSession.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(isVoiceFrame(contents, permission, details) && details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio');
    });
    voiceSession.setPermissionCheckHandler((contents, permission, _origin, details) => {
      return isVoiceFrame(contents, permission, details) && details.mediaType === 'audio';
    });
    voicePermissionSession = voiceSession;
  }

  /** Keep dictation beside the active input without activating its overlay. */
  async function openVoiceInput({ preview = false } = {}) {
    if (!getSettings()) return { ok: false, error: '数据未就绪' };
    if (voiceWindow && !voiceWindow.isDestroyed()) {
      if (!voiceWindow.__stopping && Date.now() - voiceWindow.__openedAt > 450) {
        voiceWindow.__stopping = true;
        voiceWindow.webContents.send('voice:stop');
      }
      return { ok: true };
    }
    const foreground = preview ? null : getForeground();
    voiceSessionTarget = preview ? null : captureTarget(foreground, { selectionMethod: 'voice' });
    voiceSessionTarget = voiceSessionTarget && { ...voiceSessionTarget, focusHwnd: foreground?.focusHwnd };
    if (getPanelWindow()?.isVisible()) hideQuickPanel();
    installVoicePermissionHandlers();
    const win = voiceWindow = windowIpc.create('voice', {
      width: 208, height: 48, show: false, frame: false, thickFrame: false, transparent: true,
      focusable: false, alwaysOnTop: true, skipTaskbar: true,
      resizable: false, movable: false, hasShadow: false,
      backgroundColor: '#00000000', title: '随序 · 语音输入',
      webPreferences: {
        preload: path.join(appRoot, 'voice-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        autoplayPolicy: 'no-user-gesture-required', spellcheck: false, partition: PARTITION
      }
    });
    win.__openedAt = Date.now();
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    win.setPosition(Math.round(area.x + (area.width - 208) / 2), area.y + area.height - 72);
    win.setMenuBarVisibility(false);

    win.on('closed', () => {
      if (voiceWindow === win) {
        voiceRequestController?.abort();
        voiceRequestController = null;
        voiceSessionTarget = null;
        voiceWindow = null;
      }
    });
    try {
      await win.loadFile(path.join(appRoot, 'src', 'voice-input.html'));
      if (!win.isDestroyed()) win.showInactive();
      return { ok: true };
    } catch (error) {
      if (win.isDestroyed()) return { ok: true };
      console.warn('语音窗口加载失败:', error.message);
      win.close();
      return { ok: false, error: '语音窗口加载失败，请重试' };
    }
  }

  function registerIpc() {
    windowIpc.handle('voice:open', event => {
      const caller = BrowserWindow.fromWebContents(event.sender);
      if (!caller || (caller !== getPanelWindow() && caller !== getMainWindow())) return { ok: false, error: '语音输入入口无效' };
      return openVoiceInput({ preview: caller === getMainWindow() });
    });
    windowIpc.handle('voice:status', event => {
      if (!isVoiceSender(event)) return { ok: false, error: '语音窗口无效' };
      return voiceStatus();
    });
    windowIpc.handle('voice:open-settings', event => {
      if (!isVoiceSender(event)) return { ok: false, error: '语音窗口无效' };
      const win = voiceWindow;
      win?.close();
      showSettings();
      return { ok: true };
    });
    windowIpc.handle('voice:transcribe', async (event, payload) => {
      if (!isVoiceSender(event)) return { ok: false, error: '语音窗口无效' };
      const win = voiceWindow;
      if (voiceRequestController) return { ok: false, error: '正在识别上一段录音' };
      const config = voiceConfig();
      const target = voiceSessionTarget;
      const controller = voiceRequestController = new AbortController();
      try {
        const result = await transcribe({ pcm: payload?.pcm, format: config.format, baseUrl: config.baseUrl,
          model: config.model, apiKey: config.apiKey, fetchImpl, signal: controller.signal });
        if (controller.signal.aborted || voiceWindow !== win) return { ok: false, cancelled: true };
        if (!result.ok) return result;
        if (!result.text?.trim()) return { ok: false, error: '没有识别到语音' };
        await writeClipboardText(result.text);
        // Check the same foreground window and native focused control immediately
        // before sending Ctrl+V. Dictation never activates a window behind the user.
        if (!target?.focusHwnd || controller.signal.aborted || voiceWindow !== win) return { ok: true, pasted: false };
        const pasted = await pasteTo(target, { stayInForeground: true });
        return { ok: true, pasted: pasted.ok };
      } finally {
        if (voiceRequestController === controller) voiceRequestController = null;
      }
    });
    windowIpc.handle('voice:close', event => {
      if (!isVoiceSender(event)) return { ok: false };
      voiceWindow.close();
      return { ok: true };
    });
  }

  return {
    open: openVoiceInput,
    registerIpc,
    registerPreload: options => session.fromPartition(PARTITION).registerPreloadScript(options)
  };
}

module.exports = { createVoiceWindow, voiceSettingsSummary, VOICE_KEY_AAD };
