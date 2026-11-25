'use strict';

const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { ask } = require('./agy-ask.cjs');

const id = '12345678-1234-1234-1234-123456789abc';
const listedModels = 'gemini-4-neon-high\tGemini 4 Neon (High)\r\ngemini-4-neon-medium\tGemini 4 Neon (Medium)\r\n';
const calls = [];
const spawn = (_command, args, options) => {
  calls.push({ args, options });
  if (args[0] === 'models') return { status: 0, stdout: listedModels, stderr: '' };
  return {
    status: 0,
    stdout: JSON.stringify({ status: 'SUCCESS', response: '建议保持简洁。', conversation_id: id }),
    stderr: '',
  };
};

const result = ask({ mode: 'copy', task: '评审提示文案' }, spawn);
assert.deepEqual(result, { conversationId: id, response: '建议保持简洁。' });
assert.equal(calls.length, 2);
assert.deepEqual(calls[0].args, ['models']);
assert.ok(calls[1].args.includes('--mode'));
assert.ok(calls[1].args.includes('plan'));
assert.ok(calls[1].args.includes('--print'));
assert.ok(!calls[1].args.includes('--dangerously-skip-permissions'));
assert.deepEqual(calls[1].args.slice(0, 2), ['--model', 'gemini-4-neon-high']);
assert.ok(calls.every(call => call.options.cwd.includes('agy-ask-')));
assert.ok(calls.every(call => !Object.keys(call.options.env).some(key => /(?:^|_)(?:API_KEY|BASE_URL)$/i.test(key))));
assert.ok(calls.every(call => !existsSync(call.options.cwd)));
assert.throws(() => ask({ mode: 'test', task: 'unexpected data' }, spawn), /does not accept/);
assert.throws(() => ask({ task: 'resume', resume: 'arbitrary-session' }, spawn), /conversationId/);
ask({ mode: 'plan', task: '继续评审', resume: id }, spawn);
assert.deepEqual(calls[3].args.slice(0, 2), ['--model', 'gemini-4-neon-high']);
assert.equal(calls[3].args[calls[3].args.indexOf('--conversation') + 1], id);
assert.throws(() => ask({ mode: 'test' }, (_command, args) => {
  assert.deepEqual(args, ['models'], 'Do not request a fallback model');
  return { status: 0, stdout: 'gemini-4-neon-medium\tGemini 4 Neon (Medium)', stderr: '' };
}), /Neon \(High\) is not available/);

const testCalls = [];
const testSpawn = (_command, args) => {
  testCalls.push(args);
  return args[0] === 'models'
    ? { status: 0, stdout: listedModels, stderr: '' }
    : { status: 0, stdout: JSON.stringify({
      status: 'SUCCESS', response: 'GEMINI_COLLAB_OK', conversation_id: id,
    }), stderr: '' };
};
assert.equal(ask({ mode: 'test' }, testSpawn).response, 'GEMINI_COLLAB_OK');
assert.deepEqual(testCalls[1].slice(0, 2), ['--model', 'gemini-4-neon-high']);
assert.ok(testCalls[1].includes('Reply with exactly GEMINI_COLLAB_OK. Do not use tools.'));

console.log('agy-ask protocol tests passed');
