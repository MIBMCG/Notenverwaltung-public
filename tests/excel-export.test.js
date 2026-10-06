'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { unzipSync, strFromU8 } = require('fflate');
const { bundleEsmGraph, loadEsmGraph } = require('./harness/load-esm-graph.js');

function loadExcelExportModule() {
  return loadEsmGraph('src/transfer/excel-export.js', {
    globals: {
      Blob,
      TextEncoder,
      TextDecoder,
      Uint8Array,
      ArrayBuffer,
      setTimeout,
      clearTimeout
    }
  }).exports;
}

async function unzipWorkbook(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes, files: unzipSync(bytes) };
}

test('Excel adapter emits a genuine formula-safe XLSX Blob from typed cells', async () => {
  const excel = loadExcelExportModule();
  const dangerousText = '=1+1 & <Fach>\nZweite Zeile';
  const blob = await excel.createExcelWorkbookBlob([{
    sheet: 'Formelsicherheit',
    data: [[
      excel.createExcelTextCell(dangerousText),
      excel.createExcelNumberCell(0)
    ]]
  }]);

  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const { bytes, files } = await unzipWorkbook(blob);
  assert.deepEqual(Array.from(bytes.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
  assert.ok(files['[Content_Types].xml']);
  assert.ok(files['xl/workbook.xml']);
  assert.ok(files['xl/worksheets/sheet1.xml']);

  const sharedStrings = strFromU8(files['xl/sharedStrings.xml']);
  const worksheet = strFromU8(files['xl/worksheets/sheet1.xml']);
  const styles = strFromU8(files['xl/styles.xml']);
  assert.match(sharedStrings, /=1\+1 &amp; &lt;Fach&gt;\nZweite Zeile/);
  assert.doesNotMatch(worksheet, /<f(?:\s|>)/, 'plain user text must never become a formula');
  assert.match(worksheet, /<c r="A1"[^>]* t="s">/);
  assert.match(worksheet, /<c r="B1"[^>]*><v>0<\/v><\/c>/);
  assert.match(styles, /formatCode="@"/);
});

test('XLSX stores every spreadsheet prefix and script-shaped user text as literal string cells', async () => {
  const excel = loadExcelExportModule();
  const { readXlsxWorkbook } = require('./harness/read-xlsx');
  const values = [
    '=1+1', '+2', '-3', '@SUM(1,2)',
    '<img src=x onerror="alert(1)">', '</script> "Zitat"'
  ];
  const blob = await excel.createExcelWorkbookBlob([{
    sheet: 'Synthetische Eingaben',
    data: values.map(value => [excel.createExcelTextCell(value)])
  }]);
  const workbook = await readXlsxWorkbook(blob);
  assert.deepEqual(workbook.sheets[0].rows.map(row => row[0]), values);
  assert.ok([...workbook.sheets[0].cells.values()].every(cell => cell.type !== 'formula'));
  const sharedStrings = strFromU8((await unzipWorkbook(blob)).files['xl/sharedStrings.xml']);
  assert.match(sharedStrings, /&lt;img src=x onerror=/);
  assert.match(sharedStrings, /&lt;\/script&gt;/);
  assert.doesNotMatch(sharedStrings, /<img|<\/script>/);
});
test('Excel adapter creates valid unique worksheet names without changing course titles', () => {
  const excel = loadExcelExportModule();
  const names = excel.createUniqueWorksheetNames([
    'Biologie [Q3]/Leistung: sehr langer vollständiger Kurstitel',
    'Biologie [Q3]/Leistung: sehr langer vollständiger Kurstitel',
    'biologie [q3]/leistung: sehr langer vollständiger kurstitel',
    "'"
  ]);

  assert.deepEqual(Array.from(names), [
    'Biologie _Q3__Leistung_ sehr la',
    'Biologie _Q3__Leistung_ seh (2)',
    'biologie _q3__leistung_ seh (3)',
    'Kurs'
  ]);
  assert.equal(new Set(names.map(name => name.toLocaleLowerCase('de-DE'))).size, names.length);
  assert.ok(names.every(name => name.length <= 31 && !/[\\/?*\[\]:]/.test(name)));
});

test('Excel adapter removes edge apostrophes and avoids the reserved History worksheet name', () => {
  const excel = loadExcelExportModule();
  const names = excel.createUniqueWorksheetNames([
    "  'Biologie'  ",
    "123456789012345678901234567890'xyz",
    'History',
    'history'
  ]);

  assert.deepEqual(Array.from(names), [
    'Biologie',
    '123456789012345678901234567890',
    'History_',
    'history_ (2)'
  ]);
  assert.ok(names.every(name => !/^'|'$/.test(name)));
  assert.ok(names.every(name => name.toLocaleLowerCase('en-US') !== 'history'));
});

test('Excel adapter bundle retains the complete write-excel-file and fflate MIT notices', () => {
  const bundle = bundleEsmGraph('src/transfer/excel-export.js');
  assert.match(bundle, /Copyright \(c\) 2018 gitlab\.com\/catamphetamine/);
  assert.match(bundle, /Copyright \(c\) 2026 Arjun Barrett/);
  assert.equal((bundle.match(/Permission is hereby granted, free of charge/g) || []).length, 2);
  assert.equal((bundle.match(/THE SOFTWARE IS PROVIDED "AS IS"/g) || []).length, 2);
});

test('Excel numeric cells retain the existing two-decimal reporting rounding', () => {
  const excel = loadExcelExportModule();
  assert.equal(excel.createExcelNumberCell(2.675).value, 2.68);
  assert.equal(excel.createExcelNumberCell(2).format, '0');
  assert.equal(excel.createExcelNumberCell(2.5).format, '0.0#');
});
