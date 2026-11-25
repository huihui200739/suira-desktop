'use strict';

const fs = require('node:fs');
const path = require('node:path');

function writeVerificationReport(name, proof) {
  const directory = path.join(__dirname, '..', '.workbuddy', 'verification-reports');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, name), JSON.stringify(proof, null, 2) + '\n');
}

module.exports = { writeVerificationReport };
