'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { bundleEsmGraph, loadEsmGraph } = require('./harness/load-esm-graph.js');
const { localStorageStub } = require('./harness/load.js');

function storageGlobals() {
  return {
    Date,
    Event,
    TextEncoder,
    TextDecoder,
    btoa,
    atob,
    crypto,
    localStorage: localStorageStub(),
    window: { addEventListener() {}, dispatchEvent() {}, promptPassword: async () => null, alert() {}, confirm() { return false; } },
    setTimeout: () => 0,
    clearTimeout() {},
    console: { error() {}, warn() {}, log() {}, info() {}, debug() {} }
  };
}

test('entrySourceTransform wird einmal nur auf den echten Entry angewendet', () => {
  let transformCalls = 0;
  let transformedSource = null;
  const bundle = bundleEsmGraph('src/infrastructure/storage.js', {
    globalName: '__storage_exports',
    entrySourceTransform(source) {
      transformCalls += 1;
      transformedSource = source;
      return `globalThis.__storageEntryTransform = true;\n${source}`;
    }
  });
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(bundle, sandbox);
  assert.equal(transformCalls, 1);
  assert.match(transformedSource, /export function createStorage/);
  assert.equal(sandbox.__storageEntryTransform, true);
  assert.equal(typeof sandbox.__storage_exports.createStorage, 'function');
});

test('Storage-Graph verwendet die echte importierte Verschluesselung', async () => {
  const { exports } = loadEsmGraph('src/infrastructure/storage.js', { globals: storageGlobals(), globalName: '__storage_exports' });
  const sessionCoordinator = loadEsmGraph('src/infrastructure/session-coordinator.js').exports.createSessionCoordinator({ lockManager: null });
  const storage = exports.createStorage({
    sessionCoordinator,
    DomainModel: { ensureStateShape: state => state },
    createInitialState: () => ({ courses: [] })
  });
  const payload = await storage._encryptJsonWithSalt('{"kurs":"Kryptografie"}', 'synthetisches-passwort');
  assert.equal(await storage._decryptPayload(payload, 'synthetisches-passwort'), '{"kurs":"Kryptografie"}');
});

test('untransformiertes Laden behaelt den bisherigen Entry-Point-Pfad', () => {
  const { exports } = loadEsmGraph('src/infrastructure/storage.js', { globalName: '__storage_exports' });
  assert.deepEqual(Object.keys(exports), ['createStorage']);
});
