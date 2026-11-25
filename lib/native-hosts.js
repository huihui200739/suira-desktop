'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { ensureNativeHost } = require('./key-watch');

const hosts = Object.freeze({
  'foreground-host': { references: ['System.Web.Extensions.dll'], legacy: ['foreground-host-v5.exe'] },
  'key-watch-host': { references: [], legacy: ['key-watch-host.exe'] },
  'island-pointer-host': { references: [], legacy: ['island-pointer-host-v1.exe'] },
  'app-icon-host': { references: ['System.Drawing.dll'], legacy: ['app-icon-host-v2.exe'] },
  'capture-host': { references: ['System.Drawing.dll'], legacy: ['capture-host-v3.exe'] }
});

async function appNativeHost(name, { userRoot, sourceDir, resourcesPath, onError = () => {} }) {
  const { references, legacy } = hosts[name];
  const executable = `${name}.exe`;
  try {
    const targetPath = resourcesPath
      ? path.join(resourcesPath, 'native-hosts', executable)
      : await ensureNativeHost({ sourcePath: path.join(sourceDir, `${name}.cs`), targetPath: path.join(userRoot, 'native-hosts', executable), references, onError });
    if (!targetPath) return null;
    if (resourcesPath && !(await fs.stat(targetPath)).isFile()) throw Error('Windows 组件不可用');
    await Promise.all(legacy.map(file => fs.unlink(path.join(userRoot, file)).catch(error => {
      if (!['ENOENT', 'EPERM', 'EBUSY', 'EACCES'].includes(error.code)) console.warn('无法清除旧版 Windows 组件:', error.code);
    })));
    return targetPath;
  } catch (error) {
    onError(error.code || error.message);
    return null;
  }
}

module.exports = { appNativeHost, hosts };
