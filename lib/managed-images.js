'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const keyFor = file => {
  if (typeof file !== 'string' || !path.isAbsolute(file)) return '';
  const normalized = path.normalize(file);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

function createManagedImages({ captures, clipboard, references = () => [] }) {
  const captureRoot = keyFor(captures);
  const clipboardRoot = keyFor(clipboard);

  function owned(item) {
    if (item?.kind !== 'image') return false;
    const file = keyFor(item.filePath);
    if (!file) return false;
    const name = path.basename(file);
    const source = item.managedFileMethod || item.source?.acquisitionMethod;
    if (path.dirname(file) === clipboardRoot) return /^img-[a-z0-9]+-[a-f0-9]{8}\.png$/i.test(name) && item.id + '.png' === path.basename(item.filePath);
    if (path.dirname(file) !== captureRoot) return false;
    if (source === 'screen-capture') return /^capture-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z\.png$/i.test(name);
    if (source === 'long-capture') return /^long-[a-z0-9]+-[a-f0-9]{8}\.png$/i.test(name);
    if (source === 'image-edit') return /^edited-[a-z0-9]+-[a-f0-9]{8}\.png$/i.test(name);
    return false;
  }

  async function reclaim(file, isReferenced) {
    const fileKey = keyFor(file);
    const dir = path.dirname(fileKey);
    if (dir !== captureRoot && dir !== clipboardRoot) return true;
    const inUse = () => isReferenced(fileKey) || references().some(value => keyFor(value) === fileKey);
    if (inUse()) return false;
    try {
      const [realDir, info] = await Promise.all([fs.realpath(path.dirname(file)), fs.lstat(file)]);
      if (keyFor(realDir) !== dir || !info.isFile()) return true;
      if (inUse()) return false;
      await fs.unlink(file);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return true;
      throw error;
    }
  }

  return { owned, reclaim, keyFor };
}

module.exports = { createManagedImages };
