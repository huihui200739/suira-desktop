// Keep relative image references portable. Hosts decide which directory the
// reader has access to and must check containment again after resolving links.
export const maxLocalImageBytes = 3 * 1024 * 1024;
export const maxLocalImageReferences = 16;
const imageTypes = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp' };

export function localImageReference(url) {
  if (typeof url !== 'string' || url.length > 1024 || /[?#]/.test(url)) return null;
  let name;
  try { name = decodeURIComponent(url).replaceAll('\\', '/'); }
  catch { return null; }
  if (name.startsWith('/') || /[:<>"|?*\u0000-\u001f]/.test(name)) return null;
  const parts = name.split('/').filter(part => part !== '.');
  if (parts.some(part => !part || part === '..' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]) *(?:\.|$)/i.test(part))) return null;
  const extension = /\.(png|jpe?g|gif|webp)$/i.exec(parts.at(-1) || '')?.[1];
  return extension ? { parts, type:imageTypes[extension.toLowerCase()] } : null;
}

export function matchesImageType(bytes, type) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 12) return false;
  const prefix = view.getUint32(0);
  switch (type) {
    case 'image/png': return prefix === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a;
    case 'image/jpeg': return prefix >>> 8 === 0xffd8ff;
    case 'image/gif': return prefix === 0x47494638 && [0x3761,0x3961].includes(view.getUint16(4));
    case 'image/webp': return prefix === 0x52494646 && view.getUint32(8) === 0x57454250;
    default: return false;
  }
}
