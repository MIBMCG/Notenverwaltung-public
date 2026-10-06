'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('npm test commands are scoped to the repository test directory', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
  );

  assert.equal(packageJson.scripts.test, 'node tests/run-tests.js');
  assert.equal(
    packageJson.scripts['test:tap'],
    'node tests/run-tests.js --test-reporter=tap'
  );
  assert.equal(fs.existsSync(path.join(__dirname, 'run-tests.js')), true);
});

test('Wave 1 pins the deterministic developer build contract', () => {
  const root = path.join(__dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const attributes = fs.readFileSync(path.join(root, '.gitattributes'), 'utf8');

  assert.equal(packageJson.devDependencies.esbuild, '0.25.9');
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.packages[''].devDependencies.esbuild, '0.25.9');
  assert.equal(lock.packages['node_modules/esbuild'].version, '0.25.9');
  assert.match(attributes, /^Notenverwaltung\.html text eol=lf$/m);
  assert.match(attributes, /^src\/\*\* text eol=lf$/m);
  assert.match(attributes, /^scripts\/\*\.mjs text eol=lf$/m);
  assert.match(attributes, /^package\.json text eol=lf$/m);
  assert.match(attributes, /^package-lock\.json text eol=lf$/m);
  assert.match(attributes, /^\*\.png binary$/m);
});
