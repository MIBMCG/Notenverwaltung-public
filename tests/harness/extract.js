'use strict';
const fs = require('node:fs');
const path = require('node:path');

const HTML_PATH = path.join(__dirname, '..', '..', 'src', 'legacy', 'application.js');

function readSourceLines(htmlPath = HTML_PATH) {
  return fs.readFileSync(htmlPath, 'utf8').split(/\r?\n/);
}

// Top-level modules: `    const Name = (function () {` ... `    })();`
// Both markers are unique at four spaces of indentation, so no brace counting.
function extractModule(lines, name) {
  const opener = `    const ${name} = (function () {`;
  const start = lines.indexOf(opener);
  if (start === -1) throw new Error(`Modulanfang nicht gefunden: ${name}`);
  const end = lines.indexOf('    })();', start);
  if (end === -1) throw new Error(`Modulende nicht gefunden: ${name}`);
  return lines.slice(start, end + 1).join('\n');
}

// Nested helpers: `<indent>function name(` ... `<indent>}`
function extractFunction(lines, name) {
  const opener = new RegExp(`^(\\s*)function ${name}\\s*\\(`);
  const start = lines.findIndex(line => opener.test(line));
  if (start === -1) throw new Error(`Funktionsanfang nicht gefunden: ${name}`);
  const closer = lines[start].match(opener)[1] + '}';
  const end = lines.indexOf(closer, start + 1);
  if (end === -1) throw new Error(`Funktionsende nicht gefunden: ${name}`);
  return lines.slice(start, end + 1).join('\n');
}

module.exports = { HTML_PATH, readSourceLines, extractModule, extractFunction };
