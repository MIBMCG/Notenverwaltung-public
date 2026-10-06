'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDashboardUi, findByText, findByAttribute } = require('./harness/dashboard-app');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fixedDate(isoInstant) {
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

async function openGradesheet(app, courseId) {
  const saves = [];
  const realSave = app.Storage.saveState.bind(app.Storage);
  app.Storage.saveState = candidate => {
    const pending = realSave(candidate);
    saves.push(Promise.resolve(pending));
    return pending;
  };
  const card = findByAttribute(app.root, 'data-course-id', courseId);
  const open = card._find(element => element.textContent === 'Noten öffnen');
  await open.dispatch('click');
  if (saves.length > 0) await saves.at(-1);
  app.Storage.saveState = realSave;
}

async function upperSecondaryApp() {
  const dateImpl = fixedDate('2026-09-20T12:00:00.000Z');
  const probe = await loadDashboardUi({ dateImpl });
  const state = probe.DomainModel.createEmptyState();
  const course = probe.DomainModel.createCourse({
    id: 't7-course',
    name: 'Biologie',
    subject: 'Biologie',
    classLabel: 'Oberstufe',
    schemaMode: probe.DomainModel.SCHEMA_MODES.UPPERSEC,
    upperSecContext: { courseType: 'basic', qualificationYear: 'q1-q2' }
  });
  const student = probe.DomainModel.createStudent({
    id: 't7-student', lastName: 'Curie', firstName: 'Marie'
  });
  probe.DomainModel.addCourseToState(state, course);
  probe.DomainModel.addStudentToState(state, student);
  probe.DomainModel.enrollStudentInCourse(state, course.id, student.id);
  probe.DomainModel.setTermResult(state, course.id, student.id, '2026-H1', 8);
  const assessment = probe.DomainModel.createAssessment({
    id: 't7-assessment',
    courseId: course.id,
    categoryId: state.settings.categories[0].id,
    title: 'Klausur',
    date: '2026-09-15',
    term: '2026-H1',
    weight: 1
  });
  assessment.scores[student.id] = probe.DomainModel.createScoreEntry({
    valueRaw: '8', valueNumeric: 8
  });
  probe.DomainModel.addAssessmentToState(state, assessment);
  const app = await loadDashboardUi({ state, dateImpl });
  await app.UiShell.init('app');
  await openGradesheet(app, course.id);
  return { app, course, student, assessment };
}

test('a failed term-result save restores the latest confirmed value without an intervening render', async () => {
  const { app, course, student } = await upperSecondaryApp();
  const input = app.root.querySelector('.gradesheet-term-result-input');
  assert.equal(input.value, '8');

  input.value = '10';
  await input.dispatch('change');
  let persisted = await app.Storage.loadState();
  assert.equal(
    app.DomainModel.getTermResult(
      app.DomainModel.findCourseById(persisted, course.id), student.id, '2026-H1'
    ),
    10
  );

  const realSave = app.Storage.saveState;
  app.Storage.saveState = async () => { throw new Error('synthetic term-result failure'); };
  input.value = '12';
  await input.dispatch('change');
  app.Storage.saveState = realSave;

  persisted = await app.Storage.loadState();
  assert.equal(input.value, '10');
  assert.equal(
    app.DomainModel.getTermResult(
      app.DomainModel.findCourseById(persisted, course.id), student.id, '2026-H1'
    ),
    10
  );
});

test('a successful term-score save refreshes term averages from the confirmed assessment', async () => {
  const { app, student } = await upperSecondaryApp();
  const input = app.root.querySelectorAll('.gradesheet-input').find(element =>
    element.dataset.gradesheetTerm === '2026-H1' &&
    element.closest('tr') && element.closest('tr').dataset.student === student.id
  );
  assert.ok(input);
  const averages = () => input.closest('tr').querySelectorAll('td.gradesheet-avg').map(cell => cell.textContent);
  assert.ok(averages().includes('8.00'));

  input.value = '12';
  await input.dispatch('change');

  assert.ok(averages().includes('12.00'), 'the visible term average must use the newly confirmed score');
  assert.equal(averages().includes('8.00'), false);
});

test('a late period save reconciles its submitted defaults without erasing a newer draft', async () => {
  const app = await loadDashboardUi();
  await app.UiShell.init('app');
  await findByText(app.root, 'Einstellungen').dispatch('click');
  const name = findByAttribute(app.root, 'id', 'settings-seckI-h1-name');
  name.value = '';
  await name.dispatch('input');

  const started = deferred();
  const release = deferred();
  const realSave = app.Storage.saveState.bind(app.Storage);
  app.Storage.saveState = async candidate => {
    started.resolve();
    await release.promise;
    return realSave(candidate);
  };
  const pending = findByText(app.root, 'Zeiträume für Sek I und Sek II speichern').dispatch('click');
  await started.promise;
  name.value = 'Neuer Entwurf';
  await name.dispatch('input');
  release.resolve();
  await pending;

  assert.equal(findByAttribute(app.root, 'id', 'settings-seckI-h1-name').value, 'Neuer Entwurf');
  assert.equal((await app.Storage.loadState()).settings.halfYearNames.seckI.h1, 'H1');
});
