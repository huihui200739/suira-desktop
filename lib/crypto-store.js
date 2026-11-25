'use strict';

/**
 * 内容加密。
 *
 * 对应开发方案第 8 节「存储与搜索」：
 * - 内容使用当前用户保护的密钥加密
 * - 首期可对有限历史做解密后的内存搜索
 * - 不把敏感正文另写入明文 FTS5 索引
 *
 * 实现选择：
 * - 数据密钥（DEK）为随机 32 字节，用 AES-256-GCM 加密正文
 * - DEK 本身用 Windows DPAPI（CurrentUser 范围）保护后落盘
 *   → 换用户或换机器无法解密，符合「当前用户保护的密钥」
 * - 每条记录使用独立 IV，AAD 绑定记录 id，防止密文被搬移到别的记录
 *
 * 通过 stdin 调用系统 DPAPI，不将密钥写入命令行。
 */

const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ENVELOPE_VERSION = 1;

/** 加密后的字段形态，便于在 JSON 中识别。 */
function isEncrypted(value) {
  return Boolean(value && typeof value === 'object' && value.__enc === ENVELOPE_VERSION && typeof value.data === 'string');
}

/**
 * 用数据密钥加密一段文本。
 * @param {Buffer} key 32 字节
 * @param {string} plaintext
 * @param {string} [aad] 附加认证数据，通常传记录 id
 * @returns {{__enc:number, iv:string, data:string, tag:string}}
 */
function encryptText(key, plaintext, aad = '') {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) throw new Error('数据密钥无效');
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  if (aad) cipher.setAAD(Buffer.from(String(aad), 'utf8'));
  const data = Buffer.concat([cipher.update(String(plaintext == null ? '' : plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    __enc: ENVELOPE_VERSION,
    iv: iv.toString('base64'),
    data: data.toString('base64'),
    tag: tag.toString('base64')
  };
}

/**
 * 解密。失败时抛出，调用方决定是否降级为空串。
 * @param {Buffer} key
 * @param {object} envelope
 * @param {string} [aad]
 * @returns {string}
 */
function decryptText(key, envelope, aad = '') {
  if (!isEncrypted(envelope)) throw new Error('不是加密字段');
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) throw new Error('数据密钥无效');
  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('加密字段损坏');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  if (aad) decipher.setAAD(Buffer.from(String(aad), 'utf8'));
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
  return plain.toString('utf8');
}

/** 生成新的数据密钥。 */
function generateKey() {
  return crypto.randomBytes(KEY_BYTES);
}

/* ---------- DPAPI 桥接 ---------- */

function runDpapi(mode, buffer) {
  const operation = mode === 'protect' ? 'Protect' : 'Unprotect';
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Security',
    '$bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd())',
    `$out = [System.Security.Cryptography.ProtectedData]::${operation}($bytes, $null, "CurrentUser")`,
    '[Console]::Out.Write([Convert]::ToBase64String($out))'
  ].join('\n');
  return new Promise((resolve, reject) => {
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = execFile(executable, ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 16 * 1024
    }, (error, output) => error ? reject(new Error('Windows 密钥保护服务不可用')) : resolve(Buffer.from(output.trim(), 'base64')));
    child.stdin.on('error', () => reject(new Error('无法向 Windows 密钥保护服务传输数据')));
    child.stdin.end(buffer.toString('base64'));
  });
}

const SAFE_PREFIX = 'safeStorage:';

async function writeKeyFile(keyPath, stored, replace) {
  await fs.mkdir(path.dirname(keyPath), { recursive: true });
  const temp = `${keyPath}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, stored, { flag: 'wx', mode: 0o600 });
    if (replace) await fs.rename(temp, keyPath);
    else await fs.link(temp, keyPath);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}

/**
 * 密钥保管：负责生成、DPAPI 保护/解封数据密钥。
 *
 * 测试可注入 protect/unprotect 以避免依赖真实 DPAPI。
 */
class KeyVault {
  constructor(options = {}) {
    this.protect = options.protect || ((buf) => runDpapi('protect', buf));
    this.unprotect = options.unprotect || ((buf) => runDpapi('unprotect', buf));
    this.safeStorage = options.safeStorage || null;
    this.key = null;
  }

  /** 从受保护的密钥文件加载；不存在则生成并保存。 */
  async loadOrCreate(keyPath, { allowCreate = () => true } = {}) {
    this.key = null;
    let created = false;
    try {
      const stored = await fs.readFile(keyPath, 'utf8').then(text => text.trim(), async error => {
        if (error.code !== 'ENOENT' || !await allowCreate()) throw error;
        created = true;
        return '';
      });
      const legacySafeStorage = !created && stored.startsWith(SAFE_PREFIX);
      let key;
      if (created) key = generateKey();
      else if (legacySafeStorage) {
        const safe = this.safeStorage;
        if (!safe || !await safe.isAsyncEncryptionAvailable() || safe.getSelectedStorageBackend?.() === 'basic_text') {
          throw new Error('系统安全存储当前不可用');
        }
        const decrypted = await safe.decryptStringAsync(Buffer.from(stored.slice(SAFE_PREFIX.length), 'base64'));
        key = Buffer.from(decrypted.result, 'base64');
      } else key = await this.unprotect(Buffer.from(stored, 'base64'));
      if (key.length !== KEY_BYTES) throw new Error('密钥长度不符');
      let migrationPending = false;
      if (created || legacySafeStorage) {
        try {
          // Direct DPAPI does not depend on Chromium flushing Local State after first launch.
          const wrapped = (await this.protect(key)).toString('base64');
          await writeKeyFile(keyPath, wrapped, !created);
        } catch (error) {
          if (created) throw error;
          migrationPending = true;
        }
      }
      this.key = key;
      return { ok: true, created, migrationPending };
    } catch (error) {
      return { ok: false, created: false, error: `数据密钥${created ? '创建' : '解封'}失败：${error.message}` };
    }
  }

  isReady() {
    return Buffer.isBuffer(this.key) && this.key.length === KEY_BYTES;
  }
}

/**
 * 加密存储的辅助层：对 item.text / title 等敏感字段加解密。
 *
 * 只加密正文类字段；id、kind、时间、来源等元数据保持明文，
 * 便于列表与统计在不解密全量正文的情况下工作。
 */
const SENSITIVE_FIELDS = ['text', 'title', 'customTitle', 'richText'];

function encryptItem(key, item) {
  if (!key || !item) return item;
  const output = { ...item };
  for (const field of SENSITIVE_FIELDS) {
    const value = item[field];
    if (typeof value === 'string' && value) {
      output[field] = encryptText(key, value, `${item.id}:${field}`);
    }
  }
  output.encrypted = true;
  return output;
}

function decryptItem(key, item) {
  if (!key || !item) return item;
  const output = { ...item };
  for (const field of SENSITIVE_FIELDS) {
    const value = item[field];
    if (isEncrypted(value)) {
      try {
        output[field] = decryptText(key, value, `${item.id}:${field}`);
      } catch {
        // 解密失败（换用户/换机器/密文损坏）：保留空串并标记，不中断加载
        output[field] = '';
        output.decryptFailed = true;
      }
    }
  }
  return output;
}

module.exports = {
  ALGORITHM,
  KEY_BYTES,
  ENVELOPE_VERSION,
  SENSITIVE_FIELDS,
  isEncrypted,
  encryptText,
  decryptText,
  generateKey,
  KeyVault,
  encryptItem,
  decryptItem
};
