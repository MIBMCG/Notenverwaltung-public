'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { loadDashboardUi, loadGeneratedDashboardUi, findByText, findByAttribute } = require('./harness/dashboard-app');
const { localStorageStub } = require('./harness/load');

async function unlockedAppWithCourses() {
  const probe = await loadDashboardUi();
  const state = probe.DomainModel.createEmptyState();
  const first = probe.DomainModel.createCourse({ id: 'bio-10a', name: 'Biologie', subject: 'Biologie', classLabel: '10a' });
  const second = probe.DomainModel.createCourse({ id: 'bio-10b', name: 'Biologie', subject: 'Biologie', classLabel: '10b' });
  probe.DomainModel.addCourseToState(state, first);
  probe.DomainModel.addCourseToState(state, second);
  return loadDashboardUi({ state });
}

async function unlockedAppWithAppearance(appearance, options = {}) {
  const app = await unlockedAppWithCourses();
  app.storage.setItem('notenverwaltung_appearance', JSON.stringify({
    family: 'aurora', appearance: 'light', accent: 'standard', background: 'standard', motion: 'vivid',
    ...appearance
  }));
  if (options.reducedMotionMediaQueryList) {
    return loadDashboardUi({
      state: await app.Storage.loadState(),
      reducedMotionMediaQueryList: options.reducedMotionMediaQueryList
    });
  }
  return app;
}

async function openGradesheetAndWaitForResume(app, card) {
  const realSaveState = app.Storage.saveState;
  const saves = [];
  app.Storage.saveState = candidate => {
    const pending = realSaveState.call(app.Storage, candidate);
    saves.push(Promise.resolve(pending));
    return pending;
  };
  try {
    await openButton(card).dispatch('click');
    if (saves.length > 0) await saves.at(-1);
  } finally {
    app.Storage.saveState = realSaveState;
  }
}

async function gradesheetApp({ appearance = null } = {}) {
  const probe = await loadDashboardUi();
  const state = probe.DomainModel.createEmptyState();
  const student = probe.DomainModel.createStudent({ id: 'student-a', lastName: 'Ada', firstName: 'Lovelace' });
  const course = probe.DomainModel.createCourse({ id: 'grade-course', name: 'Mathematik', subject: 'Mathematik', classLabel: '10a' });
  probe.DomainModel.addStudentToState(state, student);
  probe.DomainModel.addCourseToState(state, course);
  probe.DomainModel.enrollStudentInCourse(state, course.id, student.id);
  const assessment = probe.DomainModel.createAssessment({ id: 'grade-assessment', courseId: course.id, categoryId: state.settings.categories[0].id, title: 'Test', weight: 1 });
  assessment.scores[student.id] = probe.DomainModel.createScoreEntry({ valueRaw: '2' });
  probe.DomainModel.addAssessmentToState(state, assessment);
  const app = await loadDashboardUi({ state });
  if (appearance) {
    app.storage.setItem('notenverwaltung_appearance', JSON.stringify({
      family: 'aurora', appearance: 'light', accent: 'standard', background: 'standard', motion: 'vivid',
      ...appearance
    }));
  }
  await app.UiShell.init('app');
  await openGradesheetAndWaitForResume(
    app,
    findByAttribute(app.root, 'data-course-id', 'grade-course')
  );
  const input = app.root._find(element => element.classList && element.classList.contains('gradesheet-input'));
  return { app, input };
}

async function quickCourseSwitchGradesheetApp() {
  const fixedDate = createFixedDate('2026-03-15T12:00:00.000Z');
  const probe = await loadDashboardUi({ dateImpl: fixedDate });
  const state = probe.DomainModel.createEmptyState();
  const gradedStudent = probe.DomainModel.createStudent({
    id: 'quick-graded', lastName: 'Curie', firstName: 'Marie', homeClass: '10c'
  });
  const blankStudent = probe.DomainModel.createStudent({
    id: 'quick-blank', lastName: 'Franklin', firstName: 'Rosalind', homeClass: '10c'
  });
  const biology = probe.DomainModel.createCourse({
    id: 'quick-biology', name: 'Biologie', subject: 'Biologie', classLabel: '10c'
  });
  const mathematics = probe.DomainModel.createCourse({
    id: 'quick-mathematics', name: 'Mathematik', subject: 'Mathematik', classLabel: '10c'
  });
  const secondBiology = probe.DomainModel.createCourse({
    id: 'quick-biology-10d', name: 'Biologie', subject: 'Biologie', classLabel: '10d'
  });
  const unnamed = probe.DomainModel.createCourse({
    id: 'quick-unnamed', name: '', subject: '', classLabel: ''
  });
  const archived = probe.DomainModel.createCourse({
    id: 'quick-archived', name: 'Archivierter Kurs', subject: 'Chemie', classLabel: '10e',
    archivedAt: '2026-03-01T00:00:00.000Z'
  });
  probe.DomainModel.addStudentToState(state, gradedStudent);
  probe.DomainModel.addStudentToState(state, blankStudent);
  probe.DomainModel.addCourseToState(state, biology);
  probe.DomainModel.addCourseToState(state, mathematics);
  probe.DomainModel.addCourseToState(state, secondBiology);
  probe.DomainModel.addCourseToState(state, unnamed);
  probe.DomainModel.addCourseToState(state, archived);
  archived.archiveSnapshot = probe.DomainModel.createArchiveSnapshot(state, archived);
  probe.DomainModel.enrollStudentInCourse(state, biology.id, gradedStudent.id);
  probe.DomainModel.enrollStudentInCourse(state, biology.id, blankStudent.id);
  const assessment = probe.DomainModel.createAssessment({
    id: 'quick-assessment', courseId: biology.id,
    categoryId: state.settings.categories[0].id,
    title: 'Mündliche Mitarbeit', date: '2026-03-10', term: '2025-H2', weight: 1
  });
  assessment.scores[gradedStudent.id] = probe.DomainModel.createScoreEntry({ valueRaw: '2' });
  probe.DomainModel.addAssessmentToState(state, assessment);
  const app = await loadDashboardUi({ state, dateImpl: fixedDate });
  await app.UiShell.init('app');
  await openGradesheetAndWaitForResume(app, cardFor(app.root, biology.id));

  function scoreInput(studentId) {
    return app.root.querySelectorAll('.gradesheet-input').find(input =>
      input.dataset.gradesheetTerm === 'all' &&
      input.closest('tr') && input.closest('tr').dataset.student === studentId
    );
  }

  function headerCourseSelect() {
    return findByAttribute(app.root, 'id', 'current-course-select');
  }

  function selectCourse(courseId) {
    const select = headerCourseSelect();
    select.value = courseId;
    return select.dispatch('change');
  }

  return {
    app, biology, mathematics, secondBiology, unnamed, archived,
    gradedStudent, blankStudent, assessment, scoreInput, headerCourseSelect, selectCourse
  };
}

async function multiGradeGradesheetApp() {
  // Untimed assessments use the current renderer term; keep this fixture in
  // the spring 2026 scope that corresponds to the established 2025-H2 tests.
  const fixedDate = createFixedDate('2026-03-15T12:00:00.000Z');
  const probe = await loadDashboardUi({ dateImpl: fixedDate });
  const state = probe.DomainModel.createEmptyState();
  const student = probe.DomainModel.createStudent({ id: 'student-multi', lastName: 'Grace', firstName: 'Hopper' });
  const course = probe.DomainModel.createCourse({ id: 'grade-multi-course', name: 'Deutsch', subject: 'Deutsch', classLabel: '10b' });
  probe.DomainModel.addStudentToState(state, student);
  probe.DomainModel.addCourseToState(state, course);
  probe.DomainModel.enrollStudentInCourse(state, course.id, student.id);
  for (const [index, value] of ['2', '2'].entries()) {
    const assessment = probe.DomainModel.createAssessment({
      id: `grade-multi-assessment-${index + 1}`,
      courseId: course.id,
      categoryId: state.settings.categories[0].id,
      title: `Test ${index + 1}`,
      weight: 1
    });
    assessment.scores[student.id] = probe.DomainModel.createScoreEntry({ valueRaw: value });
    probe.DomainModel.addAssessmentToState(state, assessment);
  }
  const app = await loadDashboardUi({ state, dateImpl: fixedDate });
  await app.UiShell.init('app');
  await openGradesheetAndWaitForResume(app, cardFor(app.root, course.id));
  const inputs = app.root.querySelectorAll('.gradesheet-input').filter(input => input.dataset.gradesheetTerm === 'all');
  return { app, inputs };
}

async function multiTermResultGradesheetApp() {
  const fixedDate = createFixedDate('2026-09-20T12:00:00.000Z');
  const probe = await loadDashboardUi({ dateImpl: fixedDate });
  const state = probe.DomainModel.createEmptyState();
  const course = probe.DomainModel.createCourse({
    id: 'term-result-multi-course', name: 'Biologie', subject: 'Biologie', classLabel: 'Oberstufe',
    schemaMode: probe.DomainModel.SCHEMA_MODES.UPPERSEC,
    upperSecContext: { courseType: 'basic', qualificationYear: 'q1-q2' }
  });
  probe.DomainModel.addCourseToState(state, course);
  for (const [index, name] of ['Curie', 'Franklin'].entries()) {
    const student = probe.DomainModel.createStudent({ id: `term-student-${index + 1}`, lastName: name, firstName: 'Test' });
    probe.DomainModel.addStudentToState(state, student);
    probe.DomainModel.enrollStudentInCourse(state, course.id, student.id);
    probe.DomainModel.setTermResult(state, course.id, student.id, '2026-H1', 10);
  }
  const app = await loadDashboardUi({ state, dateImpl: fixedDate });
  await app.UiShell.init('app');
  await openGradesheetAndWaitForResume(app, cardFor(app.root, course.id));
  return { app, inputs: app.root.querySelectorAll('.gradesheet-term-result-input') };
}

async function splitTermScoreGradesheetApp({ schemaMode = 'grades', sparse = false } = {}) {
  const fixedDate = createFixedDate('2026-09-15T12:00:00.000Z');
  const probe = await loadDashboardUi({ dateImpl: fixedDate });
  const state = probe.DomainModel.createEmptyState();
  const isUpperSec = schemaMode === probe.DomainModel.SCHEMA_MODES.UPPERSEC;
  const course = probe.DomainModel.createCourse({
    id: isUpperSec ? 'term-score-uppersec' : 'term-score-grades',
    name: isUpperSec ? 'Physik Oberstufe' : 'Geschichte',
    subject: isUpperSec ? 'Physik' : 'Geschichte',
    classLabel: isUpperSec ? 'Oberstufe' : '9a',
    schemaMode,
    upperSecContext: isUpperSec ? { courseType: 'basic', qualificationYear: 'q1-q2' } : null
  });
  const student = probe.DomainModel.createStudent({
    id: isUpperSec ? 'term-score-student-uppersec' : 'term-score-student-grades',
    lastName: 'Noether',
    firstName: 'Emmy'
  });
  probe.DomainModel.addStudentToState(state, student);
  probe.DomainModel.addCourseToState(state, course);
  probe.DomainModel.enrollStudentInCourse(state, course.id, student.id);
  let blankStudent = null;
  if (sparse) {
    blankStudent = probe.DomainModel.createStudent({
      id: isUpperSec ? 'term-score-blank-uppersec' : 'term-score-blank-grades',
      lastName: 'Zuse',
      firstName: 'Konrad'
    });
    probe.DomainModel.addStudentToState(state, blankStudent);
    probe.DomainModel.enrollStudentInCourse(state, course.id, blankStudent.id);
  }
  const scoreValues = isUpperSec ? ['10', '8'] : ['2', '3'];
  const assessments = ['2026-H1', '2026-H2'].map((term, index) => {
    const assessment = probe.DomainModel.createAssessment({
      id: `${course.id}-${term}`,
      courseId: course.id,
      categoryId: state.settings.categories[0].id,
      title: `${term}-Test`,
      date: index === 0 ? '2026-09-15' : '2027-03-15',
      term,
      weight: 1
    });
    assessment.scores[student.id] = probe.DomainModel.createScoreEntry({ valueRaw: scoreValues[index] });
    probe.DomainModel.addAssessmentToState(state, assessment);
    return assessment;
  });
  const app = await loadDashboardUi({ state, dateImpl: fixedDate });
  await app.UiShell.init('app');
  await openGradesheetAndWaitForResume(app, cardFor(app.root, course.id));
  return { app, course, student, blankStudent, assessments };
}

async function combinedScoreGradesheetApp({ sparse = false } = {}) {
  const fixedDate = createFixedDate('2027-03-15T12:00:00.000Z');
  const probe = await loadDashboardUi({ dateImpl: fixedDate });
  const state = probe.DomainModel.createEmptyState();
  const course = probe.DomainModel.createCourse({
    id: 'combined-score-grades',
    name: 'Deutsch',
    subject: 'Deutsch',
    classLabel: '9b'
  });
  const student = probe.DomainModel.createStudent({
    id: 'combined-score-student',
    lastName: 'Noether',
    firstName: 'Emmy'
  });
  probe.DomainModel.addStudentToState(state, student);
  probe.DomainModel.addCourseToState(state, course);
  probe.DomainModel.enrollStudentInCourse(state, course.id, student.id);
  let blankStudent = null;
  if (sparse) {
    blankStudent = probe.DomainModel.createStudent({
      id: 'combined-score-blank',
      lastName: 'Zuse',
      firstName: 'Konrad'
    });
    probe.DomainModel.addStudentToState(state, blankStudent);
    probe.DomainModel.enrollStudentInCourse(state, course.id, blankStudent.id);
  }
  const assessment = probe.DomainModel.createAssessment({
    id: 'combined-score-2026-H2',
    courseId: course.id,
    categoryId: state.settings.categories[0].id,
    title: 'H2-Test',
    date: '2027-03-15',
    term: '2026-H2',
    weight: 1
  });
  assessment.scores[student.id] = probe.DomainModel.createScoreEntry({ valueRaw: '2' });
  probe.DomainModel.addAssessmentToState(state, assessment);
  const app = await loadDashboardUi({ state, dateImpl: fixedDate });
  await app.UiShell.init('app');
  await openGradesheetAndWaitForResume(app, cardFor(app.root, course.id));
  return { app, course, student, blankStudent, assessment };
}

function termScoreInput(app, term, studentId = null) {
  return app.root.querySelectorAll('.gradesheet-input').find(input =>
    input.dataset.gradesheetTerm === term &&
    (!studentId || (input.closest('tr') && input.closest('tr').dataset.student === studentId))
  );
}

function containingTermSection(element) {
  for (let current = element; current; current = current.parentNode) {
    if (current.classList && current.classList.contains('term-section')) return current;
  }
  return null;
}

function persistedTermScores(savedState, assessmentIds, studentId) {
  return assessmentIds.map(assessmentId =>
    savedState.assessments.find(assessment => assessment.id === assessmentId).scores[studentId].valueRaw
  );
}

function averageTextsForScoreInput(input) {
  return input.closest('tr').querySelectorAll('td.gradesheet-avg').map(cell => cell.textContent);
}

async function mixedTermsDashboardApp() {
  const fixedDate = createFixedDate('2027-02-10T12:00:00.000Z');
  const probe = await loadDashboardUi({ dateImpl: fixedDate });
  const state = probe.DomainModel.createEmptyState();
  const earlyCutoff = probe.DomainModel.createCourse({
    id: 'seki-early-cutoff', name: 'Geschichte', subject: 'Geschichte', classLabel: '9a',
    termCutoffs: { h2StartMonth: 1, h2StartDay: 1 }
  });
  const lateCutoff = probe.DomainModel.createCourse({
    id: 'seki-late-cutoff', name: 'Deutsch', subject: 'Deutsch', classLabel: '9b',
    termCutoffs: { h2StartMonth: 3, h2StartDay: 31 }
  });
  const sekII = probe.DomainModel.createCourse({
    id: 'sekii-context', name: 'Biologie', subject: 'Biologie', classLabel: 'Oberstufe',
    schemaMode: probe.DomainModel.SCHEMA_MODES.UPPERSEC,
    upperSecContext: { courseType: 'basic', qualificationYear: 'q1-q2' }
  });
  probe.DomainModel.addCourseToState(state, earlyCutoff);
  probe.DomainModel.addCourseToState(state, lateCutoff);
  probe.DomainModel.addCourseToState(state, sekII);
  const app = await loadDashboardUi({ state, dateImpl: fixedDate });
  await app.UiShell.init('app');
  return { app, before: JSON.stringify(await app.Storage.loadState()) };
}

function createFixedDate(isoInstant) {
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

function cardFor(root, id) {
  return findByAttribute(root, 'data-course-id', id);
}

function openButton(card) {
  return card._find(element => element.textContent === 'Noten öffnen');
}

function resumeCard(root) {
  return root._find(element => element.classList && element.classList.contains('dashboard-resume-card'));
}

function termFieldFor(card) {
  const details = card._find(element => element.tagName === 'DL');
  const index = details.children.findIndex(element => element.tagName === 'DT' && element.textContent === 'Halbjahr');
  return details.children[index + 1];
}

async function settleDashboardRequest() {
  await new Promise(resolve => setImmediate(resolve));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function assertDashboardHeadingFocused(app) {
  const heading = app.root.querySelector('h2');
  assert.equal(heading.textContent, 'Übersicht');
  assert.equal(heading.getAttribute('tabindex'), '-1');
  assert.equal(app.document.activeElement, heading,
    'der Rückweg zur Übersicht muss ihre Überschrift genau einmal fokussieren');
}

async function dispatchDocumentKey(app, key) {
  const listeners = app.documentListeners.get('keydown') || [];
  await Promise.all(listeners.map(listener => listener({ key, preventDefault() {} })));
}

async function dispatchDocumentFocus(app, target) {
  const listeners = app.documentListeners.get('focusin') || [];
  await Promise.all(listeners.map(listener => listener({ target })));
}

test('der Seitenrahmen markiert alle Routen und öffnet das mobile Menü ohne Neuaufbau', async () => {
  const app = await unlockedAppWithCourses();
  await app.UiShell.init('app');

  const frame = app.root._find(element => element.classList && element.classList.contains('app-frame'));
  const sidebar = app.root._find(element => element.tagName === 'ASIDE' && element.classList.contains('app-sidebar'));
  const toggle = findByText(app.root, 'Navigation öffnen');
  const nav = app.root._find(element => element.tagName === 'NAV' && element.id === 'main-navigation');
  assert.ok(frame && sidebar && toggle && nav, 'die Shell braucht Rahmen, Seitenleiste, Menüschalter und Hauptnavigation');
  assert.deepEqual(frame.children.map(element => element.tagName), ['HEADER', 'DIV', 'ASIDE', 'MAIN'],
    'im mobilen Lesefluss muss der Schalter vor der Navigation und diese vor dem Inhalt stehen');
  assert.ok(findByText(sidebar, 'NV'));
  assert.ok(findByText(sidebar, 'Notenverwaltung'));
  assert.ok(findByText(sidebar, 'Lokale Anwendung'));
  assert.equal(app.root._find(element => element.classList && element.classList.contains('app-header')).querySelector('h1'), null,
    'die kompakte Kopfleiste darf keinen großen Produkttitel mehr enthalten');
  assert.equal(findByText(nav, 'Übersicht').getAttribute('aria-current'), 'page');
  assert.equal(nav.querySelectorAll('button').map(button => button.textContent).join('|'),
    'Übersicht|Noten|Kurse|Stammdaten|Statistik|Einstellungen|Import / Export|Klausurnotenrechner');
  const navIcon = nav._find(element => element.tagName === 'SVG');
  assert.equal(navIcon.namespaceURI, 'http://www.w3.org/2000/svg',
    'die Navigation braucht browsergültige lokale SVG-Symbole');
  assert.equal(navIcon.getAttribute('class'), 'ui-icon',
    'SVG-Klassen müssen als Attribute gesetzt werden, damit echte SVGElemente sie behalten');
  assert.equal(navIcon.getAttribute('width'), '18');
  assert.equal(navIcon.getAttribute('height'), '18');

  await toggle.dispatch('click');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(nav.classList.contains('is-mobile-open'), true);
  assert.equal(app.root._find(element => element.tagName === 'NAV' && element.id === 'main-navigation'), nav,
    'der Menüschalter darf Editor und Navigation nicht neu aufbauen');

  await dispatchDocumentKey(app, 'Escape');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(nav.classList.contains('is-mobile-open'), false);
  assert.equal(app.document.activeElement, toggle);

  await findByText(nav, 'Kurse').dispatch('click');
  const active = app.root._find(element => element.getAttribute && element.getAttribute('aria-current') === 'page');
  assert.equal(active.textContent, 'Kurse');
  assert.equal(app.root.querySelector('h2').textContent, 'Kurse');
  assert.equal(app.document.activeElement, app.root.querySelector('h2'));
});

test('die echte Designleiste nutzt Segmentbuttons, getrennte Farbfelder und Bewegung ohne alte Doppelsteuerung', async () => {
  const app = await unlockedAppWithCourses();
  await app.UiShell.init('app');

  const designbar = app.root._find(element => element.classList && element.classList.contains('design-bar'));
  const families = designbar._findAll(element => element.getAttribute && element.getAttribute('data-family-choice'));
  assert.deepEqual(families.map(button => button.textContent), ['Klassisch', 'Modern ruhig', 'Aurora']);
  assert.equal(families[0].getAttribute('aria-pressed'), 'true');
  assert.equal(findByAttribute(designbar, 'id', 'appearance-mode').value, 'light');
  assert.equal(findByAttribute(designbar, 'id', 'appearance-motion').value, 'vivid');
  assert.equal(designbar._findAll(element => element.getAttribute && element.getAttribute('role') === 'radio').length, 12);
  assert.ok(findByText(designbar, 'Farben & Bewegung'));
  assert.ok(findByText(designbar, 'Effekte testen'));
  assert.equal(app.root._findAll(element => element.classList && element.classList.contains('appearance-controls')).length, 0);

  const resetDisclosure = app.root._find(element => element.classList && element.classList.contains('secondary-actions'));
  assert.ok(resetDisclosure, 'Zurücksetzen muss aus der primären Kopfzeile herausgenommen sein');
  assert.ok(findByText(resetDisclosure, 'Datenbestand zurücksetzen'));
  assert.ok(findByText(resetDisclosure, 'Alles zurücksetzen, Achtung!'));
});

test('Farbradios wählen per Pfeil sowie Home und Ende mit genau einem Tabstopp je Gruppe', async () => {
  const app = await unlockedAppWithCourses();
  await app.UiShell.init('app');

  const card = findByAttribute(app.root, 'data-course-id', 'bio-10a');
  const info = card._find(element => element.getAttribute && element.getAttribute('data-role') === 'info');
  await info.dispatch('click');
  const accents = app.root._findAll(element => element.getAttribute && element.getAttribute('data-accent-choice'));
  const backgrounds = app.root._findAll(element => element.getAttribute && element.getAttribute('data-background-choice'));
  const assertSingleTabstop = (buttons, selected) => {
    assert.deepEqual(buttons.map(button => button.getAttribute('tabindex')), buttons.map(button => button === selected ? '0' : '-1'));
    assert.equal(selected.getAttribute('aria-checked'), 'true');
  };

  assertSingleTabstop(accents, accents[0]);
  assertSingleTabstop(backgrounds, backgrounds[0]);

  await accents[0].dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(app.document.activeElement, accents[1]);
  assertSingleTabstop(accents, accents[1]);
  await accents[1].dispatch('keydown', { key: 'ArrowLeft' });
  assert.equal(app.document.activeElement, accents[0]);
  await accents[0].dispatch('keydown', { key: 'ArrowLeft' });
  assert.equal(app.document.activeElement, accents[5], 'Pfeil links muss am Anfang zum letzten Akzent springen');
  await accents[5].dispatch('keydown', { key: 'Home' });
  assert.equal(app.document.activeElement, accents[0]);
  assertSingleTabstop(accents, accents[0]);

  await backgrounds[0].dispatch('keydown', { key: 'End' });
  assert.equal(app.document.activeElement, backgrounds[5]);
  assertSingleTabstop(backgrounds, backgrounds[5]);
  await backgrounds[5].dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(app.document.activeElement, backgrounds[0], 'Pfeil abwärts muss am Ende zum ersten Hintergrund springen');
  await backgrounds[0].dispatch('keydown', { key: 'ArrowUp' });
  assert.equal(app.document.activeElement, backgrounds[5], 'Pfeil aufwärts muss am Anfang zum letzten Hintergrund springen');
  await backgrounds[5].dispatch('keydown', { key: 'Home' });
  assert.equal(app.document.activeElement, backgrounds[0]);
  assertSingleTabstop(backgrounds, backgrounds[0]);

  assert.equal(app.document.body.getAttribute('data-accent'), 'standard');
  assert.equal(app.document.body.getAttribute('data-background'), 'standard');
  assert.deepEqual(JSON.parse(app.storage.getItem('notenverwaltung_appearance')), {
    family: 'classic', appearance: 'light', accent: 'standard', background: 'standard', motion: 'vivid'
  });
  assert.equal(findByAttribute(app.root, 'data-course-id', 'bio-10a'), card,
    'Tastaturwahl darf die montierte Kurskarte nicht ersetzen');
  assert.equal(info.getAttribute('aria-expanded'), 'true', 'angeheftete Kursinfo muss bei Tastaturwahl offen bleiben');
});

test('Bewegungswahl bleibt gespeichert, wird bei Systemreduktion effektiv ausgeschaltet und räumt aktive Effekte sofort auf', async () => {
  const reducedListeners = [];
  const reduced = { matches: false, addEventListener(type, listener) { if (type === 'change') reducedListeners.push(listener); } };
  const app = await unlockedAppWithCourses();
  const loaded = await loadDashboardUi({ state: await app.Storage.loadState(), reducedMotionMediaQueryList: reduced });
  await loaded.UiShell.init('app');
  const family = findByAttribute(loaded.root, 'data-family-choice', 'modern');
  await family.dispatch('click');
  const motion = findByAttribute(loaded.root, 'id', 'appearance-motion');
  motion.value = 'calm';
  await motion.dispatch('change');
  const sample = findByText(loaded.root, 'Effekte testen');
  await sample.dispatch('click');
  assert.equal(sample.classList.contains('motion-demo'), true);
  const cardInfo = findByAttribute(loaded.root, 'data-course-id', 'bio-10a')
    ._find(element => element.getAttribute && element.getAttribute('data-role') === 'info');
  assert.equal(cardInfo.getAttribute('aria-expanded'), 'true', 'die sichtbare Effektprobe muss auch eine echte Kurskarte demonstrieren');
  assert.equal(loaded.document.body.getAttribute('data-effective-motion'), 'calm');

  reduced.matches = true;
  reducedListeners.forEach(listener => listener({ matches: true }));
  assert.equal(loaded.document.body.getAttribute('data-effective-motion'), 'off');
  assert.equal(sample.classList.contains('motion-demo'), false);
  assert.equal(cardInfo.getAttribute('aria-expanded'), 'false');
  assert.equal(motion.value, 'calm', 'die gewünschte Stufe bleibt trotz Systemvorgabe erhalten');
  assert.match(findByText(loaded.root, 'Die Systemeinstellung reduziert Bewegung; Effekte bleiben ausgeschaltet.').textContent, /Systemeinstellung/);
  assert.equal(JSON.parse(loaded.storage.getItem('notenverwaltung_appearance')).motion, 'calm');

  reduced.matches = false;
  reducedListeners.forEach(listener => listener({ matches: false }));
  assert.equal(loaded.document.body.getAttribute('data-effective-motion'), 'calm');
});

test('Aurora startet einen endlichen Lichtpass nur beim echten Eintritt sowie per Tastaturfokus', async () => {
  const app = await unlockedAppWithAppearance();
  await app.UiShell.init('app');
  const scheduled = [];
  app.sandbox.setTimeout = (callback, delay) => {
    scheduled.push({ callback, delay });
    return scheduled.length;
  };

  const backupButton = findByText(app.root, 'Backup');
  const backupLabel = backupButton.children[1];
  const backupIcon = backupButton.children[0];
  await app.root.dispatch('pointerover', { target: backupIcon, relatedTarget: null });
  assert.equal(backupButton.classList.contains('aurora-effect-run'), true);
  assert.equal(scheduled.length, 1, 'der erste Eintritt muss genau eine endliche Aufraeumung planen');

  await app.root.dispatch('pointerover', { target: backupLabel, relatedTarget: backupIcon });
  await app.root.dispatch('pointerover', { target: backupButton, relatedTarget: null });
  assert.equal(scheduled.length, 1, 'Kindwechsel und erneuter Eintritt waehrend des Laufs duerfen nicht neu starten');

  const navButton = findByText(app.root, 'Kurse');
  await app.root.dispatch('focusin', { target: navButton });
  assert.equal(navButton.classList.contains('aurora-effect-run'), true, 'Tastaturfokus braucht denselben sichtbaren Hinweis');
  const designSummary = findByText(app.root, 'Farben & Bewegung');
  await app.root.dispatch('focusin', { target: designSummary });
  assert.equal(designSummary.classList.contains('aurora-effect-run'), true, 'bedienbare Aufklappzeilen muessen per Fokus reagieren');

  const card = findByAttribute(app.root, 'data-course-id', 'bio-10a');
  const face = findByAttribute(card, 'data-role', 'front');
  const faceText = face._find(element => element.tagName === 'H3');
  await app.root.dispatch('pointerover', { target: faceText, relatedTarget: null });
  assert.equal(card.classList.contains('aurora-effect-run'), true, 'die stabile Karte muss den Lichtpass durch den Flaechenwechsel tragen');
  assert.equal(face.classList.contains('aurora-effect-run'), false, 'die beim Flip ausgeblendete Front darf nicht der Effekttraeger sein');

  await openGradesheetAndWaitForResume(app, card);
  await findByText(app.root, 'Übersicht').dispatch('click');
  const resumeCard = app.root._find(element => element.classList && element.classList.contains('dashboard-resume-card'));
  const resumeText = resumeCard._find(element => element.classList && element.classList.contains('dashboard-resume-meta'));
  await app.root.dispatch('pointerover', { target: resumeText, relatedTarget: null });
  assert.equal(resumeCard.classList.contains('aurora-effect-run'), true, 'die freie Flaeche der Fortsetzen-Karte muss reagieren');
  const resumeButton = findByText(resumeCard, 'Fortsetzen');
  await app.root.dispatch('pointerover', { target: resumeButton, relatedTarget: resumeText });
  assert.equal(resumeButton.classList.contains('aurora-effect-run'), false, 'ein laufender Kartenpass darf im enthaltenen Button keinen zweiten Pass stapeln');
});

test('Aurora stapelt nach einem Buttonfokus keinen zweiten Lichtpass auf dessen Karte', async () => {
  const app = await unlockedAppWithAppearance();
  await app.UiShell.init('app');
  const card = findByAttribute(app.root, 'data-course-id', 'bio-10a');
  await openGradesheetAndWaitForResume(app, card);
  await findByText(app.root, 'Übersicht').dispatch('click');
  const resumeCard = app.root._find(element => element.classList && element.classList.contains('dashboard-resume-card'));
  const resumeText = resumeCard._find(element => element.classList && element.classList.contains('dashboard-resume-meta'));
  const resumeButton = findByText(resumeCard, 'Fortsetzen');

  await app.root.dispatch('focusin', { target: resumeButton });
  await app.root.dispatch('pointerover', { target: resumeText, relatedTarget: null });
  assert.equal(resumeButton.classList.contains('aurora-effect-run'), true, 'der zuerst gestartete Buttonpass muss aktiv bleiben');
  assert.equal(resumeCard.classList.contains('aurora-effect-run'), false, 'ein laufender Buttonpass muss den spaeteren Kartenpass ebenfalls unterdruecken');
});

test('Aurora-Kartenlicht bleibt beim echten Mouse-Hover über den automatischen Flip erhalten', async () => {
  const app = await unlockedAppWithAppearance();
  const scheduled = [];
  app.sandbox.setTimeout = (callback, delay) => {
    scheduled.push({ callback, delay });
    return scheduled.length;
  };
  await app.UiShell.init('app');

  const card = findByAttribute(app.root, 'data-course-id', 'bio-10a');
  const face = findByAttribute(card, 'data-role', 'front');
  const faceText = face._find(element => element.tagName === 'H3');
  await app.root.dispatch('pointerover', { target: faceText, relatedTarget: null });
  await card.dispatch('pointerenter', { pointerType: 'mouse' });

  const hoverTimer = scheduled.find(timer => timer.delay === 140);
  assert.ok(hoverTimer, 'Aurora Vivid muss den bestehenden 140-ms-Kartenhover verwenden');
  hoverTimer.callback();
  assert.equal(card.classList.contains('is-open'), true, 'der echte Kartenhover muss die Rueckseite oeffnen');
  assert.equal(card.classList.contains('aurora-effect-run'), true, 'der Lichtpass muss auf dem stabil sichtbaren Kartentraeger weiterlaufen');
  assert.equal(face.classList.contains('aurora-effect-run'), false);
});

test('Aurora schließt ruhige Modi, Systemreduktion, Eingaben und Gefahrenaktionen vom Lichtpass aus', async () => {
  const reduced = { matches: true, addEventListener() {}, removeEventListener() {} };
  const reducedApp = await unlockedAppWithAppearance({}, { reducedMotionMediaQueryList: reduced });
  await reducedApp.UiShell.init('app');
  const reducedButton = findByText(reducedApp.root, 'Backup');
  await reducedApp.root.dispatch('pointerover', { target: reducedButton, relatedTarget: null });
  assert.equal(reducedButton.classList.contains('aurora-effect-run'), false);

  const offApp = await unlockedAppWithAppearance({ motion: 'off' });
  await offApp.UiShell.init('app');
  const offButton = findByText(offApp.root, 'Backup');
  await offApp.root.dispatch('focusin', { target: offButton });
  assert.equal(offButton.classList.contains('aurora-effect-run'), false);

  const classicApp = await unlockedAppWithAppearance({ family: 'classic' });
  await classicApp.UiShell.init('app');
  const classicButton = findByText(classicApp.root, 'Backup');
  await classicApp.root.dispatch('pointerover', { target: classicButton, relatedTarget: null });
  assert.equal(classicButton.classList.contains('aurora-effect-run'), false);

  const auroraApp = await unlockedAppWithAppearance();
  await auroraApp.UiShell.init('app');
  const danger = findByText(auroraApp.root, 'Alles zurücksetzen, Achtung!');
  const dangerSummary = findByText(auroraApp.root, 'Datenbestand zurücksetzen');
  const input = findByAttribute(auroraApp.root, 'id', 'appearance-mode');
  const disabled = findByText(auroraApp.root, 'Backup');
  const ariaDisabled = findByText(auroraApp.root, 'Kurse');
  disabled.disabled = true;
  ariaDisabled.setAttribute('aria-disabled', 'true');
  await auroraApp.root.dispatch('pointerover', { target: danger, relatedTarget: null });
  await auroraApp.root.dispatch('focusin', { target: dangerSummary });
  await auroraApp.root.dispatch('pointerover', { target: input, relatedTarget: null });
  await auroraApp.root.dispatch('pointerover', { target: disabled, relatedTarget: null });
  await auroraApp.root.dispatch('focusin', { target: ariaDisabled });
  assert.equal(danger.classList.contains('aurora-effect-run'), false);
  assert.equal(dangerSummary.classList.contains('aurora-effect-run'), false);
  assert.equal(input.classList.contains('aurora-effect-run'), false);
  assert.equal(disabled.classList.contains('aurora-effect-run'), false);
  assert.equal(ariaDisabled.classList.contains('aurora-effect-run'), false);
});

test('Aurora schließt Tabellenzellen sowie verschachtelte Eingabe- und Bearbeitungsinhalte aus', async () => {
  const { app, input } = await gradesheetApp({ appearance: { family: 'aurora', motion: 'vivid' } });
  const rowStatus = app.root._find(element => element.tagName === 'SUMMARY' &&
    element.parentNode && element.parentNode.classList.contains('gradesheet-row-status'));
  assert.ok(rowStatus && rowStatus.closest('table'), 'der Test braucht den echten zeilenbezogenen Statusschalter');
  assert.ok(input && input.closest('table'), 'der Test braucht das echte Notenfeld in der Tabelle');
  await app.root.dispatch('pointerover', { target: rowStatus, relatedTarget: null });
  await app.root.dispatch('focusin', { target: rowStatus });
  await app.root.dispatch('pointerover', { target: input, relatedTarget: null });
  await app.root.dispatch('focusin', { target: input });
  const rowStatusRan = rowStatus.classList.contains('aurora-effect-run');
  const cellInputRan = input.classList.contains('aurora-effect-run');

  const assessmentEdit = app.root._find(element => element.tagName === 'BUTTON' &&
    element.classList.contains('gradesheet-assessment-action') && !element.classList.contains('danger'));
  assert.ok(assessmentEdit && !assessmentEdit.closest('table'), 'die zentrale Leistungsverwaltung muss außerhalb der Notentabelle liegen');
  await app.root.dispatch('pointerover', { target: assessmentEdit, relatedTarget: null });
  await app.root.dispatch('focusin', { target: assessmentEdit });
  const managementActionRan = assessmentEdit.classList.contains('aurora-effect-run');

  const backupButton = findByText(app.root, 'Backup');
  const nestedInput = app.document.createElement('input');
  backupButton.appendChild(nestedInput);
  await app.root.dispatch('pointerover', { target: nestedInput, relatedTarget: null });
  await app.root.dispatch('focusin', { target: nestedInput });
  const nestedInputRan = backupButton.classList.contains('aurora-effect-run');
  backupButton.classList.remove('aurora-effect-run');

  const editable = app.document.createElement('span');
  editable.setAttribute('contenteditable', 'true');
  backupButton.appendChild(editable);
  await app.root.dispatch('pointerover', { target: editable, relatedTarget: null });
  await app.root.dispatch('focusin', { target: editable });
  const editableContentRan = backupButton.classList.contains('aurora-effect-run');

  assert.deepEqual({ rowStatusRan, cellInputRan, managementActionRan, nestedInputRan, editableContentRan }, {
    rowStatusRan: false,
    cellInputRan: false,
    managementActionRan: true,
    nestedInputRan: false,
    editableContentRan: false
  }, 'Tabelleninhalte und editierbare Inhalte sperren den Lichtpass; die eigenständige zentrale Aktion bleibt interaktiv');
});

test('Aurora räumt den Lichtpass bei Darstellungswechsel, Neuaufbau und Sperre ohne spätes Wiedererscheinen auf', async () => {
  const app = await unlockedAppWithAppearance();
  await app.UiShell.init('app');
  const pending = new Map();
  let timerId = 0;
  app.sandbox.setTimeout = callback => {
    timerId += 1;
    pending.set(timerId, callback);
    return timerId;
  };
  app.sandbox.clearTimeout = id => pending.delete(id);

  let backupButton = findByText(app.root, 'Backup');
  await app.root.dispatch('pointerover', { target: backupButton, relatedTarget: null });
  assert.equal(backupButton.classList.contains('aurora-effect-run'), true);
  await findByAttribute(app.root, 'data-family-choice', 'modern').dispatch('click');
  assert.equal(backupButton.classList.contains('aurora-effect-run'), false);
  assert.equal(pending.size, 0);

  await findByAttribute(app.root, 'data-family-choice', 'aurora').dispatch('click');
  backupButton = findByText(app.root, 'Backup');
  await app.root.dispatch('pointerover', { target: backupButton, relatedTarget: null });
  await findByText(app.root, 'Kurse').dispatch('click');
  assert.equal(backupButton.classList.contains('aurora-effect-run'), false, 'Render muss auch den abgeloesten Knoten bereinigen');
  assert.equal(pending.size, 0);

  backupButton = findByText(app.root, 'Backup');
  await app.root.dispatch('pointerover', { target: backupButton, relatedTarget: null });
  const lockButton = findByText(app.root, 'Sperren');
  await lockButton.dispatch('click');
  assert.equal(backupButton.classList.contains('aurora-effect-run'), false);
  assert.equal(pending.size, 0);
  await app.root.dispatch('pointerover', { target: backupButton, relatedTarget: null });
  assert.equal(backupButton.classList.contains('aurora-effect-run'), false, 'nach der Sperre darf ein altes Ereignis keinen Effekt nachreichen');
});

test('wiederholte Initialisierung ersetzt den Reduced-Motion-Listener und nur die aktive UI reagiert', async () => {
  const reducedListeners = new Set();
  let removedListeners = 0;
  const reduced = {
    matches: false,
    addEventListener(type, listener) { if (type === 'change') reducedListeners.add(listener); },
    removeEventListener(type, listener) {
      if (type === 'change' && reducedListeners.delete(listener)) removedListeners += 1;
    }
  };
  const loaded = await loadDashboardUi({ reducedMotionMediaQueryList: reduced });
  await loaded.UiShell.init('app');
  const firstListener = [...reducedListeners][0];
  assert.equal(reducedListeners.size, 1);

  await loaded.UiShell.init('app');

  assert.equal(removedListeners, 1, 'der Listener der vorherigen UI muss beim Ersetzen entfernt werden');
  assert.equal(reducedListeners.size, 1, 'es darf nur eine aktive Reduced-Motion-Bindung geben');
  assert.equal(reducedListeners.has(firstListener), false);

  const originalQuerySelectorAll = loaded.document.querySelectorAll;
  let effectCleanupCalls = 0;
  loaded.document.querySelectorAll = selector => {
    if (selector === '.motion-demo, .motion-tile-run, .aurora-effect-run, .aurora-ambient-run') effectCleanupCalls += 1;
    return originalQuerySelectorAll.call(loaded.document, selector);
  };
  reduced.matches = true;
  reducedListeners.forEach(listener => listener({ matches: true }));

  assert.equal(effectCleanupCalls, 1, 'ein OS-Wechsel darf nur die aktive UI-Bindung auslösen');
  assert.equal(loaded.document.body.getAttribute('data-effective-motion'), 'off');
});

test('fehlgeschlagene Reinitialisierung erhält den Listener der letzten erfolgreich gerenderten UI', async () => {
  const reducedListeners = new Set();
  let removedListeners = 0;
  const reduced = {
    matches: false,
    addEventListener(type, listener) { if (type === 'change') reducedListeners.add(listener); },
    removeEventListener(type, listener) {
      if (type === 'change' && reducedListeners.delete(listener)) removedListeners += 1;
    }
  };
  const loaded = await loadDashboardUi({ reducedMotionMediaQueryList: reduced });
  loaded.storage.setItem('notenverwaltung_appearance', JSON.stringify({
    family: 'modern', appearance: 'light', accent: 'standard', background: 'standard', motion: 'calm'
  }));
  await loaded.UiShell.init('app');
  const successfulListener = [...reducedListeners][0];

  loaded.storage.setItem('notenverwaltung_appearance', JSON.stringify({
    family: 'aurora', appearance: 'dark', accent: 'standard', background: 'standard', motion: 'vivid'
  }));
  const originalSetAttribute = loaded.document.body.setAttribute;
  loaded.document.body.setAttribute = function (name, value) {
    if (name === 'data-effective-motion') throw new Error('synthetischer Reinitialisierungsfehler');
    return originalSetAttribute.call(this, name, value);
  };
  try {
    await assert.rejects(loaded.UiShell.init('app'), /synthetischer Reinitialisierungsfehler/);
  } finally {
    loaded.document.body.setAttribute = originalSetAttribute;
  }

  assert.equal(removedListeners, 0, 'ein fehlgeschlagener Start darf den Listener der funktionsfähigen UI nicht entfernen');
  assert.equal(reducedListeners.size, 1);
  assert.equal(reducedListeners.has(successfulListener), true);
  loaded.document.body.setAttribute('data-design-family', 'sentinel');
  reduced.matches = true;
  reducedListeners.forEach(listener => listener({ matches: true }));
  assert.equal(loaded.document.body.getAttribute('data-design-family'), 'modern',
    'das OS-Ereignis muss weiterhin die Einstellungen der letzten erfolgreichen UI anwenden');
});

test('die erneute Auswahl einer aktiven Menüroute fokussiert ihre sichtbare Überschrift', async () => {
  const app = await unlockedAppWithCourses();
  await app.UiShell.init('app');

  let toggle = findByText(app.root, 'Navigation öffnen');
  let nav = app.root._find(element => element.tagName === 'NAV' && element.id === 'main-navigation');
  await toggle.dispatch('click');
  await findByText(nav, 'Übersicht').dispatch('click');
  assertDashboardHeadingFocused(app);
  assert.equal(findByText(app.root, 'Navigation öffnen').getAttribute('aria-expanded'), 'false');

  nav = app.root._find(element => element.tagName === 'NAV' && element.id === 'main-navigation');
  await findByText(nav, 'Kurse').dispatch('click');
  toggle = findByText(app.root, 'Navigation öffnen');
  nav = app.root._find(element => element.tagName === 'NAV' && element.id === 'main-navigation');
  await toggle.dispatch('click');
  await findByText(nav, 'Kurse').dispatch('click');
  const heading = app.root.querySelector('h2');
  assert.equal(heading.textContent, 'Kurse');
  assert.equal(heading.getAttribute('tabindex'), '-1');
  assert.equal(app.document.activeElement, heading,
    'auch eine weitere bereits aktive Route muss nach dem Menü-Neuaufbau ihre Überschrift fokussieren');
  assert.equal(findByText(app.root, 'Navigation öffnen').getAttribute('aria-expanded'), 'false');
});

test('das mobile Menü lässt echte sparse Editorwerte und den Navigationsguard unverändert', async () => {
  const { app, course, student, blankStudent } = await splitTermScoreGradesheetApp({
    schemaMode: 'uppersec', sparse: true
  });
  const validZero = termScoreInput(app, '2026-H1', student.id);
  const deliberatelyCleared = termScoreInput(app, '2026-H2', student.id);
  const untouchedBlank = termScoreInput(app, '2026-H1', blankStudent.id);
  const toggle = findByText(app.root, 'Navigation öffnen');
  const nav = app.root._find(element => element.tagName === 'NAV' && element.id === 'main-navigation');
  assert.ok(validZero && deliberatelyCleared && untouchedBlank);

  deliberatelyCleared.value = '';
  await deliberatelyCleared.dispatch('change');
  await toggle.dispatch('click');
  await toggle.dispatch('click');
  assert.equal(validZero.value, '10');
  assert.equal(deliberatelyCleared.value, '');
  assert.equal(untouchedBlank.value, '');
  assert.equal(termScoreInput(app, '2026-H1', blankStudent.id), untouchedBlank,
    'reines Menüöffnen darf keine Editor-Knoten ersetzen');

  validZero.value = '99';
  await validZero.dispatch('change');
  await toggle.dispatch('click');
  await findByText(nav, 'Übersicht').dispatch('click');
  await settleDashboardRequest();
  assert.equal(app.document.activeElement, validZero);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true', 'ein blockierter Wechsel darf das Menü nicht als Erfolg schließen');

  validZero.value = '0';
  await validZero.dispatch('change');
  await findByText(nav, 'Übersicht').dispatch('click');
  await settleDashboardRequest();
  assertDashboardHeadingFocused(app);
  await openButton(cardFor(app.root, course.id)).dispatch('click');
  assert.equal(termScoreInput(app, '2026-H1', student.id).value, '0');
  assert.equal(termScoreInput(app, '2026-H2', student.id).value, '');
  assert.equal(termScoreInput(app, '2026-H1', blankStudent.id).value, '');
});

test('jeder Menüweg aus der Noteneingabe wartet echte ungültige und gültige Entwürfe ab', async () => {
  const destinations = [
    'Noten', 'Kurse', 'Stammdaten', 'Statistik', 'Einstellungen', 'Import / Export', 'Klausurnotenrechner'
  ];
  const { app, input } = await gradesheetApp();
  const toggle = findByText(app.root, 'Navigation öffnen');
  const nav = app.root._find(element => element.tagName === 'NAV' && element.id === 'main-navigation');
  input.value = '99';
  await input.dispatch('change');
  await toggle.dispatch('click');

  for (const label of destinations) {
    await findByText(nav, label).dispatch('click');
    await settleDashboardRequest();
    assert.equal(app.root.querySelector('h2').textContent, 'Noteneingabe', `${label} darf einen ungültigen Entwurf nicht verwerfen`);
    assert.equal(app.document.activeElement, input, `${label} muss den ungültigen echten Editor fokussieren`);
  }

  input.value = '3';
  await input.dispatch('change');
  await findByText(nav, 'Kurse').dispatch('click');
  await settleDashboardRequest();
  assert.equal(app.root.querySelector('h2').textContent, 'Kurse');
});

test('die Noteneingabe verbindet den direkten Leistungszugang mit der verbleibenden Kursnavigation', async () => {
  const fixture = await quickCourseSwitchGradesheetApp();
  const select = fixture.headerCourseSelect();
  const directCreate = findByText(fixture.app.root, 'Neue Leistung anlegen');

  assert.equal(directCreate.tagName, 'BUTTON');
  assert.equal(directCreate.type, 'button');
  assert.equal(directCreate.getAttribute('aria-controls'), 'gradesheet-new-assessment');
  assert.equal(select.children.find(option => option.selected).value, fixture.biology.id);
  assert.deepEqual(select.children.map(option => option.value), [
    fixture.biology.id, fixture.mathematics.id, fixture.secondBiology.id, fixture.unnamed.id
  ]);
  assert.deepEqual(select.children.map(option => option.textContent), [
    'Biologie · 10c', 'Mathematik · 10c', 'Biologie · 10d', 'Unbenannter Kurs · Klasse nicht angegeben'
  ]);
  assert.equal(select.children.some(option => option.value === fixture.archived.id), false);
});

test('die Kopfauswahl verbindet ihre sichtbare Beschriftung stabil mit dem nativen Select', async () => {
  const app = await unlockedAppWithCourses();
  await app.UiShell.init('app');
  const wrapper = app.root._find(element => element.classList &&
    element.classList.contains('course-select-wrapper'));
  const label = wrapper._find(element => element.tagName === 'LABEL');
  const select = wrapper._find(element => element.tagName === 'SELECT');

  assert.equal(label.textContent, 'Aktueller Kurs');
  assert.equal(select.id, 'current-course-select');
  assert.equal(label.getAttribute('for'), select.id);
  assert.equal(select.children[0].textContent, 'Biologie · 10a');
  assert.equal(select.children[1].textContent, 'Biologie · 10b');
});

test('die verbleibende Kopfauswahl verwirft weder einen ungültigen Entwurf noch sparse Leerwerte', async () => {
  const fixture = await quickCourseSwitchGradesheetApp();
  const invalid = fixture.scoreInput(fixture.gradedStudent.id);
  const untouchedBlank = fixture.scoreInput(fixture.blankStudent.id);
  invalid.value = '99';
  await invalid.dispatch('change');

  await fixture.selectCourse(fixture.mathematics.id);
  await settleDashboardRequest();

  assert.match(fixture.app.root._find(element => element.classList &&
    element.classList.contains('gradesheet-course-identity')).textContent, /Biologie/);
  assert.equal(fixture.app.document.activeElement, invalid);
  assert.equal(invalid.value, '99');
  assert.equal(untouchedBlank.value, '');
  assert.equal(fixture.headerCourseSelect().value, fixture.biology.id);
  const storedAfterBlock = await fixture.app.Storage.loadState();
  const assessmentAfterBlock = storedAfterBlock.assessments.find(item => item.id === fixture.assessment.id);
  assert.equal(assessmentAfterBlock.scores[fixture.gradedStudent.id].valueRaw, '2');
  assert.equal(assessmentAfterBlock.scores[fixture.blankStudent.id], undefined);

  const headerCourseSelect = fixture.app.root._find(element =>
    element.tagName === 'SELECT' && element.children.some(option => option.value === fixture.mathematics.id)
  );
  headerCourseSelect.value = fixture.mathematics.id;
  await headerCourseSelect.dispatch('change');
  await settleDashboardRequest();
  assert.equal(headerCourseSelect.value, fixture.biology.id,
    'auch die Kopfauswahl muss nach einem blockierten Kurswechsel den sichtbaren Kurs zeigen');
  assert.match(fixture.app.root._find(element => element.classList &&
    element.classList.contains('gradesheet-course-identity')).textContent, /Biologie/);

  invalid.value = '3';
  await invalid.dispatch('change');
  await fixture.selectCourse(fixture.mathematics.id);
  await settleDashboardRequest();
  assert.match(fixture.app.root._find(element => element.classList &&
    element.classList.contains('gradesheet-course-identity')).textContent, /Mathematik/);
  const storedAfterSwitch = await fixture.app.Storage.loadState();
  const assessmentAfterSwitch = storedAfterSwitch.assessments.find(item => item.id === fixture.assessment.id);
  assert.equal(assessmentAfterSwitch.scores[fixture.gradedStudent.id].valueRaw, '3');
  assert.equal(assessmentAfterSwitch.scores[fixture.blankStudent.id], undefined);
});

test('die verbleibende Kopfauswahl wartet einen laufenden echten Notenspeicher ab', async () => {
  const fixture = await quickCourseSwitchGradesheetApp();
  const save = deferred();
  let saveCalls = 0;
  fixture.app.Storage.saveState = () => { saveCalls += 1; return save.promise; };
  const input = fixture.scoreInput(fixture.gradedStudent.id);
  input.value = '3';
  const change = input.dispatch('change');
  await settleDashboardRequest();

  const switchCourse = fixture.selectCourse(fixture.mathematics.id);
  await settleDashboardRequest();

  assert.equal(saveCalls, 1);
  assert.match(fixture.app.root._find(element => element.classList &&
    element.classList.contains('gradesheet-course-identity')).textContent, /Biologie/);
  save.resolve();
  await change;
  await switchCourse;
  await settleDashboardRequest();
  assert.match(fixture.app.root._find(element => element.classList &&
    element.classList.contains('gradesheet-course-identity')).textContent, /Mathematik/);
});

test('ein Menüweg prüft einen während des Speicherns veränderten Entwurf erneut und die Sperre gewinnt', async () => {
  const { app, input } = await gradesheetApp();
  const first = deferred();
  const second = deferred();
  let saves = 0;
  app.Storage.saveState = () => {
    saves += 1;
    return saves === 1 ? first.promise : second.promise;
  };
  const toggle = findByText(app.root, 'Navigation öffnen');
  const nav = app.root._find(element => element.tagName === 'NAV' && element.id === 'main-navigation');

  input.value = '3';
  const firstChange = input.dispatch('change');
  await settleDashboardRequest();
  await toggle.dispatch('click');
  await findByText(nav, 'Kurse').dispatch('click');
  input.value = '99';
  first.resolve();
  await firstChange;
  await settleDashboardRequest();
  assert.equal(app.root.querySelector('h2').textContent, 'Noteneingabe');
  assert.equal(app.document.activeElement, input);

  input.value = '3';
  const secondChange = input.dispatch('change');
  await settleDashboardRequest();
  await findByText(nav, 'Kurse').dispatch('click');
  app.Storage.lockSession();
  second.resolve();
  await secondChange;
  await settleDashboardRequest();
  assert.ok(findByText(app.root, 'Anwendung gesperrt'));
});

test('eine stale Menüanfrage löscht nach einem Neuaufbau nicht das Ziel einer neuen Anfrage', async () => {
  const { app, input } = await gradesheetApp();
  const first = deferred();
  const second = deferred();
  let saves = 0;
  app.Storage.saveState = () => {
    saves += 1;
    return saves === 1 ? first.promise : second.promise;
  };
  input.value = '3';
  const firstChange = input.dispatch('change');
  await settleDashboardRequest();
  await findByText(app.root, 'Kurse').dispatch('click');

  const courseSelect = app.root._find(element => element.classList && element.classList.contains('course-select-wrapper'))
    ._find(element => element.tagName === 'SELECT');
  courseSelect.value = 'grade-course';
  await courseSelect.dispatch('change');
  const rebuiltInput = app.root._find(element => element.classList && element.classList.contains('gradesheet-input'));
  assert.ok(rebuiltInput, app.root.textContent);
  rebuiltInput.value = '4';
  const secondChange = rebuiltInput.dispatch('change');
  await settleDashboardRequest();
  await findByText(app.root, 'Statistik').dispatch('click');

  first.resolve();
  await firstChange;
  await settleDashboardRequest();
  second.resolve();
  await secondChange;
  await settleDashboardRequest();
  assert.equal(app.root.querySelector('h2').textContent, 'Statistik');
});

test('ein Resize übergibt den Fokus zwischen sichtbarer Route und mobilem Menüschalter', async () => {
  const mediaQueryList = new EventTarget();
  mediaQueryList.matches = false;
  const probe = await loadDashboardUi({ mediaQueryList });
  const state = probe.DomainModel.createEmptyState();
  const app = await loadDashboardUi({ state, mediaQueryList });
  await app.UiShell.init('app');
  const toggle = findByText(app.root, 'Navigation öffnen');
  const nav = app.root._find(element => element.tagName === 'NAV' && element.id === 'main-navigation');
  const activeRoute = findByText(nav, 'Übersicht');

  activeRoute.focus();
  await dispatchDocumentFocus(app, activeRoute);
  mediaQueryList.matches = true;
  app.document.activeElement = app.document.body;
  app.sandbox.window.dispatchEvent(new Event('resize'));
  assert.equal(app.document.activeElement, toggle, 'beim Eintritt in die mobile Ansicht darf keine versteckte Route den Fokus behalten');

  await dispatchDocumentFocus(app, toggle);
  mediaQueryList.matches = false;
  app.document.activeElement = app.document.body;
  app.sandbox.window.dispatchEvent(new Event('resize'));
  assert.equal(app.document.activeElement, activeRoute, 'beim Rückweg zum Desktop muss der sichtbare aktive Weg den Fokus erhalten');
});

test('entsperrter realer UiShell-Start zeigt Übersicht und öffnet den geklickten gleichnamigen Kurs per ID', async () => {
  const app = await unlockedAppWithCourses();
  await app.UiShell.init('app');

  assert.ok(findByText(app.root, 'Übersicht'), 'der entsperrte Start muss die Übersicht zeigen');
  const firstCard = findByAttribute(app.root, 'data-course-id', 'bio-10a');
  assert.ok(firstCard, 'die echte Karte des ersten Kurses fehlt');
  const open = firstCard._find(element => element.textContent === 'Noten öffnen');
  await open.dispatch('click');

  assert.ok(findByText(app.root, 'Noteneingabe'), 'der Kartenaufruf muss die reale Notentabelle öffnen');
  assert.ok(findByText(app.root, 'Biologie · 10a'), 'die Tabelle muss die geprüfte Kurs-ID statt des gleichnamigen Ersatzkurses verwenden');
});

test('nur erfolgreich gerenderte Noteneingaben aktualisieren die Fortsetzen-Karte und überleben den verschlüsselten Neustart', async () => {
  const app = await unlockedAppWithCourses();
  await app.UiShell.init('app');
  assert.equal(resumeCard(app.root), null, 'ohne Notenbesuch darf keine Fortsetzen-Karte erscheinen');

  const metadataSaves = [];
  const realSaveState = app.Storage.saveState.bind(app.Storage);
  app.Storage.saveState = candidate => {
    const pending = realSaveState(candidate);
    metadataSaves.push(pending);
    return pending;
  };

  await openButton(cardFor(app.root, 'bio-10a')).dispatch('click');
  await metadataSaves.at(-1);
  assert.equal((await app.Storage.loadState()).lastGradesheetCourseId, 'bio-10a');
  await findByText(app.root, 'Übersicht').dispatch('click');
  await settleDashboardRequest();
  let resume = resumeCard(app.root);
  assert.ok(resume);
  assert.ok(findByText(resume, 'ZULETZT GEÖFFNET'));
  assert.ok(findByText(resume, 'Biologie · 10a'));
  assert.ok(findByText(resume, 'Fortsetzen'));
  const dashboard = app.root._find(element => element.classList && element.classList.contains('dashboard-overview'));
  assert.ok(dashboard.children.indexOf(resume) < dashboard.children.indexOf(findByText(dashboard, 'Aktive Kurse')),
    'die Fortsetzen-Karte muss oberhalb der aktiven Kurse stehen');

  await openButton(cardFor(app.root, 'bio-10b')).dispatch('click');
  await metadataSaves.at(-1);
  assert.equal((await app.Storage.loadState()).lastGradesheetCourseId, 'bio-10b');
  await findByText(app.root, 'Übersicht').dispatch('click');
  await settleDashboardRequest();
  resume = resumeCard(app.root);
  assert.ok(findByText(resume, 'Biologie · 10b'));

  await app.Storage.lockSession();
  const lockedReload = await loadDashboardUi({
    lockManager: app.lockManager,
    storage: app.storage,
    locked: true,
    useExistingStorage: true
  });
  await lockedReload.UiShell.init('app');
  assert.ok(findByText(lockedReload.root, 'Anwendung gesperrt'));
  assert.equal(resumeCard(lockedReload.root), null);
  assert.equal(lockedReload.root.textContent.includes('bio-10b'), false);
  assert.equal(lockedReload.root.textContent.includes('Biologie · 10b'), false);

  lockedReload.sandbox.window.promptPassword = async () => lockedReload.password;
  await findByText(lockedReload.root, 'Entsperren').dispatch('click');
  resume = resumeCard(lockedReload.root);
  assert.ok(findByText(resume, 'Biologie · 10b'));
  await findByText(resume, 'Fortsetzen').dispatch('click');
  assert.equal(lockedReload.root.querySelector('h2').textContent, 'Noteneingabe');
  assert.ok(findByText(lockedReload.root, 'Biologie · 10b'));
  const persisted = await lockedReload.Storage.loadState();
  assert.equal(persisted.lastGradesheetCourseId, 'bio-10b');
  assert.equal(Object.prototype.hasOwnProperty.call(persisted, 'lastGradesheetTerm'), false,
    'Fortsetzen darf keinen gespeicherten Halbjahr-Override einführen');
});

test('Fortsetzen speichert denselben Kurs nach einem Metadatenfehler erneut und übersteht danach den Neustart', async () => {
  for (const synchronous of [false, true]) {
    const app = await unlockedAppWithCourses();
    await app.UiShell.init('app');
    const realSave = app.Storage.saveState.bind(app.Storage);
    let calls = 0;
    let saved;
    app.Storage.saveState = candidate => {
      calls++;
      if (calls === 1) {
        const error = new Error('synthetischer Metadatenfehler');
        if (synchronous) throw error;
        return Promise.reject(error);
      }
      saved = realSave(candidate);
      return saved;
    };
    await openButton(cardFor(app.root, 'bio-10a')).dispatch('click');
    await settleDashboardRequest();
    assert.equal((await app.Storage.loadState()).lastGradesheetCourseId, null);
    await findByText(app.root, 'Übersicht').dispatch('click');
    await settleDashboardRequest();
    await findByText(resumeCard(app.root), 'Fortsetzen').dispatch('click');
    assert.equal(calls, 2, 'der gleiche Kurs braucht nach einem fehlgeschlagenen Save einen neuen Versuch');
    await saved;
    await findByText(app.root, 'Übersicht').dispatch('click');
    await settleDashboardRequest();
    await findByText(resumeCard(app.root), 'Fortsetzen').dispatch('click');
    assert.equal(calls, 2, 'nach erfolgreichem Save ist keine Wiederholung nötig');
    await app.Storage.lockSession();
    const restarted = await loadDashboardUi({ storage: app.storage, lockManager: app.lockManager, useExistingStorage: true });
    await restarted.UiShell.init('app');
    assert.ok(findByText(resumeCard(restarted.root), 'Biologie · 10a'));
  }
});

test('Fortsetzen reiht während desselben offenen Metadaten-Saves keinen doppelten Kursbesuch ein', async () => {
  const app = await unlockedAppWithCourses();
  await app.UiShell.init('app');
  const firstSaveGate = deferred();
  const realSave = app.Storage.saveState.bind(app.Storage);
  const writes = [];
  app.Storage.saveState = candidate => {
    writes.push(candidate.lastGradesheetCourseId);
    if (writes.length === 1) {
      return firstSaveGate.promise.then(() => realSave(candidate));
    }
    return realSave(candidate);
  };

  await openButton(cardFor(app.root, 'bio-10a')).dispatch('click');
  await settleDashboardRequest();
  assert.deepEqual(writes, ['bio-10a']);
  await findByText(app.root, 'Übersicht').dispatch('click');
  await settleDashboardRequest();
  await findByText(resumeCard(app.root), 'Fortsetzen').dispatch('click');
  await settleDashboardRequest();
  assert.deepEqual(writes, ['bio-10a'], 'der offene erste Save blockiert die gemeinsame UI-FIFO');

  firstSaveGate.resolve();
  await settleDashboardRequest();
  await app.Storage.loadCurrentSessionState();
  await settleDashboardRequest();

  assert.deepEqual(writes, ['bio-10a'], 'derselbe noch offene Besuch darf nach Freigabe nicht erneut gespeichert werden');
  assert.equal((await app.Storage.loadState()).lastGradesheetCourseId, 'bio-10a');
});

test('A nach einem offenen Besuch von B bleibt als neuestes Fortsetzen-Ziel erhalten', async () => {
  const app = await unlockedAppWithCourses();
  await app.UiShell.init('app');
  await openGradesheetAndWaitForResume(app, cardFor(app.root, 'bio-10a'));
  assert.equal((await app.Storage.loadState()).lastGradesheetCourseId, 'bio-10a');
  await findByText(app.root, 'Übersicht').dispatch('click');
  await settleDashboardRequest();

  const firstSaveGate = deferred();
  const realSave = app.Storage.saveState.bind(app.Storage);
  const writes = [];
  const saves = [];
  app.Storage.saveState = candidate => {
    writes.push(candidate.lastGradesheetCourseId);
    const pending = writes.length === 1
      ? firstSaveGate.promise.then(() => realSave(candidate))
      : realSave(candidate);
    saves.push(Promise.resolve(pending));
    return pending;
  };

  await openButton(cardFor(app.root, 'bio-10b')).dispatch('click');
  await settleDashboardRequest();
  await findByText(app.root, 'Übersicht').dispatch('click');
  await settleDashboardRequest();
  await openButton(cardFor(app.root, 'bio-10a')).dispatch('click');
  await settleDashboardRequest();
  assert.deepEqual(writes, ['bio-10b'], 'der neueste A-Besuch wartet hinter dem offenen B-Save');

  firstSaveGate.resolve();
  await saves[0];
  await settleDashboardRequest();
  assert.deepEqual(writes, ['bio-10b', 'bio-10a']);
  await saves.at(-1);
  await settleDashboardRequest();

  assert.equal((await app.Storage.loadState()).lastGradesheetCourseId, 'bio-10a');
});

test('ein verspäteter Fehler eines früheren Kursbesuchs macht den neueren erfolgreichen Besuch nicht erneut schreibbedürftig', async () => {
  const app = await unlockedAppWithCourses();
  await app.UiShell.init('app');
  const first = deferred();
  const realSave = app.Storage.saveState.bind(app.Storage);
  let calls = 0;
  let saved;
  app.Storage.saveState = candidate => {
    calls++;
    if (calls === 1) return first.promise;
    saved = realSave(candidate);
    return saved;
  };
  await openButton(cardFor(app.root, 'bio-10a')).dispatch('click');
  await findByText(app.root, 'Übersicht').dispatch('click');
  await settleDashboardRequest();
  await openButton(cardFor(app.root, 'bio-10b')).dispatch('click');
  assert.equal(calls, 1, 'der zweite Besuch wartet in derselben UI-FIFO auf den ersten Save');
  first.reject(new Error('synthetischer verspäteter Fehler'));
  await settleDashboardRequest();
  assert.equal(calls, 2, 'nach dem alten Fehler muss der neuere Besuch seinen Save starten');
  await saved;
  await findByText(app.root, 'Übersicht').dispatch('click');
  await settleDashboardRequest();
  await findByText(resumeCard(app.root), 'Fortsetzen').dispatch('click');
  assert.equal(calls, 2);
  assert.equal((await app.Storage.loadState()).lastGradesheetCourseId, 'bio-10b');
});

test('Statistik-Kopfauswahl und Kurseditor-Auswahl ersetzen den letzten echten Notenbesuch nicht', async () => {
  const app = await unlockedAppWithCourses();
  await app.UiShell.init('app');
  await openButton(cardFor(app.root, 'bio-10a')).dispatch('click');
  await settleDashboardRequest();
  await findByText(app.root, 'Übersicht').dispatch('click');
  await settleDashboardRequest();

  const nav = app.root._find(element => element.tagName === 'NAV' && element.id === 'main-navigation');
  await findByText(nav, 'Statistik').dispatch('click');
  const headerSelect = findByAttribute(app.root, 'id', 'current-course-select');
  headerSelect.value = 'bio-10b';
  await headerSelect.dispatch('change');
  assert.equal(app.root.querySelector('h2').textContent, 'Statistik');

  await findByText(nav, 'Kurse').dispatch('click');
  const editSecond = cardFor(app.root, 'bio-10b')._find(element => element.textContent === 'Kurs bearbeiten');
  await editSecond.dispatch('click');
  assert.ok(findByText(app.root, 'Kurs bearbeiten: Biologie · 10b'));
  await findByText(app.root, 'Übersicht').dispatch('click');
  await settleDashboardRequest();
  assert.ok(findByText(resumeCard(app.root), 'Biologie · 10a'));
  assert.equal((await app.Storage.loadState()).lastGradesheetCourseId, 'bio-10a');
});

test('blockierter Kurswechsel, verzögerte Besuche und ein Metadaten-Speicherfehler behalten die letzte abgeschlossene Noteneingabe', async () => {
  const fixture = await quickCourseSwitchGradesheetApp();
  assert.equal((await fixture.app.Storage.loadState()).lastGradesheetCourseId, fixture.biology.id);

  const invalid = fixture.scoreInput(fixture.gradedStudent.id);
  invalid.value = '99';
  await invalid.dispatch('change');
  await fixture.selectCourse(fixture.mathematics.id);
  await settleDashboardRequest();
  assert.equal(fixture.app.document.activeElement, invalid);
  assert.equal((await fixture.app.Storage.loadState()).lastGradesheetCourseId, fixture.biology.id,
    'ein abgewiesener Zielkurs darf nicht als besucht gespeichert werden');

  invalid.value = '3';
  await invalid.dispatch('change');
  await findByText(fixture.app.root, 'Übersicht').dispatch('click');
  await settleDashboardRequest();
  await openGradesheetAndWaitForResume(fixture.app, cardFor(fixture.app.root, fixture.biology.id));
  const firstVisit = deferred();
  const snapshots = [];
  const errors = [];
  const realConsoleError = fixture.app.sandbox.console.error;
  fixture.app.sandbox.console.error = (...args) => { errors.push(args.map(String).join(' ')); };
  fixture.app.Storage.saveState = candidate => {
    snapshots.push(candidate.lastGradesheetCourseId);
    return snapshots.length === 1 ? firstVisit.promise : Promise.resolve(true);
  };
  const switchCourse = fixture.selectCourse(fixture.mathematics.id);
  await settleDashboardRequest();
  assert.deepEqual(snapshots, [fixture.mathematics.id]);
  assert.equal(fixture.app.root.querySelector('h2').textContent, 'Noteneingabe',
    'der Metadaten-Save darf die gerenderte Zielansicht nicht blockieren');
  firstVisit.reject(new Error('synthetischer Resume-Speicherfehler'));
  await switchCourse;
  await settleDashboardRequest();
  assert.equal(fixture.app.root.querySelector('h2').textContent, 'Noteneingabe');
  assert.equal(errors.some(message => /quick-|Biologie|Mathematik/.test(message)), false,
    'der Fehlerkanal darf weder Kurs-ID noch Kursname offenlegen');

  await fixture.selectCourse(fixture.secondBiology.id);
  await settleDashboardRequest();
  assert.deepEqual(snapshots, [fixture.mathematics.id, fixture.secondBiology.id],
    'die nächste Notenansicht muss nach einem Fehler weiterhin gespeichert werden können');
  fixture.app.sandbox.console.error = realConsoleError;
});

test('eine Sperre entfernt Kursdaten sofort und ein später Resume-Speicherfehler zeigt keinen Hinweis', async () => {
  const app = await unlockedAppWithCourses();
  await app.UiShell.init('app');
  const save = deferred();
  const alerts = [];
  app.sandbox.window.alert = message => { alerts.push(String(message)); };
  app.Storage.saveState = () => save.promise;

  await openButton(cardFor(app.root, 'bio-10a')).dispatch('click');
  assert.equal(app.root.querySelector('h2').textContent, 'Noteneingabe');
  app.Storage.lockSession();
  assert.ok(findByText(app.root, 'Anwendung gesperrt'));
  assert.equal(app.root.textContent.includes('Biologie'), false);
  assert.equal(app.root.textContent.includes('bio-10a'), false);

  save.reject(new Error('synthetischer später Resume-Fehler'));
  await settleDashboardRequest();
  assert.ok(findByText(app.root, 'Anwendung gesperrt'));
  assert.deepEqual(alerts, [], 'ein Metadatenfehler nach der Sperre darf keinen Dialog anzeigen');
});

test('Fortsetzen prüft die aktive Kursreferenz beim Klick erneut und bleibt bei einer stale Karte auf der Übersicht', async () => {
  const probe = await loadDashboardUi();
  const state = probe.DomainModel.createEmptyState();
  const course = probe.DomainModel.createCourse({ id: 'resume-stale', name: 'Geschichte', classLabel: '9a' });
  probe.DomainModel.addCourseToState(state, course);
  state.lastGradesheetCourseId = course.id;
  const app = await loadDashboardUi({ state });
  await app.UiShell.init('app');
  const resume = resumeCard(app.root);
  const button = findByText(resume, 'Fortsetzen');
  let saveCalls = 0;
  app.Storage.saveState = async () => { saveCalls += 1; };
  const realListActiveCourses = app.DomainModel.listActiveCourses;
  app.DomainModel.listActiveCourses = () => [];
  try {
    await button.dispatch('click');
  } finally {
    app.DomainModel.listActiveCourses = realListActiveCourses;
  }

  assert.equal(app.root.querySelector('h2').textContent, 'Übersicht');
  assert.equal(findByText(app.root, 'Noteneingabe'), null);
  assert.equal(saveCalls, 0);
});

test('gemischte Sek-I/Sek-II-Karten bleiben klassisch, termgenau und zustandsneutral über Öffnen, Schließen und Themewechsel', async () => {
  const { app, before } = await mixedTermsDashboardApp();
  const cards = app.root._find(element => element.classList && element.classList.contains('nv-course-cards'));
  assert.equal(cards.getAttribute('data-family'), 'classic');
  assert.equal(cards.getAttribute('data-appearance'), 'light');
  assert.match(cardFor(app.root, 'seki-early-cutoff').textContent, /H2/,
    'der frühe eigene Sek-I-Stichtag muss in die zweite Halbjahresphase führen');
  assert.match(cardFor(app.root, 'seki-late-cutoff').textContent, /H1/,
    'der späte eigene Sek-I-Stichtag muss in der ersten Halbjahresphase bleiben');
  assert.equal(termFieldFor(cardFor(app.root, 'sekii-context')).textContent, '26/27 Q2',
    'der feste Sek-II-Stichtag muss genau das erwartete Qualifikationshalbjahr ausweisen');
  assert.equal(app.document.activeElement, null, 'gewöhnlicher Start setzt keinen Fokus um');

  const mode = findByAttribute(app.root, 'id', 'appearance-mode');
  mode.value = 'dark';
  await mode.dispatch('change');
  const darkCards = app.root._find(element => element.classList && element.classList.contains('nv-course-cards'));
  assert.equal(darkCards.getAttribute('data-family'), 'classic');
  assert.equal(darkCards.getAttribute('data-appearance'), 'dark');
  assert.notEqual(app.document.activeElement, app.root._find(element => element.tagName === 'H2'),
    'ein Themewechsel darf den Fokus nicht zur Überschrift ziehen');

  await openGradesheetAndWaitForResume(app, cardFor(app.root, 'seki-early-cutoff'));
  assert.equal(app.document.activeElement.textContent, 'Noteneingabe');
  await findByText(app.root, 'Übersicht').dispatch('click');
  await settleDashboardRequest();
  assertDashboardHeadingFocused(app);
  await openGradesheetAndWaitForResume(app, cardFor(app.root, 'sekii-context'));
  assert.ok(findByText(app.root, 'Biologie · Oberstufe'));
  await findByText(app.root, 'Übersicht').dispatch('click');
  await settleDashboardRequest();
  assertDashboardHeadingFocused(app);
  const expected = JSON.parse(before);
  expected.lastGradesheetCourseId = 'sekii-context';
  assert.equal(JSON.stringify(await app.Storage.loadState()), JSON.stringify(expected),
    'Navigation und Themewechsel dürfen außer dem letzten echten Notenbesuch keinen Fachzustand verändern');
});

test('eine angeheftete Karteninfo bleibt über Design- und Darstellungswechsel auf demselben DOM offen', async () => {
  const app = await unlockedAppWithCourses();
  await app.UiShell.init('app');
  const card = findByAttribute(app.root, 'data-course-id', 'bio-10a');
  const info = card._find(element => element.getAttribute && element.getAttribute('data-role') === 'info');
  await info.dispatch('click');
  await findByAttribute(app.root, 'data-family-choice', 'aurora').dispatch('click');
  const mode = findByAttribute(app.root, 'id', 'appearance-mode');
  mode.value = 'dark'; await mode.dispatch('change');
  assert.equal(findByAttribute(app.root, 'data-course-id', 'bio-10a'), card);
  assert.equal(info.getAttribute('aria-expanded'), 'true');
});

test('alle echten Designleistenwege erhalten einen offenen ungültigen Noteneditor', async () => {
  const { app, input } = await gradesheetApp();
  const persistedBefore = JSON.stringify(await app.Storage.loadState());
  input.value = '99';
  await input.dispatch('change');
  assert.equal(input.classList.contains('gradesheet-input-invalid'), true, 'der echte Editor muss seinen ungültigen Entwurf registrieren');
  const originalInput = input;

  const family = findByAttribute(app.root, 'data-family-choice', 'aurora');
  const appearance = findByAttribute(app.root, 'id', 'appearance-mode');
  const accent = findByAttribute(app.root, 'data-accent-choice', 'violet');
  const background = findByAttribute(app.root, 'data-background-choice', 'petrol');
  const motion = findByAttribute(app.root, 'id', 'appearance-motion');
  assert.ok(family && appearance && accent && background && motion, 'die echte Designleiste muss alle Darstellungswege enthalten');

  await family.dispatch('click');
  appearance.value = 'dark';
  await appearance.dispatch('change');
  await accent.dispatch('click');
  await background.dispatch('click');
  motion.value = 'calm'; await motion.dispatch('change');
  appearance.value = 'light'; await appearance.dispatch('change');

  assert.equal(app.document.body.getAttribute('data-design-family'), 'aurora');
  assert.equal(app.document.body.getAttribute('data-appearance'), 'light');
  assert.equal(app.document.body.getAttribute('data-accent'), 'violet');
  assert.equal(app.document.body.getAttribute('data-background'), 'petrol');
  assert.equal(input, originalInput, 'ein Darstellungswechsel darf den offenen echten Noteneditor nicht neu aufbauen');
  assert.equal(input.value, '99');
  assert.equal(input.classList.contains('gradesheet-input-invalid'), true);
  assert.equal(JSON.stringify(await app.Storage.loadState()), persistedBefore, 'Darstellung darf nicht in den Notendatenstand geschrieben werden');
  assert.deepEqual(JSON.parse(app.storage.getItem('notenverwaltung_appearance')), {
    family: 'aurora', appearance: 'light', accent: 'violet', background: 'petrol', motion: 'calm'
  });

  const reloaded = await loadDashboardUi({ storage: app.storage });
  await reloaded.UiShell.init('app');
  assert.equal(findByAttribute(reloaded.root, 'data-family-choice', 'aurora').getAttribute('aria-pressed'), 'true');
  assert.equal(findByAttribute(reloaded.root, 'id', 'appearance-mode').value, 'light');
  assert.equal(findByAttribute(reloaded.root, 'data-accent-choice', 'violet').getAttribute('aria-checked'), 'true');
  assert.equal(findByAttribute(reloaded.root, 'data-background-choice', 'petrol').getAttribute('aria-checked'), 'true');
  assert.equal(findByAttribute(reloaded.root, 'id', 'appearance-motion').value, 'calm');
});

test('echte Sek-II-Null, unberührte Leere und bewusstes Leeren bleiben über Darstellungswechsel als getrennte Editorzustände erhalten', async () => {
  const { app, student, blankStudent } = await splitTermScoreGradesheetApp({ schemaMode: 'uppersec', sparse: true });
  const zero = termScoreInput(app, '2026-H1', student.id);
  const cleared = termScoreInput(app, '2026-H2', student.id);
  const untouched = termScoreInput(app, '2026-H1', blankStudent.id);
  assert.ok(zero && cleared && untouched, 'die sparse Fixture benötigt echte Sek-II-, Clear- und Leer-Editoren');
  zero.value = '0';
  await zero.dispatch('change');
  cleared.value = '';
  await cleared.dispatch('change');

  const family = findByAttribute(app.root, 'data-family-choice', 'modern');
  const appearance = findByAttribute(app.root, 'id', 'appearance-mode');
  const accent = findByAttribute(app.root, 'data-accent-choice', 'green');
  const background = findByAttribute(app.root, 'data-background-choice', 'blue');
  await family.dispatch('click');
  appearance.value = 'dark'; await appearance.dispatch('change');
  await accent.dispatch('click');
  await background.dispatch('click');

  assert.equal(termScoreInput(app, '2026-H1', student.id), zero);
  assert.equal(termScoreInput(app, '2026-H2', student.id), cleared);
  assert.equal(termScoreInput(app, '2026-H1', blankStudent.id), untouched);
  assert.equal(zero.value, '0');
  assert.equal(cleared.value, '');
  assert.equal(untouched.value, '');
});

test('ein Hell-zu-Dunkel-Wechsel korrigiert den Vordergrund vorhandener farbiger Notenzusammenfassungen ohne DOM-Ersatz', async () => {
  const { app, input } = await gradesheetApp();
  const summary = input.closest('tr').querySelectorAll('td.gradesheet-avg')
    .find(cell => cell.textContent === '2.00' && cell.style.backgroundColor);
  assert.ok(summary, 'die echte Notentabelle muss eine semantisch eingefärbte Zusammenfassung enthalten');
  assert.equal(summary.style.color || '', '', 'in der hell montierten Tabelle kommt der dunkle Vordergrund zunächst aus dem Theme');
  const originalBackground = summary.style.backgroundColor;

  const appearance = findByAttribute(app.root, 'id', 'appearance-mode');
  appearance.value = 'dark';
  await appearance.dispatch('change');

  assert.equal(input.closest('tr').querySelectorAll('td.gradesheet-avg').includes(summary), true,
    'der Darstellungswechsel muss die bestehende Zusammenfassungszelle erhalten');
  assert.equal(summary.style.backgroundColor, originalBackground, 'die fachliche Bewertungsfarbe darf sich nicht ändern');
  assert.equal(summary.style.color, '#050505', 'der Vordergrund muss auf der hellen Bewertungsfläche dunkel bleiben');
});

test('eine alte Dark-Mode-Auswahl wird als vollständige Darstellung migriert und Karten folgen der gewählten Familie ohne Neuaufbau', async () => {
  const storage = localStorageStub();
  storage.setItem('notenverwaltung_theme', 'dark');
  const probe = await loadDashboardUi({ storage });
  const state = probe.DomainModel.createEmptyState();
  probe.DomainModel.addCourseToState(state, probe.DomainModel.createCourse({ id: 'appearance-course', name: 'Chemie', subject: 'Chemie', classLabel: '10a' }));
  const app = await loadDashboardUi({ state, storage });
  await app.UiShell.init('app');
  const cards = app.root._find(element => element.classList && element.classList.contains('nv-course-cards'));
  const originalCards = cards;

  assert.equal(app.document.body.getAttribute('data-appearance'), 'dark');
  assert.equal(cards.getAttribute('data-appearance'), 'dark');
  assert.deepEqual(JSON.parse(storage.getItem('notenverwaltung_appearance')), {
    family: 'classic', appearance: 'dark', accent: 'standard', background: 'standard', motion: 'vivid'
  }, 'die alte lokale Wahl muss einmalig in das neue private Darstellungsformat überführt werden');
  const family = findByAttribute(app.root, 'data-family-choice', 'aurora');
  await family.dispatch('click');
  const accent = findByAttribute(app.root, 'data-accent-choice', 'amber');
  await accent.dispatch('click');
  assert.equal(app.root._find(element => element.classList && element.classList.contains('nv-course-cards')), originalCards,
    'die Karten dürfen bei einer reinen Darstellungswahl nicht neu montiert werden');
  assert.equal(cards.getAttribute('data-family'), 'aurora');
  assert.equal(cards.getAttribute('data-accent'), 'amber', 'die montierte Karte muss die Akzentwahl ohne Neuaufbau übernehmen');
});

test('ungültige oder nicht lesbare lokale Darstellungsdaten fallen sicher zurück und ein Speicherfehler wird ehrlich angezeigt', async () => {
  const storage = localStorageStub();
  storage.setItem('notenverwaltung_appearance', '{keine json');
  const app = await loadDashboardUi({ storage });
  await app.UiShell.init('app');
  assert.equal(app.document.body.getAttribute('data-design-family'), 'classic');
  assert.equal(app.document.body.getAttribute('data-appearance'), 'light');

  storage.setItem = () => { throw new Error('Speicher gesperrt'); };
  const accent = findByAttribute(app.root, 'data-accent-choice', 'green');
  await accent.dispatch('click');
  assert.match(findByText(app.root, 'Darstellung geändert, konnte aber lokal nicht gespeichert werden.').textContent, /nicht gespeichert/);
  assert.equal(app.document.body.getAttribute('data-accent'), 'green', 'die Anwendung bleibt bei gesperrtem Speicher bedienbar');

  const feedback = app.root._find(element => element.classList && element.classList.contains('appearance-feedback'));
  feedback.textContent = '';
  const mode = findByAttribute(app.root, 'id', 'appearance-mode');
  mode.value = 'dark';
  await mode.dispatch('change');
  assert.equal(feedback.textContent, 'Darstellung geändert, konnte aber lokal nicht gespeichert werden.',
    'auch der beschriftete Darstellungsmodus muss einen blockierten lokalen Speicher ehrlich melden');
});

test('Systemdarstellung folgt einem OS-Wechsel ohne die Systemwahl oder die vorhandenen Kurskarten zu ersetzen', async () => {
  const listeners = [];
  const mediaQueryList = { matches: false, addEventListener(type, listener) { if (type === 'change') listeners.push(listener); } };
  const probe = await loadDashboardUi({ mediaQueryList });
  const state = probe.DomainModel.createEmptyState();
  probe.DomainModel.addCourseToState(state, probe.DomainModel.createCourse({ id: 'system-course', name: 'Physik', subject: 'Physik', classLabel: '10b' }));
  const app = await loadDashboardUi({ state, mediaQueryList });
  await app.UiShell.init('app');
  const cards = app.root._find(element => element.classList && element.classList.contains('nv-course-cards'));
  const appearance = findByAttribute(app.root, 'id', 'appearance-mode');
  appearance.value = 'system';
  await appearance.dispatch('change');
  mediaQueryList.matches = true;
  listeners.forEach(listener => listener({ matches: true }));

  assert.equal(app.document.body.getAttribute('data-appearance'), 'system');
  assert.equal(app.document.body.classList.contains('theme-dark'), true);
  assert.equal(appearance.value, 'system', 'ein OS-Wechsel darf die gewählte Systemdarstellung nicht ersetzen');
  assert.equal(app.root._find(element => element.classList && element.classList.contains('nv-course-cards')), cards);
  assert.equal(cards.getAttribute('data-appearance'), 'dark');
});

test('erfolgreiche Reinitialisierung ersetzt den Farbschema-Listener und eine feste neue Darstellung bleibt bei OS-Wechseln stabil', async () => {
  const listeners = new Set();
  let removedListeners = 0;
  const colorScheme = {
    matches: false,
    addEventListener(type, listener) { if (type === 'change') listeners.add(listener); },
    removeEventListener(type, listener) {
      if (type === 'change' && listeners.delete(listener)) removedListeners += 1;
    }
  };
  const app = await loadDashboardUi({ mediaQueryList: colorScheme });
  app.storage.setItem('notenverwaltung_appearance', JSON.stringify({
    family: 'aurora', appearance: 'system', accent: 'violet', background: 'amber', motion: 'vivid'
  }));
  await app.UiShell.init('app');
  const firstListener = [...listeners][0];

  app.storage.setItem('notenverwaltung_appearance', JSON.stringify({
    family: 'modern', appearance: 'light', accent: 'green', background: 'blue', motion: 'off'
  }));
  await app.UiShell.init('app');

  assert.equal(removedListeners, 1, 'die erfolgreiche neue UI muss ihre Vorgaengerbindung entfernen');
  assert.equal(listeners.size, 1, 'nur die aktuelle Farbschema-Bindung darf aktiv bleiben');
  assert.equal(listeners.has(firstListener), false);
  colorScheme.matches = true;
  listeners.forEach(listener => listener({ matches: true }));
  assert.deepEqual({
    family: app.document.body.getAttribute('data-design-family'),
    appearance: app.document.body.getAttribute('data-appearance'),
    accent: app.document.body.getAttribute('data-accent'),
    background: app.document.body.getAttribute('data-background'),
    motion: app.document.body.getAttribute('data-motion'),
    dark: app.document.body.classList.contains('theme-dark')
  }, {
    family: 'modern', appearance: 'light', accent: 'green', background: 'blue', motion: 'off', dark: false
  }, 'eine alte System-Closure darf keine Darstellung der vorherigen UI zurueckschreiben');
});

test('nach Reinitialisierung reagiert ausschließlich die aktuelle Systemdarstellung auf das OS-Farbschema', async () => {
  const listeners = new Set();
  const colorScheme = {
    matches: false,
    addEventListener(type, listener) { if (type === 'change') listeners.add(listener); },
    removeEventListener(type, listener) { if (type === 'change') listeners.delete(listener); }
  };
  const app = await loadDashboardUi({ mediaQueryList: colorScheme });
  app.storage.setItem('notenverwaltung_appearance', JSON.stringify({
    family: 'aurora', appearance: 'light', accent: 'violet', background: 'amber', motion: 'vivid'
  }));
  await app.UiShell.init('app');
  app.storage.setItem('notenverwaltung_appearance', JSON.stringify({
    family: 'modern', appearance: 'system', accent: 'green', background: 'blue', motion: 'calm'
  }));
  await app.UiShell.init('app');

  colorScheme.matches = true;
  listeners.forEach(listener => listener({ matches: true }));

  assert.equal(listeners.size, 1);
  assert.equal(app.document.body.getAttribute('data-design-family'), 'modern');
  assert.equal(app.document.body.getAttribute('data-appearance'), 'system');
  assert.equal(app.document.body.classList.contains('theme-dark'), true);
});

test('fehlgeschlagene Reinitialisierung erhält den Farbschema-Listener der letzten erfolgreich gerenderten UI', async () => {
  const listeners = new Set();
  let removedListeners = 0;
  const colorScheme = {
    matches: false,
    addEventListener(type, listener) { if (type === 'change') listeners.add(listener); },
    removeEventListener(type, listener) {
      if (type === 'change' && listeners.delete(listener)) removedListeners += 1;
    }
  };
  const app = await loadDashboardUi({ mediaQueryList: colorScheme });
  app.storage.setItem('notenverwaltung_appearance', JSON.stringify({
    family: 'modern', appearance: 'system', accent: 'green', background: 'blue', motion: 'calm'
  }));
  await app.UiShell.init('app');
  const successfulListener = [...listeners][0];

  app.storage.setItem('notenverwaltung_appearance', JSON.stringify({
    family: 'aurora', appearance: 'system', accent: 'violet', background: 'amber', motion: 'vivid'
  }));
  const originalSetAttribute = app.document.body.setAttribute;
  app.document.body.setAttribute = function (name, value) {
    if (name === 'data-effective-motion') throw new Error('synthetischer Reinitialisierungsfehler');
    return originalSetAttribute.call(this, name, value);
  };
  try {
    await assert.rejects(app.UiShell.init('app'), /synthetischer Reinitialisierungsfehler/);
  } finally {
    app.document.body.setAttribute = originalSetAttribute;
  }

  assert.equal(removedListeners, 0, 'ein fehlgeschlagener Start darf die funktionsfaehige Bindung nicht entfernen');
  assert.equal(listeners.size, 1);
  assert.equal(listeners.has(successfulListener), true);
  app.document.body.setAttribute('data-design-family', 'sentinel');
  colorScheme.matches = true;
  listeners.forEach(listener => listener({ matches: true }));
  assert.equal(app.document.body.getAttribute('data-design-family'), 'modern');
  assert.equal(app.document.body.classList.contains('theme-dark'), true);
});

test('die Farbschema-Bindung ersetzt sich auch ueber addListener und removeListener symmetrisch', async () => {
  const listeners = new Set();
  let removedListeners = 0;
  const colorScheme = {
    matches: false,
    addListener(listener) { listeners.add(listener); },
    removeListener(listener) {
      if (listeners.delete(listener)) removedListeners += 1;
    }
  };
  const app = await loadDashboardUi({ mediaQueryList: colorScheme });
  await app.UiShell.init('app');
  await app.UiShell.init('app');

  assert.equal(removedListeners, 1);
  assert.equal(listeners.size, 1);
});

test('eine vor dem Klick fehlende oder archivierte Karten-ID aktualisiert die Übersicht ohne Ersatzkurs', async () => {
  const app = await unlockedAppWithCourses();
  const notices = [];
  app.sandbox.window.alert = message => notices.push(String(message));
  await app.UiShell.init('app');
  const open = findByAttribute(app.root, 'data-course-id', 'bio-10a')._find(element => element.textContent === 'Noten öffnen');
  const originalListActiveCourses = app.DomainModel.listActiveCourses;
  app.DomainModel.listActiveCourses = () => [];
  try {
    await open.dispatch('click');
  } finally {
    app.DomainModel.listActiveCourses = originalListActiveCourses;
  }
  const activeHeading = app.root._find(element => element.tagName === 'H2');
  assert.equal(activeHeading.textContent, 'Übersicht');
  assert.match(notices[0], /nicht mehr aktiv/i);
  assert.equal(findByText(app.root, 'Noteneingabe'), null);
});

test('ausschließlich archivierte Kurse zeigen den beschrifteten Leerzustand ohne Ersatzkurs', async () => {
  const probe = await loadDashboardUi();
  const state = probe.DomainModel.createEmptyState();
  const archived = probe.DomainModel.createCourse({ id: 'archiv', name: 'Archiv', subject: 'Chemie', classLabel: '10b' });
  archived.archivedAt = '2026-09-01T00:00:00.000Z';
  probe.DomainModel.addCourseToState(state, archived);
  archived.archiveSnapshot = probe.DomainModel.createArchiveSnapshot(state, archived);
  const app = await loadDashboardUi({ state });
  await app.UiShell.init('app');

  assert.ok(findByText(app.root, 'Noch keine aktiven Kurse vorhanden.'));
  assert.ok(findByText(app.root, 'Zur Kursanlage'));
  assert.ok(findByText(app.root, 'Import öffnen'));
  assert.equal(findByAttribute(app.root, 'data-course-id', 'archiv'), null);
});

test('gesperrte Sitzung zeigt eine beschriftete Sperransicht ohne sensible App-Inhalte und fokussiert Entsperren', async () => {
  const probe = await loadDashboardUi();
  const state = probe.DomainModel.createEmptyState();
  const course = probe.DomainModel.createCourse({ id: 'gesperrt', name: 'Physik vertraulich', subject: 'Physik', classLabel: '10c' });
  const student = probe.DomainModel.createStudent({ id: 'gesperrt-student', lastName: 'Privatname', firstName: 'Test' });
  probe.DomainModel.addCourseToState(state, course);
  probe.DomainModel.addStudentToState(state, student);
  probe.DomainModel.enrollStudentInCourse(state, course.id, student.id);
  const app = await loadDashboardUi({ state, locked: true });
  await app.UiShell.init('app');

  const heading = findByText(app.root, 'Anwendung gesperrt');
  const lockSurface = app.root._find(element => element.classList && element.classList.contains('lock-screen'));
  const unlock = findByText(app.root, 'Entsperren');
  const actions = app.root._find(element => element.classList && element.classList.contains('lock-card__actions'));
  assert.equal(heading.tagName, 'H1');
  assert.equal(lockSurface.getAttribute('aria-labelledby'), heading.id);
  assert.equal(app.document.activeElement, unlock);
  assert.deepEqual(actions.children.map(button => button.textContent), ['Entsperren', 'Gesperrt bleiben']);
  assert.equal(findByAttribute(app.root, 'data-course-id', 'gesperrt'), null);
  assert.equal(findByText(app.root, 'Physik vertraulich'), null);
  assert.equal(findByText(app.root, 'Privatname'), null);
  assert.equal(app.root._find(element => element.classList && element.classList.contains('app-frame')), null);
  assert.equal(findByAttribute(app.root, 'aria-label', 'Seitennavigation'), null);
  assert.equal(findByAttribute(app.root, 'id', 'appearance-mode'), null, 'im gesperrten Kontext darf keine Darstellungssteuerung über dem Sperrhinweis liegen');
  app.sandbox.window.promptPassword = async () => app.password;
  await unlock.dispatch('click');
  assert.ok(findByText(app.root, 'Übersicht'));
  assert.ok(findByAttribute(app.root, 'data-course-id', 'gesperrt'));
  assert.ok(findByAttribute(app.root, 'id', 'appearance-mode'), 'nach dem echten Entsperren muss die Steuerung wieder bereitstehen');
});

test('Sperren und Entsperren setzt die Jahresansicht für denselben, einen anderen Sek-I- und einen Sek-II-Kurs zurück', async () => {
  const probe = await loadDashboardUi();
  const state = probe.DomainModel.createEmptyState();
  const student = probe.DomainModel.createStudent({ id: 'lock-reset-student', lastName: 'Test', firstName: 'Person' });
  const sameSekI = probe.DomainModel.createCourse({ id: 'lock-reset-same', name: 'Biologie', subject: 'Biologie', classLabel: '10a' });
  const otherSekI = probe.DomainModel.createCourse({ id: 'lock-reset-other', name: 'Chemie', subject: 'Chemie', classLabel: '10b' });
  const sekII = probe.DomainModel.createCourse({
    id: 'lock-reset-upper', name: 'Physik', subject: 'Physik', classLabel: '11a',
    schemaMode: probe.DomainModel.SCHEMA_MODES.UPPERSEC
  });
  sekII.upperSecContext = {
    courseType: probe.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    qualificationYear: probe.DomainModel.QUALIFICATION_YEARS.Q1_Q2,
    weightingDeviationReason: null
  };
  probe.DomainModel.addStudentToState(state, student);
  for (const course of [sameSekI, otherSekI, sekII]) {
    probe.DomainModel.addCourseToState(state, course);
    probe.DomainModel.enrollStudentInCourse(state, course.id, student.id);
    const assessment = probe.DomainModel.createAssessment({
      id: course.id + '-assessment', courseId: course.id, categoryId: state.settings.categories[0].id,
      title: 'Leistung', weight: 1
    });
    assessment.scores[student.id] = probe.DomainModel.createScoreEntry({ valueRaw: '2' });
    probe.DomainModel.addAssessmentToState(state, assessment);
  }
  const app = await loadDashboardUi({ state });
  await app.UiShell.init('app');

  await openButton(cardFor(app.root, sameSekI.id)).dispatch('click');
  await findByText(app.root, 'Gesamtes Schuljahr').dispatch('click');
  await settleDashboardRequest();
  assert.equal(app.root.querySelector('h2').textContent, 'Gesamtes Schuljahr', 'der Test muss aus der echten Jahresansicht sperren');

  app.Storage.lockSession();
  assert.ok(findByText(app.root, 'Anwendung gesperrt'));
  app.sandbox.window.promptPassword = async () => app.password;
  await findByText(app.root, 'Entsperren').dispatch('click');
  assert.ok(findByText(app.root, 'Übersicht'));

  for (const course of [sameSekI, otherSekI, sekII]) {
    await openButton(cardFor(app.root, course.id)).dispatch('click');
    assert.equal(app.root.querySelector('h2').textContent, 'Noteneingabe', `${course.name} darf keine Jahresansicht aus der gesperrten Sitzung erben`);
    assert.match(app.root.textContent, /Schüler stehen in den Zeilen, Leistungen in den Spalten/);
    assert.equal(app.root.querySelectorAll('.gradesheet-input').length, 1, `${course.name} muss nach dem Entsperren editierbar bleiben`);
    await findByText(app.root, 'Übersicht').dispatch('click');
    await settleDashboardRequest();
  }
});

test('ein Fehler beim dekorativen Sperrsymbol lässt die echte Sperransicht bedienbar und geschützt', async () => {
  const probe = await loadDashboardUi();
  const state = probe.DomainModel.createEmptyState();
  const course = probe.DomainModel.createCourse({ id: 'icon-fehler-kurs', name: 'Geheime Physik', subject: 'Physik', classLabel: '10c' });
  const student = probe.DomainModel.createStudent({ id: 'icon-fehler-person', lastName: 'Vertraulich', firstName: 'Ada' });
  probe.DomainModel.addCourseToState(state, course);
  probe.DomainModel.addStudentToState(state, student);
  probe.DomainModel.enrollStudentInCourse(state, course.id, student.id);
  const app = await loadDashboardUi({ state, locked: true });
  app.document.createElementNS = () => { throw new Error('SVG-Erzeugung fehlgeschlagen'); };

  await app.UiShell.init('app');

  assert.ok(findByText(app.root, 'Anwendung gesperrt'));
  assert.ok(findByText(app.root, 'Entsperren'));
  assert.ok(findByText(app.root, 'Gesperrt bleiben'));
  assert.equal(app.root._find(element => element.classList && element.classList.contains('app-frame')), null);
  assert.equal(findByAttribute(app.root, 'aria-label', 'Seitennavigation'), null);
  assert.equal(findByAttribute(app.root, 'data-course-id', course.id), null);
  assert.equal(findByText(app.root, 'Geheime Physik'), null);
  assert.equal(findByText(app.root, 'Vertraulich'), null);
});

test('ein Fehler beim anfänglichen Buttonfokus lässt die echte Sperransicht bedienbar und geschützt', async () => {
  const probe = await loadDashboardUi();
  const state = probe.DomainModel.createEmptyState();
  const course = probe.DomainModel.createCourse({ id: 'fokus-fehler-kurs', name: 'Geschützte Chemie', subject: 'Chemie', classLabel: '11a' });
  const student = probe.DomainModel.createStudent({ id: 'fokus-fehler-person', lastName: 'Privat', firstName: 'Marie' });
  probe.DomainModel.addCourseToState(state, course);
  probe.DomainModel.addStudentToState(state, student);
  probe.DomainModel.enrollStudentInCourse(state, course.id, student.id);
  const app = await loadDashboardUi({ state, locked: true });
  const createElement = app.document.createElement.bind(app.document);
  app.document.createElement = tagName => {
    const element = createElement(tagName);
    if (String(tagName).toLowerCase() === 'button') {
      element.focus = () => { throw new Error('Fokus fehlgeschlagen'); };
    }
    return element;
  };

  await app.UiShell.init('app');

  assert.ok(findByText(app.root, 'Anwendung gesperrt'));
  assert.ok(findByText(app.root, 'Entsperren'));
  assert.ok(findByText(app.root, 'Gesperrt bleiben'));
  assert.equal(app.root._find(element => element.classList && element.classList.contains('app-frame')), null);
  assert.equal(findByAttribute(app.root, 'aria-label', 'Seitennavigation'), null);
  assert.equal(findByAttribute(app.root, 'data-course-id', course.id), null);
  assert.equal(findByText(app.root, 'Geschützte Chemie'), null);
  assert.equal(findByText(app.root, 'Privat'), null);
});

test('Gesperrt bleiben lässt ausschließlich die Sperransicht sichtbar', async () => {
  const probe = await loadDashboardUi();
  const state = probe.DomainModel.createEmptyState();
  probe.DomainModel.addCourseToState(state, probe.DomainModel.createCourse({ id: 'bleibt-gesperrt', name: 'Biologie geschützt', subject: 'Biologie', classLabel: '11a' }));
  const app = await loadDashboardUi({ state, locked: true });
  await app.UiShell.init('app');

  await findByText(app.root, 'Gesperrt bleiben').dispatch('click');

  assert.ok(findByText(app.root, 'Anwendung gesperrt'));
  assert.equal(findByText(app.root, 'Einstellungen'), null);
  assert.equal(findByText(app.root, 'Biologie geschützt'), null);
  assert.equal(findByAttribute(app.root, 'data-course-id', 'bleibt-gesperrt'), null);
  assert.equal(findByAttribute(app.root, 'id', 'appearance-mode'), null);
});

test('Ersteinrichtung bleibt nach erfolgreichem Passwortsetzen in den Einstellungen', async () => {
  const app = await loadDashboardUi({ encrypted: false });
  app.sandbox.window.promptPassword = async () => 'Erstes-Passwort-2026';
  await app.UiShell.init('app');
  assert.ok(findByText(app.root, 'Einstellungen'));
  await findByText(app.root, 'Verschlüsselung jetzt einrichten').dispatch('click');
  const activeHeading = app.root._find(element => element.tagName === 'H2');
  assert.equal(activeHeading.textContent, 'Einstellungen');
});

test('Passwortabbruch und falsches Passwort lassen die echte Sperransicht ohne Karten bestehen', async () => {
  const probe = await loadDashboardUi();
  const state = probe.DomainModel.createEmptyState();
  probe.DomainModel.addCourseToState(state, probe.DomainModel.createCourse({ id: 'weiter-gesperrt', name: 'Chemie', subject: 'Chemie', classLabel: '10b' }));
  const app = await loadDashboardUi({ state, locked: true });
  await app.UiShell.init('app');
  await findByText(app.root, 'Entsperren').dispatch('click');
  assert.ok(findByText(app.root, 'Anwendung gesperrt'));
  let wrongPasswordAttempted = false;
  app.sandbox.window.promptPassword = async () => {
    if (wrongPasswordAttempted) return null;
    wrongPasswordAttempted = true;
    return 'falsches-passwort';
  };
  await findByText(app.root, 'Entsperren').dispatch('click');
  assert.ok(findByText(app.root, 'Anwendung gesperrt'));
  assert.equal(findByAttribute(app.root, 'data-course-id', 'weiter-gesperrt'), null);
});

test('das echte gebaute HTML bündelt Kartenstyles und führt seinen Start- und Kartenhandler aus', async () => {
  const probe = await loadDashboardUi();
  const state = probe.DomainModel.createEmptyState();
  probe.DomainModel.addCourseToState(state, probe.DomainModel.createCourse({ id: 'artefakt-kurs', name: 'Informatik', subject: 'Informatik', classLabel: '11a' }));
  const { buildArtifact } = await import(pathToFileURL(path.join(__dirname, '..', 'scripts', 'build.mjs')).href);
  const artifact = await buildArtifact();
  assert.match(artifact, /\.nv-course-cards\s*\{/);
  assert.doesNotMatch(artifact, /course-cards\.css/);
  const app = await loadGeneratedDashboardUi({ artifact, state });
  await app.start();

  assert.ok(findByText(app.root, 'Übersicht'));
  const open = findByAttribute(app.root, 'data-course-id', 'artefakt-kurs')._find(element => element.textContent === 'Noten öffnen');
  await open.dispatch('click');
  assert.ok(findByText(app.root, 'Noteneingabe'));
});

test('der echte Übersicht-Button wartet einen begonnenen Grade-change ab und wechselt erst nach Erfolg', async () => {
  const { app, input } = await gradesheetApp();
  let releaseSave;
  app.Storage.saveState = () => new Promise(resolve => { releaseSave = resolve; });
  input.value = '3';
  const change = input.dispatch('change');
  await Promise.resolve();
  await findByText(app.root, 'Übersicht').dispatch('click');
  assert.ok(findByText(app.root, 'Noteneingabe'), 'die Tabelle muss während des offenen Speicherns sichtbar bleiben');
  releaseSave();
  await change;
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(findByText(app.root, 'Übersicht'), 'erst ein erfolgreicher echter Save darf zur Übersicht wechseln');
});

test('die Sek-I Jahresansicht wartet den echten Eingabeguard ab und kehrt lesend zur Noteneingabe zurück', async () => {
  const { app, input } = await gradesheetApp();
  const annualButton = () => findByText(app.root, 'Gesamtes Schuljahr');

  input.value = '99';
  await input.dispatch('change');
  await annualButton().dispatch('click');
  await settleDashboardRequest();
  assert.ok(findByText(app.root, 'Noteneingabe'), 'ein ungültiger Entwurf darf die Noteneingabe nicht verlassen');
  assert.equal(app.document.activeElement, input);

  input.value = '3';
  await input.dispatch('change');
  await annualButton().dispatch('click');
  await settleDashboardRequest();
  assert.ok(findByText(app.root, 'Gesamtes Schuljahr'));
  assert.equal(app.root.querySelectorAll('.gradesheet-input').length, 0, 'die Jahresansicht darf keine Note editierbar machen');

  await findByText(app.root, 'Noteneingabe').dispatch('click');
  assert.equal(app.root.querySelectorAll('.gradesheet-input').length, 1);
  assert.equal(app.root.querySelectorAll('.gradesheet-input')[0].value, '3');
  const entryHeading = app.root.querySelector('h2');
  assert.equal(entryHeading.textContent, 'Noteneingabe');
  assert.equal(app.document.activeElement, entryHeading,
    'der verschwindende Jahresregister-Button muss den Fokus auf die wiederhergestellte Eingabeüberschrift übergeben');
});

test('bewusstes Leeren wird vor dem Wechsel in die Sek-I Jahresansicht gespeichert', async () => {
  const { app, input } = await gradesheetApp();
  input.value = '';
  await input.dispatch('change');
  await findByText(app.root, 'Gesamtes Schuljahr').dispatch('click');
  await settleDashboardRequest();

  assert.ok(findByText(app.root, 'Gesamtes Schuljahr'));
  assert.equal(app.root.querySelectorAll('.gradesheet-input').length, 0);
  const persisted = await app.Storage.loadState();
  const score = persisted.assessments.find(assessment => assessment.id === 'grade-assessment').scores['student-a'];
  assert.equal(score.valueRaw, null, 'der bewusst gelöschte Rohwert muss vor der Jahresansicht persistiert sein');
  assert.equal(score.valueNumeric, null, 'das Leeren darf keinen künstlichen Zahlenwert hinterlassen');
});

test('eine ungültige echte H1-Halbjahresnote blockiert die Übersicht mit Fokus und erlaubt danach die gültige Korrektur', async () => {
  const { app, course } = await splitTermScoreGradesheetApp();
  const input = termScoreInput(app, '2026-H1');
  assert.ok(input, 'der Test muss den echten data-term-H1-Editor verwenden');
  assert.notEqual(input.dataset.gradesheetTerm, 'all');

  input.value = '99';
  await input.dispatch('change');
  assert.equal(input.classList.contains('gradesheet-input-invalid'), true);
  await findByText(app.root, 'Übersicht').dispatch('click');
  await settleDashboardRequest();

  assert.ok(findByText(app.root, 'Noteneingabe'), '99 darf den H1-Editor nicht verlassen');
  assert.equal(app.document.activeElement, input);

  input.value = '4';
  await input.dispatch('change');
  assert.equal(input.classList.contains('gradesheet-input-invalid'), false);
  await findByText(app.root, 'Übersicht').dispatch('click');
  await settleDashboardRequest();
  assertDashboardHeadingFocused(app);

  await openButton(cardFor(app.root, course.id)).dispatch('click');
  assert.equal(termScoreInput(app, '2026-H1').value, '4');
});

test('eine korrigierte H1-Sek-I-Termnote lässt unberührte leere Termzellen ohne künstliche Scores passieren', async () => {
  const { app, course, student, blankStudent, assessments } = await splitTermScoreGradesheetApp({ sparse: true });
  const input = termScoreInput(app, '2026-H1', student.id);
  const blankTermInput = termScoreInput(app, '2026-H1', blankStudent.id);
  assert.ok(input && blankTermInput, 'der Test benötigt echte dünn besetzte H1-Termzellen');
  const realSaveState = app.Storage.saveState.bind(app.Storage);
  const snapshots = [];
  app.Storage.saveState = async savedState => {
    snapshots.push(JSON.parse(JSON.stringify(savedState)));
    return realSaveState(savedState);
  };

  input.value = '99';
  await input.dispatch('change');
  await findByText(app.root, 'Übersicht').dispatch('click');
  await settleDashboardRequest();
  assert.ok(findByText(app.root, 'Noteneingabe'));
  assert.equal(app.document.activeElement, input);

  input.value = '4';
  await input.dispatch('change');
  await findByText(app.root, 'Übersicht').dispatch('click');
  await settleDashboardRequest();
  assertDashboardHeadingFocused(app);
  assert.equal(snapshots.length, 1, 'unberührte leere Zellen dürfen keinen eigenen Save erzeugen');
  for (const assessment of snapshots[0].assessments.filter(item => assessments.some(expected => expected.id === item.id))) {
    assert.equal(Object.prototype.hasOwnProperty.call(assessment.scores, blankStudent.id), false);
  }

  await openButton(cardFor(app.root, course.id)).dispatch('click');
  assert.equal(termScoreInput(app, '2026-H1', blankStudent.id).value, '');
});

test('eine korrigierte H2-Sek-II-Termnote akzeptiert 0 Punkte und lässt übrige leere Termzellen unberührt', async () => {
  const { app, course, student, blankStudent, assessments } = await splitTermScoreGradesheetApp({
    schemaMode: 'uppersec',
    sparse: true
  });
  const input = termScoreInput(app, '2026-H2', student.id);
  assert.ok(input, 'der Test muss einen echten H2-Sek-II-Termeditor verwenden');
  const realSaveState = app.Storage.saveState.bind(app.Storage);
  let saveCalls = 0;
  app.Storage.saveState = async savedState => {
    saveCalls += 1;
    return realSaveState(savedState);
  };

  input.value = '99';
  await input.dispatch('change');
  input.value = '0';
  await input.dispatch('change');
  await findByText(app.root, 'Übersicht').dispatch('click');
  await settleDashboardRequest();
  assertDashboardHeadingFocused(app);
  assert.equal(saveCalls, 1);

  const reloaded = await app.Storage.loadState();
  const savedAssessment = reloaded.assessments.find(item => item.id === assessments[1].id);
  assert.equal(savedAssessment.scores[student.id].valueRaw, '0');
  assert.equal(savedAssessment.scores[student.id].valueNumeric, 0);
  for (const assessment of reloaded.assessments.filter(item => assessments.some(expected => expected.id === item.id))) {
    assert.equal(Object.prototype.hasOwnProperty.call(assessment.scores, blankStudent.id), false);
  }

  await openButton(cardFor(app.root, course.id)).dispatch('click');
  assert.equal(termScoreInput(app, '2026-H2', student.id).value, '0');
});

test('eine korrigierte Sek-I-Hauptnote lässt eine unberührte leere Hauptzelle ohne künstlichen Score passieren', async () => {
  const { app, course, student, blankStudent, assessment } = await combinedScoreGradesheetApp({ sparse: true });
  const input = termScoreInput(app, 'all', student.id);
  const blankInput = termScoreInput(app, 'all', blankStudent.id);
  assert.ok(input && blankInput, 'der Test benötigt echte dünn besetzte Haupttabellenzellen');
  const realSaveState = app.Storage.saveState.bind(app.Storage);
  const snapshots = [];
  app.Storage.saveState = async savedState => {
    snapshots.push(JSON.parse(JSON.stringify(savedState)));
    return realSaveState(savedState);
  };

  input.value = '99';
  await input.dispatch('change');
  input.value = '4';
  await input.dispatch('change');
  await findByText(app.root, 'Übersicht').dispatch('click');
  await settleDashboardRequest();
  assertDashboardHeadingFocused(app);
  assert.equal(snapshots.length, 1);
  const savedAssessment = snapshots[0].assessments.find(item => item.id === assessment.id);
  assert.equal(Object.prototype.hasOwnProperty.call(savedAssessment.scores, blankStudent.id), false);

  await openButton(cardFor(app.root, course.id)).dispatch('click');
  assert.equal(termScoreInput(app, 'all', blankStudent.id).value, '');
});

test('das Leeren einer H2-Sek-II-Termnote wartet auf Persistenz, bleibt nach Reload leer und entfernt die Durchschnitte', async () => {
  const { app, course, student, assessments } = await splitTermScoreGradesheetApp({ schemaMode: 'uppersec' });
  const input = termScoreInput(app, '2026-H2', student.id);
  const gate = deferred();
  const realSaveState = app.Storage.saveState.bind(app.Storage);
  const snapshots = [];
  app.Storage.saveState = async savedState => {
    snapshots.push(JSON.parse(JSON.stringify(savedState)));
    await gate.promise;
    return realSaveState(savedState);
  };

  input.value = '   ';
  const change = input.dispatch('change');
  await settleDashboardRequest();
  assert.equal(snapshots.length, 1, 'bewusstes Leeren muss genau einen Save beginnen');
  const pendingAssessment = snapshots[0].assessments.find(item => item.id === assessments[1].id);
  assert.equal(pendingAssessment.scores[student.id].valueRaw, null);
  assert.equal(pendingAssessment.scores[student.id].valueNumeric, null);
  await findByText(app.root, 'Übersicht').dispatch('click');
  assert.ok(findByText(app.root, 'Noteneingabe'), 'die Navigation muss den offenen Clear-Save abwarten');

  gate.resolve();
  await change;
  await settleDashboardRequest();
  assertDashboardHeadingFocused(app);
  const reloaded = await app.Storage.loadState();
  const reloadedAssessment = reloaded.assessments.find(item => item.id === assessments[1].id);
  assert.equal(reloadedAssessment.scores[student.id].valueRaw, null);
  assert.equal(reloadedAssessment.scores[student.id].valueNumeric, null);

  await openButton(cardFor(app.root, course.id)).dispatch('click');
  const reopened = termScoreInput(app, '2026-H2', student.id);
  assert.equal(reopened.value, '');
  assert.ok(averageTextsForScoreInput(reopened).every(value => value === '–'));
});

test('ein fehlgeschlagenes Leeren der Sek-I-Hauptnote rollt Wert und Durchschnitte zurück und kann danach bewusst gelingen', async () => {
  const { app, course, student, assessment } = await combinedScoreGradesheetApp();
  const input = termScoreInput(app, 'all', student.id);
  const beforeAverages = averageTextsForScoreInput(input);
  const realSaveState = app.Storage.saveState.bind(app.Storage);
  let rejectedCalls = 0;
  app.Storage.saveState = async () => {
    rejectedCalls += 1;
    throw new Error('Clear-Save scheitert');
  };

  input.value = '   ';
  await input.dispatch('change');
  assert.equal(rejectedCalls, 1);
  assert.equal(input.value, '2');
  assert.deepEqual(averageTextsForScoreInput(input), beforeAverages);
  await findByText(app.root, 'Übersicht').dispatch('click');
  await settleDashboardRequest();
  assert.ok(findByText(app.root, 'Noteneingabe'));
  assert.equal(app.document.activeElement, input);

  app.Storage.saveState = realSaveState;
  input.value = '';
  await input.dispatch('change');
  await findByText(app.root, 'Übersicht').dispatch('click');
  await settleDashboardRequest();
  assertDashboardHeadingFocused(app);
  const reloaded = await app.Storage.loadState();
  assert.equal(reloaded.assessments.find(item => item.id === assessment.id).scores[student.id].valueRaw, null);

  await openButton(cardFor(app.root, course.id)).dispatch('click');
  const reopened = termScoreInput(app, 'all', student.id);
  assert.equal(reopened.value, '');
  assert.ok(averageTextsForScoreInput(reopened).every(value => value === '–'));
});

test('der Fehlerfokus öffnet einen eingeklappten Halbjahresabschnitt wieder sichtbar', async () => {
  const { app } = await splitTermScoreGradesheetApp();
  const input = termScoreInput(app, '2026-H1');
  const section = containingTermSection(input);
  assert.ok(section, 'der echte H1-Editor muss in einem Halbjahresabschnitt liegen');
  const header = section.children[0];
  const content = section.children[1];

  input.value = '99';
  await input.dispatch('change');
  await header.dispatch('click');
  assert.equal(content.classList.contains('hidden'), true);
  await findByText(app.root, 'Übersicht').dispatch('click');
  await settleDashboardRequest();

  assert.ok(findByText(app.root, 'Noteneingabe'));
  assert.equal(content.classList.contains('hidden'), false, 'der Fehlereditor muss wieder sichtbar sein');
  assert.equal(header.classList.contains('collapsed'), false);
  assert.equal(app.document.activeElement, input);
});

test('der Übersicht-Wechsel wartet den H2-Halbjahres-Save ab und liest danach alle H1/H2-Editoren erneut', async () => {
  const { app, student, assessments } = await splitTermScoreGradesheetApp();
  const h1 = termScoreInput(app, '2026-H1');
  const h2 = termScoreInput(app, '2026-H2');
  assert.ok(h1 && h2, 'der Test benötigt echte editierbare H1- und H2-Termzellen');
  const first = deferred();
  const second = deferred();
  const snapshots = [];
  app.Storage.saveState = savedState => {
    snapshots.push(persistedTermScores(savedState, assessments.map(item => item.id), student.id));
    return snapshots.length === 1 ? first.promise : second.promise;
  };

  h2.value = '4';
  const h2Change = h2.dispatch('change');
  await settleDashboardRequest();
  await findByText(app.root, 'Übersicht').dispatch('click');
  assert.ok(findByText(app.root, 'Noteneingabe'), 'der offene H2-Save muss die Tabelle sichtbar halten');
  h1.value = '5';
  first.resolve();
  await h2Change;
  await settleDashboardRequest();

  assert.deepEqual(snapshots, [['2', '4'], ['5', '4']]);
  assert.ok(findByText(app.root, 'Noteneingabe'), 'die nachträglich schmutzige H1-Zelle muss erneut gespeichert werden');
  second.resolve();
  await settleDashboardRequest();
  assertDashboardHeadingFocused(app);
});

test('eine ungültige echte Sek-II-Termzelle blockiert die Übersicht und kann gültig korrigiert werden', async () => {
  const { app, course } = await splitTermScoreGradesheetApp({ schemaMode: 'uppersec' });
  const input = termScoreInput(app, '2026-H2');
  assert.ok(input, 'der Test muss den echten editierbaren Q2-Termpfad verwenden');
  assert.notEqual(input.dataset.gradesheetTerm, 'all');

  input.value = '99';
  await input.dispatch('change');
  await findByText(app.root, 'Übersicht').dispatch('click');
  await settleDashboardRequest();
  assert.ok(findByText(app.root, 'Noteneingabe'));
  assert.equal(app.document.activeElement, input);

  input.value = '12';
  await input.dispatch('change');
  await findByText(app.root, 'Übersicht').dispatch('click');
  await settleDashboardRequest();
  await openButton(cardFor(app.root, course.id)).dispatch('click');
  assert.equal(termScoreInput(app, '2026-H2').value, '12');
});

test('ein unabhängig abgeschickter neuer Sek-II-Termwert überlebt einen älteren Save-Fehler und hält die Navigation bis Erfolg', async () => {
  const { app, student, assessments } = await splitTermScoreGradesheetApp({ schemaMode: 'uppersec' });
  const input = termScoreInput(app, '2026-H1');
  const first = deferred();
  const second = deferred();
  const snapshots = [];
  app.Storage.saveState = savedState => {
    snapshots.push(persistedTermScores(savedState, assessments.map(item => item.id), student.id));
    return snapshots.length === 1 ? first.promise : second.promise;
  };
  input.value = '11';
  const firstChange = input.dispatch('change');
  await settleDashboardRequest();
  input.value = '12';
  const secondChange = input.dispatch('change');
  await findByText(app.root, 'Übersicht').dispatch('click');

  first.reject(new Error('älterer Term-Save scheitert'));
  await firstChange;
  await settleDashboardRequest();
  assert.deepEqual(snapshots, [['11', '8'], ['12', '8']]);
  assert.ok(findByText(app.root, 'Noteneingabe'));

  second.resolve();
  await secondChange;
  await settleDashboardRequest();
  assertDashboardHeadingFocused(app);
});

test('derselbe fehlgeschlagene Termwert wird nicht automatisch erneut gespeichert und der aktive Fehler nur einmal verbraucht', async () => {
  const { app } = await splitTermScoreGradesheetApp({ schemaMode: 'uppersec' });
  const input = termScoreInput(app, '2026-H1');
  const first = deferred();
  let saveCalls = 0;
  app.Storage.saveState = () => {
    saveCalls += 1;
    return saveCalls === 1 ? first.promise : Promise.resolve();
  };
  input.value = '11';
  const firstChange = input.dispatch('change');
  await settleDashboardRequest();
  const duplicateChange = input.dispatch('change');
  await findByText(app.root, 'Übersicht').dispatch('click');

  first.reject(new Error('Term-Save scheitert'));
  await firstChange;
  await duplicateChange;
  await settleDashboardRequest();
  assert.equal(saveCalls, 1);
  assert.equal(input.value, '10');
  assert.equal(input.classList.contains('gradesheet-input-invalid'), true);
  assert.ok(findByText(app.root, 'Noteneingabe'));

  app.Storage.saveState = async () => { saveCalls += 1; };
  await findByText(app.root, 'Übersicht').dispatch('click');
  await settleDashboardRequest();
  assertDashboardHeadingFocused(app);
  assert.equal(saveCalls, 1, 'der zurückgerollte saubere Wert braucht keinen Retry');
});

test('eine Sperre zeigt während eines offenen H2-Term-Saves sofort die Sperransicht und bleibt nach dessen Abschluss bestehen', async () => {
  const { app, course } = await splitTermScoreGradesheetApp();
  const input = termScoreInput(app, '2026-H2');
  const save = deferred();
  app.Storage.saveState = () => save.promise;
  input.value = '4';
  const change = input.dispatch('change');
  await settleDashboardRequest();
  await findByText(app.root, 'Übersicht').dispatch('click');

  app.Storage.lockSession();
  assert.ok(findByText(app.root, 'Anwendung gesperrt'));
  assert.equal(findByAttribute(app.root, 'data-course-id', course.id), null);
  save.resolve();
  await change;
  await settleDashboardRequest();
  assert.ok(findByText(app.root, 'Anwendung gesperrt'));
  assert.equal(findByAttribute(app.root, 'data-course-id', course.id), null);
});

test('der echte Übersicht-Wechsel speichert einen bereits geprüften Grade-Editor erneut nach einem späteren await', async () => {
  const { app, inputs } = await multiGradeGradesheetApp();
  assert.equal(inputs.length, 2);
  let calls = 0;
  let releaseFirst;
  let releaseSecond;
  const first = new Promise(resolve => { releaseFirst = resolve; });
  const second = new Promise(resolve => { releaseSecond = resolve; });
  const snapshots = [];
  app.Storage.saveState = savedState => {
    calls += 1;
    snapshots.push(savedState.assessments.map(assessment => assessment.scores['student-multi'].valueRaw));
    return calls === 1 ? first : second;
  };
  inputs[1].value = '3';
  const changed = inputs[1].dispatch('change');
  await Promise.resolve();
  await findByText(app.root, 'Übersicht').dispatch('click');
  inputs[0].value = '4';
  releaseFirst();
  await changed;
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(JSON.stringify(snapshots), JSON.stringify([['2', '3'], ['4', '3']]));
  assert.ok(findByText(app.root, 'Noteneingabe'), 'der zweite Save muss vor der Navigation abgeschlossen sein');
  releaseSecond();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.root.querySelector('h2').textContent, 'Übersicht');
  assert.equal(app.root.querySelector('.gradesheet-table'), null);
});

test('eine während eines späteren Saves entstandene ungültige Grade-Eingabe hält die echte Tabelle offen', async () => {
  const { app, inputs } = await multiGradeGradesheetApp();
  let releaseSave;
  app.Storage.saveState = () => new Promise(resolve => { releaseSave = resolve; });
  inputs[1].value = '3';
  const changed = inputs[1].dispatch('change');
  await Promise.resolve();
  await findByText(app.root, 'Übersicht').dispatch('click');
  inputs[0].value = '9';
  releaseSave();
  await changed;
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(findByText(app.root, 'Noteneingabe'));
  assert.equal(inputs[0].classList.contains('gradesheet-input-invalid'), true);
  assert.equal(app.document.activeElement, inputs[0]);
});

test('der echte Übersicht-Wechsel prüft Ergebnis-Editoren nach dem await eines späteren Ergebnis-Saves erneut', async () => {
  const { app, inputs } = await multiTermResultGradesheetApp();
  assert.equal(inputs.length, 2);
  let calls = 0;
  let releaseFirst;
  let releaseSecond;
  const first = new Promise(resolve => { releaseFirst = resolve; });
  const second = new Promise(resolve => { releaseSecond = resolve; });
  const snapshots = [];
  app.Storage.saveState = savedState => {
    calls += 1;
    const course = savedState.courses.find(candidate => candidate.id === 'term-result-multi-course');
    snapshots.push(['term-student-1', 'term-student-2'].map(studentId =>
      app.DomainModel.getTermResult(course, studentId, '2026-H1')));
    return calls === 1 ? first : second;
  };
  inputs[1].value = '11';
  const changed = inputs[1].dispatch('change');
  await Promise.resolve();
  await findByText(app.root, 'Übersicht').dispatch('click');
  inputs[0].value = '12';
  releaseFirst();
  await changed;
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(snapshots, [[10, 11], [12, 11]]);
  assert.ok(findByText(app.root, 'Noteneingabe'));
  releaseSecond();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(findByText(app.root, 'Übersicht'));
});

test('der echte Übersicht-Button bleibt bei fehlgeschlagenem Grade-change in der Notentabelle', async () => {
  const { app, input } = await gradesheetApp();
  app.Storage.saveState = async () => { throw new Error('synthetischer Speicherfehler'); };
  input.value = '3';
  const change = input.dispatch('change');
  await Promise.resolve();
  await findByText(app.root, 'Übersicht').dispatch('click');
  await change;
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(findByText(app.root, 'Noteneingabe'));
  assert.equal(findByText(app.root, 'Übersicht').tagName, 'BUTTON');
  app.Storage.saveState = async () => {};
  await findByText(app.root, 'Übersicht').dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.root.querySelector('.gradesheet-table'), null,
    'der im aktiven Wechsel beobachtete Fehler darf den nächsten bewussten Klick nicht erneut blockieren');
});

test('der echte Übersicht-Wechsel wartet nach einem alten Grade-Fehler auf den unabhängig abgeschickten neuen Wert', async () => {
  const { app, input } = await gradesheetApp();
  const saves = [];
  let rejectFirst;
  let resolveSecond;
  const first = new Promise((resolve, reject) => { rejectFirst = reject; });
  const second = new Promise(resolve => { resolveSecond = resolve; });
  app.Storage.saveState = savedState => {
    saves.push(savedState.assessments[0].scores['student-a'].valueRaw);
    return saves.length === 1 ? first : second;
  };
  input.value = '3';
  const firstChange = input.dispatch('change');
  await Promise.resolve();
  input.value = '4';
  const secondChange = input.dispatch('change');
  await findByText(app.root, 'Übersicht').dispatch('click');

  rejectFirst(new Error('älterer Save scheitert'));
  await firstChange;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(saves, ['3', '4']);
  assert.ok(findByText(app.root, 'Noteneingabe'), 'der neue Save muss vor der Navigation abgeschlossen sein');

  resolveSecond();
  await secondChange;
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(findByText(app.root, 'Übersicht'));
  assert.equal(app.root.querySelector('.gradesheet-table'), null);
});

test('eine Sperre während eines offenen echten Grade-change gewinnt gegen den Übersicht-Wechsel', async () => {
  const { app, input } = await gradesheetApp();
  let releaseSave;
  app.Storage.saveState = () => new Promise(resolve => { releaseSave = resolve; });
  input.value = '3';
  const change = input.dispatch('change');
  await Promise.resolve();
  await findByText(app.root, 'Übersicht').dispatch('click');
  app.Storage.lockSession();
  releaseSave();
  await change;
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(findByText(app.root, 'Anwendung gesperrt'));
  assert.equal(findByAttribute(app.root, 'data-course-id', 'grade-course'), null);
});

test('eine Sperre gewinnt auch während der Folgepersistenz nach einem alten Ergebnisfehler', async () => {
  const { app, inputs } = await multiTermResultGradesheetApp();
  const input = inputs[0];
  let saveCalls = 0;
  let rejectFirst;
  let resolveSecond;
  const first = new Promise((resolve, reject) => { rejectFirst = reject; });
  const second = new Promise(resolve => { resolveSecond = resolve; });
  app.Storage.saveState = () => {
    saveCalls += 1;
    return saveCalls === 1 ? first : second;
  };
  input.value = '11';
  const firstChange = input.dispatch('change');
  await Promise.resolve();
  input.value = '12';
  const secondChange = input.dispatch('change');
  await findByText(app.root, 'Übersicht').dispatch('click');
  app.Storage.lockSession();

  rejectFirst(new Error('älterer Save scheitert'));
  await firstChange;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(saveCalls, 2, 'der unabhängig abgeschickte Wert behält seinen eigenen Persistenzversuch');
  resolveSecond();
  await secondChange;
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(findByText(app.root, 'Anwendung gesperrt'));
  assert.equal(findByAttribute(app.root, 'data-course-id', 'term-result-multi-course'), null);
});
