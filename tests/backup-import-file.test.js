'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDashboardUi, findByText, findByAttribute } = require('./harness/dashboard-app');

function createState(DomainModel, prefix) {
  const state = DomainModel.createEmptyState();
  const student = DomainModel.createStudent({
    id: `${prefix}-student`, lastName: `${prefix}person`, firstName: 'Synthetisch', homeClass: `${prefix}1`
  });
  const course = DomainModel.createCourse({
    id: `${prefix}-course`, name: `${prefix}kurs`, subject: 'Testfach', classLabel: `${prefix}1`
  });
  DomainModel.addStudentToState(state, student);
  DomainModel.addCourseToState(state, course);
  DomainModel.enrollStudentInCourse(state, course.id, student.id);
  return state;
}

async function createImportHarness(prepareState = () => {}, protection = 'V1') {
  const seed = await loadDashboardUi();
  const initialState = createState(seed.DomainModel, 'Lokal');
  prepareState(initialState, seed.DomainModel);
  const app = await loadDashboardUi({ state: initialState });
  if (protection === 'V2') {
    const draft = await app.Storage.prepareRecoveryEnrollment({ password: app.password });
    await app.Storage.confirmPreparedProtection(draft.token, draft.recoveryCode);
    await app.Storage.commitPreparedProtection(draft.token);
  }
  app.sandbox.mergeImportedStateIntoCurrent =
    app.sandbox.__module_exports.ImportMerge.mergeImportedStateIntoCurrent;
  await app.UiShell.init('app');
  const nav = app.root._find(element => element.classList && element.classList.contains('nav-main'));
  await findByText(nav, 'Import / Export').dispatch('click');
  const input = findByAttribute(app.root, 'id', 'json-import-file');
  const merge = findByAttribute(app.root, 'id', 'json-import-merge-checkbox');
  const alerts = [];
  const confirmations = [];
  let readComplete = Promise.resolve();

  app.sandbox.window.alert = message => alerts.push(String(message));
  app.sandbox.FileReader = class {
    readAsText(file, encoding) {
      assert.equal(encoding, 'utf-8');
      readComplete = Promise.resolve().then(async () => {
        if (file.error) {
          this.error = file.error;
          if (this.onerror) await this.onerror({ target: this });
          if (file.fireLoadAfterError && this.onload) {
            await this.onload({ target: { result: file.text } });
          }
          return;
        }
        await this.onload({ target: { result: file.text } });
      });
    }
  };

  return {
    app,
    input,
    merge,
    alerts,
    confirmations,
    initialSnapshot: JSON.stringify(await app.Storage.loadState()),
    setDialogs({ passwords = [], confirms = [] } = {}) {
      const passwordQueue = [...passwords];
      const confirmQueue = [...confirms];
      app.sandbox.window.promptPassword = async () => passwordQueue.shift() ?? null;
      app.sandbox.window.confirm = message => {
        confirmations.push(String(message));
        return confirmQueue.shift() ?? false;
      };
    },
    async importFile(file) {
      input.files = [file];
      input.value = file.name;
      await input.dispatch('change');
      await readComplete;
    },
    loadedState() { return app.Storage.loadState(); }
  };
}

test('structured backup file replaces the persisted state only after both confirmations', async () => {
  const harness = await createImportHarness();
  const incoming = createState(harness.app.DomainModel, 'Import');
  const text = await harness.app.Storage.exportStateEncrypted(harness.app.password, incoming);
  harness.setDialogs({ passwords: [harness.app.password], confirms: [true, true] });

  await harness.importFile({ name: 'structured.enc.json', text });

  const loaded = await harness.loadedState();
  assert.deepEqual(Array.from(loaded.students, student => student.id), ['Import-student']);
  assert.deepEqual(Array.from(loaded.courses, course => course.id), ['Import-course']);
  assert.equal(harness.confirmations.length, 2);
  assert.deepEqual(harness.alerts, ['Import erfolgreich und verschlüsselt gespeichert.']);
  assert.equal(harness.input.value, '');
});

for (const protection of ['V1', 'V2']) {
  test(`C1: ${protection} file restores global and course-specific Q4 category IDs after reopening`, async () => {
    const source = await loadDashboardUi();
    const data = createState(source.DomainModel, 'Q4');
    const [oral, written, other] = data.settings.categories;
    data.settings.categoryRoles = { upperSecWrittenCategoryId: other.id };
    const course = data.courses[0];
    course.schemaMode = 'uppersec';
    course.upperSecContext = { courseType: 'basic', qualificationYear: 'q3-q4' };
    course.categoryRoles = { upperSecWrittenCategoryId: written.id };
    for (const [category, points] of [[oral, '8'], [written, '15']]) {
      category.name = 'Umbenannt ' + points;
      const assessment = source.DomainModel.createAssessment({ courseId: course.id, categoryId: category.id, term: '2025-H2' });
      assessment.scores[data.students[0].id] = source.DomainModel.createScoreEntry({ valueRaw: points });
      data.assessments.push(assessment);
    }
    let text;
    if (protection === 'V2') {
      const prepared = await source.Storage.prepareRecoveryEnrollment({ password: source.password });
      await source.Storage.confirmPreparedProtection(prepared.token, prepared.recoveryCode);
      await source.Storage.commitPreparedProtection(prepared.token);
      text = await source.Storage.encryptForBackup(JSON.stringify(data));
    } else {
      text = await source.Storage.exportStateEncrypted(source.password, data);
    }
    const target = await createImportHarness();
    target.setDialogs({ passwords: [source.password], confirms: [true, true] });
    await target.importFile({ name: 'q4.enc.json', text });
    assert.equal(target.confirmations.length, 2, target.alerts.join('\n'));
    await target.app.Storage.lockSession();
    const reopened = await loadDashboardUi({ storage: target.app.storage, lockManager: target.app.lockManager, useExistingStorage: true });
    await reopened.UiShell.init('app');
    const restored = await reopened.Storage.loadState();
    assert.equal(restored.settings.categoryRoles.upperSecWrittenCategoryId, other.id);
    assert.equal(restored.courses[0].categoryRoles.upperSecWrittenCategoryId, written.id);
    assert.equal(reopened.sandbox.__module_exports.GradingLogic.computeWeightedOverallForAssessments(restored.assessments,
      restored.courses[0], restored.students[0].id, restored.settings, '2025-H2'), 8);
  });
}

const savedPeriods = {
  seckI: {
    schoolYearStartYear: 2030, schoolYearStartMonth: 8, schoolYearStartDay: 26,
    h1EndYear: 2031, h1EndMonth: 1, h1EndDay: 23,
    h2StartYear: 2031, h2StartMonth: 2, h2StartDay: 2
  },
  seckII: {
    schoolYearStartYear: 2030, schoolYearStartMonth: 9, schoolYearStartDay: 2,
    h1EndYear: 2031, h1EndMonth: 2, h1EndDay: 13,
    h2StartYear: 2031, h2StartMonth: 2, h2StartDay: 17
  }
};
const savedPeriodNames = {
  seckI: { h1: 'Erstes Halbjahr', h2: 'Zweites Halbjahr' },
  seckII: { h1: 'Semester A', h2: 'Semester B' }
};
const plain = value => JSON.parse(JSON.stringify(value));

test('replacement by a default backup restores the standard 15-minute timeout', async () => {
  const h = await createImportHarness(state => { state.settings.sessionTimeoutMinutes = 1; });
  const incoming = createState(h.app.DomainModel, 'Import');
  const text = await h.app.Storage.exportStateEncrypted(h.app.password, incoming);
  assert.equal(h.app.Storage.getSessionTimeoutMinutes(), 1);
  h.setDialogs({ passwords: [h.app.password], confirms: [true, true] });
  await h.importFile({ name: 'default.enc.json', text });
  assert.equal(h.app.Storage.getSessionTimeoutMinutes(), 15);
});

test('a file merge saves a dated automatic assessment in the target period before and after unlock', async () => {
  const h = await createImportHarness(state => {
    state.courses[0].termCutoffs = { h2StartMonth: 2, h2StartDay: 1 };
  });
  const incoming = JSON.parse(h.initialSnapshot);
  incoming.courses[0].termCutoffs.h2StartDay = 15;
  incoming.assessments.push(h.app.DomainModel.createAssessment({
    id: 'dated', title: 'Test', courseId: incoming.courses[0].id,
    categoryId: incoming.settings.categories[0].id, date: '2027-02-08',
    term: '2026-H1', termAssignment: 'auto'
  }));
  h.merge.checked = true;
  const text = await h.app.Storage.exportStateEncrypted(h.app.password, incoming);
  h.setDialogs({ passwords: [h.app.password], confirms: [true] });
  await h.importFile({ name: 'dated.enc.json', text });
  assert.equal((await h.loadedState()).assessments[0].term, '2026-H2', h.alerts.join(' '));
  await h.app.Storage.lockSession();
  const reopened = await loadDashboardUi({ storage: h.app.storage, lockManager: h.app.lockManager, useExistingStorage: true });
  await reopened.UiShell.init('app');
  assert.equal((await reopened.Storage.loadState()).assessments[0].term, '2026-H2');
});

test('merge, cancellation and failed replacement preserve the local inactivity timeout', async () => {
  for (const mode of ['merge', 'cancel', 'failed']) {
    const h = await createImportHarness(state => { state.settings.sessionTimeoutMinutes = 15; });
    const source = createState(h.app.DomainModel, 'Import');
    source.settings.sessionTimeoutMinutes = 1;
    const text = await h.app.Storage.exportStateEncrypted(h.app.password, source);
    h.merge.checked = mode === 'merge';
    h.setDialogs({ passwords: [h.app.password], confirms: [true, mode !== 'cancel'] });
    if (mode === 'failed') h.app.Storage.replaceState = async () => { throw new Error('Testfehler'); };
    await h.importFile({ name: 'timeout.enc.json', text });
    assert.equal(h.app.Storage.getSessionTimeoutMinutes(), 15, mode);
    assert.equal((await h.loadedState()).settings.sessionTimeoutMinutes, 15, mode);
  }
});

for (const protection of ['V1', 'V2']) {
  test(`old ${protection} single archive imports without its predecessor and links a local predecessor only on merge`, async () => {
    const source = await loadDashboardUi();
    if (protection === 'V2') {
      const enrollment = await source.Storage.prepareRecoveryEnrollment({ password: source.password });
      await source.Storage.confirmPreparedProtection(enrollment.token, enrollment.recoveryCode);
      await source.Storage.commitPreparedProtection(enrollment.token);
    }
    const incoming = createState(source.DomainModel, 'Archiv');
    source.DomainModel.archiveCourse(incoming, 'Archiv-course', 'manual', {});
    for (const predecessor of ['Lokal-course', 'missing-course']) {
      incoming.courses[0].carriedForwardFromCourseId = predecessor;
      const text = await source.Storage.encryptForBackup(JSON.stringify(incoming));
      for (const merge of [true, false]) {
        const h = await createImportHarness();
        h.merge.checked = merge;
        const renamed = merge && predecessor === 'missing-course';
        if (renamed) findByAttribute(h.app.root, 'id', 'json-import-single-archive').checked = true;
        h.setDialogs({ passwords: [source.password], confirms: [true, true] });
        await h.importFile({ name: renamed ? 'mein-kurs.json' : 'notenverwaltung_archiv_2026-11-20T14-15-16.enc.json', text });
        const course = (await h.loadedState()).courses.find(course => course.id === 'Archiv-course');
        assert.ok(course, h.alerts.join(' '));
        assert.equal(course.carriedForwardFromCourseId, merge && predecessor === 'Lokal-course' ? predecessor : null);
      }
      const strict = await createImportHarness();
      strict.setDialogs({ passwords: [source.password], confirms: [true, true] });
      await strict.importFile({ name: 'notenverwaltung_backup_2026-11-20T14-15-16.enc.json', text });
      assert.equal(strict.confirmations.length, 0);
      assert.equal(JSON.stringify(await strict.loadedState()), strict.initialSnapshot);
    }
  });
}

function weightingFixture(D) {
  const state = createState(D, 'Bewertung');
  for (const category of state.settings.categories) category.subcategories = [];
  const student = state.students[0];
  const cat = state.settings.categories[0];
  cat.subcategories = [{ id: 's-oral', name: 'Beitrag', weightPercent: 100 }];
  state.settings.weightTemplates.push(D.createWeightTemplate({ id: 'w-custom', name: 'Eigen', items: [{ categoryId: cat.id, weightPercent: 100 }] }));
  const archive = D.createCourse({ id: 'old-course', name: 'Altkurs', schemaMode: 'uppersec' });
  state.courses.push(archive);
  D.enrollStudentInCourse(state, archive.id, student.id);
  for (const course of state.courses) {
    course.schemaMode = 'uppersec';
    course.weightTemplateId = 'w-custom';
    D.setTermResult(state, course.id, student.id, '2025-H1', 0);
    const a = D.createAssessment({ id: 'score-' + course.id, courseId: course.id, categoryId: cat.id, subcategoryId: 's-oral', term: '2025-H1' });
    a.scores[student.id] = D.createScoreEntry({ valueRaw: '7', valueNumeric: 7 });
    state.assessments.push(a);
  }
  D.archiveCourse(state, archive.id);
  return state;
}

for (const format of ['raw', 'structured']) {
  test(`A4: ${format} V1 offers narrow repairs and rejects a mixed broken file`, async () => {
    const target = await createImportHarness();
    const D = target.app.DomainModel;
    const incoming = weightingFixture(D);
    incoming.settings.weightTemplates = incoming.settings.weightTemplates.filter(t => t.id !== 'w-custom');
    incoming.settings.categories[0].subcategories = [];
    const snapshot = plain(incoming.courses[1].archiveSnapshot);
    const encrypt = () => format === 'raw' ? target.app.Storage.encryptForBackup(JSON.stringify(incoming))
      : target.app.Storage.exportStateEncrypted(target.app.password, incoming);
    const file = { name: 'alt.enc.json', text: await encrypt() };
    target.setDialogs({ passwords: [target.app.password], confirms: [false] });
    await target.importFile(file);
    assert.equal(JSON.stringify(await target.loadedState()), target.initialSnapshot);
    assert.match(target.confirmations[0] || '', /1.*Gleichverteilung/);
    assert.match(target.confirmations[0], /1.*Hauptkategorie/);
    for (let attempt = 0; attempt < 2; attempt++) {
      target.setDialogs({ passwords: [target.app.password], confirms: [true, true] });
      await target.importFile(file);
      const repaired = await target.loadedState();
      assert.equal(repaired.courses[0].weightTemplateId, null);
      assert.equal(repaired.assessments[0].subcategoryId, null);
      assert.equal(repaired.assessments[0].scores[incoming.students[0].id].valueNumeric, 7);
      assert.equal(repaired.courses[0].termResults[0].points, 0);
      assert.deepEqual(plain(repaired.courses[1].archiveSnapshot), snapshot);
      assert.equal(repaired.assessments[1].subcategoryId, 's-oral');
    }
    for (const corrupt of [
      a => { a.scores['lost-person'] = a.scores[incoming.students[0].id]; },
      a => { a.courseId = 'lost-course'; }, a => { a.categoryId = 'lost-category'; },
      a => { a.categoryId = null; a.subcategoryId = null; }
    ]) {
      const original = plain(incoming.assessments[0]);
      corrupt(incoming.assessments[0]);
      const before = target.app.storage.getItem('notenverwaltung_v1_state_enc');
      target.setDialogs({ passwords: [target.app.password], confirms: [true, true] });
      await target.importFile({ name: file.name, text: await encrypt() });
      assert.match(target.alerts.at(-1), /fehlgeschlagen/);
      assert.equal(target.app.storage.getItem('notenverwaltung_v1_state_enc'), before);
      incoming.assessments[0] = original;
    }
  });
}

for (const protection of ['V1', 'V2']) {
  test(`A4: ${protection} setting deletions and restored archive survive encrypted export, import and reopening`, async () => {
    const seed = await loadDashboardUi();
    const incoming = weightingFixture(seed.DomainModel);
    const app = await loadDashboardUi({state: incoming});
    if (protection === 'V2') {
      const draft = await app.Storage.prepareRecoveryEnrollment({ password: app.password });
      await app.Storage.confirmPreparedProtection(draft.token, draft.recoveryCode);
      await app.Storage.commitPreparedProtection(draft.token);
    }
    const downloads = [];
    app.sandbox.downloadBlobFile = text => downloads.push(text);
    await app.UiShell.init('app');
    const button = (root, label) => root.querySelectorAll('button').find(b => b.textContent.trim() === label);
    await button(app.root, 'Einstellungen').dispatch('click');
    const templateDelete = () => button(app.root.querySelectorAll('input').find(i => i.value === 'Eigen').parentNode, 'Vorlage löschen');
    const openSub = findByAttribute(app.root, 'aria-label', 'Unterkategorien von ' + incoming.settings.categories[0].name + ' bearbeiten');
    await openSub.dispatch('click');
    const subDialog = findByText(app.document.body, 'Unterkategorien für: ' + incoming.settings.categories[0].name).parentNode;
    for (const [action, expected] of [[() => button(subDialog, 'Löschen'), /Hauptkategorie/], [templateDelete, /Gleichverteilung/]]) {
      const before = app.storage.getItem('notenverwaltung_v1_state_enc');
      let prompt = '';
      app.sandbox.window.confirm = message => { prompt = message; return false; };
      await action().dispatch('click');
      assert.match(prompt, expected);
      assert.equal(app.storage.getItem('notenverwaltung_v1_state_enc'), before);
      app.sandbox.window.confirm = () => true;
      const save = app.Storage.saveState;
      app.Storage.saveState = async () => { throw new Error('synthetischer Speicherfehler'); };
      await action().dispatch('click');
      assert.equal(app.storage.getItem('notenverwaltung_v1_state_enc'), before);
      app.Storage.saveState = save;
      await action().dispatch('click');
    }
    const exportAndReopen = async () => {
      await app.root._find(e => e.className === 'header-action header-action-primary').dispatch('click');
      const target = await createImportHarness(s => { s.students = []; s.courses = []; }, protection);
      target.setDialogs({ passwords: [app.password], confirms: [true, true] });
      await target.importFile({ name: 'neu.enc.json', text: downloads.at(-1) });
      assert.match(target.alerts.at(-1), /erfolgreich/);
      await target.app.Storage.lockSession();
      const reopened = await loadDashboardUi({storage: target.app.storage, useExistingStorage: true});
      return reopened.Storage.loadState();
    };
    const deleted = await exportAndReopen();
    assert.equal(deleted.courses[0].weightTemplateId, null);
    assert.equal(deleted.assessments[0].subcategoryId, null);
    assert.equal(deleted.assessments[0].categoryId, incoming.settings.categories[0].id);
    assert.equal(deleted.assessments[0].scores[incoming.students[0].id].valueNumeric, 7);
    assert.equal(deleted.assessments[1].subcategoryId, 's-oral');
    assert.deepEqual(plain(deleted.courses[1].archiveSnapshot), plain(incoming.courses[1].archiveSnapshot));
    await button(app.root, 'Kurse').dispatch('click');
    await button(app.root, 'Wiederherstellen').dispatch('click');
    const restored = await exportAndReopen();
    assert.equal(restored.courses[1].archivedAt, null);
    assert.equal(restored.courses[1].weightTemplateId, null);
    assert.equal(restored.assessments[1].subcategoryId, null);
    assert.equal(restored.courses[1].termResults[0].points, 0);
    assert.deepEqual(plain(restored.courses[1].archiveHistory[0].snapshot), plain(incoming.courses[1].archiveSnapshot));
  });
}

test('replacing a backup immediately arms the restored one-minute inactivity timer', async () => {
  const h = await createImportHarness();
  const pending = new Map();
  let clock = 0;
  let nextTimer = 0;
  h.app.sandbox.setTimeout = (callback, delay) => {
    pending.set(++nextTimer, { callback, due: clock + delay });
    return nextTimer;
  };
  h.app.sandbox.clearTimeout = id => pending.delete(id);
  const advance = ms => {
    clock += ms;
    for (const [id, timer] of pending) {
      if (timer.due > clock) continue;
      pending.delete(id);
      timer.callback();
    }
  };
  h.app.Storage.setSessionTimeoutMinutes(15);
  const incoming = createState(h.app.DomainModel, 'Import');
  incoming.settings.sessionTimeoutMinutes = 1;
  const text = await h.app.Storage.exportStateEncrypted(h.app.password, incoming);
  h.setDialogs({ passwords: [h.app.password], confirms: [true, true] });
  await h.importFile({ name: 'timeout.enc.json', text });
  advance(59999);
  assert.equal(h.app.Storage.hasSessionPassword(), true);
  advance(1);
  assert.equal(h.app.Storage.hasSessionPassword(), false);
});

// Catches replacement silently overwriting dates/names that the real backup
// button exported correctly. Uses separate source/target browser storage.
for (const protection of ['V1', 'V2']) {
  test(`${protection} header backup restores saved Sek-I and Sek-II periods after reopening`, async () => {
    const source = await loadDashboardUi();
    if (protection === 'V2') {
      const prepared = await source.Storage.prepareRecoveryEnrollment({ password: source.password });
      await source.Storage.confirmPreparedProtection(prepared.token, prepared.recoveryCode);
      await source.Storage.commitPreparedProtection(prepared.token);
    }
    const downloads = [];
    source.sandbox.downloadBlobFile = content => downloads.push(content);
    await source.UiShell.init('app');
    await findByText(source.root, 'Einstellungen').dispatch('click');
    const fields = {
      seckI: ['2030-08-26', '2031-01-23', '2031-02-02', 'Erstes Halbjahr', 'Zweites Halbjahr'],
      seckII: ['2030-09-02', '2031-02-13', '2031-02-17', 'Semester A', 'Semester B']
    };
    for (const [level, values] of Object.entries(fields)) {
      await findByAttribute(source.root, 'data-settings-stage', level).dispatch('click');
      for (const [index, field] of ['school-year-start', 'h1-end', 'h2-start', 'h1-name', 'h2-name'].entries()) {
        const input = findByAttribute(source.root, 'id', `settings-${level}-${field}`);
        input.value = values[index];
        await input.dispatch('input');
      }
    }
    await findByText(source.root, 'Zeiträume für Sek I und Sek II speichern').dispatch('click');
    const backupButton = source.root._find(element => element.className === 'header-action header-action-primary');
    await backupButton.dispatch('click');
    assert.equal(downloads.length, 1);
    const text = downloads[0];
    const exported = protection === 'V2'
      ? await source.Storage.importStateEncryptedFromText(text, source.password)
      : JSON.parse(await source.Storage._decryptPayload(text, source.password));
    assert.deepEqual(plain(exported.settings.halfYearSettings), savedPeriods);
    assert.deepEqual(plain(exported.settings.halfYearNames), savedPeriodNames);

    const target = await createImportHarness();
    target.setDialogs({ passwords: [source.password], confirms: [true, true] });
    await target.importFile({ name: 'synthetic-periods.enc.json', text });
    const restored = await target.loadedState();
    assert.deepEqual(plain(restored.settings.halfYearSettings), savedPeriods);
    assert.deepEqual(plain(restored.settings.halfYearNames), savedPeriodNames);
    assert.equal(target.confirmations.length, 2);

    await target.app.Storage.lockSession();
    const reopened = await loadDashboardUi({
      storage: target.app.storage, lockManager: target.app.lockManager, useExistingStorage: true
    });
    await reopened.UiShell.init('app');
    await findByText(reopened.root, 'Einstellungen').dispatch('click');
    for (const [level, values] of Object.entries(fields)) {
      for (const [index, field] of ['school-year-start', 'h1-end', 'h2-start', 'h1-name', 'h2-name'].entries()) {
        assert.equal(findByAttribute(reopened.root, 'id', `settings-${level}-${field}`).value, values[index]);
      }
    }
  });
}

for (const access of ['V1 password', 'V2 password', 'V2 recovery code']) {
 for (const missing of ['all periods', 'Sek II only']) {
  test(`${access} legacy backup missing ${missing} retains local settings before assigning assessment terms`, async () => {
    const harness = await createImportHarness(state => {
      state.settings.halfYearSettings = plain(savedPeriods);
      state.settings.halfYearNames = plain(savedPeriodNames);
    });
    const incoming = createState(harness.app.DomainModel, 'Altbackup');
    incoming.courses[0].schemaMode = 'uppersec';
    incoming.courses[0].schoolYearStartYear = 2030;
    const assessment = harness.app.DomainModel.createAssessment({
      id: 'legacy-without-term', courseId: incoming.courses[0].id,
      categoryId: incoming.settings.categories[0].id, title: 'Synthetische Leistung', date: '2031-02-10'
    });
    delete assessment.term;
    delete assessment.termAssignment;
    incoming.assessments.push(assessment);
    incoming.settings.halfYearSettings.seckI = {
      schoolYearStartYear: 2028, schoolYearStartMonth: 8, schoolYearStartDay: 21,
      h1EndYear: 2029, h1EndMonth: 1, h1EndDay: 25,
      h2StartYear: 2029, h2StartMonth: 2, h2StartDay: 5
    };
    incoming.settings.halfYearNames.seckI = { h1: 'Quelle H1', h2: 'Quelle H2' };
    const expectedDates = { ...plain(savedPeriods), seckI: plain(incoming.settings.halfYearSettings.seckI) };
    const expectedNames = { ...plain(savedPeriodNames), seckI: plain(incoming.settings.halfYearNames.seckI) };
    if (missing === 'all periods') {
      delete incoming.settings.halfYearSettings;
      delete incoming.settings.halfYearNames;
    } else {
      delete incoming.settings.halfYearSettings.seckII;
      delete incoming.settings.halfYearNames.seckII;
    }
    let text;
    let recoveryCode;
    if (access.startsWith('V2')) {
      const source = await loadDashboardUi();
      const prepared = await source.Storage.prepareRecoveryEnrollment({ password: source.password });
      await source.Storage.confirmPreparedProtection(prepared.token, prepared.recoveryCode);
      await source.Storage.commitPreparedProtection(prepared.token);
      text = await source.Storage.encryptForBackup(JSON.stringify(incoming));
      recoveryCode = prepared.recoveryCode;
    } else {
      text = await harness.app.Storage.exportStateEncrypted(harness.app.password, incoming);
    }
    harness.setDialogs({ passwords: [harness.app.password], confirms: [true, true] });
    if (access === 'V2 recovery code') {
      harness.app.sandbox.window.promptPassword = async options => {
        if (options.secretKind === 'recovery-code') return recoveryCode;
        assert.equal(await options.onRecovery(), true);
        return null;
      };
    }
    await harness.importFile({ name: 'synthetic-legacy-periods.enc.json', text });
    const restored = await harness.loadedState();
    assert.equal(restored.courses[0].id, 'Altbackup-course');
    assert.deepEqual(plain(restored.settings.halfYearSettings), missing === 'all periods' ? savedPeriods : expectedDates);
    assert.deepEqual(plain(restored.settings.halfYearNames), missing === 'all periods' ? savedPeriodNames : expectedNames);
    assert.equal(restored.assessments[0].term, '2030-H1', 'February 10 precedes the restored Sek-II H2 start on February 17');
  });
 }
}

test('encrypted backup replacement restores the chosen course symbol from a different source password', async () => {
  const harness = await createImportHarness();
  const incoming = createState(harness.app.DomainModel, 'Symbol');
  incoming.courses[0].symbolId = 'globe';
  const sourcePassword = 'Synthetic-source-symbol-2026';
  const text = await harness.app.Storage.exportStateEncrypted(sourcePassword, incoming);
  harness.setDialogs({ passwords: [sourcePassword], confirms: [true, true] });
  await harness.importFile({ name: 'synthetic-symbol.enc.json', text });
  const loaded = await harness.loadedState();
  assert.equal(loaded.courses[0].symbolId, 'globe');
  assert.equal(loaded.courses[0].id, 'Symbol-course');
  assert.equal(harness.confirmations.length, 2);
  assert.deepEqual(harness.alerts, ['Import erfolgreich und verschlüsselt gespeichert.']);
});

test('raw portable backup file merges through the rendered change handler', async () => {
  const harness = await createImportHarness();
  const incoming = createState(harness.app.DomainModel, 'Import');
  incoming.settings.halfYearSettings = plain(savedPeriods);
  incoming.settings.halfYearNames = plain(savedPeriodNames);
  const text = await harness.app.Storage._encryptJsonWithSalt(JSON.stringify(incoming), harness.app.password);
  harness.merge.checked = true;
  harness.setDialogs({ passwords: [harness.app.password], confirms: [true] });

  await harness.importFile({ name: 'portable.enc.json', text });

  const loaded = await harness.loadedState();
  assert.deepEqual(harness.alerts, [
    'Import erfolgreich und verschlüsselt gespeichert.\nLeistungsmetadaten-Konflikte (lokale Werte bleiben): 0'
  ]);
  assert.equal(harness.confirmations.length, 1);
  assert.deepEqual(Array.from(loaded.students, student => student.id).sort(), ['Import-student', 'Lokal-student']);
  assert.deepEqual(Array.from(loaded.courses, course => course.id).sort(), ['Import-course', 'Lokal-course']);
  const original = JSON.parse(harness.initialSnapshot);
  assert.deepEqual(plain(loaded.settings.halfYearSettings), original.settings.halfYearSettings);
  assert.deepEqual(plain(loaded.settings.halfYearNames), original.settings.halfYearNames);
});

test('merge preview ignores identical active and archived entries while preserving source and target courses', async () => {
  const harness = await createImportHarness((state, D) => {
    const archive = D.createCourse({ id: 'shared-archive', name: 'Gemeinsames Archiv',
      subject: 'Testfach', classLabel: 'A1', schoolYearStartYear: 2025 });
    D.addCourseToState(state, archive);
    D.enrollStudentInCourse(state, archive.id, state.students[0].id);
    for (const [courseId, date, valueRaw] of [
      [state.courses[0].id, '2026-09-01', '2'], [archive.id, '2025-10-10', '3']
    ]) {
      const assessment = D.createAssessment({ id: `assessment-${courseId}`, courseId,
        categoryId: state.settings.categories[0].id, title: 'Gemeinsame Leistung', date });
      assessment.scores[state.students[0].id] = D.createScoreEntry({ valueRaw });
      state.assessments.push(assessment);
    }
    D.archiveCourse(state, archive.id, 'manual', {});
    D.addCourseToState(state, D.createCourse({ id: 'target-only', name: 'MERGE-ZIEL',
      subject: 'Testfach', classLabel: 'TEST' }));
  });
  const incoming = JSON.parse(harness.initialSnapshot);
  incoming.courses = incoming.courses.filter(course => course.id !== 'target-only');
  incoming.courses.push(harness.app.DomainModel.createCourse({ id: 'source-only',
    name: 'MERGE-QUELLE', subject: 'Testfach', classLabel: 'TEST' }));
  const text = await harness.app.Storage.exportStateEncrypted(harness.app.password, incoming);
  const file = { name: 'shared-with-source-course.enc.json', text };
  harness.merge.checked = true;
  harness.setDialogs({ passwords: [harness.app.password], confirms: [false] });
  await harness.importFile(file);

  assert.equal(harness.confirmations.length, 1);
  assert.match(harness.confirmations[0], /Ziel: zusammenführen/);
  assert.match(harness.confirmations[0], /Ergebnis: 1 Schüler:innen, 4 Kurse, 2 Leistungen/);
  assert.match(harness.confirmations[0], /Score-Konflikte \(vorhandener Wert bleibt\): 0/);
  assert.match(harness.confirmations[0], /Übersprungene Archivänderungen: 0/);
  assert.equal(JSON.stringify(await harness.loadedState()), harness.initialSnapshot,
    'Abbruch der Vorschau lässt den gespeicherten Zielbestand unverändert');

  harness.setDialogs({ passwords: [harness.app.password], confirms: [true] });
  await harness.importFile(file);
  const merged = await harness.loadedState();
  assert.equal(merged.students.length, 1);
  assert.equal(merged.courses.length, 4);
  assert.ok(merged.courses.some(course => course.id === 'source-only'));
  assert.ok(merged.courses.some(course => course.id === 'target-only'));
  assert.equal(JSON.stringify(merged.assessments), JSON.stringify(JSON.parse(harness.initialSnapshot).assessments));
  assert.deepEqual(harness.alerts, [
    'Import erfolgreich und verschlüsselt gespeichert.\nLeistungsmetadaten-Konflikte (lokale Werte bleiben): 0'
  ]);
});

test('merge preview reports discarded assessment metadata differences separately', async () => {
  const harness = await createImportHarness((state, D) => {
    const assessment = D.createAssessment({
      id: 'assessment-metadata-conflict',
      courseId: state.courses[0].id,
      categoryId: state.settings.categories[0].id,
      title: 'Lokaler Titel',
      date: '2026-02-01'
    });
    state.assessments.push(assessment);
  });
  const incoming = JSON.parse(harness.initialSnapshot);
  incoming.assessments[0].title = 'Importierter Titel';
  incoming.assessments[0].date = '2026-02-03';
  const text = await harness.app.Storage.exportStateEncrypted(harness.app.password, incoming);
  harness.merge.checked = true;
  harness.setDialogs({ passwords: [harness.app.password], confirms: [false] });

  await harness.importFile({ name: 'metadata-conflict.enc.json', text });

  assert.match(harness.confirmations[0], /Leistungsmetadaten-Konflikte \(lokale Werte bleiben\): 1/);
  assert.equal(JSON.stringify(await harness.loadedState()), harness.initialSnapshot);

  harness.setDialogs({ passwords: [harness.app.password], confirms: [true] });
  await harness.importFile({ name: 'metadata-conflict.enc.json', text });

  assert.deepEqual(harness.alerts, [
    'Import erfolgreich und verschlüsselt gespeichert.\nLeistungsmetadaten-Konflikte (lokale Werte bleiben): 1'
  ]);
  assert.equal((await harness.loadedState()).assessments[0].title, 'Lokaler Titel');
});

test('wrong backup password reports failure and preserves persisted state', async () => {
  const harness = await createImportHarness();
  const incoming = createState(harness.app.DomainModel, 'Import');
  const text = await harness.app.Storage._encryptJsonWithSalt(JSON.stringify(incoming), harness.app.password);
  harness.setDialogs({ passwords: ['Falsches-Synthetisches-Passwort'] });

  await harness.importFile({ name: 'wrong-password.enc.json', text });

  assert.equal(JSON.stringify(await harness.loadedState()), harness.initialSnapshot);
  assert.equal(harness.confirmations.length, 0);
  assert.equal(harness.alerts.length, 1);
  assert.match(harness.alerts[0], /^Import fehlgeschlagen\. Der bisherige Datenbestand bleibt erhalten\./);
});

test('cancelling the backup password dialog performs no confirmation, alert, or state change', async () => {
  const harness = await createImportHarness();
  const incoming = createState(harness.app.DomainModel, 'Import');
  const text = await harness.app.Storage._encryptJsonWithSalt(JSON.stringify(incoming), harness.app.password);
  harness.setDialogs({ passwords: [null] });

  await harness.importFile({ name: 'cancelled.enc.json', text });

  assert.equal(JSON.stringify(await harness.loadedState()), harness.initialSnapshot);
  assert.equal(harness.confirmations.length, 0);
  assert.deepEqual(harness.alerts, []);
});

test('file read error reports the import failure once and preserves persisted state', async () => {
  const harness = await createImportHarness();
  harness.setDialogs({ passwords: [harness.app.password], confirms: [true, true] });

  await harness.importFile({
    name: 'unreadable.enc.json',
    error: new Error('Synthetischer Lesefehler')
  });

  assert.equal(JSON.stringify(await harness.loadedState()), harness.initialSnapshot);
  assert.equal(harness.confirmations.length, 0);
  assert.deepEqual(harness.alerts, [
    'Import fehlgeschlagen. Der bisherige Datenbestand bleibt erhalten. Synthetischer Lesefehler'
  ]);
  assert.equal(harness.input.value, '');
});

test('a late load event after a file read error is ignored without a second alert or import', async () => {
  const harness = await createImportHarness();
  harness.setDialogs({ passwords: [harness.app.password], confirms: [true, true] });

  await harness.importFile({
    name: 'unreadable-with-late-load.enc.json',
    text: JSON.stringify(createState(harness.app.DomainModel, 'Import')),
    error: new Error('Synthetischer Lesefehler'),
    fireLoadAfterError: true
  });

  assert.equal(JSON.stringify(await harness.loadedState()), harness.initialSnapshot);
  assert.equal(harness.confirmations.length, 0);
  assert.deepEqual(harness.alerts, [
    'Import fehlgeschlagen. Der bisherige Datenbestand bleibt erhalten. Synthetischer Lesefehler'
  ]);
});
