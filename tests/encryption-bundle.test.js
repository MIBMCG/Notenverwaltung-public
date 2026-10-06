'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { bundleEsmGraph } = require('./harness/load-esm-graph.js');
const { installFormattingGlobals } = require('./harness/install-formatting.js');
const { createLockManagerStub } = require('./harness/shared-session');
const { localStorageStub, seededRandom } = require('./harness/load.js');

const root = path.join(__dirname, '..');
const artifactPath = path.join(root, 'Notenverwaltung.html');
const PASSWORD = 'Synthetic-Wave42-Password';
const NEW_PASSWORD = 'Synthetic-Wave42-New-Password';

function findBalancedEnd(source, start) {
  const opener = source.indexOf('{', start);
  if (opener === -1) throw new Error('Öffnende Klammer im Artefakt nicht gefunden.');
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = opener; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  throw new Error('Abgeschlossene Klammer im Artefakt nicht gefunden.');
}

function extractArtifactFunction(source, name) {
  const matcher = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = matcher.exec(source);
  if (!match) throw new Error(`Artefaktfunktion nicht gefunden: ${name}`);
  return source.slice(match.index, findBalancedEnd(source, source.indexOf(') {', match.index)));
}

function extractArtifactStorageFactory(source) {
  const start = source.indexOf('function createStorage(');
  if (start === -1) throw new Error('Storage-Fabrik im Artefakt nicht gefunden.');
  const bodyStart = source.indexOf(') {', start);
  if (bodyStart === -1) throw new Error('Storage-Fabrikrumpf im Artefakt nicht gefunden.');
  return source.slice(start, findBalancedEnd(source, bodyStart));
}

function extractArtifactStorageConstruction(source) {
  const statement = 'var Storage = createStorage({ DomainModel, createInitialState, sessionCoordinator });';
  const start = source.indexOf(statement);
  if (start === -1) throw new Error('Storage-Fabrikerzeugung im Artefakt nicht gefunden.');
  return source.slice(start, start + statement.length);
}

async function loadFreshBundledStorage({ storage, password, lockManager = createLockManagerStub() }) {
  const window = new EventTarget();
  window.promptPassword = async () => password;
  window.alert = () => {};
  window.confirm = () => false;
  const sandbox = {
    Date,
    lockManager,
    Event,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    btoa,
    atob,
    crypto,
    localStorage: storage,
    window,
    setTimeout: () => 0,
    clearTimeout: () => {},
    console: { error() {}, warn() {}, log() {}, info() {}, debug() {} },
    Math: Object.assign(Object.create(Math), { random: seededRandom(42) })
  };
  vm.createContext(sandbox);
  installFormattingGlobals(sandbox);
  vm.runInContext(
    bundleEsmGraph('src/domain/domain-model.js', { globalName: '__domain_exports' }),
    sandbox,
    { filename: 'src/domain/domain-model.js.bundle.js' }
  );
  vm.runInContext(
    bundleEsmGraph('src/domain/initial-state.js', { globalName: '__initial_state_exports' }),
    sandbox,
    { filename: 'src/domain/initial-state.js.bundle.js' }
  );
  vm.runInContext(
    bundleEsmGraph('src/domain/course-settings.js', { globalName: '__course_settings_exports' }),
    sandbox,
    { filename: 'src/domain/course-settings.js.bundle.js' }
  );
  vm.runInContext(
    bundleEsmGraph('src/domain/terms.js', { globalName: '__terms_exports' }),
    sandbox,
    { filename: 'src/domain/terms.js.bundle.js' }
  );
  const artifact = fs.readFileSync(artifactPath, 'utf8');
  const helperSource = [
    '_bufToBase64', '_base64ToBuf', '_deriveKey', '_encryptJsonWithKey', '_decryptWithKey'
  ].map(name => extractArtifactFunction(artifact, name)).join('\n\n');
  const storageFactorySource = extractArtifactStorageFactory(artifact);
  const storageConstructionSource = extractArtifactStorageConstruction(artifact);
  const source = `const createInitialState = globalThis.__initial_state_exports.createInitialState;
const DomainModel = globalThis.__domain_exports.createDomainModel({
  now: () => new Date(),
  termServices: {
    getSettingsForCourse: globalThis.__course_settings_exports.getSettingsForCourse,
    resolveAssessmentTermFromDateValue: globalThis.__terms_exports.resolveAssessmentTermFromDateValue
  }
});
${helperSource}
${extractArtifactFunction(artifact, 'createSessionCoordinator')}
const sessionCoordinator = createSessionCoordinator({ lockManager, resourceName: 'notenverwaltung-v1-editor', onLost: () => Storage.lockSession() });
${storageFactorySource}
${storageConstructionSource}
globalThis.__bundledStorage = { Storage, DomainModel, sessionCoordinator };`;
  vm.runInContext(source, sandbox, { filename: 'Notenverwaltung.html.storage.js' });
  await sandbox.__bundledStorage.sessionCoordinator.acquire();
  return { ...sandbox.__bundledStorage, storage, sandbox, lockManager };
}

test('Wave 4.4 artifact constructs Storage exactly once after promptPassword and DomainModel, before UiShell', () => {
  const artifact = fs.readFileSync(artifactPath, 'utf8');
  const promptPasswordIndex = artifact.indexOf('window.promptPassword = function');
  const domainModelIndex = artifact.indexOf('var DomainModel = createDomainModel');
  const storageConstruction = 'var Storage = createStorage({ DomainModel, createInitialState, sessionCoordinator });';
  const storageIndex = artifact.indexOf(storageConstruction);
  const uiShellIndex = artifact.indexOf('var UiShell = (function()');
  assert.ok(promptPasswordIndex < domainModelIndex);
  assert.ok(domainModelIndex < storageIndex);
  assert.equal(artifact.split(storageConstruction).length - 1, 1);
  assert.ok(storageIndex < uiShellIndex);
});

function seededValidState(DomainModel) {
  const state = DomainModel.createEmptyState();
  const student = DomainModel.createStudent({ lastName: 'Beispiel', firstName: 'Ada' });
  const course = DomainModel.createCourse({ name: 'Kryptografie', subject: 'Informatik', classLabel: 'Q1' });
  DomainModel.addStudentToState(state, student);
  DomainModel.addCourseToState(state, course);
  DomainModel.enrollStudentInCourse(state, course.id, student.id);
  return state;
}

test('Wave 4.2 bundled Storage uses the actual artifact helpers through setup, save and password rotation', async () => {
  const storage = localStorageStub();
  const bundled = await loadFreshBundledStorage({ storage, password: PASSWORD });
  const state = seededValidState(bundled.DomainModel);
  await bundled.Storage.enableEncryption(PASSWORD, state);
  const updatedState = JSON.parse(JSON.stringify(state));
  updatedState.courses[0].name = 'Kryptografie aktualisiert';
  await bundled.Storage.saveState(updatedState);
  await bundled.Storage.changePassword(PASSWORD, NEW_PASSWORD);

  await bundled.Storage.lockSession();
  const reopened = await loadFreshBundledStorage({ storage, password: NEW_PASSWORD, lockManager: bundled.lockManager });
  const expectedNormalizedState = bundled.DomainModel.ensureStateShape(updatedState);
  assert.deepEqual(
    JSON.parse(JSON.stringify(await reopened.Storage.loadState())),
    JSON.parse(JSON.stringify(expectedNormalizedState))
  );
  assert.equal(storage.getItem('notenverwaltung_v1_state'), null);
});

test('generated application keeps a saved course encrypted and authenticates it on reload', async () => {
  const storage = localStorageStub();
  const writer = await loadFreshBundledStorage({ storage, password: PASSWORD });
  const state = seededValidState(writer.DomainModel);
  await writer.Storage.enableEncryption(PASSWORD, state);

  const payload = storage.getItem('notenverwaltung_v1_state_enc');
  assert.ok(payload);
  assert.equal(storage.getItem('notenverwaltung_v1_state'), null);
  assert.equal(payload.includes('Kryptografie'), false);

  await writer.Storage.lockSession();
  const wrongPassword = await loadFreshBundledStorage({ storage, password: 'Synthetic-Wrong-Password', lockManager: writer.lockManager });
  const rejectedState = await wrongPassword.Storage.loadState();
  assert.equal(rejectedState.courses.some(course => course.name === 'Kryptografie'), false);

  await wrongPassword.Storage.lockSession();
  const reader = await loadFreshBundledStorage({ storage, password: PASSWORD, lockManager: writer.lockManager });
  const restored = await reader.Storage.loadState();
  assert.equal(restored.courses[0].name, 'Kryptografie');
  assert.equal(restored.students[0].firstName, 'Ada');
});

test('Wave 4.3 bundled Storage decrypts portable, legacy and structured backups through artifact helpers', async () => {
  const storage = localStorageStub();
  const bundled = await loadFreshBundledStorage({ storage, password: PASSWORD });
  const state = seededValidState(bundled.DomainModel);
  const json = JSON.stringify(state);

  const raw = await bundled.Storage._encryptJsonWithSalt(json, PASSWORD);
  assert.equal(await bundled.Storage._decryptPayload(raw, PASSWORD), json);

  const [saltB64, ivB64, cipherB64] = raw.split(':');
  storage.setItem('notenverwaltung_v1_salt', saltB64);
  assert.equal(
    await bundled.Storage._decryptPayload(`${ivB64}:${cipherB64}`, PASSWORD),
    json
  );

  storage.removeItem('notenverwaltung_v1_salt');
  await assert.rejects(
    () => bundled.Storage._decryptPayload(`${ivB64}:${cipherB64}`, PASSWORD),
    /fehlender Salt/
  );

  const structured = await bundled.Storage.exportStateEncrypted(PASSWORD, state);
  assert.deepEqual(
    JSON.parse(JSON.stringify(await bundled.Storage.importStateEncryptedFromText(structured, PASSWORD))),
    JSON.parse(JSON.stringify(state))
  );
});
