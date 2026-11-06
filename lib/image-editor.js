'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp'];
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;

function validateImage(image) {
  if (!image || image.isEmpty()) throw new Error('图片无法读取，请选择 PNG、JPG、WebP 或 BMP 图片');
  const { width, height } = image.getSize();
  if (!width || !height || width > 16384 || height > 16384 || width * height > MAX_PIXELS) {
    throw new Error('图片尺寸过大，请选择边长不超过 16384 像素、总像素不超过 4000 万的图片');
  }
  return { width, height };
}

async function loadImage(filePath, nativeImage) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('请选择本机图片文件');
  if (!EXTENSIONS.includes(path.extname(filePath).slice(1).toLowerCase())) throw new Error('支持 PNG、JPG、WebP 和 BMP 图片');
  const stat = await fs.stat(filePath).catch(() => { throw new Error('图片不存在或已被移动'); });
  if (!stat.isFile()) throw new Error('请选择图片文件');
  if (stat.size > MAX_BYTES) throw new Error('图片文件超过 64 MB，请先缩小图片');
  const buffer = await fs.readFile(filePath);
  const extension = path.extname(filePath).slice(1).toLowerCase();
  // nativeImage 的缓冲区解码优先支持 PNG/JPEG；其余格式交给同一窗口的 Chromium 解码器。
  if (extension === 'webp' || extension === 'bmp') {
    const valid = extension === 'webp'
      ? buffer.length >= 20 && buffer.toString('ascii',0,4)==='RIFF' && buffer.toString('ascii',8,12)==='WEBP'
      : buffer.length >= 26 && buffer.toString('ascii',0,2)==='BM';
    if (!valid) throw new Error('图片文件已损坏，无法读取');
    return { dataUrl:`data:image/${extension};base64,${buffer.toString('base64')}`, size:null, name:path.basename(filePath) };
  }
  const image = nativeImage.createFromBuffer(buffer);
  return { dataUrl: image.toDataURL(), size: validateImage(image), name: path.basename(filePath) };
}

// 另存为必须保留原图，包括用户通过快捷方式、符号链接或硬链接选回原文件。
async function isOriginalDestination(original, destination) {
  if (!original) return false;
  const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (normalize(original) === normalize(destination)) return true;
  const [a, b] = await Promise.all([fs.stat(original,{bigint:true}).catch(() => null), fs.stat(destination,{bigint:true}).catch(() => null)]);
  return Boolean(a && b && a.ino && a.ino === b.ino && a.dev === b.dev);
}

function decodeOutput(dataUrl, nativeImage) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > MAX_BYTES * 1.4) {
    throw new Error('编辑图片数据无效或过大');
  }
  const image = nativeImage.createFromDataURL(dataUrl);
  validateImage(image);
  return image;
}

module.exports = { EXTENSIONS, MAX_BYTES, MAX_PIXELS, validateImage, loadImage, isOriginalDestination, decodeOutput };
