'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { importEsmSource } = require('./harness/import-esm-source.js');

test('calendar dates validate real days and retain local components', async () => {
  const api = await importEsmSource('src/formatting/date-time.js');
  assert.deepEqual(api.parseCalendarDate('2024-02-29'), { year: 2024, month: 2, day: 29 });
  assert.equal(api.parseCalendarDate('2026-02-29'), null);
  assert.equal(api.parseCalendarDate('2026/02/09'), null);
  const date = api.calendarDateToLocalDate({ year: 2026, month: 2, day: 9 });
  assert.deepEqual([date.getFullYear(), date.getMonth() + 1, date.getDate()], [2026, 2, 9]);
  assert.equal(api.formatCalendarDate('2026-02-09'), '9.2.2026');
});

test('instant formatting requires an explicit timezone and preserves the instant', async () => {
  const api = await importEsmSource('src/formatting/date-time.js');
  const value = '2026-03-29T01:30:00.000Z';
  assert.throws(() => api.formatInstant(value, { locale: 'de-DE' }), /timeZone/);
  assert.equal(api.formatInstant(value, { locale: 'de-DE', timeZone: 'Europe/Berlin', includeTime: true }), '29.3.2026, 03:30:00');
  assert.equal(api.formatInstant(value, { locale: 'de-DE', timeZone: 'America/Los_Angeles', includeTime: true }), '28.3.2026, 18:30:00');
  assert.equal(api.parseInstant('2026-03-29'), null);
  assert.equal(api.parseInstant('kein Zeitpunkt'), null);
});

test('instant parsing rejects February 29 in a non-leap year', async () => {
  const api = await importEsmSource('src/formatting/date-time.js');
  assert.equal(api.parseInstant('2026-02-29T00:00:00.000Z'), null);
});

test('instant parsing rejects a day beyond the selected month', async () => {
  const api = await importEsmSource('src/formatting/date-time.js');
  assert.equal(api.parseInstant('2026-04-31T12:30:00+02:00'), null);
});

test('instant parsing rejects normalized hour 24', async () => {
  const api = await importEsmSource('src/formatting/date-time.js');
  assert.equal(api.parseInstant('2026-04-30T24:00:00.000Z'), null);
});

test('instant parsing retains supported UTC, offset and defensive-copy forms', async () => {
  const api = await importEsmSource('src/formatting/date-time.js');
  assert.equal(api.parseInstant('2024-02-29T00:00:00.000Z').toISOString(), '2024-02-29T00:00:00.000Z');
  assert.equal(api.parseInstant('2026-03-29T01:30Z').toISOString(), '2026-03-29T01:30:00.000Z');
  assert.equal(api.parseInstant('2026-03-29T03:30:00+02:00').toISOString(), '2026-03-29T01:30:00.000Z');
  const original = new Date('2026-03-29T01:30:00.000Z');
  const copy = api.parseInstant(original);
  assert.notStrictEqual(copy, original);
  assert.equal(copy.getTime(), original.getTime());
});

test('UTC filename stamps preserve the existing machine format', async () => {
  const api = await importEsmSource('src/formatting/date-time.js');
  const value = new Date('2026-08-30T14:15:16.987Z');
  assert.equal(api.formatUtcDateStamp(value), '2026-08-30');
  assert.equal(api.formatUtcFileTimestamp(value), '2026-08-30T14-15-16');
  assert.equal(api.formatUtcDateStamp(NaN), null);
});

test('VM installer exposes real date helpers through immutable global bindings', () => {
  let installFormattingGlobals;
  assert.doesNotThrow(() => {
    ({ installFormattingGlobals } = require('./harness/install-formatting.js'));
  });
  const sandbox = {};
  vm.createContext(sandbox);

  installFormattingGlobals(sandbox);

  const original = sandbox.formatCalendarDate;
  assert.equal(original('2026-02-09'), '9.2.2026');
  assert.equal(Reflect.set(sandbox, 'formatCalendarDate', () => 'verändert'), false);
  assert.equal(Reflect.deleteProperty(sandbox, 'formatCalendarDate'), false);
  assert.strictEqual(sandbox.formatCalendarDate, original);
});

test('production does not publish a formatting namespace global', () => {
  const source = fs.readFileSync('src/legacy/application.js', 'utf8');
  assert.doesNotMatch(source, /window\.Formatting|globalThis\.Formatting/);
});

test('date-time formatter source avoids browser state and ambient current time', () => {
  const source = fs.readFileSync('src/formatting/date-time.js', 'utf8');
  assert.doesNotMatch(source, /\b(?:window|document|localStorage)\b/);
  assert.doesNotMatch(source, /Date\.now\s*\(|new Date\s*\(\s*\)/);
});
