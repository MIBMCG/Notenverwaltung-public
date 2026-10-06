'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules } = require('./harness/load');
const { buildCourseState, addAssessment, setScore } = require('./harness/fixtures');
const { loadDashboardUi, findByText, findByAttribute } = require('./harness/dashboard-app');

function byButtonText(root, text) {
  return root.querySelectorAll('button').find(button => button.textContent.trim() === text) || null;
}

function findDetails(root, summaryText) {
  return root._find(element => element.tagName === 'DETAILS' &&
    element.children.some(child => child.tagName === 'SUMMARY' && child.textContent === summaryText));
}

async function openGradesheet(app, courseId) {
  const card = findByAttribute(app.root, 'data-course-id', courseId);
  assert.ok(card, 'synthetic active course is visible on the dashboard');
  const open = byButtonText(card, 'Noten öffnen');
  assert.ok(open, 'course card exposes the real gradesheet route');
  await open.dispatch('click');
}

async function createAssessmentApp() {
  const modules = loadModules();
  const fixture = buildCourseState(modules, { studentCount: 1 });
  const assessment = addAssessment(modules, fixture, {
    categoryId: fixture.categoryIds.written,
    title: 'Synthetische Ausgangsleistung',
    date: '2026-09-15',
    term: '2026-H1'
  });
  setScore(modules, assessment, fixture.students[0].id, '2', modules.DomainModel.SCORE_STATUS.VALID);
  const app = await loadDashboardUi({ state: fixture.state });
  await app.UiShell.init('app');
  await openGradesheet(app, fixture.course.id);
  return { app, fixture, assessment };
}

test('the gradesheet header opens the existing new-assessment form for the current course and focuses its category', async () => {
  const { app, fixture, assessment } = await createAssessmentApp();
  const direct = byButtonText(app.root, 'Neue Leistung anlegen');
  const management = findDetails(app.root, 'Leistungen verwalten');
  const create = findDetails(management, 'Neue Leistung anlegen');
  assert.ok(direct, 'the former course-switch position exposes the direct create action');
  assert.equal(findByText(app.root, 'Kurs wechseln'), null);
  assert.ok(management && create, 'the existing assessment-management form remains the single create form');
  assert.equal(management.open, false);
  assert.equal(create.open, false);

  const score = app.root.querySelector('.gradesheet-input');
  score.value = '3';
  await direct.dispatch('click');

  assert.equal(management.open, true);
  assert.equal(create.open, true);
  assert.equal(app.document.activeElement, app.document.getElementById('gradesheet-new-category'));
  const persisted = await app.Storage.loadState();
  assert.equal(persisted.assessments.find(item => item.id === assessment.id).scores[fixture.students[0].id].valueRaw, '3',
    'opening the form finishes the pending score edit before changing focus');
  assert.equal(persisted.assessments.filter(item => item.courseId === fixture.course.id).length, 1,
    'opening the form alone does not create a second assessment');
});

test('invalid or failed pending score saves keep the create form closed and focus the real editor', async t => {
  await t.test('invalid score', async () => {
    const { app, fixture, assessment } = await createAssessmentApp();
    const direct = byButtonText(app.root, 'Neue Leistung anlegen');
    const management = findDetails(app.root, 'Leistungen verwalten');
    const create = findDetails(management, 'Neue Leistung anlegen');
    const score = app.root.querySelector('.gradesheet-input');
    assert.ok(direct, 'direct create action is available before validating the pending score');
    score.value = '99';

    await direct.dispatch('click');

    assert.equal(management.open, false);
    assert.equal(create.open, false);
    assert.equal(app.document.activeElement, score);
    const persisted = await app.Storage.loadState();
    assert.equal(persisted.assessments.find(item => item.id === assessment.id).scores[fixture.students[0].id].valueRaw, '2');
  });

  await t.test('rejected save', async () => {
    const { app, fixture, assessment } = await createAssessmentApp();
    const direct = byButtonText(app.root, 'Neue Leistung anlegen');
    const management = findDetails(app.root, 'Leistungen verwalten');
    const create = findDetails(management, 'Neue Leistung anlegen');
    const score = app.root.querySelector('.gradesheet-input');
    assert.ok(direct, 'direct create action is available before finishing the pending save');
    const confirmedBefore = JSON.parse(JSON.stringify(await app.Storage.loadState()));
    app.Storage.saveState = async () => { throw new Error('synthetic direct-create save failure'); };
    score.value = '3';

    await direct.dispatch('click');

    assert.equal(management.open, false);
    assert.equal(create.open, false);
    assert.equal(app.document.activeElement, score);
    assert.equal(score.value, '2', 'the editor restores the latest confirmed value after the rejected save');
    const persisted = await app.Storage.loadState();
    assert.deepEqual(
      JSON.parse(JSON.stringify(persisted.assessments)),
      confirmedBefore.assessments,
      'the rejected editor save leaves assessment data unchanged'
    );
    assert.equal(persisted.assessments.find(item => item.id === assessment.id).scores[fixture.students[0].id].valueRaw, '2');
  });
});

test('no direct create action is rendered without an active editable course', async () => {
  const modules = loadModules();
  const state = modules.DomainModel.createEmptyState();
  const archived = modules.DomainModel.createCourse({
    id: 'archived-only-course', name: 'Archivkurs', subject: 'Biologie', classLabel: '10a'
  });
  modules.DomainModel.addCourseToState(state, archived);
  modules.DomainModel.archiveCourse(state, archived.id, 'manual', {});
  const app = await loadDashboardUi({ state });
  await app.UiShell.init('app');
  await findByText(app.root, 'Noten').dispatch('click');

  assert.equal(byButtonText(app.root, 'Neue Leistung anlegen'), null);
  assert.equal((await app.Storage.loadState()).assessments.length, 0);
});
