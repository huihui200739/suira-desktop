'use strict';

const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const limits = {
  'main.js': 500,
  'lib/clipboard-history.js': 200,
  'lib/store-writer.js': 140,
  'src/icons.js': 440,
  'src/stage-tools.js': 440,
  'src/styles.css': 440,
  'src/workspace.js': 440,
  'src/trail-view.js': 440,
  'src/utility-surface.css': 140
};

for (const [file, limit] of Object.entries(limits)) {
  const lines = readFileSync(resolve(__dirname, '..', file), 'utf8').split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line.length <= limit) continue;
    console.error(`${file}:${index + 1}: split this ${line.length}-character line (limit ${limit}).`);
    process.exitCode = 1;
  }
}
