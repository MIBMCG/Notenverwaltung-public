'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { readSourceLines, extractFunction } = require('./harness/extract.js');
const { loadModules } = require('./harness/load.js');
const { buildCourseState } = require('./harness/fixtures.js');

const htmlPath = path.join(__dirname, '..', 'Notenverwaltung.html');
const validatorNames = ['validateImportedState', 'validateRawTermResults', 'validateRawUpperSecContexts'];

function extractAsyncFunction(lines, name) {
  const opener = new RegExp(`^(\\s*)async function ${name}\\s*\\(`);
  const start = lines.findIndex(line => opener.test(line));
  if (start < 0) throw new Error(`Funktionsanfang nicht gefunden: ${name}`);
  const closer = lines[start].match(opener)[1] + '}';
  const end = lines.indexOf(closer, start + 1);
  if (end < 0) throw new Error(`Funktionsende nicht gefunden: ${name}`);
  return lines.slice(start, end + 1).join('\n');
}

function extractArtifactConstants(lines) {
  return ['SCHEMA_MODES', 'UPPERSEC_COURSE_TYPES', 'QUALIFICATION_YEARS'].map(name => {
    const marker = `  var ${name} = {`;
    const start = lines.indexOf(marker);
    const end = lines.indexOf('  };', start + 1);
    assert.ok(start >= 0 && end > start, `Artefaktkonstante nicht gefunden: ${name}`);
    return lines.slice(start, end + 1).join('\n');
  }).join('\n');
}

function artifactLinesWithProvenanceValidator() {
  const lines = readSourceLines(htmlPath);
  const line = lines.findIndex(item => /^  function validateImportedState\(candidate\) \{/.test(item));
  assert.ok(line >= 0, 'das gebaute Artefakt muss den gemeinsamen Validator enthalten');
  lines.splice(line + 1, 0,
    '    if (candidate && candidate.__artifactProvenance) throw new Error("artifact-validator-used");'
  );
  return lines;
}

function loadArtifactCommit({ htmlLines = readSourceLines(htmlPath), initialState, confirmed = [true, true], replaceState } = {}) {
  const modules = loadModules();
  const validations = [
    extractArtifactConstants(htmlLines),
    validatorNames.map(name => extractFunction(htmlLines, name)).join('\n\n')
  ].join('\n\n');
  vm.runInContext(validations, modules.sandbox, { filename: 'import-validation-from-artifact.js' });
  const saves = [];
  const alerts = [];
  const confirms = [...confirmed];
  let persistedState = JSON.parse(JSON.stringify(initialState || modules.DomainModel.createEmptyState()));
  modules.Storage.loadCurrentSessionState = async () => JSON.parse(JSON.stringify(persistedState));
  modules.Storage.replaceState = async candidate => {
    saves.push(JSON.parse(JSON.stringify(candidate)));
    if (replaceState) await replaceState(candidate);
    persistedState = JSON.parse(JSON.stringify(candidate));
    return candidate;
  };
  modules.Storage.hasSessionPassword = () => true;
  modules.sandbox.window.confirm = () => confirms.shift() ?? false;
  modules.sandbox.window.alert = message => alerts.push(String(message));
  modules.sandbox.__initialImportState = initialState || modules.DomainModel.createEmptyState();
  const source = [
    '(function () {',
    '  const Storage = globalThis.__module_exports.Storage;',
    '  const DomainModel = globalThis.__module_exports.DomainModel;',
    '  const mergeCheckbox = { checked: false };',
    '  let state = globalThis.__initialImportState;',
    '  let uiStateEpoch = 0;',
    '  let currentCourseId = null;',
    '  let settingsPeriodDrafts = null;',
    '  const persistenceBoundary = { invalidate() {} };',
    '  function mergeImportedStateIntoCurrent() { throw new Error("merge must not run in replace tests"); }',
    '  function render() { globalThis.__renderCalls = (globalThis.__renderCalls || 0) + 1; }',
    extractFunction(htmlLines, 'createSerializedTransactionQueue'),
    '  const enqueueStatePersistenceTransaction = createSerializedTransactionQueue();',
    extractFunction(htmlLines, 'invalidateUiStateEpoch'),
    extractFunction(htmlLines, 'createStateCommitAbortedError'),
    extractFunction(htmlLines, 'runExclusiveStateOperation'),
    extractAsyncFunction(htmlLines, 'reconcileExclusiveState'),
    extractAsyncFunction(htmlLines, 'commitImportedState'),
    '  globalThis.__commitImportedState = commitImportedState;',
    '  globalThis.__getImportedState = () => state;',
    '})();'
  ].join('\n\n');
  vm.runInContext(source, modules.sandbox, { filename: 'commit-imported-state-from-artifact.js' });
  return {
    modules,
    saves,
    alerts,
    commit: modules.sandbox.__commitImportedState,
    state: modules.sandbox.__getImportedState
  };
}

test('artifact JSON commit rejects invalid raw data before confirmation, saving, or visible state changes', async () => {
  const modules = loadModules();
  const local = modules.DomainModel.createEmptyState();
  const before = JSON.stringify(local);
  const invalid = buildCourseState(modules, { schemaMode: modules.DomainModel.SCHEMA_MODES.UPPERSEC }).state;
  invalid.courses[0].termResults = [{ studentId: invalid.students[0].id, term: 'Q4', points: 11 }];
  const importer = loadArtifactCommit({ initialState: local });

  await assert.rejects(() => importer.commit(invalid, 'JSON-Datei'), /ungueltige Festsetzung/);
  assert.equal(importer.saves.length, 0);
  assert.equal(JSON.stringify(importer.state()), before);
  assert.equal(importer.alerts.length, 0);
});

test('artifact JSON commit stops at either confirmation without saving or changing state', async () => {
  const modules = loadModules();
  for (const confirmed of [[false], [true, false]]) {
    const local = modules.DomainModel.createEmptyState();
    const before = JSON.stringify(local);
    const importer = loadArtifactCommit({ initialState: local, confirmed });

    assert.equal(await importer.commit(modules.DomainModel.createEmptyState(), 'JSON-Datei'), false);
    assert.equal(importer.saves.length, 0);
    assert.equal(JSON.stringify(importer.state()), before);
  }
});

test('artifact JSON commit preserves local half-year settings and saves only after both replace confirmations', async () => {
  const modules = loadModules();
  const local = modules.DomainModel.createEmptyState();
  local.settings.halfYearNames = { seckI: { h1: 'Lokal H1', h2: 'Lokal H2' }, seckII: { h1: 'Lokal Q1', h2: 'Lokal Q2' } };
  local.settings.halfYearSettings = { seckI: { schoolYearStartYear: 2031 }, seckII: { schoolYearStartYear: 2032 } };
  const incoming = modules.DomainModel.createEmptyState();
  incoming.settings.halfYearNames = { seckI: { h1: 'Fremd H1', h2: 'Fremd H2' }, seckII: { h1: 'Fremd Q1', h2: 'Fremd Q2' } };
  incoming.settings.halfYearSettings = { seckI: { schoolYearStartYear: 2041 }, seckII: { schoolYearStartYear: 2042 } };
  const importer = loadArtifactCommit({ initialState: local, confirmed: [true, true] });

  assert.equal(await importer.commit(incoming, 'JSON-Datei'), true);
  assert.equal(importer.saves.length, 1);
  assert.deepEqual(importer.saves[0].settings.halfYearNames, local.settings.halfYearNames);
  assert.deepEqual(importer.saves[0].settings.halfYearSettings, local.settings.halfYearSettings);
  assert.deepEqual(JSON.parse(JSON.stringify(importer.state())).settings.halfYearNames, local.settings.halfYearNames);
  assert.deepEqual(JSON.parse(JSON.stringify(importer.state())).settings.halfYearSettings, local.settings.halfYearSettings);
  assert.equal(importer.alerts[0], 'Import erfolgreich und verschlüsselt gespeichert.');
});

test('artifact JSON commit keeps the live state unchanged when encrypted saving rejects', async () => {
  const modules = loadModules();
  const local = modules.DomainModel.createEmptyState();
  const before = JSON.stringify(local);
  const importer = loadArtifactCommit({
    initialState: local,
    replaceState: async () => { throw new Error('Speichern fehlgeschlagen'); }
  });

  await assert.rejects(() => importer.commit(modules.DomainModel.createEmptyState(), 'JSON-Datei'), /Speichern fehlgeschlagen/);
  assert.equal(JSON.stringify(importer.state()), before);
  assert.equal(importer.modules.sandbox.__renderCalls, 1, 'die exklusive Wiederherstellung veröffentlicht den bestätigten Bestand erneut');
  assert.equal(importer.alerts.length, 0);
});

test('artifact JSON commit uses the validator embedded in the HTML artifact', async () => {
  const modules = loadModules();
  const local = modules.DomainModel.createEmptyState();
  const importer = loadArtifactCommit({
    htmlLines: artifactLinesWithProvenanceValidator(),
    initialState: local
  });
  const candidate = modules.DomainModel.createEmptyState();
  candidate.__artifactProvenance = true;

  await assert.rejects(() => importer.commit(candidate, 'JSON-Datei'), /artifact-validator-used/);
  assert.equal(importer.saves.length, 0, 'kein Fallback auf den Quellvalidator darf speichern');
  assert.equal(importer.state(), local);
});

test('application imports the shared validators while the generated HTML retains one executable copy of each', () => {
  const source = readSourceLines().join('\n');
  assert.match(source, /import \{ validateImportedState, validateRawTermResults, validateRawUpperSecContexts \} from '\.\.\/transfer\/import-validation\.js';/);
  for (const name of validatorNames) {
    assert.equal((source.match(new RegExp(`function ${name}\\s*\\(`, 'g')) || []).length, 0, name);
    assert.equal(readSourceLines(htmlPath).filter(line => new RegExp(`function ${name}\\s*\\(`).test(line)).length, 1, name);
  }
});
