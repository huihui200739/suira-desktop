'use strict';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function serviceEndpoint(value) {
  const input = String(value || '').trim();
  if (input.length > 2048 || !/^https?:\/\//i.test(input)) throw Error('请填写完整的接口地址');
  let url;
  try { url = new URL(input); }
  catch { throw Error('接口地址无效，请检查地址格式'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) {
    throw Error('远程接口必须使用 HTTPS，本机接口可使用 HTTP');
  }
  if (url.username || url.password || /[?#]/.test(input)) throw Error('接口地址不能包含账号、查询参数或锚点');
  return url;
}

module.exports = { serviceEndpoint };
