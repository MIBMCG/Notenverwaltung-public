'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  loadDashboardUi,
  findByText,
  findByAttribute
} = require('./harness/dashboard-app');

function fixedDate(isoDate) {
  const RealDate = Date;
  const fixedMillis = new RealDate(`${isoDate}T12:00:00.000Z`).getTime();
  return class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedMillis]));
    }
    static now() { return fixedMillis; }
  };
}

function addStudent(modules, state, { id, lastName, firstName = 'Test', homeClass = '' }) {
  const student = modules.DomainModel.createStudent({ id, lastName, firstName, homeClass });
  modules.DomainModel.addStudentToState(state, student);
  return student;
}

function addCourse(modules, state, { id, name, subject, classLabel, schemaMode = 'grades', archivedAt = null }) {
  const course = modules.DomainModel.createCourse({
    id, name, subject, classLabel, schemaMode,
    upperSecContext: schemaMode === modules.DomainModel.SCHEMA_MODES.UPPERSEC
      ? { courseType: 'basic', qualificationYear: 'q1-q2' }
      : null,
    archivedAt
  });
  modules.DomainModel.addCourseToState(state, course);
  return course;
}

function addAssessment(modules, state, course, { id, title, scores = {} }) {
  const assessment = modules.DomainModel.createAssessment({
    id,
    courseId: course.id,
    categoryId: state.settings.categories[0].id,
    title,
    date: '2026-03-10',
    term: '2025-H2',
    weight: 1
  });
  for (const [studentId, valueRaw] of Object.entries(scores)) {
    assessment.scores[studentId] = modules.DomainModel.createScoreEntry({ valueRaw });
  }
  modules.DomainModel.addAssessmentToState(state, assessment);
  return assessment;
}

async function statisticsFixture({ debug = false, customMinusAtFour = false } = {}) {
  const DateImpl = fixedDate('2026-03-15');
  const probe = await loadDashboardUi({ dateImpl: DateImpl });
  const state = probe.DomainModel.createEmptyState();
  if (customMinusAtFour) state.settings.gradeMapping['4-'] = 4;
  const gradeCourse = addCourse(probe, state, {
    id: 'stats-grades', name: 'Biologie 10a', subject: 'Biologie', classLabel: '10a'
  });
  const upperCourse = addCourse(probe, state, {
    id: 'stats-upper', name: 'Physik Q1', subject: 'Physik', classLabel: 'Q1',
    schemaMode: probe.DomainModel.SCHEMA_MODES.UPPERSEC
  });
  const archivedCourse = addCourse(probe, state, {
    id: 'stats-archived', name: 'Archivkurs', subject: 'Chemie', classLabel: '10b',
    archivedAt: '2026-03-01T00:00:00.000Z'
  });

  const ada = addStudent(probe, state, { id: 'stats-ada', lastName: 'Lovelace', homeClass: '10a' });
  const berta = addStudent(probe, state, { id: 'stats-berta', lastName: 'Benz', homeClass: '10a' });
  const clara = addStudent(probe, state, { id: 'stats-clara', lastName: 'Schumann', homeClass: '10a' });
  const dora = addStudent(probe, state, { id: 'stats-dora', lastName: 'Maar', homeClass: '10a' });
  const euler = addStudent(probe, state, { id: 'stats-euler', lastName: 'Euler', homeClass: 'Q1' });
  const fermi = addStudent(probe, state, { id: 'stats-fermi', lastName: 'Fermi', homeClass: 'Q1' });
  const gauss = addStudent(probe, state, { id: 'stats-gauss', lastName: 'Gauss', homeClass: 'Q1' });
  const hilbert = addStudent(probe, state, { id: 'stats-hilbert', lastName: 'Hilbert', homeClass: 'Q1' });

  for (const student of [ada, berta, clara, dora]) {
    probe.DomainModel.enrollStudentInCourse(state, gradeCourse.id, student.id);
  }
  for (const student of [euler, fermi, gauss, hilbert]) {
    probe.DomainModel.enrollStudentInCourse(state, upperCourse.id, student.id);
  }
  probe.DomainModel.enrollStudentInCourse(state, archivedCourse.id, ada.id);

  addAssessment(probe, state, gradeCourse, {
    id: 'stats-grade-assessment',
    title: 'Lernkontrolle',
    scores: {
      [ada.id]: '2',
      [berta.id]: '4-',
      ...(customMinusAtFour ? { [clara.id]: '4' } : {}),
      [dora.id]: '99'
    }
  });
  addAssessment(probe, state, upperCourse, {
    id: 'stats-upper-assessment',
    title: 'Klausur',
    scores: {
      [euler.id]: '12',
      [fermi.id]: '4',
      [gauss.id]: '0',
      [hilbert.id]: '5'
    }
  });
  addAssessment(probe, state, archivedCourse, {
    id: 'stats-archived-assessment', title: 'Altleistung', scores: { [ada.id]: '6' }
  });
  archivedCourse.archiveSnapshot = probe.DomainModel.createArchiveSnapshot(state, archivedCourse);

  const app = await loadDashboardUi({ state, dateImpl: DateImpl });
  if (debug) app.storage.setItem('__debugMode', '1');
  await app.UiShell.init('app');
  await findByText(app.root, 'Statistik').dispatch('click');
  return { app, state, gradeCourse, upperCourse, archivedCourse };
}

async function mixedBoundaryStatisticsFixture() {
  const DateImpl = fixedDate('2026-03-15');
  const probe = await loadDashboardUi({ dateImpl: DateImpl });
  const state = probe.DomainModel.createEmptyState();
  const gradeCourse = addCourse(probe, state, {
    id: 'mixed-grades', name: 'Gemischte Notengrenzen', subject: 'Testfach', classLabel: 'T1'
  });
  const upperCourse = addCourse(probe, state, {
    id: 'mixed-upper', name: 'Gemischte Punktegrenzen', subject: 'Testfach', classLabel: 'Q1',
    schemaMode: probe.DomainModel.SCHEMA_MODES.UPPERSEC
  });
  const gradeScores = {};
  ['1', '2+', '2', '3+', '3', '4+', '4', '4-'].forEach((raw, index) => {
    const student = addStudent(probe, state, {
      id: `mixed-grade-${index}`, lastName: `Notengrenze ${index + 1}`, homeClass: 'T1'
    });
    probe.DomainModel.enrollStudentInCourse(state, gradeCourse.id, student.id);
    gradeScores[student.id] = raw;
  });
  const upperScores = {};
  ['5', '7'].forEach((raw, index) => {
    const student = addStudent(probe, state, {
      id: `mixed-upper-${index}`, lastName: `Punktegrenze ${index + 1}`, homeClass: 'Q1'
    });
    probe.DomainModel.enrollStudentInCourse(state, upperCourse.id, student.id);
    upperScores[student.id] = raw;
  });
  addAssessment(probe, state, gradeCourse, {
    id: 'mixed-grade-assessment', title: 'Notengrenzen', scores: gradeScores
  });
  addAssessment(probe, state, upperCourse, {
    id: 'mixed-upper-assessment', title: 'Punktegrenzen', scores: upperScores
  });
  const app = await loadDashboardUi({ state, dateImpl: DateImpl });
  await app.UiShell.init('app');
  await findByText(app.root, 'Statistik').dispatch('click');
  return { app, gradeCourse, upperCourse };
}

function statsTab(root, id) {
  return findByAttribute(root, 'id', `stats-tab-${id}`);
}

function statsPanel(root, id) {
  return findByAttribute(root, 'id', `stats-panel-${id}`);
}

function courseRow(root, courseId) {
  return findByAttribute(root, 'data-stats-course-id', courseId);
}

function detailAction(row) {
  return row._find(element => element.tagName === 'BUTTON' &&
    element.classList && element.classList.contains('stats-detail-action'));
}

function distributionBarForLabel(panel, label) {
  const row = panel._find(element => element.classList &&
    element.classList.contains('stats-distribution-row') &&
    element.children[0] && element.children[0].textContent === label);
  return row && row._find(element => element.classList &&
    element.classList.contains('stats-distribution-bar'));
}

function distributionSegmentBands(panel, label) {
  const bar = distributionBarForLabel(panel, label);
  return bar ? bar.children.map(segment => {
    return ['best', 'good', 'middle', 'notice', 'critical', 'neutral'].find(band =>
      segment.classList.contains(`stats-distribution-bar--${band}`)
    );
  }) : [];
}

function distributionRowForLabel(panel, label) {
  return panel._find(element => element.classList &&
    element.classList.contains('stats-distribution-row') &&
    element.children[0] && element.children[0].textContent === label);
}

test('Statistik bietet drei verknüpfte, per Tastatur bedienbare lokale Tabs', async () => {
  const { app } = await statisticsFixture();
  assert.equal(app.root.querySelector('h2').textContent, 'Statistik');
  assert.match(app.root.textContent, /berechenbaren Bewertungen/);
  assert.doesNotMatch(app.root.textContent, /Simulation/);

  const tablist = findByAttribute(app.root, 'role', 'tablist');
  const overview = statsTab(app.root, 'overview');
  const critical = statsTab(app.root, 'critical');
  const details = statsTab(app.root, 'details');
  assert.ok(tablist);
  assert.deepEqual([overview.textContent, critical.textContent, details.textContent], [
    'Kursübersicht', 'Kritische Bewertungen', 'Kursdetails'
  ]);
  assert.deepEqual([overview.tabIndex, critical.tabIndex, details.tabIndex], [0, -1, -1]);
  assert.equal(overview.getAttribute('aria-selected'), 'true');
  assert.equal(overview.getAttribute('aria-controls'), 'stats-panel-overview');
  assert.equal(statsPanel(app.root, 'overview').getAttribute('aria-labelledby'), 'stats-tab-overview');
  assert.equal(statsPanel(app.root, 'overview').hidden, false);
  assert.equal(statsPanel(app.root, 'critical').hidden, true);

  await overview.dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(app.document.activeElement, critical);
  assert.equal(critical.getAttribute('aria-selected'), 'true');
  assert.equal(statsPanel(app.root, 'critical').hidden, false);
  await critical.dispatch('keydown', { key: 'End' });
  assert.equal(app.document.activeElement, details);
  assert.equal(details.getAttribute('aria-selected'), 'true');
  await details.dispatch('keydown', { key: 'Home' });
  assert.equal(app.document.activeElement, overview);
  assert.equal(overview.getAttribute('aria-selected'), 'true');
});

test('Kursübersicht trennt gemischte Schemata, zählt nur Berechenbares und schließt Archive aus', async () => {
  const { app, gradeCourse, upperCourse, archivedCourse } = await statisticsFixture();
  const gradeRow = courseRow(app.root, gradeCourse.id);
  const upperRow = courseRow(app.root, upperCourse.id);
  assert.ok(gradeRow);
  assert.ok(upperRow);
  assert.equal(courseRow(app.root, archivedCourse.id), null);
  assert.deepEqual(gradeRow.children.map(cell => cell.textContent), [
    'Biologie 10a', '10a', 'Noten (1–6)', '2', '3.15', '3.15', 'Details ansehen'
  ]);
  assert.deepEqual(upperRow.children.map(cell => cell.textContent), [
    'Physik Q1', 'Q1', 'Punkte (0–15)', '4', '5.25', '4.50', 'Details ansehen'
  ]);
});

test('Gesamtbereiche verwenden die Farben ihrer tatsächlichen Werte ohne ihre Verteilungszahlen zu verändern', async () => {
  const { app, upperCourse } = await statisticsFixture();
  await statsTab(app.root, 'details').dispatch('click');

  const gradePanel = statsPanel(app.root, 'details');
  const gradeBar = distributionBarForLabel(gradePanel, '2,0–2,9');
  assert.ok(gradeBar, 'der echte Sek-I-Gesamtbereich fehlt');
  assert.deepEqual(distributionSegmentBands(gradePanel, '2,0–2,9'), ['good']);

  const selector = findByAttribute(app.root, 'id', 'stats-detail-course');
  selector.value = upperCourse.id;
  await selector.dispatch('change');
  const upperPanel = statsPanel(app.root, 'details');
  const upperBar = distributionBarForLabel(upperPanel, '10–12');
  assert.ok(upperBar, 'der echte Sek-II-Gesamtbereich fehlt');
  assert.deepEqual(distributionSegmentBands(upperPanel, '10–12'), ['good']);
  assert.deepEqual(distributionSegmentBands(upperPanel, '0–4'), ['critical']);
  assert.deepEqual(distributionSegmentBands(upperPanel, '5–9'), ['notice']);
  assert.deepEqual(
    ['0–4', '5–9', '10–12'].map(label => distributionRowForLabel(upperPanel, label).children[2].textContent),
    ['2 (50.0 %)', '1 (25.0 %)', '1 (25.0 %)']
  );
  assert.match(upperPanel.textContent, /Farben innerhalb eines Balkens zeigen die enthaltenen Notenbereiche/);
});

test('Gesamtbalken teilen alle gemischten Sek-I-Grenzen und den Sek-II-Bereich 5 bis 9 proportional auf', async () => {
  const { app, upperCourse } = await mixedBoundaryStatisticsFixture();
  await statsTab(app.root, 'details').dispatch('click');
  const gradePanel = statsPanel(app.root, 'details');
  const expectedGradeBands = [
    ['bis 1,9', ['best', 'good']],
    ['2,0–2,9', ['good', 'middle']],
    ['3,0–3,9', ['middle', 'notice']],
    ['4,0–4,9', ['notice', 'critical']]
  ];
  for (const [label, bands] of expectedGradeBands) {
    const bar = distributionBarForLabel(gradePanel, label);
    assert.deepEqual(distributionSegmentBands(gradePanel, label), bands, `${label} muss beide enthaltenen Bereiche zeigen`);
    assert.deepEqual(bar.children.map(segment => segment.style.width), ['50%', '50%']);
    const count = distributionRowForLabel(gradePanel, label).children[2];
    assert.equal(count.textContent, '2 (25.0 %)');
    assert.match(count.getAttribute('aria-label'), /1.*1/);
  }

  const selector = findByAttribute(app.root, 'id', 'stats-detail-course');
  selector.value = upperCourse.id;
  await selector.dispatch('change');
  const upperPanel = statsPanel(app.root, 'details');
  assert.deepEqual(distributionSegmentBands(upperPanel, '5–9'), ['notice', 'middle']);
  assert.deepEqual(distributionBarForLabel(upperPanel, '5–9').children.map(segment => segment.style.width), ['50%', '50%']);
  assert.equal(distributionRowForLabel(upperPanel, '5–9').children[2].textContent, '2 (100.0 %)');
});

test('Sek-II-Einzelverteilung unterscheidet 0, 4 und 5 Punkte mit unveränderten Anzahlen', async () => {
  const { app, upperCourse } = await statisticsFixture();
  await statsTab(app.root, 'details').dispatch('click');
  const selector = findByAttribute(app.root, 'id', 'stats-detail-course');
  selector.value = upperCourse.id;
  await selector.dispatch('change');
  const panel = statsPanel(app.root, 'details');
  const toggle = panel.querySelector('button.stats-assessment-toggle');
  await toggle.dispatch('click');
  const content = findByAttribute(panel, 'id', toggle.getAttribute('aria-controls'));

  for (const label of ['0', '4']) {
    assert.deepEqual(distributionSegmentBands(content, label), ['critical']);
  }
  assert.deepEqual(distributionSegmentBands(content, '5'), ['notice']);
  assert.deepEqual(distributionSegmentBands(content, '12'), ['good']);
  assert.deepEqual(
    ['0', '4', '5', '12'].map(label => distributionRowForLabel(content, label).children[2].textContent),
    ['1 (25.0 %)', '1 (25.0 %)', '1 (25.0 %)', '1 (25.0 %)']
  );
});

test('Sek-I-Einzelverteilung bewahrt den Poor-Override für 4− auch bei angepasstem Zahlenwert', async () => {
  const { app, gradeCourse } = await statisticsFixture({ customMinusAtFour: true });
  await statsTab(app.root, 'details').dispatch('click');
  const selector = findByAttribute(app.root, 'id', 'stats-detail-course');
  selector.value = gradeCourse.id;
  await selector.dispatch('change');
  const panel = statsPanel(app.root, 'details');
  const toggle = panel.querySelector('button.stats-assessment-toggle');
  await toggle.dispatch('click');
  const content = findByAttribute(panel, 'id', toggle.getAttribute('aria-controls'));

  assert.deepEqual(distributionSegmentBands(content, '4'), ['critical', 'notice']);
  const count = distributionRowForLabel(content, '4').children[2];
  assert.equal(count.textContent, '2 (66.7 %)');
  assert.match(count.getAttribute('aria-label'), /kritisch: 1/i);
  assert.match(count.getAttribute('aria-label'), /ausreichend: 1/i);
});

test('Detailaktion und Kursauswahl bleiben lokal und zeigen bestehende Verteilungen sowie echte Leistungsschalter', async () => {
  const { app, gradeCourse, upperCourse } = await statisticsFixture();
  const globalCourse = findByAttribute(app.root, 'id', 'current-course-select');
  const globalCourseId = globalCourse.value || globalCourse.options.find(option => option.selected).value;
  assert.equal(globalCourseId, gradeCourse.id);
  const beforeStored = JSON.stringify(await app.Storage.loadState());
  let saveCalls = 0;
  app.Storage.saveState = async () => { saveCalls += 1; };

  const upperRow = courseRow(app.root, upperCourse.id);
  const action = detailAction(upperRow);
  action.focus();
  await action.dispatch('click');

  assert.equal(statsTab(app.root, 'details').getAttribute('aria-selected'), 'true');
  const selector = findByAttribute(app.root, 'id', 'stats-detail-course');
  assert.equal(selector.value, upperCourse.id);
  assert.equal(app.document.activeElement && app.document.activeElement.id, 'stats-detail-course');
  assert.equal(globalCourse.value || globalCourse.options.find(option => option.selected).value, globalCourseId);
  assert.match(statsPanel(app.root, 'details').textContent, /Physik Q1/);
  assert.match(statsPanel(app.root, 'details').textContent, /Q1/);
  assert.match(statsPanel(app.root, 'details').textContent, /Kurshalbjahr/);
  assert.match(statsPanel(app.root, 'details').textContent, /Verteilung Rechenwerte/);

  const toggle = app.root.querySelector('button.stats-assessment-toggle');
  assert.ok(toggle);
  assert.equal(toggle.tagName, 'BUTTON');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  const controlled = findByAttribute(app.root, 'id', toggle.getAttribute('aria-controls'));
  assert.equal(controlled.hidden, true);
  await toggle.dispatch('click');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(controlled.hidden, false);
  assert.match(controlled.textContent, /Anzahl: 4/);
  assert.match(controlled.textContent, /Mittelwert: 5\.25/);

  selector.focus();
  selector.value = gradeCourse.id;
  await selector.dispatch('change');
  const replacementSelector = findByAttribute(app.root, 'id', 'stats-detail-course');
  assert.notEqual(replacementSelector, selector);
  assert.equal(replacementSelector.value, gradeCourse.id);
  assert.equal(app.document.activeElement === replacementSelector, true);
  assert.equal(globalCourse.value || globalCourse.options.find(option => option.selected).value, globalCourseId);
  assert.match(statsPanel(app.root, 'details').textContent, /Biologie 10a/);
  assert.equal(saveCalls, 0);
  assert.equal(JSON.stringify(await app.Storage.loadState()), beforeStored);
});

test('Kritische Bewertungen behalten Schwellen, Reihenfolge und fehlende Werte ohne Erfolgsbehauptung', async () => {
  const { app } = await statisticsFixture();
  await statsTab(app.root, 'critical').dispatch('click');
  const criticalPanel = statsPanel(app.root, 'critical');
  assert.match(criticalPanel.textContent, /Sek I: ab 4\.25/);
  assert.match(criticalPanel.textContent, /Sek II: bis 4 Punkte/);
  assert.match(criticalPanel.textContent, /Benz, Test/);
  assert.match(criticalPanel.textContent, /Fermi, Test/);
  assert.doesNotMatch(criticalPanel.textContent, /Lovelace, Test/);
  assert.doesNotMatch(criticalPanel.textContent, /Schumann, Test/);
  assert.doesNotMatch(criticalPanel.textContent, /Maar, Test/);
  assert.doesNotMatch(criticalPanel.textContent, /Euler, Test/);
  assert.doesNotMatch(criticalPanel.textContent, /Hilbert, Test/);
  assert.doesNotMatch(criticalPanel.textContent, /Archivkurs/);
});

test('ohne berechenbare Werte und ohne aktive Kurse bleiben alle drei Ansichten ehrlich bedienbar', async () => {
  const probe = await loadDashboardUi({ dateImpl: fixedDate('2026-03-15') });
  const blankState = probe.DomainModel.createEmptyState();
  const blankCourse = addCourse(probe, blankState, {
    id: 'blank-course', name: 'Deutsch', subject: 'Deutsch', classLabel: '9b'
  });
  const blankStudent = addStudent(probe, blankState, { id: 'blank-student', lastName: 'Leer', homeClass: '9b' });
  probe.DomainModel.enrollStudentInCourse(blankState, blankCourse.id, blankStudent.id);
  const blankApp = await loadDashboardUi({ state: blankState, dateImpl: fixedDate('2026-03-15') });
  await blankApp.UiShell.init('app');
  await findByText(blankApp.root, 'Statistik').dispatch('click');
  await statsTab(blankApp.root, 'critical').dispatch('click');
  assert.match(statsPanel(blankApp.root, 'critical').textContent, /Keine berechenbaren Werte/);
  assert.match(statsPanel(blankApp.root, 'critical').textContent, /Fehlende Bewertungen/);

  const emptyState = probe.DomainModel.createEmptyState();
  const onlyArchived = addCourse(probe, emptyState, {
    id: 'only-archived', name: 'Archiviert', subject: 'Geschichte', classLabel: '9c',
    archivedAt: '2026-03-01T00:00:00.000Z'
  });
  onlyArchived.archiveSnapshot = probe.DomainModel.createArchiveSnapshot(emptyState, onlyArchived);
  const emptyApp = await loadDashboardUi({ state: emptyState, dateImpl: fixedDate('2026-03-15') });
  await emptyApp.UiShell.init('app');
  await findByText(emptyApp.root, 'Statistik').dispatch('click');
  assert.match(statsPanel(emptyApp.root, 'overview').textContent, /Keine aktiven Kurse/);
  await statsTab(emptyApp.root, 'details').dispatch('click');
  assert.match(statsPanel(emptyApp.root, 'details').textContent, /Keine aktiven Kurse/);
});

test('Debug-Schutz bleibt erhalten und Sperren verwirft die lokale Statistik-Auswahl', async () => {
  const { app, upperCourse } = await statisticsFixture({ debug: true });
  assert.equal(app.root.querySelectorAll('.debug-block').length, 1);
  await detailAction(courseRow(app.root, upperCourse.id)).dispatch('click');
  assert.equal(statsTab(app.root, 'details').getAttribute('aria-selected'), 'true');

  app.Storage.lockSession();
  assert.ok(findByText(app.root, 'Anwendung gesperrt'));
  assert.equal(app.root.querySelectorAll('.debug-block').length, 0);
  app.sandbox.window.promptPassword = async () => app.password;
  await findByText(app.root, 'Entsperren').dispatch('click');
  await findByText(app.root, 'Statistik').dispatch('click');

  assert.equal(statsTab(app.root, 'overview').getAttribute('aria-selected'), 'true');
  assert.equal(statsPanel(app.root, 'overview').hidden, false);
  assert.equal(statsPanel(app.root, 'details').hidden, true);
});
