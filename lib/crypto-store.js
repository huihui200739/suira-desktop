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
 * DPAPI 通过一个短命的 PowerShell 调用完成（Node 无原生绑定）。
 * 该调用只在启动加载与首次写入时发生，不在热路径上。
 */

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

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

/*
 * DPAPI 桥接。
 *
 * 注意：`powershell -Command` 不会把尾部参数填进 `$args`（那是脚本文件的语义），
 * 必须把模式与数据以变量形式拼进命令文本。数据只有 base64 字符，可安全内联。
 */
function buildDpapiCommand(mode, base64) {
  return [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Security',
    `$mode = '${mode}'`,
    `$b64 = '${base64}'`,
    '$bytes = [Convert]::FromBase64String($b64)',
    '$out = if ($mode -eq "protect") {',
    '  [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, "CurrentUser")',
    '} else {',
    '  [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, "CurrentUser")',
    '}',
    '[Console]::Out.Write([Convert]::ToBase64String($out))'
  ].join('\n');
}

function runDpapi(mode, buffer) {
  const base64 = buffer.toString('base64');
  // base64 只含 A-Za-z0-9+/=，不会破坏单引号字符串
  if (!/^[A-Za-z0-9+/=]*$/.test(base64)) throw new Error('DPAPI 输入包含非法字符');
  const output = execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-Command', buildDpapiCommand(mode, base64)
  ], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  return Buffer.from(String(output).trim(), 'base64');
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
    this.key = null;
  }

  /** 从受保护的密钥文件加载；不存在则生成并保存。 */
  loadOrCreate(keyPath) {
    const fs = require('node:fs');
    if (fs.existsSync(keyPath)) {
      try {
        const wrapped = Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'base64');
        const raw = this.unprotect(wrapped);
        if (raw.length !== KEY_BYTES) throw new Error('密钥长度不符');
        this.key = raw;
        return { ok: true, created: false };
      } catch (error) {
        return { ok: false, created: false, error: `数据密钥解封失败：${error.message}` };
      }
    }
    try {
      const key = generateKey();
      const wrapped = this.protect(key);
      fs.mkdirSync(require('node:path').dirname(keyPath), { recursive: true });
      fs.writeFileSync(keyPath, wrapped.toString('base64'), { mode: 0o600 });
      this.key = key;
      return { ok: true, created: true };
    } catch (error) {
      return { ok: false, created: false, error: `数据密钥创建失败：${error.message}` };
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
const SENSITIVE_FIELDS = ['text', 'title'];

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
