'use strict';

// Durable UI persistence regressions for the real extracted UiShell.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repo = process.cwd();
const { loadModules } = require(path.join(repo, 'tests', 'harness', 'load.js'));
const { buildCourseState, addAssessment, setScore } = require(path.join(repo, 'tests', 'harness', 'fixtures.js'));
const { loadDashboardUi, findByText, findByAttribute } = require(path.join(repo, 'tests', 'harness', 'dashboard-app.js'));

function byButtonText(root, text) {
  return Array.from(root.querySelectorAll('button')).find(button => button.textContent.trim() === text) || null;
}

function assertSaveErrorVisible(app, alerts) {
  const feedback = [
    ...alerts,
    ...Array.from(app.root.querySelectorAll('[role="alert"],[role="status"]'), node => node.textContent)
  ].join('\n');
  assert.match(feedback, /QuotaExceededError|nicht gespeichert|Fehler beim Speichern|Speichern fehlgeschlagen/i,
    'the user must see why the mutation was not saved');
}

async function makeApp({ assessment = false } = {}) {
  const modules = loadModules();
  const fixture = buildCourseState(modules, { studentCount: 1, schemaMode: assessment ? 'uppersec' : 'grades' });
  let assessmentRecord = null;
  if (assessment) {
    assessmentRecord = addAssessment(modules, fixture, {
      categoryId: fixture.categoryIds.oral,
      title: 'Synthetische R06-Leistung',
      date: '2026-02-05'
    });
    setScore(modules, assessmentRecord, fixture.students[0].id, '4', modules.DomainModel.SCORE_STATUS.VALID);
    modules.DomainModel.setTermResult(fixture.state, fixture.course.id, fixture.students[0].id, '2025-H1', 11);
  }

  const app = await loadDashboardUi({ state: fixture.state });
  await app.UiShell.init('app');
  const alerts = [];
  app.sandbox.window.confirm = () => true;
  app.sandbox.window.alert = message => alerts.push(String(message));
  return { app, fixture, assessment: assessmentRecord, alerts };
}

async function goTo(app, label) {
  const button = byButtonText(app.root, label);
  assert.ok(button, `Navigationsschaltfläche ${label} ist vorhanden`);
  await button.dispatch('click');
}

async function openCourseEditor(app) {
  await goTo(app, 'Kurse');
  const editButton = app.root.querySelectorAll('[data-role="edit"]')[0];
  assert.ok(editButton, 'Kurskarte bietet die echte Bearbeitungsaktion');
  await editButton.dispatch('click');
}

function makeNextSaveFailWithQuota(app) {
  const originalSave = app.Storage.saveState.bind(app.Storage);
  let failNext = true;
  app.Storage.saveState = candidate => {
    if (failNext) {
      failNext = false;
      const error = new Error('Synthetischer localStorage-Quotenfehler');
      error.name = 'QuotaExceededError';
      return Promise.reject(error);
    }
    return originalSave(candidate);
  };
}

async function refreshThroughNavigation(app) {
  await goTo(app, 'Übersicht');
  await goTo(app, 'Kurse');
}

test('R06: deleting a course with QuotaExceededError keeps the confirmed course and allows retry', async () => {
  const { app, fixture, alerts } = await makeApp();
  const { course } = fixture;
  makeNextSaveFailWithQuota(app);
  await openCourseEditor(app);

  const deleteButton = byButtonText(app.root, 'Kurs löschen');
  assert.ok(deleteButton, 'Kurseditor exposes its delete action');
  await deleteButton.dispatch('click');

  const persistedAfterFailure = await app.Storage.loadState();
  assert.ok(persistedAfterFailure.courses.some(candidate => candidate.id === course.id),
    'a rejected save must leave the persisted course intact');
  await refreshThroughNavigation(app);
  assert.ok(app.root.querySelectorAll('[data-role="edit"]').length > 0,
    'a failed deletion must not remove the course from the confirmed in-memory view');
  assertSaveErrorVisible(app, alerts);

  await openCourseEditor(app);
  await byButtonText(app.root, 'Kurs löschen').dispatch('click');
  const persistedAfterRetry = await app.Storage.loadState();
  assert.equal(persistedAfterRetry.courses.some(candidate => candidate.id === course.id), false,
    'retry after the visible save error deletes exactly the selected course');
});

test('R06: deleting a person with QuotaExceededError retains the person and leaves the action retryable', async () => {
  const { app, fixture, alerts } = await makeApp();
  const student = fixture.students[0];
  makeNextSaveFailWithQuota(app);
  await openCourseEditor(app);

  await byButtonText(app.root, 'Schüler löschen').dispatch('click');
  assert.ok((await app.Storage.loadState()).students.some(candidate => candidate.id === student.id),
    'the failed save must leave the persisted person intact');
  await refreshThroughNavigation(app);
  await openCourseEditor(app);
  assert.ok(app.root.querySelectorAll('li').some(row => row.textContent.includes(student.lastName)),
    'the person remains in the in-memory roster after failure');
  assertSaveErrorVisible(app, alerts);

  await byButtonText(app.root, 'Schüler löschen').dispatch('click');
  assert.equal((await app.Storage.loadState()).students.some(candidate => candidate.id === student.id), false,
    'retry deletes the person once the save succeeds');
});

test('R06: unenrolling with QuotaExceededError keeps enrollment retryable and preserves score history', async () => {
  const { app, fixture, assessment, alerts } = await makeApp({ assessment: true });
  const { course, students: [student] } = fixture;
  makeNextSaveFailWithQuota(app);
  await openCourseEditor(app);

  await byButtonText(app.root, 'aus Kurs entfernen').dispatch('click');
  const persistedAfterFailure = await app.Storage.loadState();
  const storedCourseAfterFailure = persistedAfterFailure.courses.find(candidate => candidate.id === course.id);
  assert.ok(storedCourseAfterFailure.enrollments.some(enrollment => enrollment.studentId === student.id),
    'a failed save must leave the persisted enrollment intact');
  await refreshThroughNavigation(app);
  await openCourseEditor(app);
  assert.ok(app.root.querySelectorAll('li').some(row => row.textContent.includes(student.lastName)),
    'the roster still shows the confirmed enrollment after failure');
  assertSaveErrorVisible(app, alerts);

  await byButtonText(app.root, 'aus Kurs entfernen').dispatch('click');
  const persistedAfterRetry = await app.Storage.loadState();
  const storedCourseAfterRetry = persistedAfterRetry.courses.find(candidate => candidate.id === course.id);
  assert.equal(storedCourseAfterRetry.enrollments.some(enrollment => enrollment.studentId === student.id), false,
    'retry removes the enrollment after persistence succeeds');
  assert.ok(persistedAfterRetry.students.some(candidate => candidate.id === student.id),
    'unenrollment does not delete the person');
  const retainedScore = persistedAfterRetry.assessments.find(candidate => candidate.id === assessment.id).scores[student.id];
  assert.equal(retainedScore.valueRaw, '4', 'historical assessment score data remains available after unenrollment');
  assert.equal(retainedScore.status, 'valid');
  assert.ok(storedCourseAfterRetry.termResults.some(result =>
    result.studentId === student.id && result.term === '2025-H1' && result.points === 11),
  'manual term results remain available after unenrollment');
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

test('R13: delayed school-profile save and a later settings event both survive reload', async () => {
  const { app } = await makeApp();
  await goTo(app, 'Einstellungen');
  await byButtonText(app.root, 'Schule und Logo').dispatch('click');

  const templateId = (await app.Storage.loadState()).settings.weightTemplates[0].id;
  const name = app.document.getElementById('settings-school-name');
  assert.ok(name);
  name.value = 'R13 synthetische Schule';
  await name.dispatch('input');

  const originalSave = app.Storage.saveState.bind(app.Storage);
  const profileSaveStarted = deferred();
  const allowProfileSave = deferred();
  app.Storage.saveState = candidate => {
    if (candidate.settings.schoolProfile.name === 'R13 synthetische Schule') {
      profileSaveStarted.resolve();
      return allowProfileSave.promise.then(() => originalSave(candidate));
    }
    return originalSave(candidate);
  };

  const profileSave = byButtonText(app.root, 'Schule und Logo speichern').dispatch('click');
  await profileSaveStarted.promise;

  // Deliberately dispatch the real hidden grading-settings control while the
  // profile save is pending. It is a separate current UI mutation and replaces
  // the settings template array, exposing any stale whole-state publication.
  const templateName = findByAttribute(app.root, 'id', 'settings-template-name-0');
  assert.ok(templateName, 'grading settings expose the real template name control');
  templateName.value = 'R13 unabhängige Vorlage';
  const independentSetting = templateName.dispatch('change');
  allowProfileSave.resolve();
  await Promise.all([profileSave, independentSetting]);
  const changedStorage = await app.Storage.loadState();
  assert.equal(changedStorage.settings.schoolProfile.name, 'R13 synthetische Schule',
    'the later independent settings event must not restore the previous profile');
  assert.equal(changedStorage.settings.weightTemplates.find(template => template.id === templateId).name, 'R13 unabhängige Vorlage',
    'the delayed profile save must not restore the previous settings snapshot');

  await app.Storage.lockSession();
  const reloaded = await loadDashboardUi({ storage: app.storage, lockManager: app.lockManager, useExistingStorage: true });
  await reloaded.UiShell.init('app');
  const afterReload = await reloaded.Storage.loadState();
  assert.equal(afterReload.settings.schoolProfile.name, 'R13 synthetische Schule');
  assert.equal(afterReload.settings.weightTemplates.find(template => template.id === templateId).name, 'R13 unabhängige Vorlage');
});

test('R12: rejected period save preserves dates, names and automatic terms through a later successful setting edit, then retries', async () => {
  const modules = loadModules();
  const fixture = buildCourseState(modules, { studentCount: 1 });
  for (const level of ['seckI', 'seckII']) {
    fixture.state.settings.halfYearSettings[level] = {
      schoolYearStartYear: 2025, schoolYearStartMonth: 9, schoolYearStartDay: 8,
      h1EndYear: 2026, h1EndMonth: 1, h1EndDay: 30,
      h2StartYear: 2026, h2StartMonth: 2, h2StartDay: 9
    };
  }
  const assessment = addAssessment(modules, fixture, {
    categoryId: fixture.categoryIds.oral,
    date: '2026-02-05',
    term: '2025-H1',
    termAssignment: 'auto'
  });
  const app = await loadDashboardUi({ state: fixture.state });
  await app.UiShell.init('app');
  await findByText(app.root, 'Einstellungen').dispatch('click');
  const before = JSON.parse(JSON.stringify(await app.Storage.loadState()));
  const alerts = [];
  app.sandbox.window.alert = value => alerts.push(String(value));
  for (const [id, value] of Object.entries({
    'settings-seckI-h2-start': '2026-02-01',
    'settings-seckI-h1-name': 'R12 neuer Name'
  })) {
    const input = findByAttribute(app.root, 'id', id);
    assert.ok(input);
    input.value = value;
    await input.dispatch('input');
  }
  const originalSave = app.Storage.saveState.bind(app.Storage);
  let rejectNext = true;
  app.Storage.saveState = candidate => {
    if (rejectNext) {
      rejectNext = false;
      const error = new Error('Synthetischer Quotenfehler');
      error.name = 'QuotaExceededError';
      return Promise.reject(error);
    }
    return originalSave(candidate);
  };
  await findByText(app.root, 'Zeiträume für Sek I und Sek II speichern').dispatch('click');
  assert.ok(alerts.some(value => /Fehler beim Speichern|nicht gespeichert|Speichern fehlgeschlagen/.test(value)));
  assert.deepEqual(JSON.parse(JSON.stringify((await app.Storage.loadState()).settings.halfYearSettings)), before.settings.halfYearSettings);
  assert.equal(findByAttribute(app.root, 'id', 'settings-seckI-h2-start').value, '2026-02-01');
  assert.equal(findByAttribute(app.root, 'id', 'settings-seckI-h1-name').value, 'R12 neuer Name');

  await findByAttribute(app.root, 'data-settings-area', 'grading').dispatch('click');
  const template = findByAttribute(app.root, 'id', 'settings-template-name-0');
  template.value = 'R12 unabhängige Änderung';
  await template.dispatch('change');
  const afterIndependentCommit = JSON.parse(JSON.stringify(await app.Storage.loadState()));
  assert.equal(afterIndependentCommit.settings.weightTemplates[0].name, 'R12 unabhängige Änderung');
  assert.deepEqual(afterIndependentCommit.settings.halfYearSettings, before.settings.halfYearSettings,
    'a later commit must not publish period dates from the failed save');
  assert.deepEqual(afterIndependentCommit.settings.halfYearNames, before.settings.halfYearNames);
  assert.equal(afterIndependentCommit.assessments.find(item => item.id === assessment.id).term, '2025-H1');

  await findByAttribute(app.root, 'data-settings-area', 'periods').dispatch('click');
  assert.equal(findByAttribute(app.root, 'id', 'settings-seckI-h2-start').value, '2026-02-01');
  await findByText(app.root, 'Zeiträume für Sek I und Sek II speichern').dispatch('click');
  const afterRetry = JSON.parse(JSON.stringify(await app.Storage.loadState()));
  assert.equal(afterRetry.settings.halfYearSettings.seckI.h2StartDay, 1);
  assert.equal(afterRetry.settings.halfYearNames.seckI.h1, 'R12 neuer Name');
  assert.equal(afterRetry.assessments.find(item => item.id === assessment.id).term, '2025-H2');
  assert.equal(afterRetry.settings.weightTemplates[0].name, 'R12 unabhängige Änderung');
});

function fixedDateClass(isoInstant) {
  const instant = Date.parse(isoInstant);
  function FixedDate(...args) {
    return new Date(...(args.length ? args : [instant]));
  }
  FixedDate.now = () => instant;
  FixedDate.parse = Date.parse;
  FixedDate.UTC = Date.UTC;
  FixedDate.prototype = Date.prototype;
  return FixedDate;
}

const R23_FIXED_DATE = fixedDateClass('2026-09-15T12:00:00.000Z');

function findDetails(root, summaryText) {
  return root && root._find(element => element.tagName === 'DETAILS' &&
    element.children.some(child => child.tagName === 'SUMMARY' && child.textContent === summaryText));
}

function findLeafText(root, pattern) {
  return root && root._find(element => {
    if (!pattern.test(String(element.textContent || '')) || element.style.display === 'none') return false;
    return !(element.children || []).some(child => pattern.test(String(child.textContent || '')));
  });
}

function findControlAfterLabel(dialog, labelText, predicate) {
  const labelIndex = dialog.children.findIndex(child => child.tagName === 'LABEL' && child.textContent === labelText);
  assert.notEqual(labelIndex, -1, `Dialogfeld ${labelText} fehlt`);
  for (let index = labelIndex + 1; index < dialog.children.length; index++) {
    const candidate = dialog.children[index];
    if (candidate.tagName === 'LABEL') break;
    if (predicate(candidate)) return candidate;
  }
  assert.fail(`Steuerelement nach ${labelText} fehlt`);
}

async function openGradesheet(app, courseId) {
  const card = findByAttribute(app.root, 'data-course-id', courseId);
  assert.ok(card, 'Kurskarte fehlt');
  const open = byButtonText(card, 'Noten öffnen');
  assert.ok(open, 'Notenaktion fehlt');
  const realSaveState = app.Storage.saveState.bind(app.Storage);
  const pending = [];
  app.Storage.saveState = candidate => {
    const save = realSaveState(candidate);
    pending.push(Promise.resolve(save));
    return save;
  };
  try {
    await open.dispatch('click');
    await Promise.all(pending);
  } finally {
    app.Storage.saveState = realSaveState;
  }
}

async function assessmentApp({ existingAssessment = false } = {}) {
  const probe = await loadDashboardUi({ dateImpl: R23_FIXED_DATE });
  const ctx = buildCourseState(probe, { studentCount: 1 });
  ctx.course.id = 'r23-course';
  const seeded = existingAssessment
    ? addAssessment(probe, ctx, {
      categoryId: ctx.categoryIds.written,
      title: 'Bestehende Leistung',
      date: '2026-09-10',
      term: '2026-H1',
      weight: 1
    })
    : null;
  const app = await loadDashboardUi({ state: ctx.state, dateImpl: R23_FIXED_DATE });
  await app.UiShell.init('app');
  await openGradesheet(app, ctx.course.id);
  return { app, ctx, seeded };
}

function rejectFirstSave(app) {
  const realSaveState = app.Storage.saveState.bind(app.Storage);
  let calls = 0;
  app.Storage.saveState = candidate => {
    calls += 1;
    if (calls === 1) {
      const error = new Error('Synthetisches Speicherkontingent erschöpft');
      error.name = 'QuotaExceededError';
      return Promise.reject(error);
    }
    return realSaveState(candidate);
  };
  return { calls: () => calls };
}

test('R23 create: QuotaExceeded keeps the populated form and retry creates exactly one assessment', async () => {
  const { app, ctx } = await assessmentApp();
  const persistedBefore = JSON.parse(JSON.stringify(await app.Storage.loadState()));
  const management = findDetails(app.root, 'Leistungen verwalten');
  const createPanel = findDetails(management, 'Neue Leistung anlegen');
  assert.ok(createPanel, 'echtes Anlageformular fehlt');

  const category = app.document.getElementById('gradesheet-new-category');
  const title = app.document.getElementById('gradesheet-new-title');
  const date = app.document.getElementById('gradesheet-new-date');
  const term = app.document.getElementById('gradesheet-new-term');
  const weight = app.document.getElementById('gradesheet-new-weight');
  const visible = app.document.getElementById('visible-checkbox-new');
  const add = byButtonText(createPanel, 'Leistung hinzufügen');
  assert.ok(category && title && date && term && weight && visible && add,
    'Anlagefelder müssen über stabile IDs und Beschriftung auffindbar sein');

  category.value = ctx.categoryIds.written;
  await category.dispatch('change');
  title.value = 'R23 Wiederholungsleistung';
  date.value = '2026-09-18';
  await date.dispatch('change');
  weight.value = '1.5';
  visible.checked = false;
  const selectedTerm = term.value;

  const saves = rejectFirstSave(app);
  await add.dispatch('click');
  assert.equal(saves.calls(), 1);
  assert.equal(JSON.stringify(await app.Storage.loadState()), JSON.stringify(persistedBefore));
  assert.equal(title.value, 'R23 Wiederholungsleistung');
  assert.equal(category.value, ctx.categoryIds.written);
  assert.equal(date.value, '2026-09-18');
  assert.equal(term.value, selectedTerm);
  assert.equal(weight.value, '1.5');
  assert.equal(visible.checked, false);
  assert.ok(findLeafText(createPanel, /nicht gespeichert|speichern[^.]*fehl|erneut versuchen/i));

  await add.dispatch('click');
  const persistedAfterRetry = await app.Storage.loadState();
  const created = persistedAfterRetry.assessments.filter(assessment =>
    assessment.courseId === ctx.course.id && assessment.title === 'R23 Wiederholungsleistung');
  assert.equal(saves.calls(), 2);
  assert.equal(created.length, 1);
  assert.equal(persistedAfterRetry.assessments.length, persistedBefore.assessments.length + 1);
});

test('R23 edit: QuotaExceeded keeps the modal and retry applies the edit once', async () => {
  const { app, seeded } = await assessmentApp({ existingAssessment: true });
  const persistedBefore = JSON.parse(JSON.stringify(await app.Storage.loadState()));
  const management = findDetails(app.root, 'Leistungen verwalten');
  const edit = management && management._find(element => element.tagName === 'BUTTON' &&
    element.getAttribute('aria-label') === 'Leistung „Bestehende Leistung“ bearbeiten');
  assert.ok(edit, 'echte Bearbeitungsaktion fehlt');
  await edit.dispatch('click', { stopPropagation() {} });

  const heading = app.document.body._find(element => element.tagName === 'H3' && element.textContent === 'Leistung bearbeiten');
  assert.ok(heading, 'echter Bearbeitungsdialog fehlt');
  const dialog = heading.parentNode;
  const title = findControlAfterLabel(dialog, 'Bezeichnung:', element => element.tagName === 'INPUT' && element.type === 'text');
  const date = findControlAfterLabel(dialog, 'Datum:', element => element.tagName === 'INPUT' && element.type === 'date');
  const term = findControlAfterLabel(dialog, 'Halbjahr:', element => element.tagName === 'SELECT');
  const weight = findControlAfterLabel(dialog, 'Gewicht:', element => element.tagName === 'INPUT' && element.type === 'number');
  const visible = dialog._find(element => element.tagName === 'INPUT' && element.type === 'checkbox' && element.id === 'edit-visible-checkbox');
  const save = byButtonText(dialog, 'Speichern');
  assert.ok(visible && save, 'Bearbeitungsfelder und Speicheraktion fehlen');

  title.value = 'Bearbeitete R23 Leistung';
  date.value = '2026-09-21';
  weight.value = '2';
  visible.checked = false;
  const selectedTerm = term.value;

  const saves = rejectFirstSave(app);
  await save.dispatch('click');
  const unchanged = (await app.Storage.loadState()).assessments.find(assessment => assessment.id === seeded.id);
  assert.equal(saves.calls(), 1, dialog.textContent);
  assert.equal(
    JSON.stringify(unchanged),
    JSON.stringify(persistedBefore.assessments.find(assessment => assessment.id === seeded.id))
  );
  assert.equal(dialog.parentNode !== null, true);
  assert.equal(title.value, 'Bearbeitete R23 Leistung');
  assert.equal(date.value, '2026-09-21');
  assert.equal(term.value, selectedTerm);
  assert.equal(weight.value, '2');
  assert.equal(visible.checked, false);
  assert.ok(findLeafText(dialog, /nicht gespeichert|speichern[^.]*fehl|erneut versuchen/i));

  await save.dispatch('click');
  const persistedAfterRetry = await app.Storage.loadState();
  const matchingId = persistedAfterRetry.assessments.filter(assessment => assessment.id === seeded.id);
  assert.equal(saves.calls(), 2);
  assert.equal(matchingId.length, 1);
  assert.equal(matchingId[0].title, 'Bearbeitete R23 Leistung');
  assert.equal(matchingId[0].date, '2026-09-21');
  assert.equal(matchingId[0].term, selectedTerm);
  assert.equal(matchingId[0].weight, 2);
  assert.equal(matchingId[0].visible, false);
  assert.equal(persistedAfterRetry.assessments.length, persistedBefore.assessments.length);
});
