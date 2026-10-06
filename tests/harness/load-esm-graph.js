'use strict';
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..', '..');

function bundleEsmGraph(relativePath, { globalName = '__esm_exports', entrySourceTransform } = {}) {
  const entry = path.join(root, relativePath);
  const entryOptions = entrySourceTransform
    ? {
      stdin: {
        contents: entrySourceTransform(fs.readFileSync(entry, 'utf8')),
        resolveDir: path.dirname(entry),
        sourcefile: entry,
        loader: 'js'
      }
    }
    : { entryPoints: [entry] };
  const result = esbuild.buildSync({
    ...entryOptions,
    absWorkingDir: root,
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    charset: 'utf8',
    legalComments: 'inline',
    minify: false,
    sourcemap: false,
    logLevel: 'silent',
    globalName
  });
  if (result.outputFiles.length !== 1) throw new Error('ESM-Testbundle muss genau eine Ausgabedatei besitzen.');
  return result.outputFiles[0].text;
}

function loadEsmGraph(relativePath, { globals = {}, globalName = '__esm_exports' } = {}) {
  // Product buffers passed to host WebCrypto must use host typed-array storage on Node 20.
  const sandbox = { Uint8Array, ...globals };
  vm.createContext(sandbox);
  vm.runInContext(bundleEsmGraph(relativePath, { globalName }), sandbox, { filename: `${relativePath}.bundle.js` });
  return { exports: sandbox[globalName], sandbox };
}

module.exports = { bundleEsmGraph, loadEsmGraph };
