'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEsmGraph } = require('./harness/load-esm-graph.js');
const { CsvTextDecoder } = require('./harness/csv-text-decoder.js');

const { exports: csvDecoding } = loadEsmGraph('src/transfer/csv-decoding.js', { globals: { TextDecoder: CsvTextDecoder } });
const { CsvDecodeError, decodeCsvBytes } = csvDecoding;

test('invalid UTF-8, including Windows-1252 umlaut bytes, raises a typed decode error', () => {
  const invalidUtf8 = [
    Uint8Array.of(0xf6, 0xdf),
    Uint8Array.of(0x47, 0x72, 0xf6, 0xdf, 0x65),
    Uint8Array.of(0xc3, 0x28)
  ];

  for (const bytes of invalidUtf8) {
    assert.throws(() => decodeCsvBytes(bytes), error =>
      error instanceof CsvDecodeError && error.name === 'CsvDecodeError' && error.encoding === 'utf-8');
  }
});

test('UTF-8 without a BOM and with a BOM decode to the same text', () => {
  assert.equal(decodeCsvBytes(Uint8Array.of(0x4e, 0x61, 0x6d, 0x65, 0x3b, 0x46, 0x61, 0x63, 0x68)), 'Name;Fach');
  assert.equal(decodeCsvBytes(Uint8Array.of(0xef, 0xbb, 0xbf, 0x4e, 0x61, 0x6d, 0x65, 0x3b, 0x46, 0x61, 0x63, 0x68)), 'Name;Fach');
});

test('explicit Windows-1252 selection decodes umlauts and typographic characters', () => {
  const windows1252 = Uint8Array.of(
    0x47, 0x72, 0xf6, 0xdf, 0x65, 0x20, 0x96, 0x20, 0x84, 0x54, 0xfc, 0x72, 0x93, 0x20, 0x80
  );

  assert.equal(decodeCsvBytes(windows1252, 'windows-1252'), 'Größe – „Tür“ €');
});

test('Windows-1252 keeps defined and undefined extension bytes distinct', () => {
  assert.equal(
    decodeCsvBytes(Uint8Array.of(0x80, 0x81, 0x92, 0x9d, 0x9f), 'windows-1252'),
    '\u20ac\u0081\u2019\u009d\u0178'
  );
});

test('a valid UTF-8 replacement character is preserved instead of reinterpreted', () => {
  assert.equal(decodeCsvBytes(Uint8Array.of(0xef, 0xbf, 0xbd)), '\uFFFD');
});

test('ArrayBuffer and Uint8Array inputs decode without changing caller-owned bytes', () => {
  const backing = Uint8Array.of(0xff, 0x41, 0x3b, 0x42, 0xfe);
  const before = Array.from(backing);
  const view = backing.subarray(1, 4);
  const arrayBuffer = Uint8Array.of(0x52, 0x6f, 0x77).buffer;
  const arrayBufferBefore = Array.from(new Uint8Array(arrayBuffer));

  assert.equal(decodeCsvBytes(view), 'A;B');
  assert.equal(decodeCsvBytes(arrayBuffer), 'Row');
  assert.deepEqual(Array.from(backing), before);
  assert.deepEqual(Array.from(new Uint8Array(arrayBuffer)), arrayBufferBefore);
});

test('unsupported encodings are rejected instead of using TextDecoder aliases silently', () => {
  assert.throws(() => decodeCsvBytes(Uint8Array.of(0xf6), 'latin1'), error =>
    error instanceof CsvDecodeError && error.name === 'CsvDecodeError' && error.encoding === 'latin1');
});
