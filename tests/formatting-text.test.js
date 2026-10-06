'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { importEsmSource } = require('./harness/import-esm-source.js');

test('German display text sorting follows the shared collation contract', async () => {
  const { compareText } = await importEsmSource('src/formatting/text.js');
  const values = ['Zora', 'Ordnung', 'Änne', 'Ökologie'];

  assert.deepEqual(
    values.sort(compareText),
    ['Änne', 'Ökologie', 'Ordnung', 'Zora']
  );
  assert.equal(compareText(null, 'A'), ''.localeCompare('A', 'de'));
  assert.equal(compareText(undefined, ''), 0);
  assert.throws(() => compareText('a', 'b', { locale: 'not_a_locale' }), RangeError);
});

test('text formatter source avoids browser state and ambient current time', () => {
  const source = fs.readFileSync('src/formatting/text.js', 'utf8');
  assert.doesNotMatch(source, /\b(?:window|document|localStorage)\b/);
  assert.doesNotMatch(source, /Date\.now\s*\(|new Date\s*\(\s*\)/);
});
