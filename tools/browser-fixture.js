'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Keep the production CSP in fixture pages as well: only the probe lives here.
function writeFixture(file, html) {
  let index = 0;
  const saved = [];
  const page = html.replace(/<script>([\s\S]*?)<\/script>/g, (_tag, source) => {
    const name = `${path.basename(file, '.html')}-probe-${++index}.js`;
    const script = path.join(path.dirname(file), name);
    fs.writeFileSync(script, source, 'utf8');
    saved.push(script);
    return `<script src="${name}"></script>`;
  });
  fs.writeFileSync(file, page, 'utf8');
  return saved;
}

module.exports = { writeFixture };
