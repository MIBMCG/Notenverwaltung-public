'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { loadModules, localStorageStub } = require('./harness/load');
const { loadDashboardUi, loadGeneratedDashboardUi, findByText, findByAttribute } = require('./harness/dashboard-app');
const { createLockManagerStub, deferred } = require('./harness/shared-session');
const { createReleaseFixtures } = require('./fixtures/release-readiness');
const { loadEsmGraph } = require('./harness/load-esm-graph');

const plain = value => JSON.parse(JSON.stringify(value));
const PAYLOAD_KEY = 'notenverwaltung_v1_state_enc';
const SMALL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMwTpv5HwAENAIyWy0K4AAAAABJRU5ErkJggg==';

function cryptoGate(method) {
  const entered = deferred(), release = deferred();
  let armed = false;
  const subtle = new Proxy(crypto.subtle, { get(target, name) {
    const value = target[name];
    return typeof value !== 'function' ? value : async (...args) => {
      if (armed && name === method) { entered.resolve(); await release.promise; }
      return value.apply(target, args);
    };
  } });
  return { cryptoImpl: { subtle, getRandomValues: crypto.getRandomValues.bind(crypto) }, entered, release,
    arm() { armed = true; } };
}

async function builtArtifact() {
  const { buildArtifact } = await import(pathToFileURL(path.join(__dirname, '..', 'scripts', 'build.mjs')).href);
  return buildArtifact();
}

function installFileReader(app) {
  let complete = Promise.resolve();
  app.sandbox.FileReader = class {
    readAsText(file, encoding) {
      assert.equal(encoding, 'utf-8');
      complete = Promise.resolve().then(() => this.onload({ target: { result: file.text } }));
    }
  };
  return async (text, merge = false) => {
    const input = findByAttribute(app.root, 'id', 'json-import-file');
    findByAttribute(app.root, 'id', 'json-import-merge-checkbox').checked = merge;
    input.files = [{ name: 'synthetic.enc.json', text }];
    input.value = 'synthetic.enc.json';
    await input.dispatch('change');
    await complete;
  };
}

async function transferView(app) {
  const nav = app.root._find(item => item.classList?.contains('nav-main'));
  await findByText(nav, 'Import / Export').dispatch('click');
}

function scoreOf(state, studentId, index = 1) {
  return state.assessments[index].scores[studentId]?.valueRaw;
}

function exportedCsvFields(text, studentId, courseId) {
  const { exports: csv } = loadEsmGraph('src/transfer/csv-format.js');
  const rows = csv.parseSemicolonCsv(text.replace(/^\uFEFF/u, ''));
  const row = rows.slice(1).find(item => item.fields[4] === studentId && item.fields[0] === courseId);
  assert.ok(row, `CSV row missing for ${studentId} in ${courseId}: ${JSON.stringify(rows.map(item => item.fields.slice(0, 6)))}`);
  return Array.from(csv.decodeCsvTransferFields(row.fields, 14));
}

test('built HTML first start carries UI-created data through sparse grades, immediate backup, lock, new login, restore and export', async () => {
  const storage = localStorageStub();
  const artifact = await builtArtifact(), lockManager = createLockManagerStub();
  const app = await loadGeneratedDashboardUi({
    artifact, storage, lockManager, encrypted: false
  });
  await app.start();
  const setupAlerts = [];
  app.sandbox.window.alert = value => setupAlerts.push(String(value));
  assert.deepEqual(storage._keys(), []);
  const setup = app.root._find(item => item.tagName === 'BUTTON' && item.textContent === 'Verschlüsselung jetzt einrichten');
  assert.ok(setup);
  assert.equal(setup.tagName, 'BUTTON');
  assert.equal(setup._listeners('click').length, 1);
  assert.equal(app.sessionCoordinator.getStatus(), 'held');
  await setup.dispatch('click');
  assert.equal(storage.getItem('notenverwaltung_v1_encrypted'), '1', JSON.stringify(setupAlerts));

  await findByText(app.root._find(item => item.classList?.contains('nav-main')), 'Kurse').dispatch('click');
  await app.root._find(item => item.tagName === 'BUTTON' && item.textContent === 'Kurs anlegen').dispatch('click');
  const dialog = app.document.body._find(item => item.className === 'new-course-dialog');
  assert.ok(dialog);
  const textInputs = dialog._findAll(item => item.tagName === 'INPUT' && item.type === 'text');
  textInputs.find(item => item.placeholder === 'z. B. 10c Biologie').value = 'Synthetischer Startkurs';
  textInputs.find(item => item.placeholder === 'z. B. Biologie').value = 'Biologie';
  textInputs.find(item => item.placeholder === 'z. B. 10c').value = '10a';
  dialog._find(item => item.tagName === 'SELECT' && item.children.some(option => option.value === 'grades')).value = 'grades';
  await dialog._find(item => item.tagName === 'BUTTON' && item.textContent === 'Anlegen').dispatch('click');
  let confirmed = plain(await app.Storage.loadCurrentSessionState());
  assert.equal(confirmed.courses.length, 2, JSON.stringify(setupAlerts));
  assert.ok(confirmed.courses.some(course => course.name === 'Synthetischer Startkurs'));

  await findByText(app.root._find(item => item.classList?.contains('nav-main')), 'Stammdaten').dispatch('click');
  await app.root._find(item => item.tagName === 'BUTTON' && item.textContent === 'Schüler anlegen').dispatch('click');
  findByAttribute(app.root, 'id', 'students-create-last-name').value = 'Testperson Start';
  findByAttribute(app.root, 'id', 'students-create-first-name').value = 'Vorname Start';
  await findByAttribute(app.root, 'id', 'students-create-form')
    ._find(item => item.className === 'students-create-submit').dispatch('click');
  confirmed = plain(await app.Storage.loadCurrentSessionState());
  assert.equal(confirmed.students.length, 3);
  const startPerson = confirmed.students.find(student => student.lastName === 'Testperson Start');
  const startCourse = confirmed.courses.find(course => course.name === 'Synthetischer Startkurs');
  assert.ok(startPerson && startCourse);

  await findByText(app.root._find(item => item.classList?.contains('nav-main')), 'Kurse').dispatch('click');
  const courseCard = findByAttribute(app.root, 'data-course-id', startCourse.id);
  await findByAttribute(courseCard, 'data-role', 'edit').dispatch('click');
  const editor = app.root._find(item => item.tagName === 'DETAILS' && item.classList.contains('courses-editor'));
  await findByAttribute(editor, 'data-course-editor-tab', 'students').dispatch('click');
  findByAttribute(editor, 'id', 'course-editor-existing-student').value = startPerson.id;
  await findByText(editor, 'aus Stammdaten hinzufügen').dispatch('click');
  confirmed = plain(await app.Storage.loadCurrentSessionState());
  assert.ok(confirmed.courses.find(course => course.id === startCourse.id).enrollments.some(item => item.studentId === startPerson.id));
  const untouchedPerson = confirmed.students.find(student => student.id !== startPerson.id);
  const refreshedEditor = app.root._find(item => item.tagName === 'DETAILS' && item.classList.contains('courses-editor'));
  await findByAttribute(refreshedEditor, 'data-course-editor-tab', 'students').dispatch('click');
  findByAttribute(refreshedEditor, 'id', 'course-editor-existing-student').value = untouchedPerson.id;
  await findByText(refreshedEditor, 'aus Stammdaten hinzufügen').dispatch('click');

  await findByAttribute(app.root, 'data-course-id', startCourse.id).querySelectorAll('button')
    .find(button => button.textContent.trim() === 'Noten öffnen').dispatch('click');
  await app.root._find(item => item.tagName === 'BUTTON' && item.textContent === 'Neue Leistung anlegen').dispatch('click');
  const category = findByAttribute(app.root, 'id', 'gradesheet-new-category');
  category.value = confirmed.settings.categories[0].id;
  await category.dispatch('change');
  findByAttribute(app.root, 'id', 'gradesheet-new-title').value = 'Synthetische Startleistung';
  const date = findByAttribute(app.root, 'id', 'gradesheet-new-date');
  date.value = '2026-10-05';
  await date.dispatch('change');
  await findByAttribute(app.root, 'id', 'gradesheet-new-assessment')._find(item => item.tagName === 'BUTTON' && item.textContent === 'Leistung hinzufügen').dispatch('click');
  confirmed = plain(await app.Storage.loadCurrentSessionState());
  const assessment = confirmed.assessments.find(item => item.title === 'Synthetische Startleistung' && item.courseId === startCourse.id);
  assert.ok(assessment);
  const gradeInput = () => app.root.querySelectorAll('tr').find(item => item.dataset.student === startPerson.id &&
    item.querySelectorAll('.gradesheet-input').length > 0)?.querySelectorAll('.gradesheet-input')[0];
  assert.ok(gradeInput());
  gradeInput().value = '2';
  await gradeInput().dispatch('change');
  assert.equal(plain(await app.Storage.loadCurrentSessionState()).assessments.find(item => item.id === assessment.id).scores[startPerson.id].valueRaw, '2');

  gradeInput().value = '5';
  const saving = gradeInput().dispatch('change');
  const backupButton = app.root._find(item => item.className === 'header-action header-action-primary');
  const backingUp = backupButton.dispatch('click');
  await Promise.all([saving, backingUp]);
  assert.equal(app.downloads.length, 1, JSON.stringify(setupAlerts));
  const backupText = await app.downloads[0].blob.text();
  const backupState = plain(JSON.parse(await app.Storage._decryptPayload(backupText, 'Synthetisches-Testpasswort-2026')));
  const backedAssessment = backupState.assessments.find(item => item.id === assessment.id);
  assert.equal(backedAssessment.scores[startPerson.id].valueRaw, '5');
  assert.equal(backedAssessment.scores[untouchedPerson.id], undefined);

  await app.root._find(item => item.className === 'header-action header-lock').dispatch('click');
  assert.equal(app.sessionCoordinator.getStatus(), 'idle');
  const fresh = await loadGeneratedDashboardUi({ artifact, storage, lockManager, useExistingStorage: true });
  await fresh.start();
  const freshState = plain(await fresh.Storage.loadCurrentSessionState());
  assert.equal(freshState.assessments.find(item => item.id === assessment.id).scores[startPerson.id].valueRaw, '5');
  await findByAttribute(fresh.root, 'data-course-id', startCourse.id).querySelectorAll('button')
    .find(button => button.textContent.trim() === 'Noten öffnen').dispatch('click');
  const freshGrade = fresh.root.querySelectorAll('tr').find(item => item.dataset.student === startPerson.id &&
    item.querySelectorAll('.gradesheet-input').length > 0).querySelectorAll('.gradesheet-input')[0];
  freshGrade.value = '3';
  await freshGrade.dispatch('change');
  assert.equal(plain(await fresh.Storage.loadCurrentSessionState()).assessments.find(item => item.id === assessment.id).scores[startPerson.id].valueRaw, '3');
  await transferView(fresh);
  fresh.sandbox.window.promptPassword = async () => 'Synthetisches-Testpasswort-2026';
  fresh.sandbox.window.confirm = () => true;
  await installFileReader(fresh)(backupText);
  const restored = plain(await fresh.Storage.loadCurrentSessionState());
  const restoredAssessment = restored.assessments.find(item => item.id === assessment.id);
  assert.equal(restoredAssessment.scores[startPerson.id].valueRaw, '5');
  assert.equal(restoredAssessment.scores[untouchedPerson.id], undefined);
  findByAttribute(fresh.root, 'id', 'transfer-course-select').value = startCourse.id;
  await findByText(fresh.root, 'CSV für Import exportieren').dispatch('click');
  const csv = await fresh.downloads.find(item => item.filename?.endsWith('.csv')).blob.text();
  assert.deepEqual(exportedCsvFields(csv, startPerson.id, startCourse.importKey || startCourse.id).slice(0, 13), [
    startCourse.importKey || startCourse.id, startCourse.name, startCourse.subject, startCourse.classLabel,
    startPerson.id, startPerson.lastName, startPerson.firstName, '', 'Sek I', '', '', '', ''
  ]);

  assert.equal(storage.getItem('notenverwaltung_v1_state'), null);
});
test('built HTML keeps a sparse confirmed edit across immediate backup, manual lock, new session, restore and CSV export', async () => {
  const { DomainModel } = loadModules();
  const { normal } = createReleaseFixtures(DomainModel);
  const artifact = await builtArtifact();
  const storage = localStorageStub();
  const locks = createLockManagerStub();
  const a = await loadGeneratedDashboardUi({ artifact, state: normal.state, storage, lockManager: locks });
  const downloadsA = a.downloads;
  const alertsA = [];
  a.sandbox.window.alert = value => alertsA.push(String(value));

  await a.start();

  const card = findByAttribute(a.root, 'data-course-id', normal.courses.sekI.id);
  await card.querySelectorAll('button').find(button => button.textContent.trim() === 'Noten öffnen').dispatch('click');
  const row = a.root.querySelectorAll('tr').find(item => item.dataset.student === normal.students.sekI[0].id &&
    item.querySelectorAll('.gradesheet-input').length > 0);
  assert.ok(row);
  const grade = row.querySelectorAll('.gradesheet-input').find(input => input.value === '2');
  assert.ok(grade);
  grade.value = '5';
  const pending = grade.dispatch('change');
  const backup = a.root._find(item => item.className === 'header-action header-action-primary');
  const backingUp = backup.dispatch('click');
  await Promise.all([pending, backingUp]);
  assert.equal(downloadsA.length, 1, JSON.stringify(alertsA));
  const backupState = plain(JSON.parse(await a.Storage._decryptPayload((await downloadsA[0].blob.text()), 'Synthetisches-Testpasswort-2026')));
  assert.equal(scoreOf(backupState, normal.students.sekI[0].id), '5', JSON.stringify(backupState.assessments.map(item => [item.id, item.scores[normal.students.sekI[0].id]?.valueRaw])));
  assert.equal(backupState.assessments[1].scores[normal.students.sekI[2].id], undefined,
    'untouched sparse cell must remain absent');
  const lock = a.root._find(item => item.className === 'header-action header-lock');
  await lock.dispatch('click');
  assert.equal(a.sessionCoordinator.getStatus(), 'idle');

  const b = await loadGeneratedDashboardUi({ artifact, storage, lockManager: locks, useExistingStorage: true });
  const downloadsB = b.downloads;

  await b.start();
  assert.equal(scoreOf(plain(await b.Storage.loadCurrentSessionState()), normal.students.sekI[0].id), '5');
  const changed = plain(await b.Storage.loadCurrentSessionState());
  changed.assessments[1].scores[normal.students.sekI[0].id].valueRaw = '2';
  await b.Storage.saveState(changed);
  await transferView(b);
  b.sandbox.window.promptPassword = async () => 'Synthetisches-Testpasswort-2026';
  b.sandbox.window.confirm = () => true;
  const submit = installFileReader(b);
  await submit((await downloadsA[0].blob.text()));
  assert.equal(scoreOf(plain(await b.Storage.loadCurrentSessionState()), normal.students.sekI[0].id), '5');

  findByAttribute(b.root, 'id', 'transfer-course-select').value = '__all__';
  const exportButton = findByText(b.root, 'CSV für Import exportieren');
  await exportButton.dispatch('click');
  const csv = await downloadsB.find(item => item.filename && item.filename.endsWith('.csv')).blob.text();
  const sekICourse = normal.courses.sekI;
  const sekIPerson = normal.students.sekI[0];
  assert.deepEqual(exportedCsvFields(csv, sekIPerson.id, sekICourse.importKey || sekICourse.id).slice(0, 12), [
    sekICourse.importKey || sekICourse.id, sekICourse.name, sekICourse.subject, sekICourse.classLabel,
    sekIPerson.id, sekIPerson.lastName, sekIPerson.firstName, '', 'Sek I', '', '', ''
  ]);
  const q4Course = normal.courses.q4;
  const q4Person = normal.students.q4[2];
  const q4Fields = exportedCsvFields(csv, q4Person.id, q4Course.importKey || q4Course.id);
  assert.deepEqual(q4Fields.slice(0, 7), [q4Course.importKey || q4Course.id, q4Course.name,
    q4Course.subject, q4Course.classLabel, q4Person.id, q4Person.lastName, q4Person.firstName]);
  assert.deepEqual(q4Fields.slice(8, 13), ['Sek II', 'GK', 'Q3/Q4', 'Ja', 'Q4']);
  assert.equal(storage.getItem('notenverwaltung_v1_state'), null);
});

test('rendered Replace and repeatable Merge preserve archive, Q4, fixed zero, profile and local half-year settings with separate passwords', async () => {
  const { DomainModel } = loadModules();
  const { normal } = createReleaseFixtures(DomainModel);
  const source = plain(normal.state);
  source.settings.schoolProfile = { name: 'Synthetische Quellschule', logoMode: 'custom', logoDataUrl: SMALL_PNG };
  source.settings.halfYearNames.seckI.h1 = 'Quellhalbjahr';
  const local = DomainModel.createEmptyState();
  local.settings.halfYearSettings.seckI.h1EndMonth = 4;
  local.settings.halfYearNames.seckI.h1 = 'Lokal H1';
  DomainModel.addCourseToState(local, DomainModel.createCourse({
    id: 'local-only-course', name: 'Lokaler Kurs', subject: 'Testfach', classLabel: 'L'
  }));
  const app = await loadDashboardUi({ state: local });
  app.sandbox.mergeImportedStateIntoCurrent = app.sandbox.__module_exports.ImportMerge.mergeImportedStateIntoCurrent;
  await app.UiShell.init('app');
  await transferView(app);
  const submit = installFileReader(app);
  const sourcePassword = 'Synthetisches-Quellpasswort-2026';
  const text = await app.Storage.exportStateEncrypted(sourcePassword, source);
  app.sandbox.window.promptPassword = async () => sourcePassword;
  app.sandbox.window.confirm = () => true;
  const alerts = [];
  app.sandbox.window.alert = value => alerts.push(String(value));
  await submit(text);
  let restored = plain(await app.Storage.loadCurrentSessionState());
  assert.equal(restored.courses.length, 3);
  assert.equal(restored.courses.find(course => course.id === 'release-normal-archive').archiveNote, 'Synthetischer Archivvermerk');
  assert.equal(restored.assessments.find(item => item.id === 'release-assessment-archive-manual-h1').termAssignment, 'manual');
  assert.equal(restored.courses.find(course => course.id === 'release-normal-q4').termResults[0].points, 0);
  assert.equal(restored.courses.find(course => course.id === 'release-normal-q4').enrollments.find(item =>
    item.studentId === 'release-normal-person-26').writtenExamSubjectQ4, true);
  assert.deepEqual(restored.settings.schoolProfile, source.settings.schoolProfile);
  assert.equal(restored.settings.halfYearSettings.seckI.h1EndMonth, 4);
  assert.equal(restored.settings.halfYearNames.seckI.h1, 'Lokal H1');
  assert.equal(restored.courses.some(course => course.id === 'local-only-course'), false);
  assert.equal(alerts.at(-1), 'Import erfolgreich und verschlüsselt gespeichert.');

  const extra = DomainModel.createCourse({
    id: 'merge-only-course', name: 'Nur im Merge', subject: 'Testfach', classLabel: 'M'
  });
  const mergedSource = plain(source);
  mergedSource.courses.push(extra);
  const mergeText = await app.Storage.exportStateEncrypted(sourcePassword, mergedSource);
  await submit(mergeText, true);
  const once = plain(await app.Storage.loadCurrentSessionState());
  await submit(mergeText, true);
  const twice = plain(await app.Storage.loadCurrentSessionState());
  assert.deepEqual(twice, once, 'repeat Merge must not duplicate students, courses, archives or grades');
  assert.equal(twice.courses.filter(course => course.id === extra.id).length, 1);
  assert.equal(twice.settings.halfYearNames.seckI.h1, 'Lokal H1');
});

test('both Replace confirmations and the Merge preview cancel without changing encrypted target bytes', async () => {
  const { DomainModel } = loadModules();
  const { normal } = createReleaseFixtures(DomainModel);
  const app = await loadDashboardUi({ state: normal.state });
  app.sandbox.mergeImportedStateIntoCurrent = app.sandbox.__module_exports.ImportMerge.mergeImportedStateIntoCurrent;
  await app.UiShell.init('app');
  await transferView(app);
  const submit = installFileReader(app);
  const source = plain(normal.state);
  source.courses.push(DomainModel.createCourse({
    id: 'cancel-source-course', name: 'Nicht übernehmen', subject: 'Testfach', classLabel: 'N'
  }));
  const sourcePassword = 'Synthetisches-Quellpasswort-2026';
  const text = await app.Storage.exportStateEncrypted(sourcePassword, source);
  app.sandbox.window.promptPassword = async () => sourcePassword;
  const beforeBytes = app.storage.getItem(PAYLOAD_KEY);
  const beforeState = plain(await app.Storage.loadCurrentSessionState());
  const alerts = [];
  app.sandbox.window.alert = value => alerts.push(String(value));
  for (const [mergeMode, answers, expectedPrompts] of [
    [false, [false], 1],
    [false, [true, false], 2],
    [true, [false], 1]
  ]) {
    const asked = [];
    app.sandbox.window.confirm = message => {
      asked.push(String(message));
      return answers.shift();
    };
    await submit(text, mergeMode);
    assert.equal(asked.length, expectedPrompts);
    assert.equal(app.storage.getItem(PAYLOAD_KEY), beforeBytes);
    assert.deepEqual(plain(await app.Storage.loadCurrentSessionState()), beforeState);
  }
  assert.deepEqual(alerts, []);
});
test('source and generated HTML load representative 1.3, 1.4 and 1.5 forms without losing archive or manual terms', async () => {
  const { DomainModel } = loadModules();
  const { normal } = createReleaseFixtures(DomainModel);
  const artifact = await builtArtifact();
  const cases = [
    ['1.3', state => {
      delete state.settings.schoolProfile;
      delete state.courses.find(course => course.id === 'release-normal-q4').upperSecContext;
      for (const item of state.assessments.filter(item => item.courseId === 'release-normal-seki')) {
        delete item.termAssignment;
      }
    }],
    ['1.4', state => {
      delete state.settings.schoolProfile;
      delete state.courses.find(course => course.id === 'release-normal-seki').symbolId;
    }],
    ['1.5', state => {
      delete state.lastGradesheetCourseId;
    }]
  ];
  for (const [version, makeOlder] of cases) {
    const historical = plain(normal.state);
    makeOlder(historical);
    for (const kind of ['source', 'generated']) {
      const app = kind === 'generated'
        ? await loadGeneratedDashboardUi({ artifact, state: historical })
        : await loadDashboardUi({ state: historical });
      if (kind === 'generated') await app.start();
      else await app.UiShell.init('app');
      const loaded = plain(await app.Storage.loadCurrentSessionState());
      const label = `${version} ${kind}`;
      const archive = loaded.courses.find(course => course.id === 'release-normal-archive');
      assert.ok(archive.archiveSnapshot?.gradeMapping, label);
      assert.equal(archive.archiveNote, 'Synthetischer Archivvermerk', label);
      assert.equal(loaded.assessments.find(item => item.id === 'release-assessment-archive-manual-h1').term, '2025-H1', label);
      assert.equal(loaded.assessments.find(item => item.id === 'release-assessment-archive-manual-h1').termAssignment, 'manual', label);
      assert.equal(loaded.assessments[0].scores['release-normal-person-1'].valueRaw, '4', label);
      const portable = await app.Storage.exportStateEncrypted('Synthetisches-Altbackup-' + version, historical);
      const fromBackup = DomainModel.ensureStateShape(
        await app.Storage.importStateEncryptedFromText(portable, 'Synthetisches-Altbackup-' + version)
      );
      assert.equal(fromBackup.courses.find(course => course.id === 'release-normal-archive').archiveNote,
        'Synthetischer Archivvermerk', label);
      assert.equal(fromBackup.assessments.find(item => item.id === 'release-assessment-archive-manual-h1').term,
        '2025-H1', label);
    }
  }
});
test('a closed old tab cannot protect against a later foreign old-version write, and the new session stops without overwriting it', async () => {
  const { DomainModel } = loadModules();
  const state = DomainModel.createEmptyState();
  DomainModel.addCourseToState(state, DomainModel.createCourse({
    id: 'fixed-path-course', name: 'Vor dem Update', subject: 'Testfach', classLabel: 'U'
  }));
  const storage = localStorageStub();
  const locks = createLockManagerStub();
  const old = await loadDashboardUi({ state, storage, lockManager: locks });
  await old.UiShell.init('app');
  await old.Storage.lockSession();
  const newer = await loadGeneratedDashboardUi({ artifact: await builtArtifact(), storage, lockManager: locks,
    useExistingStorage: true });
  await newer.start();
  assert.equal((await newer.Storage.loadCurrentSessionState()).courses[0].name, 'Vor dem Update');
  storage.setItem(PAYLOAD_KEY, 'foreign-old-version-synthetic-write');
  const foreign = storage.getItem(PAYLOAD_KEY);
  await assert.rejects(newer.Storage.saveState(plain(state)), { code: 'STORAGE_EXTERNAL_CHANGE' });
  assert.equal(storage.getItem(PAYLOAD_KEY), foreign);
  assert.equal(newer.Storage.hasSessionPassword(), false);
});

test('password rotation holds A ownership through B acquisition attempt, then B opens only with the new password', async () => {
  const { DomainModel } = loadModules();
  const state = DomainModel.createEmptyState();
  DomainModel.addCourseToState(state, DomainModel.createCourse({
    id: 'rotation-course', name: 'Bestätigter Kurs', subject: 'Testfach', classLabel: 'U'
  }));
  const storage = localStorageStub(), lockManager = createLockManagerStub();
  const gate = cryptoGate('encrypt');
  const a = await loadDashboardUi({ state, storage, lockManager, cryptoImpl: gate.cryptoImpl });
  await a.UiShell.init('app');
  gate.arm();
  const rotation = a.Storage.changePassword(a.password, 'Synthetisches-Neues-Passwort');
  await gate.entered.promise;
  let prompts = 0;
  const b = await loadGeneratedDashboardUi({ artifact: await builtArtifact(), storage, lockManager,
    useExistingStorage: true, promptPassword: async () => { prompts++; return 'Synthetisches-Neues-Passwort'; } });
  await b.start();
  assert.equal(prompts, 0);
  assert.ok(findByText(b.root, 'Erneut versuchen'));
  gate.release.resolve();
  assert.equal(await rotation, true);
  await a.Storage.lockSession();
  await findByText(b.root, 'Erneut versuchen').dispatch('click');
  assert.equal(prompts, 1);
  assert.equal((await b.Storage.loadCurrentSessionState()).courses[0].name, 'Bestätigter Kurs');
  assert.equal(b.Storage.hasSessionPassword(), true);
  await b.Storage.lockSession();
});
