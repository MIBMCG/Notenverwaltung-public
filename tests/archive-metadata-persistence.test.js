'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadDashboardUi, findByText } = require('./harness/dashboard-app.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

async function settleUi() {
  await new Promise(resolve => setImmediate(resolve));
}

async function courseState({ archived = false } = {}) {
  const probe = await loadDashboardUi();
  const state = probe.DomainModel.createEmptyState();
  const course = probe.DomainModel.createCourse({
    id: archived ? 'archive-metadata-course' : 'manual-archive-course',
    name: 'Synthetischer Biologiekurs',
    subject: 'Biologie',
    classLabel: '8a',
    schoolYearStartYear: 2025
  });
  probe.DomainModel.addCourseToState(state, course);
  if (archived) {
    probe.DomainModel.archiveCourse(state, course.id, 'manual', {
      archiveRetentionUntil: '2027-07-31',
      archiveNote: 'Bestaetigte Ausgangsnotiz'
    });
  }
  return { state, courseId: course.id };
}

async function openCourses(app) {
  await findByText(app.root, 'Kurse').dispatch('click');
}

function metadataDialog(app) {
  const note = app.document.body.querySelector('textarea');
  assert.ok(note, 'der echte Archivangaben-Dialog muss geöffnet bleiben');
  const dialog = note.parentNode;
  const retention = Array.from(dialog.querySelectorAll('input')).find(input => input.type === 'date');
  const confirm = Array.from(dialog.querySelectorAll('button')).at(-1);
  const cancel = Array.from(dialog.querySelectorAll('button'))[0];
  const error = dialog.querySelector('[role="alert"]');
  assert.ok(retention && confirm && cancel && error, 'der Dialog enthält Datum, Aktionen und sichtbaren Fehlerbereich');
  return { dialog, note, retention, confirm, cancel, error, overlay: dialog.parentNode };
}

function rejectFirstSave(app) {
  const originalSave = app.Storage.saveState.bind(app.Storage);
  let calls = 0;
  app.Storage.saveState = candidate => {
    calls += 1;
    if (calls === 1) {
      const error = new Error('Synthetischer Quotenfehler');
      error.name = 'QuotaExceededError';
      return Promise.reject(error);
    }
    return originalSave(candidate);
  };
  return () => calls;
}

test('P13: failed archive-metadata save keeps the same draft and retry persists it exactly once', async () => {
  const { state, courseId } = await courseState({ archived: true });
  const app = await loadDashboardUi({ state });
  await app.UiShell.init('app');
  await openCourses(app);
  const saveCalls = rejectFirstSave(app);

  const editing = findByText(app.root, 'Aufbewahrung bearbeiten').dispatch('click');
  await settleUi();
  const first = metadataDialog(app);
  first.retention.value = '2028-06-30';
  first.note.value = 'Derselbe wichtige Archiv-Entwurf';
  await first.confirm.dispatch('click');
  await settleUi();

  const retained = metadataDialog(app);
  assert.equal(retained.note, first.note, 'der fehlgeschlagene Versuch behält dasselbe Eingabefeld');
  assert.equal(retained.retention, first.retention, 'der fehlgeschlagene Versuch behält dasselbe Datumsfeld');
  assert.equal(retained.note.value, 'Derselbe wichtige Archiv-Entwurf');
  assert.equal(retained.retention.value, '2028-06-30');
  assert.match(retained.error.textContent, /nicht gespeichert|Quotenfehler|erneut/i);
  let stored = await app.Storage.loadState();
  assert.equal(stored.courses.find(course => course.id === courseId).archiveNote, 'Bestaetigte Ausgangsnotiz');

  await retained.confirm.dispatch('click');
  await editing;
  stored = await app.Storage.loadState();
  const updated = stored.courses.filter(course => course.id === courseId);
  assert.equal(saveCalls(), 2, 'ein fehlgeschlagener Versuch und genau ein erfolgreicher Retry');
  assert.equal(updated.length, 1);
  assert.equal(updated[0].archiveNote, 'Derselbe wichtige Archiv-Entwurf');
  assert.equal(updated[0].archiveRetentionUntil, '2028-06-30');
  assert.equal(app.document.body.querySelector('textarea'), null, 'erst der erfolgreiche Commit schließt den Dialog');
});

test('P12: failed manual archive keeps its draft and retry archives the course once', async () => {
  const { state, courseId } = await courseState();
  const app = await loadDashboardUi({ state });
  await app.UiShell.init('app');
  await openCourses(app);
  await app.root.querySelectorAll('[data-role="edit"]')[0].dispatch('click');
  const saveCalls = rejectFirstSave(app);

  const archiving = findByText(app.root, 'Kurs archivieren').dispatch('click');
  await settleUi();
  const first = metadataDialog(app);
  first.retention.value = '2029-07-31';
  first.note.value = 'Derselbe manuelle Archivierungsentwurf';
  await first.confirm.dispatch('click');
  await settleUi();

  const retained = metadataDialog(app);
  assert.equal(retained.note, first.note);
  assert.equal(retained.note.value, 'Derselbe manuelle Archivierungsentwurf');
  assert.equal(retained.retention.value, '2029-07-31');
  assert.equal((await app.Storage.loadState()).courses.find(course => course.id === courseId).archivedAt, null);

  await retained.confirm.dispatch('click');
  await archiving;
  const stored = await app.Storage.loadState();
  const archived = stored.courses.filter(course => course.id === courseId);
  assert.equal(saveCalls(), 2);
  assert.equal(archived.length, 1);
  assert.ok(archived[0].archivedAt);
  assert.equal(archived[0].archiveNote, 'Derselbe manuelle Archivierungsentwurf');
  assert.equal(archived[0].archiveRetentionUntil, '2029-07-31');
});

test('school-year archive metadata survives a failed commit and the same-draft retry completes once', async () => {
  const { state, courseId } = await courseState();
  const app = await loadDashboardUi({ state });
  app.sandbox.window.confirm = () => true;
  await app.UiShell.init('app');
  await openCourses(app);
  const saveCalls = rejectFirstSave(app);

  await findByText(app.root, 'Schuljahreswechsel').dispatch('click');
  const parentApply = findByText(app.document.body, 'Vorschau bestätigen und durchführen');
  const changing = parentApply.dispatch('click');
  await settleUi();
  const first = metadataDialog(app);
  first.retention.value = '2030-08-15';
  first.note.value = 'Derselbe Schuljahreswechsel-Entwurf';
  await first.confirm.dispatch('click');
  await settleUi();

  const retained = metadataDialog(app);
  assert.equal(retained.note, first.note);
  assert.equal(retained.note.value, 'Derselbe Schuljahreswechsel-Entwurf');
  assert.equal(retained.retention.value, '2030-08-15');
  assert.equal((await app.Storage.loadState()).courses.find(course => course.id === courseId).archivedAt, null);

  await retained.confirm.dispatch('click');
  await changing;
  const stored = await app.Storage.loadState();
  const predecessor = stored.courses.find(course => course.id === courseId);
  const successors = stored.courses.filter(course => course.carriedForwardFromCourseId === courseId);
  assert.equal(saveCalls(), 2);
  assert.ok(predecessor.archivedAt);
  assert.equal(predecessor.archiveNote, 'Derselbe Schuljahreswechsel-Entwurf');
  assert.equal(predecessor.archiveRetentionUntil, '2030-08-15');
  assert.equal(successors.length, 1, 'der Retry erzeugt genau einen Nachfolgekurs');
});

test('pending archive metadata ignores duplicate submit and explicit cancel; session lock still aborts it', async () => {
  const { state, courseId } = await courseState({ archived: true });
  const app = await loadDashboardUi({ state });
  await app.UiShell.init('app');
  await openCourses(app);
  const original = JSON.stringify(await app.Storage.loadState());
  const saveStarted = deferred();
  const releaseSave = deferred();
  let saveCalls = 0;
  app.Storage.saveState = candidate => {
    void candidate;
    saveCalls += 1;
    saveStarted.resolve();
    return releaseSave.promise;
  };

  const editing = findByText(app.root, 'Aufbewahrung bearbeiten').dispatch('click');
  await settleUi();
  const pending = metadataDialog(app);
  pending.note.value = 'Darf nur einmal eingereiht werden';
  const firstSubmit = pending.confirm.dispatch('click');
  await saveStarted.promise;
  assert.equal(pending.confirm.disabled, true);
  assert.equal(pending.cancel.disabled, true, 'ein begonnener Commit kann nicht als ungespeicherter Dialog abgebrochen werden');
  await pending.confirm.dispatch('click');
  await pending.cancel.dispatch('click');
  assert.equal(saveCalls, 1, 'wiederholte Ereignisse dürfen keinen zweiten Commit veröffentlichen');
  assert.equal(pending.overlay.parentNode, app.document.body);

  app.Storage.lockSession();
  assert.equal(app.document.body.querySelector('textarea'), null, 'die Sitzungssperre räumt den Dialog trotz laufendem Commit auf');
  releaseSave.reject(new Error('Synthetischer Abbruch nach Sitzungssperre'));
  await Promise.all([firstSubmit, editing]);
  app.sandbox.window.promptPassword = async () => app.password;
  await findByText(app.root, 'Entsperren').dispatch('click');
  assert.equal(JSON.stringify(await app.Storage.loadState()), original);
  assert.equal((await app.Storage.loadState()).courses.find(course => course.id === courseId).archiveNote,
    'Bestaetigte Ausgangsnotiz');
  assert.equal(saveCalls, 1);
});

test('pending archive metadata freezes its captured draft, then a failed save restores editing for an exact retry', async () => {
  const { state, courseId } = await courseState({ archived: true });
  const app = await loadDashboardUi({ state });
  await app.UiShell.init('app');
  await openCourses(app);
  const originalSave = app.Storage.saveState.bind(app.Storage);
  const firstSaveStarted = deferred();
  const firstSave = deferred();
  const captured = [];
  let saveCalls = 0;
  app.Storage.saveState = candidate => {
    saveCalls += 1;
    const candidateCourse = candidate.courses.find(course => course.id === courseId);
    captured.push([candidateCourse.archiveNote, candidateCourse.archiveRetentionUntil]);
    if (saveCalls === 1) {
      firstSaveStarted.resolve();
      return firstSave.promise;
    }
    return originalSave(candidate);
  };

  const editing = findByText(app.root, 'Aufbewahrung bearbeiten').dispatch('click');
  await settleUi();
  const pending = metadataDialog(app);
  pending.note.value = 'Festgehaltener Entwurf A';
  pending.retention.value = '2028-05-31';
  const firstSubmit = pending.confirm.dispatch('click');
  await firstSaveStarted.promise;
  try {
    assert.equal(pending.note.disabled, true, 'die Notiz darf während des Commits nicht weiter bearbeitbar sein');
    assert.equal(pending.retention.disabled, true, 'das Aufbewahrungsdatum darf während des Commits nicht weiter bearbeitbar sein');
  } finally {
    firstSave.reject(new Error('Synthetischer Fehler nach Kandidatenerfassung'));
    await firstSubmit;
  }

  assert.equal(pending.note.disabled, false, 'nach dem Fehler ist die Notiz wieder bearbeitbar');
  assert.equal(pending.retention.disabled, false, 'nach dem Fehler ist das Datum wieder bearbeitbar');
  assert.equal(pending.note.value, 'Festgehaltener Entwurf A');
  assert.equal(pending.retention.value, '2028-05-31');
  assert.deepEqual(captured[0], ['Festgehaltener Entwurf A', '2028-05-31']);

  pending.note.value = 'Bewusster Retry-Entwurf B';
  pending.retention.value = '2029-06-30';
  await pending.confirm.dispatch('click');
  await editing;

  const stored = (await app.Storage.loadState()).courses.find(course => course.id === courseId);
  assert.equal(saveCalls, 2);
  assert.deepEqual(captured[1], ['Bewusster Retry-Entwurf B', '2029-06-30']);
  assert.equal(stored.archiveNote, 'Bewusster Retry-Entwurf B');
  assert.equal(stored.archiveRetentionUntil, '2029-06-30');
});
