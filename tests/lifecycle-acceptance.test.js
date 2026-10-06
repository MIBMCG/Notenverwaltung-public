'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadDashboardUi,
  findByText,
  findByAttribute
} = require('./harness/dashboard-app');

async function settleRender() {
  await new Promise(resolve => setImmediate(resolve));
}

async function openCourses(app) {
  await app.UiShell.init('app');
  await findByText(app.root, 'Kurse').dispatch('click');
  await settleRender();
}

async function reloadApp(app) {
  await app.Storage.lockSession();
  const reloaded = await loadDashboardUi({
    lockManager: app.lockManager,
    storage: app.storage,
    useExistingStorage: true
  });
  await openCourses(reloaded);
  return reloaded;
}

function rawStorageSnapshot(storage) {
  return Object.fromEntries(storage._keys().sort().map(key => [key, storage.getItem(key)]));
}

function activeCourseCard(app, courseId) {
  return findByAttribute(app.root, 'data-course-id', courseId);
}

async function openCourseEditor(app, courseId) {
  const card = activeCourseCard(app, courseId);
  assert.ok(card, `aktive Kurskarte ${courseId} fehlt`);
  const edit = findByAttribute(card, 'data-role', 'edit');
  assert.ok(edit, `Bearbeiten-Schaltfläche für ${courseId} fehlt`);
  await edit.dispatch('click');
  return app.root._find(element => element.tagName === 'DETAILS' &&
    element.classList && element.classList.contains('courses-editor'));
}

function currentOverlay(app) {
  const overlay = app.document.body.children.at(-1);
  assert.ok(overlay && overlay !== app.root, 'erwarteter Dialog fehlt');
  return overlay;
}

function archiveMetadataControls(overlay) {
  const retention = overlay._find(element => element.tagName === 'INPUT' && element.type === 'date');
  const note = overlay._find(element => element.tagName === 'TEXTAREA');
  assert.ok(retention, 'Aufbewahrungsdatum fehlt');
  assert.ok(note, 'Archivnotiz fehlt');
  return { retention, note };
}

async function startManualArchive(app, courseId) {
  const editor = await openCourseEditor(app, courseId);
  const button = findByText(editor, 'Kurs archivieren');
  assert.ok(button, 'Archivieren-Schaltfläche fehlt');
  const completion = button.dispatch('click');
  return { completion, overlay: currentOverlay(app) };
}

async function openSchoolYearAssistant(app) {
  const trigger = findByText(app.root, 'Schuljahreswechsel');
  assert.ok(trigger, 'Schuljahreswechsel-Schaltfläche fehlt');
  await trigger.dispatch('click');
  const overlay = currentOverlay(app);
  const dialog = overlay.children[0];
  const apply = findByText(dialog, 'Vorschau bestätigen und durchführen');
  assert.ok(apply, 'Ausführen-Schaltfläche des Schuljahreswechsels fehlt');
  return { overlay, dialog, apply };
}

function createLifecycleState(app) {
  const state = app.DomainModel.createEmptyState();
  state.settings.halfYearSettings.seckI.schoolYearStartYear = 2025;
  state.settings.halfYearSettings.seckII.schoolYearStartYear = 2025;
  const student = app.DomainModel.createStudent({
    id: 'lifecycle-student',
    firstName: 'Emmy',
    lastName: 'Noether',
    homeClass: '8a'
  });
  const course = app.DomainModel.createCourse({
    id: 'lifecycle-course',
    name: 'Biologie 8a',
    subject: 'Biologie',
    classLabel: '8a',
    schoolYearStartYear: 2025
  });
  const assessment = app.DomainModel.createAssessment({
    id: 'lifecycle-assessment',
    courseId: course.id,
    categoryId: state.settings.categories[0].id,
    title: 'Ökologie-Test',
    date: '2026-01-15',
    term: '2025-H1'
  });
  assessment.scores[student.id] = app.DomainModel.createScoreEntry({ valueRaw: '2' });
  app.DomainModel.addStudentToState(state, student);
  app.DomainModel.addCourseToState(state, course);
  app.DomainModel.enrollStudentInCourse(state, course.id, student.id);
  app.DomainModel.addAssessmentToState(state, assessment);
  return { state, student, course, assessment };
}

async function lifecycleApp() {
  const probe = await loadDashboardUi();
  const fixture = createLifecycleState(probe);
  const app = await loadDashboardUi({ state: fixture.state });
  await openCourses(app);
  return { app, ...fixture };
}

test('Abbrechen der manuellen Archivangaben lässt den verschlüsselten Bestand unverändert', async () => {
  const { app, course } = await lifecycleApp();
  const before = JSON.stringify(await app.Storage.loadState());
  const rawBefore = rawStorageSnapshot(app.storage);
  const { completion, overlay } = await startManualArchive(app, course.id);

  const { retention, note } = archiveMetadataControls(overlay);
  retention.value = '2032-07-31';
  note.value = 'Darf nach Abbruch nicht gespeichert werden';
  await findByText(overlay, 'Abbrechen').dispatch('click');
  await completion;

  assert.equal(JSON.stringify(await app.Storage.loadState()), before);
  assert.deepEqual(rawStorageSnapshot(app.storage), rawBefore,
    'ein Abbruch darf den verschlüsselten Payload nicht neu schreiben');
  assert.ok(activeCourseCard(app, course.id), 'der abgebrochene Kurs muss aktiv bleiben');
  assert.doesNotMatch(app.root.textContent, /Archivierte Kurse \(1\)/);
});

test('manuelles Archivieren und Wiederherstellen überleben jeweils ein frisches Entsperren', async () => {
  const { app, course, student, assessment } = await lifecycleApp();
  const { completion, overlay } = await startManualArchive(app, course.id);
  const { retention, note } = archiveMetadataControls(overlay);
  retention.value = '2032-07-31';
  note.value = '  Aufbewahrung bis zur Abnahme  ';
  await findByText(overlay, 'Kurs archivieren').dispatch('click');
  await completion;

  const archivedApp = await reloadApp(app);
  const archivedState = await archivedApp.Storage.loadState();
  const archived = archivedApp.DomainModel.findCourseById(archivedState, course.id);
  assert.ok(archived.archivedAt);
  assert.equal(archived.archiveReason, 'manual');
  assert.equal(archived.archiveRetentionUntil, '2032-07-31');
  assert.equal(archived.archiveNote, 'Aufbewahrung bis zur Abnahme');
  assert.ok(archived.archiveSnapshot, 'der unveränderliche Archiv-Snapshot fehlt');
  assert.equal(archivedState.assessments[0].id, assessment.id);
  assert.equal(archivedState.assessments[0].scores[student.id].valueRaw, '2');

  archivedApp.sandbox.window.confirm = () => true;
  const restore = findByText(archivedApp.root, 'Wiederherstellen');
  assert.ok(restore, 'Wiederherstellen-Schaltfläche fehlt');
  await restore.dispatch('click');

  const restoredApp = await reloadApp(archivedApp);
  const restoredState = await restoredApp.Storage.loadState();
  const restored = restoredApp.DomainModel.findCourseById(restoredState, course.id);
  assert.equal(restored.archivedAt, null);
  assert.equal(restored.archiveRetentionUntil, null);
  assert.equal(restored.archiveNote, null);
  assert.equal(restored.archiveSnapshot, null);
  assert.equal(restored.archiveHistory.length, 1);
  assert.equal(restored.archiveHistory[0].archiveRetentionUntil, '2032-07-31');
  assert.equal(restored.archiveHistory[0].archiveNote, 'Aufbewahrung bis zur Abnahme');
  assert.equal(restoredState.assessments[0].scores[student.id].valueRaw, '2');
  assert.ok(activeCourseCard(restoredApp, course.id), 'wiederhergestellter Kurs muss wieder aktiv sein');
});

test('Abbrechen der letzten Schuljahreswechsel-Abfrage verwirft Vorschau und Archivangaben vollständig', async () => {
  const { app } = await lifecycleApp();
  const before = JSON.stringify(await app.Storage.loadState());
  const rawBefore = rawStorageSnapshot(app.storage);
  let confirmationText = null;
  app.sandbox.window.confirm = message => {
    confirmationText = String(message);
    return false;
  };
  const { overlay: assistantOverlay, dialog, apply } = await openSchoolYearAssistant(app);
  const year = dialog._find(element => element.tagName === 'INPUT' && element.type === 'number');
  year.value = '2026';
  await year.dispatch('input');

  const applyCompletion = apply.dispatch('click');
  const metadataOverlay = currentOverlay(app);
  const { retention, note } = archiveMetadataControls(metadataOverlay);
  retention.value = '2033-07-31';
  note.value = 'Nicht übernehmen';
  await findByText(metadataOverlay, 'Angaben übernehmen').dispatch('click');
  await applyCompletion;

  assert.match(confirmationText, /1 alte Kurse archivieren und 1 leere Nachfolgekurse/);
  assert.equal(assistantOverlay.parentNode, app.document.body,
    'die Vorschau soll nach dem Abbruch weiter offen bleiben');
  assert.equal(JSON.stringify(await app.Storage.loadState()), before);
  assert.deepEqual(rawStorageSnapshot(app.storage), rawBefore,
    'der letzte Abbruch darf den verschlüsselten Payload nicht neu schreiben');
});

test('Schuljahreswechsel speichert Archiv, Klassenfortschreibung und leeren Nachfolgekurs atomar', async () => {
  const { app, course, student, assessment } = await lifecycleApp();
  const realSaveState = app.Storage.saveState;
  let saveCalls = 0;
  app.Storage.saveState = candidate => {
    saveCalls += 1;
    return realSaveState(candidate);
  };
  app.sandbox.window.confirm = () => true;
  const { dialog, apply } = await openSchoolYearAssistant(app);
  const year = dialog._find(element => element.tagName === 'INPUT' && element.type === 'number');
  year.value = '2026';
  await year.dispatch('input');

  const applyCompletion = apply.dispatch('click');
  const metadataOverlay = currentOverlay(app);
  const { retention, note } = archiveMetadataControls(metadataOverlay);
  retention.value = '2033-07-31';
  note.value = 'Schuljahreswechsel 2026';
  await findByText(metadataOverlay, 'Angaben übernehmen').dispatch('click');
  await applyCompletion;

  const reloaded = await reloadApp(app);
  const stored = await reloaded.Storage.loadState();
  const oldCourse = reloaded.DomainModel.findCourseById(stored, course.id);
  const active = reloaded.DomainModel.listActiveCourses(stored);
  assert.equal(oldCourse.archiveReason, 'school-year-change');
  assert.equal(oldCourse.archiveRetentionUntil, '2033-07-31');
  assert.equal(oldCourse.archiveNote, 'Schuljahreswechsel 2026');
  assert.ok(oldCourse.archiveSnapshot);
  assert.equal(stored.assessments.length, 1);
  assert.equal(stored.assessments[0].id, assessment.id);
  assert.equal(stored.assessments[0].courseId, oldCourse.id);

  assert.equal(active.length, 1);
  const successor = active[0];
  assert.equal(successor.carriedForwardFromCourseId, oldCourse.id);
  assert.equal(successor.schoolYearStartYear, 2026);
  assert.equal(successor.name, 'Biologie 9a');
  assert.equal(successor.classLabel, '9a');
  assert.deepEqual(Array.from(successor.termResults), []);
  assert.equal(stored.assessments.some(item => item.courseId === successor.id), false);
  assert.deepEqual(Array.from(successor.enrollments, enrollment => ({
    studentId: enrollment.studentId,
    homeClassAtEnrollment: enrollment.homeClassAtEnrollment
  })), [{ studentId: student.id, homeClassAtEnrollment: '9a' }]);
  assert.equal(stored.students[0].homeClass, '9a');
  assert.equal(saveCalls, 1, 'Archiv, Nachfolger, Klassen und Zeiträume müssen gemeinsam gespeichert werden');
  for (const level of ['seckI', 'seckII']) {
    assert.equal(stored.settings.halfYearSettings[level].schoolYearStartYear, 2026);
    assert.equal(stored.settings.halfYearSettings[level].h1EndYear, 2027);
    assert.equal(stored.settings.halfYearSettings[level].h2StartYear, 2027);
  }
});
