'use strict';

const assert = require('node:assert/strict');
const { unzipSync, strFromU8 } = require('fflate');

function decodeXmlText(value) {
  return String(value || '').replace(/&#x([0-9a-f]+);|&#([0-9]+);|&quot;|&apos;|&lt;|&gt;|&amp;/gi, token => {
    if (token.startsWith('&#x')) return String.fromCodePoint(Number.parseInt(token.slice(3, -1), 16));
    if (token.startsWith('&#')) return String.fromCodePoint(Number.parseInt(token.slice(2, -1), 10));
    return { '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' }[token.toLowerCase()];
  });
}

function readAttribute(markup, name) {
  const match = String(markup).match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? decodeXmlText(match[1]) : null;
}

function readRichText(markup) {
  return [...String(markup).matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map(match => decodeXmlText(match[1]))
    .join('');
}

function columnIndexFromAddress(address) {
  const letters = String(address).match(/^[A-Z]+/i);
  assert.ok(letters, `ungültige Zelladresse: ${address}`);
  return [...letters[0].toUpperCase()].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function parseWorksheet(xml, sharedStrings) {
  const rows = [];
  const cellRows = [];
  const cells = new Map();
  const rowHeights = new Map(
    [...String(xml).matchAll(/<row\b([^>]*)>/g)]
      .map(match => [
        Number(readAttribute(match[1], 'r')),
        Number(readAttribute(match[1], 'ht'))
      ])
      .filter(([rowNumber, height]) => Number.isInteger(rowNumber) && Number.isFinite(height))
  );
  for (const match of String(xml).matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attributes = match[1];
    const body = match[2] || '';
    const address = readAttribute(attributes, 'r');
    const typeCode = readAttribute(attributes, 't');
    const formulaMatch = body.match(/<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/);
    const valueMatch = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/);
    let value = '';
    let type = 'string';
    if (formulaMatch) {
      type = 'formula';
      value = decodeXmlText(formulaMatch[1]);
    } else if (typeCode === 's') {
      value = sharedStrings[Number(valueMatch && valueMatch[1])] || '';
    } else if (typeCode === 'inlineStr') {
      value = readRichText(body);
    } else if (typeCode === 'b') {
      type = 'boolean';
      value = valueMatch && valueMatch[1] === '1';
    } else if (valueMatch) {
      type = 'number';
      value = Number(valueMatch[1]);
    }
    const rowNumber = Number(String(address).match(/\d+$/)[0]);
    const columnIndex = columnIndexFromAddress(address);
    if (!rows[rowNumber - 1]) rows[rowNumber - 1] = [];
    rows[rowNumber - 1][columnIndex] = value;
    const cell = {
      address,
      value,
      type,
      styleId: Number(readAttribute(attributes, 's') || 0)
    };
    cells.set(address, cell);
    if (!cellRows[rowNumber - 1]) cellRows[rowNumber - 1] = [];
    cellRows[rowNumber - 1][columnIndex] = cell;
  }
  const merges = [...String(xml).matchAll(/<mergeCell\s+ref="([^"]+)"\s*\/>/g)].map(match => match[1]);
  return { rows, cellRows, cells, rowHeights, merges, xml };
}

async function readXlsxWorkbook(blob) {
  assert.ok(blob && typeof blob.arrayBuffer === 'function', 'Excel-Download muss ein Blob sein');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual(Array.from(bytes.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04], 'Excel-Download muss ein ZIP/XLSX sein');
  const binaryFiles = unzipSync(bytes);
  const files = Object.fromEntries(Object.entries(binaryFiles).map(([name, content]) => [name, strFromU8(content)]));
  assert.ok(files['xl/workbook.xml'], 'XLSX-Arbeitsmappe fehlt');
  const sharedStrings = [...String(files['xl/sharedStrings.xml'] || '').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(match => readRichText(match[1]));
  const relationships = new Map(
    [...String(files['xl/_rels/workbook.xml.rels'] || '').matchAll(/<Relationship\b([^>]*)\/>/g)]
      .map(match => [readAttribute(match[1], 'Id'), readAttribute(match[1], 'Target')])
  );
  const sheets = [...files['xl/workbook.xml'].matchAll(/<sheet\b([^>]*)\/>/g)].map(match => {
    const name = readAttribute(match[1], 'name');
    const relationshipId = readAttribute(match[1], 'r:id');
    const target = relationships.get(relationshipId);
    assert.ok(target, `Beziehung für Tabellenblatt ${name} fehlt`);
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    assert.ok(files[path], `Tabellenblattdatei fehlt: ${path}`);
    return { name, ...parseWorksheet(files[path], sharedStrings) };
  });
  return { bytes, files, sheets };
}

module.exports = { readXlsxWorkbook };
