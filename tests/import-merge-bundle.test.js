'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { readSourceLines, extractFunction } = require('./harness/extract.js');
const { buildCourseState, addAssessment, setScore } = require('./harness/fixtures.js');

const htmlPath = path.join(__dirname, '..', 'Notenverwaltung.html');

function extractAsyncFunction(lines, name) {
  const opener = new RegExp(`^(\\s*)async function ${name}\\s*\\(`);
  const start = lines.findIndex(line => opener.test(line));
  if (start < 0) throw new Error(`Funktionsanfang nicht gefunden: ${name}`);
  const closer = lines[start].match(opener)[1] + '}';
  const end = lines.indexOf(closer, start + 1);
  if (end < 0) throw new Error(`Funktionsende nicht gefunden: ${name}`);
  return lines.slice(start, end + 1).join('\n');
}

function artifactLinesWithMergeSentinel() {
  const lines = readSourceLines(htmlPath);
  const line = lines.findIndex(item => /^    function mergeImportedStateIntoCurrent\d*\(base, incoming\) \{/.test(item));
  assert.ok(line >= 0, 'das gebaute Artefakt muss die gemeinsame Merge-Funktion enthalten');
  lines.splice(line + 1, 0, '      throw new Error("artifact-merge-used");');
  return lines;
}

function artifactLinesWithBrokenMergeBinding() {
  const lines = readSourceLines(htmlPath);
  const line = lines.findIndex(item => item === '  var { mergeImportedStateIntoCurrent } = createImportMerge({');
  assert.ok(line >= 0, 'das gebaute Artefakt muss die echte Merge-Bindung enthalten');
  lines.splice(line, 5,
    '  var { mergeImportedStateIntoCurrent } = {',
    '    mergeImportedStateIntoCurrent: () => { throw new Error("broken-html-binding"); }',
    '  };'
  );
  return lines;
}

function artifactLinesWithBrokenMergeDependency(dependency) {
  const lines = readSourceLines(htmlPath);
  const marker = new RegExp(`^    ${dependency}: DomainModel\\.${dependency},?$`);
  const line = lines.findIndex(item => marker.test(item));
  assert.ok(line >= 0, `das gebaute Artefakt muss ${dependency} in die Merge-Fabrik einbinden`);
  lines[line] = `    ${dependency}: () => { throw new Error("broken-${dependency}"); },`;
  return lines;
}

function createElementStub() {
  return {
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild() {},
    removeChild() {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    focus() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    firstChild: null,
    textContent: '',
    innerHTML: ''
  };
}

function extractApplicationScript(lines) {
  const starts = lines.map((line, index) => line === '  <script>' ? index : -1).filter(index => index >= 0);
  assert.equal(starts.length, 2, 'das Artefakt muss genau zwei Skripte enthalten');
  const start = starts[1];
  const end = lines.indexOf('  </script>', start + 1);
  assert.ok(end > start, 'das Anwendungsskript im Artefakt muss enden');
  return lines.slice(start + 1, end).join('\n');
}

function createArtifactSandbox() {
  const root = createElementStub();
  const document = {
    addEventListener() {},
    removeEventListener() {},
    createElement: createElementStub,
    getElementById() { return root; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    body: root,
    documentElement: root,
    title: ''
  };
  const localStorage = {
    getItem() { return null; },
    setItem() {},
    removeItem() {},
    clear() {}
  };
  const window = new EventTarget();
  Object.assign(window, {
    document,
    localStorage,
    location: { search: '', href: 'file:///Notenverwaltung.html' },
    prompt: () => null,
    confirm: () => false,
    alert() {},
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {}
  });
  document.defaultView = window;
  const sandbox = {
    window,
    document,
    localStorage,
    crypto,
    TextEncoder,
    TextDecoder,
    btoa,
    atob,
    Event,
    EventTarget,
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    setInterval: window.setInterval,
    clearInterval: window.clearInterval,
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} }
  };
  vm.createContext(sandbox);
  return sandbox;
}

function loadArtifactMergeBindings(htmlLines) {
  const script = extractApplicationScript(htmlLines);
  const finalClosure = script.lastIndexOf('\n})();');
  assert.ok(finalClosure >= 0, 'das Anwendungsskript muss mit seiner IIFE enden');
  const capture = `\n  globalThis.__artifactImportMergeBindings = {\n    DomainModel,\n    Storage,\n    createStateCommitter,\n    mergeImportedStateIntoCurrent,\n    validateImportedState,\n    validateRawTermResults,\n    validateRawUpperSecContexts\n  };`;
  const sandbox = createArtifactSandbox();
  vm.runInContext(
    script.slice(0, finalClosure) + capture + script.slice(finalClosure),
    sandbox,
    { filename: 'Notenverwaltung.html.artifact.js' }
  );
  assert.ok(sandbox.__artifactImportMergeBindings, 'das Artefakt muss die echte Merge-Bindung erzeugen');
  return { sandbox, bindings: sandbox.__artifactImportMergeBindings };
}

function loadArtifactMergeCommit({ htmlLines = readSourceLines(htmlPath), initialState, confirmed = [true], saveState } = {}) {
  const { sandbox, bindings } = loadArtifactMergeBindings(htmlLines);
  const { DomainModel, Storage } = bindings;
  const saves = [];
  const alerts = [];
  const confirms = [...confirmed];
  Storage.saveState = async candidate => {
    saves.push(JSON.parse(JSON.stringify(candidate)));
    if (saveState) return saveState(candidate);
  };
  sandbox.window.confirm = () => confirms.shift() ?? false;
  sandbox.window.alert = message => alerts.push(String(message));
  sandbox.__initialImportState = initialState || DomainModel.createEmptyState();
  const source = [
    '(function ({ DomainModel, Storage, createStateCommitter, mergeImportedStateIntoCurrent, validateImportedState, validateRawTermResults, validateRawUpperSecContexts }) {',
    '  const mergeCheckbox = { checked: true };',
    '  let state = globalThis.__initialImportState;',
    '  let uiStateEpoch = 0;',
    '  let currentCourseId = null;',
    '  let settingsPeriodDrafts = null;',
    '  const pendingUiPersistencePromises = new Set();',
    '  const persistenceBoundary = { invalidate() {} };',
    '  function observeForCapture() {}',
    '  function render() { globalThis.__renderCalls = (globalThis.__renderCalls || 0) + 1; }',
    extractFunction(htmlLines, 'createSerializedTransactionQueue'),
    '  const enqueueStatePersistenceTransaction = createSerializedTransactionQueue();',
    '  const stateCommitter = createStateCommitter({',
    '    readState: () => state,',
    '    persistState: candidate => Storage.saveState(candidate),',
    '    publishState: candidate => { state = candidate; },',
    '    enqueue: enqueueStatePersistenceTransaction,',
    '    readEpoch: () => uiStateEpoch',
    '  });',
    extractFunction(htmlLines, 'invalidateUiStateEpoch'),
    extractFunction(htmlLines, 'commitStateChange'),
    extractFunction(htmlLines, 'overwriteStateObject'),
    extractAsyncFunction(htmlLines, 'commitImportedState'),
    '  globalThis.__artifactMerge = mergeImportedStateIntoCurrent;',
    '  globalThis.__commitImportedMergeState = commitImportedState;',
    '  globalThis.__getImportedMergeState = () => state;',
    '})(globalThis.__artifactImportMergeBindings);'
  ].join('\n\n');
  vm.runInContext(source, sandbox, { filename: 'commit-imported-merge-state-from-artifact.js' });
  return {
    DomainModel,
    saves,
    alerts,
    merge: sandbox.__artifactMerge,
    validateState: bindings.validateImportedState,
    commit: sandbox.__commitImportedMergeState,
    state: sandbox.__getImportedMergeState,
    sandbox
  };
}

test('artifact merge factory keeps local scores, preserves inputs, and repeats without new entities', () => {
  const factory = loadArtifactMergeCommit();
  const modules = { DomainModel: factory.DomainModel };
  const local = buildCourseState(modules, { studentCount: 1 });
  const assessment = addAssessment(modules, local, { categoryId: local.categoryIds.oral, title: 'Gemeinsame Leistung' });
  setScore(modules, assessment, local.students[0].id, '4');
  const incoming = JSON.parse(JSON.stringify(local.state));
  incoming.assessments[0].scores[local.students[0].id].valueRaw = '12';
  const beforeBase = JSON.stringify(local.state);
  const beforeIncoming = JSON.stringify(incoming);
  const merge = factory.merge;

  const first = merge(local.state, incoming);

  assert.equal(first.summary.scoreConflicts, 1);
  assert.equal(first.state.assessments[0].scores[local.students[0].id].valueRaw, '4');
  assert.equal(JSON.stringify(local.state), beforeBase);
  assert.equal(JSON.stringify(incoming), beforeIncoming);
  const second = merge(first.state, incoming);
  assert.equal(second.summary.studentsAdded, 0);
  assert.equal(second.summary.coursesAdded, 0);
  assert.equal(second.summary.assessmentsAdded, 0);
});

test('artifact consumer fails when the HTML merge binding is broken', () => {
  const importer = loadArtifactMergeCommit({
    htmlLines: artifactLinesWithBrokenMergeBinding()
  });
  const local = importer.DomainModel.createEmptyState();

  assert.throws(() => importer.merge(local, importer.DomainModel.createEmptyState()), /broken-html-binding/);
});

test('artifact consumer invokes the reachable HTML-configured merge dependencies', () => {
  for (const dependency of ['ensureStateShape', 'createEmptyState']) {
    const importer = loadArtifactMergeCommit({ htmlLines: artifactLinesWithBrokenMergeDependency(dependency) });
    const DomainModel = importer.DomainModel;
    const base = DomainModel.createEmptyState();
    const incoming = DomainModel.createEmptyState();
    if (dependency === 'createEmptyState') {
      assert.throws(() => importer.merge(null, incoming), new RegExp(`broken-${dependency}`));
      continue;
    }
    assert.throws(() => importer.merge(base, incoming), new RegExp(`broken-${dependency}`));
  }
});

test('artifact D2 merge never regenerates valid core IDs through the legacy generateId dependency', () => {
  const importer = loadArtifactMergeCommit({ htmlLines: artifactLinesWithBrokenMergeDependency('generateId') });
  const { DomainModel } = importer;
  const base = DomainModel.createEmptyState();
  const incoming = DomainModel.createEmptyState();
  const categoryId = incoming.settings.categories[0].id;

  for (const suffix of ['one', 'two']) {
    const student = DomainModel.createStudent({
      id: `student_${suffix}`,
      lastName: 'Gleichname',
      firstName: 'Mia',
      birthDate: null
    });
    const course = DomainModel.createCourse({
      id: `course_${suffix}`,
      name: 'Gleicher Kurs',
      subject: 'Biologie',
      classLabel: 'T1'
    });
    const assessment = DomainModel.createAssessment({
      id: `assessment_${suffix}`,
      courseId: course.id,
      categoryId,
      title: 'Gleiche Leistung',
      date: '2026-03-12'
    });
    DomainModel.addStudentToState(incoming, student);
    DomainModel.addCourseToState(incoming, course);
    DomainModel.enrollStudentInCourse(incoming, course.id, student.id);
    setScore({ DomainModel }, assessment, student.id, suffix === 'one' ? '1' : '5');
    DomainModel.addAssessmentToState(incoming, assessment);
  }
  importer.validateState(base);
  importer.validateState(incoming);

  const first = importer.merge(base, incoming);
  const second = importer.merge(first.state, incoming);

  assert.deepEqual(Array.from(first.state.students, item => item.id).sort(), ['student_one', 'student_two']);
  assert.deepEqual(Array.from(first.state.courses, item => item.id).sort(), ['course_one', 'course_two']);
  assert.deepEqual(Array.from(first.state.assessments, item => item.id).sort(), ['assessment_one', 'assessment_two']);
  assert.equal(first.state.assessments.find(item => item.id === 'assessment_one').scores.student_one.valueRaw, '1');
  assert.equal(first.state.assessments.find(item => item.id === 'assessment_two').scores.student_two.valueRaw, '5');
  assert.equal(second.summary.studentsAdded, 0);
  assert.equal(second.summary.coursesAdded, 0);
  assert.equal(second.summary.assessmentsAdded, 0);

  const renamedBase = DomainModel.createEmptyState();
  const renamedIncoming = DomainModel.createEmptyState();
  DomainModel.addStudentToState(renamedBase, DomainModel.createStudent({
    id: 'student_shared', lastName: 'Lokal', firstName: 'Person', birthDate: '2010-01-01'
  }));
  DomainModel.addStudentToState(renamedIncoming, DomainModel.createStudent({
    id: 'student_shared', lastName: 'Importiert', firstName: 'Person', birthDate: '2010-01-01'
  }));
  importer.validateState(renamedBase);
  importer.validateState(renamedIncoming);
  const renamed = importer.merge(renamedBase, renamedIncoming);
  assert.equal(renamed.state.students.length, 1);
  assert.equal(renamed.state.students[0].id, 'student_shared');
  assert.equal(renamed.state.students[0].lastName, 'Lokal');
});

test('artifact merge-mode commit uses the transformed HTML merger before persistence or visible changes', async () => {
  const importer = loadArtifactMergeCommit({
    htmlLines: artifactLinesWithMergeSentinel()
  });
  const originalState = importer.state();

  await assert.rejects(() => importer.commit(importer.DomainModel.createEmptyState(), 'Test', true), /artifact-merge-used/);
  assert.equal(importer.saves.length, 0);
  assert.strictEqual(importer.state(), originalState);
  assert.equal(importer.sandbox.__renderCalls || 0, 0);
  assert.deepEqual(importer.alerts, []);
});

test('artifact merge-mode commit stops on declined confirmation without state changes', async () => {
  const importer = loadArtifactMergeCommit({ confirmed: [false] });
  const originalState = importer.state();

  assert.equal(await importer.commit(importer.DomainModel.createEmptyState(), 'Test', true), false);
  assert.equal(importer.saves.length, 0);
  assert.strictEqual(importer.state(), originalState);
  assert.equal(importer.sandbox.__renderCalls || 0, 0);
  assert.deepEqual(importer.alerts, []);
});

test('artifact merge-mode commit rejects saving without replacing live state', async () => {
  const importer = loadArtifactMergeCommit({
    saveState: async () => { throw new Error('storage rejected'); }
  });
  const originalState = importer.state();

  await assert.rejects(() => importer.commit(importer.DomainModel.createEmptyState(), 'Test', true), /storage rejected/);
  assert.strictEqual(importer.state(), originalState);
  assert.equal(importer.sandbox.__renderCalls || 0, 0);
  assert.deepEqual(importer.alerts, []);
});

test('artifact merge-mode commit saves the merged candidate before replacing live state', async () => {
  const importer = loadArtifactMergeCommit();
  const modules = { DomainModel: importer.DomainModel };
  const local = buildCourseState(modules, { studentCount: 1 });
  const assessment = addAssessment(modules, local, { categoryId: local.categoryIds.oral, title: 'Lokale Leistung' });
  setScore(modules, assessment, local.students[0].id, '4');
  const incoming = JSON.parse(JSON.stringify(local.state));
  incoming.assessments[0].scores[local.students[0].id].valueRaw = '12';
  const addedStudent = modules.DomainModel.createStudent({ lastName: 'Hinzugefügt', firstName: 'Import', birthDate: '2010-02-02', homeClass: 'T1' });
  modules.DomainModel.addStudentToState(incoming, addedStudent);
  const addedCourse = modules.DomainModel.createCourse({ name: 'Importierter Kurs', subject: 'Testfach', classLabel: 'T1' });
  modules.DomainModel.addCourseToState(incoming, addedCourse);
  modules.DomainModel.enrollStudentInCourse(incoming, addedCourse.id, addedStudent.id);
  Object.assign(importer.state(), local.state);
  const originalState = importer.state();
  let stateAtSave;
  importer.sandbox.__artifactImportMergeBindings.Storage.saveState = async candidate => {
    importer.saves.push(JSON.parse(JSON.stringify(candidate)));
    stateAtSave = importer.state();
  };

  assert.equal(await importer.commit(incoming, 'Test', true), true);
  assert.strictEqual(stateAtSave, originalState);
  assert.equal(importer.saves.length, 1);
  assert.equal(importer.saves[0].students.some(student => student.lastName === 'Hinzugefügt'), true);
  assert.equal(importer.saves[0].courses.some(course => course.name === 'Importierter Kurs'), true);
  assert.equal(importer.saves[0].assessments[0].scores[local.students[0].id].valueRaw, '4');
  assert.equal(importer.state().students.some(student => student.lastName === 'Hinzugefügt'), true);
  assert.equal(importer.state().assessments[0].scores[local.students[0].id].valueRaw, '4');
});
