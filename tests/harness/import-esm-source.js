'use strict';
const fs = require('node:fs');
const path = require('node:path');

async function importEsmSource(relativePath, transformSource = source => source) {
  const absolutePath = path.join(__dirname, '..', '..', relativePath);
  let source = transformSource(fs.readFileSync(absolutePath, 'utf8'));
  if (/^import\s/m.test(source)) {
    source = require('esbuild').buildSync({
      stdin: { contents: source, resolveDir: path.dirname(absolutePath), loader: 'js' },
      bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent'
    }).outputFiles[0].text;
  }
  const encoded = Buffer.from(source, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${encodeURIComponent(relativePath)}`);
}

module.exports = { importEsmSource };
