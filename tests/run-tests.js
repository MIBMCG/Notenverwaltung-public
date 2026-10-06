'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const testFiles = fs.readdirSync(__dirname, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.test.js'))
  .map(entry => path.join(__dirname, entry.name))
  .sort();

if (testFiles.length === 0) {
  throw new Error('Keine Testdateien in tests/ gefunden.');
}

const result = spawnSync(
  process.execPath,
  ['--test', ...process.argv.slice(2), ...testFiles],
  { stdio: 'inherit' }
);

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;
