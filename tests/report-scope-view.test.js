'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDashboardUi, findByText, findByAttribute } = require('./harness/dashboard-app');

class FixedMarch2026Date extends Date {
  constructor(...args) {
    super(...(args.length > 0 ? args : ['2026-03-15T12:00:00.000Z']));
  }

  static now() {
    return new Date('2026-03-15T12:00:00.000Z').getTime();
  }
}

async function settleRender() {
  await new Promise(resolve => setImmediate(resolve));
}

function findByClass(root, className) {
  return root._find(element => element.classList && element.classList.contains(className));
}

function findAllByClass(root, className) {
  return root._findAll(element => element.classList && element.classList.contains(className));
}

function optionTexts(select) {
  return select.options.map(option => option.textContent);
}

function addScoredAssessment(domain, state, course, students, term, raw) {
  const assessment = domain.createAssessment({
    id: course.id + '-' + term,
    courseId: course.id,
    categoryId: state.settings.categories[0].id,
    title: course.name + ' ' + term,
    term,
    visible: true
  });
  for (const student of students) {
    assessment.scores[student.id] = domain.createScoreEntry({ valueRaw: raw });
  }
  domain.addAssessmentToState(state, assessment);
  return assessment;
}

async function reportScopeApp() {
  const probe = await loadDashboardUi({ dateImpl: FixedMarch2026Date });
  const { DomainModel } = probe;
  const state = DomainModel.createEmptyState();
  const biology = DomainModel.createCourse({
    id: 'scope-biology', name: 'Biologie', subject: 'Biologie', classLabel: '10a', schoolYearStartYear: 2025
  });
  const mathematics = DomainModel.createCourse({
    id: 'scope-mathematics', name: 'Mathematik Q3/Q4', subject: 'Mathematik', classLabel: '9b',
    schoolYearStartYear: 2025, schemaMode: DomainModel.SCHEMA_MODES.UPPERSEC,
    upperSecContext: {
      courseType: DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
      qualificationYear: DomainModel.QUALIFICATION_YEARS.Q3_Q4,
      weightingDeviationReason: null
    }
  });
  const history = DomainModel.createCourse({
    id: 'scope-history', name: 'Geschichte Archiv', subject: 'Geschichte', classLabel: '10a', schoolYearStartYear: 2025
  });
  const ada = DomainModel.createStudent({
    id: 'scope-ada', firstName: 'Ada', lastName: 'Alpha', homeClass: '10a'
  });
  const bert = DomainModel.createStudent({
    id: 'scope-bert', firstName: 'Bert', lastName: 'Beta', homeClass: '9b'
  });
  const clara = DomainModel.createStudent({
    id: 'scope-clara', firstName: 'Clara', lastName: 'Ohnekurs', homeClass: '8c'
  });
  for (const course of [biology, mathematics, history]) DomainModel.addCourseToState(state, course);
  for (const student of [ada, bert, clara]) DomainModel.addStudentToState(state, student);
  DomainModel.enrollStudentInCourse(state, biology.id, ada.id);
  DomainModel.enrollStudentInCourse(state, mathematics.id, ada.id);
  DomainModel.enrollStudentInCourse(state, mathematics.id, bert.id);
  DomainModel.enrollStudentInCourse(state, history.id, ada.id);
  addScoredAssessment(DomainModel, state, biology, [ada], '2025-H1', '2');
  addScoredAssessment(DomainModel, state, biology, [ada], '2025-H2', '1');
  addScoredAssessment(DomainModel, state, mathematics, [ada, bert], '2025-H1', '12');
  addScoredAssessment(DomainModel, state, history, [ada], '2025-H1', '3');
  DomainModel.archiveCourse(state, history.id, 'manual', {});

  const app = await loadDashboardUi({ state, dateImpl: FixedMarch2026Date });
  await app.UiShell.init('app');
  const navigation = findByClass(app.root, 'nav-main');
  await findByText(navigation, 'Stammdaten').dispatch('click');
  await settleRender();
  return { app, biology, mathematics, history, ada, bert, clara };
}

// Break caught: a name input event must update the table, available report terms,
// and truthful selected-person scope from one filter result without opening or saving anything.
test('der Sammeldruckumfang folgt kombinierten Filtern und der sichtbaren Zeitraumwahl bereits beim Tippen', async () => {
  const { app, mathematics } = await reportScopeApp();
  let opened = 0;
  let saved = 0;
  app.sandbox.window.open = () => { opened += 1; return null; };
  app.Storage.saveState = async () => { saved += 1; };

  const reports = findByClass(app.root, 'students-reports');
  const scope = findByClass(reports, 'students-print-scope');
  const termSelect = findByAttribute(reports, 'id', 'students-report-term');
  const nameFilter = findByAttribute(app.root, 'id', 'students-name-filter');
  const classFilter = findByAttribute(app.root, 'id', 'students-class-filter');
  const courseFilter = findByAttribute(app.root, 'id', 'students-course-filter');
  const tableBody = findByClass(app.root, 'students-list-body');

  assert.ok(scope, 'vor der Sammeldruckaktion fehlt die semantische Umfangskarte');
  assert.equal(scope.getAttribute('aria-live'), 'polite');
  assert.match(scope.textContent, /Druckumfang/);
  assert.match(scope.textContent, /Personen:\s*3 angezeigt/);
  assert.match(scope.textContent, /Alle aktiven und archivierten Berichtskurse der angezeigten Personen/);
  assert.match(scope.textContent, /Zeitraumauswahl:\s*25\/26 H2/);
  assert.match(scope.textContent, /Nur für PDF-Berichte freigegebene Leistungen werden ausgegeben\./);
  assert.doesNotMatch(scope.textContent, /Seiten|Leistungen:\s*\d|ausgeblendet/i);
  assert.ok(optionTexts(termSelect).some(label => /25\/26 H1/.test(label) && /25\/26 Q3/.test(label)),
    'gemischte Sek-I-/Q-Labels müssen aus den vorhandenen Berichtskursen sichtbar bleiben');

  nameFilter.focus();
  nameFilter.value = 'Beta';
  await nameFilter.dispatch('input');
  assert.equal(app.document.activeElement, nameFilter, 'die Live-Aktualisierung darf den Schreibfokus nicht verschieben');
  assert.equal(tableBody.children.length, 1);
  assert.match(tableBody.textContent, /Beta, Bert/);
  assert.deepEqual(termSelect.options.map(option => option.value), ['', '2025-H1']);
  assert.match(scope.textContent, /Personen:\s*1 angezeigt/);
  assert.match(scope.textContent, /Zeitraumauswahl:\s*25\/26 Q3/,
    'die Karte muss schon im selben Input-Zyklus die neu aufgebaute Option anzeigen');

  termSelect.value = '';
  await termSelect.dispatch('change');
  assert.match(scope.textContent, /Zeitraumauswahl:\s*Alle Halbjahre/);
  reports.open = true;
  await reports.dispatch('toggle');
  assert.equal(termSelect.value, '', 'reines Öffnen und Schließen des Berichtsbereichs erhält die Auswahl');

  nameFilter.value = '';
  await nameFilter.dispatch('input');
  classFilter.value = '9b';
  await classFilter.dispatch('change');
  courseFilter.value = mathematics.id;
  await courseFilter.dispatch('change');
  assert.equal(tableBody.children.length, 1);
  assert.match(tableBody.textContent, /Beta, Bert/);
  assert.match(scope.textContent, /Personen:\s*1 angezeigt/);
  assert.match(scope.textContent, /Kurse:\s*Mathematik Q3\/Q4 \(9b\)/);
  assert.match(scope.textContent, /Zeitraumauswahl:\s*Alle Halbjahre/);

  nameFilter.value = 'Ohnekurs';
  await nameFilter.dispatch('input');
  assert.match(tableBody.textContent, /Keine Personen für diese Filterkombination/);
  assert.match(scope.textContent, /Keine Personen ausgewählt/);
  assert.deepEqual(termSelect.options.map(option => option.value), ['']);
  assert.equal(opened, 0, 'Filter- und Umfangsänderungen dürfen kein Druckfenster öffnen');
  assert.equal(saved, 0, 'Filter- und Umfangsänderungen dürfen nichts persistieren');
});

// Break caught: the personal card must describe every active and archived report
// course for that person, independent of the course filter used to find the row.
test('der persönliche Druckumfang ignoriert den Listen-Kursfilter, aktualisiert den Zeitraum und wird sauber entfernt', async () => {
  const { app, biology } = await reportScopeApp();
  const courseFilter = findByAttribute(app.root, 'id', 'students-course-filter');
  courseFilter.value = biology.id;
  await courseFilter.dispatch('change');

  const adaRow = findByAttribute(app.root, 'data-student-id', 'scope-ada');
  const detailsButton = findByText(adaRow, 'Details');
  await detailsButton.dispatch('click');
  let dialog = findByClass(app.document.body, 'students-detail-dialog');
  let scope = findByClass(dialog, 'students-print-scope');
  let detailTermSelect = findByAttribute(dialog, 'id', 'students-detail-term-scope-ada');

  assert.ok(scope);
  assert.match(scope.textContent, /Person:\s*Alpha, Ada/);
  assert.match(scope.textContent, /Biologie \(10a\)/);
  assert.match(scope.textContent, /Mathematik Q3\/Q4 \(9b\)/);
  assert.match(scope.textContent, /Geschichte Archiv \(10a, archiviert\)/);
  assert.match(scope.textContent, /Der Kursfilter der Personenliste begrenzt diesen persönlichen Bericht nicht\./);
  assert.match(scope.textContent, /Zeitraumauswahl:\s*25\/26 H2/);
  assert.equal(findAllByClass(dialog, 'students-print-scope').length, 1);
  const detailTables = dialog._findAll(element => element.tagName === 'TABLE');
  assert.ok(detailTables.length > 0, 'die synthetische Person braucht sichtbare Leistungsdaten für den Responsivtest');
  for (const table of detailTables) {
    assert.equal(table.parentNode.classList.contains('students-detail-table-scroll'), true,
      'jede breite Detailtabelle braucht innerhalb des Dialogs ihre eigene horizontale Scrollgrenze');
  }

  detailTermSelect.value = '2025-H1';
  await detailTermSelect.dispatch('change');
  assert.match(scope.textContent, /Zeitraumauswahl:\s*25\/26 H1 \/ 25\/26 Q3|Zeitraumauswahl:\s*25\/26 Q3 \/ 25\/26 H1/);

  await findByText(dialog, 'Schließen').dispatch('click');
  assert.ok(!findByClass(app.document.body, 'students-detail-dialog'));
  assert.ok(!findByClass(app.document.body, 'students-print-scope--personal'),
    'die Umfangskarte darf nach dem Schließen nicht im Dokument verbleiben');

  const reopenedFixture = await reportScopeApp();
  const reopenedApp = reopenedFixture.app;
  const reopenedAdaRow = findByAttribute(reopenedApp.root, 'data-student-id', 'scope-ada');
  await findByText(reopenedAdaRow, 'Details').dispatch('click');
  dialog = findByClass(reopenedApp.document.body, 'students-detail-dialog');
  scope = findByClass(dialog, 'students-print-scope');
  detailTermSelect = findByAttribute(dialog, 'id', 'students-detail-term-scope-ada');
  assert.equal(findAllByClass(dialog, 'students-print-scope').length, 1);
  assert.match(scope.textContent, /Zeitraumauswahl:\s*25\/26 H2/,
    'ein neu geöffneter Dialog darf keine alte Auswahl übernehmen');
  assert.equal(detailTermSelect.value, '2025-H2');

  reopenedApp.Storage.lockSession();
  assert.ok(!findByClass(reopenedApp.document.body, 'students-detail-dialog'),
    'die vorhandene Sitzungssperre muss den persönlichen Umfang mit dem Modal entfernen');
});

// Break caught: a selected person without any report course must stay printable
// as the existing informative page and must never acquire invented course counts.
test('eine Person ohne Berichtskurs bleibt als vorhandene Leerseite im Sammelbericht enthalten', async () => {
  const { app } = await reportScopeApp();
  const nameFilter = findByAttribute(app.root, 'id', 'students-name-filter');
  nameFilter.value = 'Ohnekurs';
  await nameFilter.dispatch('input');

  const reports = findByClass(app.root, 'students-reports');
  const batchScope = findByClass(reports, 'students-print-scope');
  assert.match(batchScope.textContent, /Personen:\s*1 angezeigt/);
  assert.match(batchScope.textContent, /Alle aktiven und archivierten Berichtskurse der angezeigten Personen/);
  assert.doesNotMatch(batchScope.textContent, /0 Kurse|0 Seiten/);

  const row = findByAttribute(app.root, 'data-student-id', 'scope-clara');
  await findByText(row, 'Details').dispatch('click');
  const dialog = findByClass(app.document.body, 'students-detail-dialog');
  const personalScope = findByClass(dialog, 'students-print-scope');
  assert.match(personalScope.textContent, /Person:\s*Ohnekurs, Clara/);
  assert.match(personalScope.textContent, /Kurse:\s*Keine Berichtskurse/);
  assert.match(personalScope.textContent, /Zeitraumauswahl:\s*Alle Halbjahre/);
  assert.equal(dialog.querySelector('select'), null);
  await findByText(dialog, 'Schließen').dispatch('click');

  let printedHtml = '';
  app.sandbox.window.open = () => ({
    closed: false,
    focus() {},
    print() {},
    document: {
      images: [],
      open() {},
      write(html) { printedHtml = html; },
      close() {}
    }
  });
  await findByText(reports, 'PDF für alle angezeigten Schüler drucken').dispatch('click');
  assert.match(printedHtml, /Notenübersicht: Ohnekurs, Clara/);
  assert.match(printedHtml, /Dieser Schüler ist in keinem Kurs eingeschrieben\./,
    'die bestehende informative Berichtseite darf nicht übersprungen werden');
});
