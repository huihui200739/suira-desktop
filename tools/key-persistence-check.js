'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const readline = require('node:readline');

async function checkKeyPersistence() {
  if (process.platform !== 'win32') return;
  const root = path.resolve(__dirname, '..');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'suira-key-persistence-'));
  const entry = path.join(profile, 'app.js');
  const exe = process.env.SUIRA_TEST_ELECTRON || (await fs.stat('C:/suira-electron/electron.exe').catch(() => null)
    ? 'C:/suira-electron/electron.exe' : require('electron'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  async function launch(mode, userData, forceQuit = false) {
    await fs.mkdir(userData, { recursive: true });
    const child = spawn(exe, [entry, mode, userData], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const exit = once(child, 'exit');
    const lines = readline.createInterface({ input: child.stdout });
    const timer = setTimeout(() => child.kill(), 15000);
    let failure = '';
    child.stderr.on('data', chunk => { failure = (failure + chunk).slice(-1500); });
    try {
      const ready = new Promise(resolve => lines.on('line', line => {
        if (line === 'READY') resolve(line);
      }));
      const result = await Promise.race([ready, exit.then(() => `exited before ready: ${failure}`)]);
      assert.equal(result, 'READY');
      if (forceQuit) assert.ok(child.kill());
      const [code] = await exit;
      if (!forceQuit) assert.equal(code, 0, failure);
    } finally {
      clearTimeout(timer);
      lines.close();
      if (child.pid && child.exitCode === null && !child.signalCode) child.kill();
      await exit;
    }
  }

  try {
    await fs.writeFile(entry, `
      const { app, safeStorage } = require('electron');
      const assert = require('node:assert/strict');
      const fs = require('node:fs/promises');
      const path = require('node:path');
      const { KeyVault, generateKey, encryptText, decryptText } = require(${JSON.stringify(path.join(root, 'lib/crypto-store'))});
      const [mode, userData] = process.argv.slice(2);
      app.setPath('userData', userData);
      app.whenReady().then(async () => {
        const keyPath = path.join(userData, 'suira-data.key');
        const recordPath = path.join(userData, 'record.json');
        const vault = new KeyVault({ safeStorage });
        if (mode === 'write' || mode === 'legacy') {
          let key;
          if (mode === 'legacy') {
            key = generateKey();
            const wrapped = await safeStorage.encryptStringAsync(key.toString('base64'));
            await fs.writeFile(keyPath, 'safeStorage:' + wrapped.toString('base64'));
          } else {
            const result = await vault.loadOrCreate(keyPath);
            assert.ok(result.ok && result.created, result.error);
            key = vault.key;
          }
          await fs.writeFile(recordPath, JSON.stringify(encryptText(key, 'first protected record', 'fixture')));
        } else {
          const result = await vault.loadOrCreate(keyPath, { allowCreate: () => false });
          assert.ok(result.ok && !result.created, result.error);
          const record = JSON.parse(await fs.readFile(recordPath, 'utf8'));
          assert.equal(decryptText(vault.key, record, 'fixture'), 'first protected record');
        }
        process.stdout.write('READY\\n', () => { if (mode === 'legacy' || mode === 'read') app.quit(); });
      }).catch(error => { console.error(error.message); app.exit(1); });
    `);
    const fresh = path.join(profile, 'fresh');
    await launch('write', fresh, true);
    await launch('read', fresh);
    const legacy = path.join(profile, 'legacy');
    await launch('legacy', legacy);
    await launch('migrate', legacy, true);
    assert.ok(!(await fs.readFile(path.join(legacy, 'suira-data.key'), 'utf8')).startsWith('safeStorage:'));
    await launch('read', legacy);
    console.log('PASS protected records survive first-launch force quit and legacy key migration');
  } finally {
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

module.exports = { checkKeyPersistence };
if (require.main === module) {
  checkKeyPersistence().catch(error => { console.error(error); process.exitCode = 1; });
}
