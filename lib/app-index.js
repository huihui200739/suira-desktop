'use strict';

/**
 * 应用搜索。
 *
 * 对应开发方案 5.1：「应用搜索首期扫描开始菜单快捷方式及已注册应用，
 * 不做全盘文件索引」。
 *
 * 只读扫描开始菜单与已注册应用路径，不递归全盘、不解析快捷方式内部
 * 的复杂属性（目标路径与图标按需解析，失败则跳过）。
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

/** 返回需要扫描的开始菜单目录（当前用户 + 所有用户）。 */
function startMenuDirs(env = process.env) {
  const dirs = [];
  const appData = env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const programData = env.ProgramData || 'C:\\ProgramData';
  dirs.push(path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  dirs.push(path.join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  return dirs;
}

const MAX_DEPTH = 4;
const SKIP_NAMES = new Set(['desktop.ini', 'thumbs.db']);

/**
 * 递归收集 .lnk / .url 快捷方式。
 * @param {string[]} roots
 * @param {{maxDepth?:number, limit?:number}} [options]
 * @returns {Promise<Array<{name:string, filePath:string}>>}
 */
async function collectShortcuts(roots, options = {}) {
  const maxDepth = Number(options.maxDepth) || MAX_DEPTH;
  const limit = Number(options.limit) || 2000;
  const found = [];
  const seen = new Set();

  async function walk(dir, depth) {
    if (found.length >= limit || depth > maxDepth) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return; // 目录不存在或无权限，跳过
    }
    for (const entry of entries) {
      if (found.length >= limit) return;
      const name = entry.name;
      if (SKIP_NAMES.has(name.toLowerCase())) continue;
      const full = path.join(dir, name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      const lower = name.toLowerCase();
      if (!entry.isFile()) continue;
      if (!lower.endsWith('.lnk') && !lower.endsWith('.url')) continue;
      const display = name.replace(/\.(lnk|url)$/i, '').trim();
      if (!display) continue;
      // 过滤卸载、帮助等噪音条目
      if (/^(uninstall|卸载|readme|帮助|help|documentation)/i.test(display)) continue;
      const key = display.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ name: display, filePath: full });
    }
  }

  for (const root of roots) {
    if (found.length >= limit) break;
    await walk(root, 0);
  }
  return found;
}

/**
 * 把扫描到的快捷方式转成搜索候选。
 * @param {Array<{name:string, filePath:string}>} shortcuts
 */
function toCandidates(shortcuts) {
  return (shortcuts || []).map((entry) => ({
    id: 'app:' + entry.filePath,
    kind: 'app',
    title: entry.name,
    subtitle: '应用',
    keywords: path.basename(entry.filePath).replace(/\.(lnk|url)$/i, ''),
    appPath: entry.filePath
  }));
}

/** 带缓存的应用索引，避免每次打开面板都扫盘。 */
class AppIndex {
  constructor(options = {}) {
    this.ttl = Number(options.ttl) || 5 * 60 * 1000;
    this.roots = options.roots || null;
    this.shortcuts = [];
    this.loadedAt = 0;
    this.loading = null;
  }

  isStale(now = Date.now()) {
    return !this.loadedAt || now - this.loadedAt > this.ttl;
  }

  /** 确保索引已加载；并发调用复用同一次扫描。 */
  async ensure() {
    if (!this.isStale()) return this.shortcuts;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        this.shortcuts = await collectShortcuts(this.roots || startMenuDirs());
        this.loadedAt = Date.now();
      } catch {
        this.shortcuts = [];
        this.loadedAt = Date.now();
      } finally {
        this.loading = null;
      }
      return this.shortcuts;
    })();
    return this.loading;
  }

  async candidates() {
    return toCandidates(await this.ensure());
  }

  async launchPath(requested) {
    if (typeof requested !== 'string' || !isLocalAbsolute(requested)) return null;
    const entry = (await this.ensure()).find(item => item.filePath === requested);
    if (!entry) return null;
    for (const root of this.roots || startMenuDirs()) {
      if (!isLocalAbsolute(root) || !isBelow(root, entry.filePath)) continue;
      try {
        const [realRoot, realFile, info] = await Promise.all([
          fsp.realpath(root), fsp.realpath(entry.filePath), fsp.lstat(entry.filePath)
        ]);
        if (isLocalAbsolute(realRoot) && isLocalAbsolute(realFile) && isBelow(realRoot, realFile) &&
            info.isFile() && /\.(lnk|url)$/i.test(realFile)) return realFile;
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP'].includes(error.code)) throw error;
      }
    }
    return null;
  }

  invalidate() {
    this.loadedAt = 0;
  }
}

function isLocalAbsolute(value) {
  return process.platform === 'win32' ? /^[a-z]:[\\/]/i.test(value) : path.isAbsolute(value);
}

function isBelow(dir, file) {
  const relative = path.relative(dir, file);
  return Boolean(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

module.exports = {
  startMenuDirs,
  collectShortcuts,
  toCandidates,
  AppIndex,
  MAX_DEPTH
};
