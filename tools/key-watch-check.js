'use strict';

/**
 * 按住型按键侦测的真机验证工具。
 *
 * 用法：
 *   node tools/key-watch-check.js "CommandOrControl+Alt+Space"
 *   node tools/key-watch-check.js "CommandOrControl+Alt+Space" --seconds 15 --poll 25
 *   node tools/key-watch-check.js --selftest
 *
 * 普通模式会启动真实的 assets/key-watch.ps1 并打印每一条边沿，
 * 用来人工确认「按住出现 DOWN、全部松开出现 UP」：
 *   运行后按住目标组合键，终端应立即出现 DOWN；松手出现 UP。
 *
 * --selftest 模式不需要按键：直接跑助手的 -SelfTest 协议回放，
 * 用来确认脚本语法、READY 时序与进程退出行为。
 */

const { spawn } = require('node:child_process');
const { parseAcceleratorToVk, resolveScriptPath, KeyWatchProbe } = require('../lib/key-watch');

const POWERSHELL = 'powershell.exe';

function usage() {
  console.log('用法: node tools/key-watch-check.js "<加速键>" [--seconds N] [--poll N]');
  console.log('      node tools/key-watch-check.js --selftest [--poll N]');
  console.log('示例: node tools/key-watch-check.js "CommandOrControl+Alt+Space" --seconds 10');
}

function parseArgs(argv) {
  const options = { accelerator: '', selftest: false, seconds: 10, poll: 25 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--selftest') options.selftest = true;
    else if (arg === '--seconds') options.seconds = Number(argv[++i]);
    else if (arg === '--poll') options.poll = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (!options.accelerator) options.accelerator = arg;
  }
  return options;
}

/** 直接跑助手的 -SelfTest 回放，不经过 KeyWatchProbe。 */
function runSelfTest(pollMs) {
  return new Promise((resolve) => {
    const child = spawn(POWERSHELL, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', resolveScriptPath(), '-SelfTest', '-PollMs', String(pollMs)
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

    const startedAt = Date.now();
    const lines = [];
    let buffer = '';
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      finish(1, '10 秒内未收到 DONE');
    }, 10000);

    const finish = (code, note) => {
      clearTimeout(timer);
      try { child.stdin.end(); } catch {}
      try { child.kill(); } catch {}
      resolve({ code, lines, note });
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        lines.push(line);
        console.log('  +' + String(Date.now() - startedAt).padStart(5) + 'ms  ' + line);
        if (line === 'DONE' && !done) {
          done = true;
          finish(0, 'ok');
          return;
        }
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) console.log('  stderr: ' + text.slice(0, 300));
    });

    child.on('exit', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code: 1, lines, note: '助手提前退出 code=' + code });
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { usage(); return 0; }

  if (options.selftest) {
    console.log('[selftest] 协议回放，不需要按键');
    const result = await runSelfTest(Number.isFinite(options.poll) ? options.poll : 25);
    if (result.code !== 0) {
      console.log('[selftest] 失败：' + result.note);
      return 1;
    }
    const expected = 'READY,DOWN,UP,DOWN,UP,DONE';
    const actual = result.lines.join(',');
    if (actual !== expected) {
      console.log('[selftest] 序列不符：期望 ' + expected + '，实际 ' + actual);
      return 1;
    }
    console.log('[selftest] 通过：' + expected);
    return 0;
  }

  if (!options.accelerator) { usage(); return 2; }

  const parsed = parseAcceleratorToVk(options.accelerator);
  if (!parsed.ok) {
    console.log('[probe] 加速键无效：' + parsed.error);
    return 2;
  }

  const seconds = Number.isFinite(options.seconds) && options.seconds > 0 ? options.seconds : 10;
  const pollMs = Number.isFinite(options.poll) && options.poll > 0 ? options.poll : 25;
  const startedAt = Date.now();
  const stamp = () => '+' + String(Date.now() - startedAt).padStart(5) + 'ms';

  let downs = 0;
  let ups = 0;
  let heldAt = 0;

  const probe = new KeyWatchProbe({
    accelerator: options.accelerator,
    pollMs,
    onDown: () => {
      downs += 1;
      heldAt = Date.now();
      console.log(stamp() + '  DOWN');
    },
    onUp: () => {
      ups += 1;
      const held = heldAt ? ' (按住 ' + (Date.now() - heldAt) + 'ms)' : '';
      console.log(stamp() + '  UP' + held);
    },
    onError: (message) => console.log(stamp() + '  ERROR ' + message)
  });

  console.log('[probe] 加速键: ' + options.accelerator);
  console.log('[probe] VK: ' + parsed.vks.join(',') + '  poll=' + pollMs + 'ms');

  const startResult = await probe.start();
  if (!startResult.ok) {
    console.log('[probe] 启动失败：' + startResult.error);
    return 1;
  }
  console.log('[probe] READY，status=' + probe.status + '；请按住 ' + options.accelerator + ' 再松开');
  console.log('[probe] ' + seconds + ' 秒后自动结束（Ctrl+C 可提前退出）');

  const stop = async () => {
    await probe.stop();
    console.log('[probe] 已停止，status=' + probe.status + '  DOWN=' + downs + ' UP=' + ups);
    process.exit(downs > 0 ? 0 : 3);
  };

  process.once('SIGINT', () => { stop(); });
  setTimeout(stop, seconds * 1000);
  return null;
}

main().then((code) => {
  if (typeof code === 'number') process.exit(code);
}).catch((error) => {
  console.log('[probe] 异常：' + (error && error.message ? error.message : error));
  process.exit(1);
});
