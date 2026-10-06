'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { HTML_PATH, readSourceLines, extractModule, extractFunction } = require('./harness/extract.js');

const lines = readSourceLines();

test('only UiShell remains an extractable top-level IIFE', () => {
  const names = lines
    .map(line => /^    const (\w+) = \(function \(\) \{$/.exec(line))
    .filter(Boolean)
    .map(match => match[1]);
  assert.deepEqual(names, ['UiShell']);
});

test('readSourceLines returns the whole file', () => {
  assert.equal(lines.join('\n'), fs.readFileSync(HTML_PATH, 'utf8').replace(/\r\n/g, '\n'));
});

test('extractModule returns the remaining complete IIFE', () => {
  for (const name of ['UiShell']) {
    const code = extractModule(lines, name);
    assert.ok(code.startsWith(`    const ${name} = (function () {`), `${name}: falscher Anfang`);
    assert.ok(code.endsWith('    })();'), `${name}: falsches Ende`);
  }
});

test('extractModule slices the remaining plausibly complete IIFE', () => {
  for (const [name, min] of [['UiShell', 1000]]) {
    const count = extractModule(lines, name).split('\n').length;
    assert.ok(count > min, `${name}: nur ${count} Zeilen — Schnitt vermutlich zu frueh beendet`);
  }
});

test('extractModule throws a clear error for an unknown module', () => {
  assert.throws(() => extractModule(lines, 'GibtEsNicht'), /Modulanfang nicht gefunden/);
});

test('extractFunction slices a nested helper by its indentation', () => {
  const code = extractFunction(lines, 'recalcAssessmentTermsForCurrentState');
  assert.ok(code.startsWith('      function recalcAssessmentTermsForCurrentState(state, courseId = null) {'));
  assert.equal(code.split('\n').pop(), '      }');
});

test('extractFunction throws a clear error for an unknown function', () => {
  assert.throws(() => extractFunction(lines, 'gibtEsNicht'), /Funktionsanfang nicht gefunden/);
});
