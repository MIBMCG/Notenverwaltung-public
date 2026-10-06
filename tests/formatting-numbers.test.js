'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { importEsmSource } = require('./harness/import-esm-source.js');

test('legacy fixed and percent output stays byte-identical', async () => {
  const api = await importEsmSource('src/formatting/numbers.js');
  assert.equal(api.formatLegacyFixed(2.5, 2), '2.50');
  assert.equal(api.formatLegacyPercent(67.25, { digits: 1, spaceBeforeSymbol: true }), '67.3 %');
  assert.equal(api.formatLegacyPercent(67.25, { digits: 1, spaceBeforeSymbol: false }), '67.3%');
  assert.equal(api.formatLegacyFixed(NaN, 2), null);
  assert.equal(api.formatLegacyFixed(Infinity, 2), null);
});

test('localized numbers are explicit and do not alter their input', async () => {
  const api = await importEsmSource('src/formatting/numbers.js');
  assert.equal(api.formatNumber(11.5, { locale: 'de-DE', minimumFractionDigits: 1, maximumFractionDigits: 1 }), '11,5');
  assert.equal(api.formatNumber(11.5, { locale: 'en-US', minimumFractionDigits: 1, maximumFractionDigits: 1 }), '11.5');
  assert.throws(() => api.formatNumber(1, { locale: 'not_a_locale' }), RangeError);
});

test('decimal comma adapters preserve Excel and CSV contracts', async () => {
  const api = await importEsmSource('src/formatting/numbers.js');
  assert.equal(api.formatDecimalComma(2.5, { digits: 2, trimTrailingZeros: true }), '2,5');
  assert.equal(api.formatDecimalComma(2.5, { digits: 1, trimTrailingZeros: false }), '2,5');
  assert.equal(api.formatDecimalComma(100, { digits: 1, trimTrailingZeros: false }), '100,0');
  assert.equal(api.formatDecimalComma(null, { digits: 2 }), null);
  assert.equal(
    api.formatDecimalComma(Number.MAX_VALUE, { digits: 100, trimTrailingZeros: true }),
    '1,7976931348623157e+308'
  );
});

test('decimal input accepts only the existing complete decimal syntax', async () => {
  const api = await importEsmSource('src/formatting/numbers.js');
  assert.equal(api.parseDecimalInput(' 2,5 '), 2.5);
  assert.equal(api.parseDecimalInput('.5'), 0.5);
  for (const invalid of ['', '2.', '2x', '1e2', Infinity, null]) {
    assert.equal(api.parseDecimalInput(invalid), null);
  }
});

test('number formatter source avoids browser state and ambient current time', () => {
  const source = fs.readFileSync('src/formatting/numbers.js', 'utf8');
  assert.doesNotMatch(source, /\b(?:window|document|localStorage)\b/);
  assert.doesNotMatch(source, /Date\.now\s*\(|new Date\s*\(\s*\)/);
});
