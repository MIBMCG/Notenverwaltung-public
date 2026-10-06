'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsmGraph } = require('./harness/load-esm-graph.js');

const names = ['csvCell', 'parseSemicolonCsv', 'validateCsvTransferHeader',
  'normalizeCsvDate', 'formatCsvImportIssuesText', 'formatCsvImportIssuesCsv',
  'encodeCsvTransferRow', 'decodeCsvTransferFields'];
const headers = ['KursID', 'Kurs', 'Fach', 'Klasse', 'SchuelerID', 'Nachname',
  'Vorname', 'Geburtstag', 'Schema', 'Kursart', 'Qualifikationsabschnitt',
  '3. Pruefungsfach schriftlich', 'Stammklasse'];

test('CSV module preserves formatting and parser contracts', () => {
  const { exports: csv } = loadEsmGraph('src/transfer/csv-format.js');

  assert.deepEqual(Object.keys(csv).sort(), names.slice().sort());
  assert.equal(csv.csvCell(null), '');
  assert.equal(csv.csvCell('a;"b"'), '"a;""b"""');
  for (const value of ['=1', '+1', '-1', '@x', ' \t=1']) {
    assert.equal(csv.csvCell(value), "'" + value);
  }
  const rows = csv.parseSemicolonCsv('a;"x\ny"\r\n\r\nb;c');
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [
    { fields: ['a', 'x\ny'], line: 1 }, { fields: ['b', 'c'], line: 4 }
  ]);
  assert.deepEqual(Array.from(csv.parseSemicolonCsv('a; "x;y";b')[0].fields), ['a', ' x;y', 'b']);
  assert.deepEqual(Array.from(csv.parseSemicolonCsv('"a""b";c\nd;e')[0].fields), ['a"b', 'c']);
  assert.deepEqual(JSON.parse(JSON.stringify(csv.parseSemicolonCsv('a;b\r\nc;d'))), [
    { fields: ['a', 'b'], line: 1 }, { fields: ['c', 'd'], line: 2 }
  ]);
  assert.equal(csv.parseSemicolonCsv('\n\r\n').length, 0);
  assert.throws(() => csv.parseSemicolonCsv('a;"x'), /Nicht geschlossenes Anführungszeichen ab Zeile 1\./);
  for (let n = 8; n <= 13; n++) assert.equal(csv.validateCsvTransferHeader(headers.slice(0, n)).columnCount, n);
  const header14 = [...headers, 'CSV-Schutz'];
  assert.deepEqual(JSON.parse(JSON.stringify(csv.validateCsvTransferHeader(header14))), {
    columnCount: 14,
    expectedHeader: header14
  });
  for (const bad of [headers.slice(0, 7), [...headers, 'Extra'], [...headers, 'CSV-Schutz', 'Extra'],
    [...headers, 'Schutz'], ['Falsch', ...headers.slice(1)]]) {
    assert.throws(() => csv.validateCsvTransferHeader(bad), /Kopfzeile/);
  }
  assert.equal(csv.normalizeCsvDate(''), '');
  assert.equal(csv.normalizeCsvDate('2024-02-29'), '2024-02-29');
  assert.equal(csv.normalizeCsvDate('29.02.2023'), null);
  assert.equal(csv.normalizeCsvDate('31/12/49'), '2049-12-31');
  assert.equal(csv.normalizeCsvDate('1-1-50'), '1950-01-01');
  const issues = [{ line: 2, issues: ['a', '"b"'] }];
  assert.equal(csv.formatCsvImportIssuesText(issues), 'Zeile 2\ta; "b"');
  assert.equal(csv.formatCsvImportIssuesCsv(issues), '\ufeffZeile;Fehler\n2;"a; ""b"""');
  assert.equal(csv.formatCsvImportIssuesText([]), '');
  assert.equal(csv.formatCsvImportIssuesCsv([]), '\ufeffZeile;Fehler');
});

test('CSV transfer encoder marks only inserted formula-protection apostrophes and decodes them reversibly', () => {
  const { exports: csv } = loadEsmGraph('src/transfer/csv-format.js');
  const rawFields = [
    '-AG Chor', '=1+1', '+Text', '@Name', '\t=1', '  -Text', '=mit;Trenner',
    "'=echter Apostroph", '2010-01-01', 'Sek I', '', '', '9a'
  ];

  const line = csv.encodeCsvTransferRow(rawFields);
  const parsedFields = csv.parseSemicolonCsv(line)[0].fields;

  assert.equal(parsedFields.length, 14);
  assert.equal(parsedFields[13], 'nv1:7f');
  assert.deepEqual(Array.from(csv.decodeCsvTransferFields(parsedFields, 14)), rawFields);

  const ordinary = csv.encodeCsvTransferRow(Array(13).fill('Text'));
  assert.equal(csv.parseSemicolonCsv(ordinary)[0].fields[13], 'nv1:0');
});

test('CSV transfer decoding keeps unmarked legacy apostrophes and rejects inconsistent masks', () => {
  const { exports: csv } = loadEsmGraph('src/transfer/csv-format.js');
  const legacy = Array(13).fill('');
  legacy[5] = "'=1+1";
  assert.equal(csv.decodeCsvTransferFields(legacy, 13)[5], "'=1+1");

  const row = Array(13).fill('');
  row[5] = '=1+1';
  for (const mask of ['v1:20', 'NV1:20', 'nv1:g', 'nv1:2000']) {
    assert.throws(() => csv.decodeCsvTransferFields([...row, mask], 14), /CSV-Schutz|Maske/);
  }
  assert.throws(() => csv.decodeCsvTransferFields([...row, 'nv1:20'], 14), /Apostroph|Schutz/);
  row[5] = "'normal";
  assert.throws(() => csv.decodeCsvTransferFields([...row, 'nv1:20'], 14), /schutzbedürftig|geschützt/);
  assert.throws(() => csv.encodeCsvTransferRow(Array(12).fill('x')), /13/);
});

test('CSV module does not install application globals', () => {
  const windowStub = {};
  loadEsmGraph('src/transfer/csv-format.js', { globals: { window: windowStub } });

  for (const name of names) assert.equal(name in windowStub, false, name);
});

test('Date is resolved at call time, not at module import', () => {
  const loaded = loadEsmGraph('src/transfer/csv-format.js');
  class SentinelDate extends Date {
    static UTC() { throw new Error('date-sentinel'); }
  }
  loaded.sandbox.Date = SentinelDate;
  assert.throws(() => loaded.exports.normalizeCsvDate('2024-01-01'), /date-sentinel/);
});
