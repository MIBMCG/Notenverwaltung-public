'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDashboardUi, findByText, findByAttribute } = require('./harness/dashboard-app');

async function settleRender() {
  await new Promise(resolve => setImmediate(resolve));
}

function findByClass(root, className) {
  return root._find(element => element.classList && element.classList.contains(className));
}

async function studentsApp({ enrollCarl = true } = {}) {
  const probe = await loadDashboardUi();
  const state = probe.DomainModel.createEmptyState();
  const biology = probe.DomainModel.createCourse({
    id: 'students-biology', name: 'Biologie', subject: 'Biologie', classLabel: '10a'
  });
  const mathematics = probe.DomainModel.createCourse({
    id: 'students-mathematics', name: 'Mathematik', subject: 'Mathematik', classLabel: '9b'
  });
  const emmy = probe.DomainModel.createStudent({
    id: 'students-emmy', firstName: 'Emmy', lastName: 'Noether', birthDate: '23.03.1882', homeClass: '10a'
  });
  const carl = probe.DomainModel.createStudent({
    id: 'students-carl', firstName: 'Carl', lastName: 'Gauss', birthDate: '1777-04-30', homeClass: ''
  });
  probe.DomainModel.addCourseToState(state, biology);
  probe.DomainModel.addCourseToState(state, mathematics);
  probe.DomainModel.addStudentToState(state, emmy);
  probe.DomainModel.addStudentToState(state, carl);
  probe.DomainModel.enrollStudentInCourse(state, biology.id, emmy.id);
  probe.DomainModel.enrollStudentInCourse(state, mathematics.id, emmy.id);
  if (enrollCarl) probe.DomainModel.enrollStudentInCourse(state, biology.id, carl.id);

  const app = await loadDashboardUi({ state });
  await app.UiShell.init('app');
  const navigation = findByClass(app.root, 'nav-main');
  await findByText(navigation, 'Stammdaten').dispatch('click');
  await settleRender();
  return { app, state, biology, mathematics, emmy, carl };
}

test('die Stammdatenübersicht öffnet das Anlageformular erst auf Anforderung und fokussiert das erste Feld', async () => {
  const { app } = await studentsApp();
  const heading = app.root.querySelector('h2');
  const createButton = findByText(app.root, 'Schüler anlegen');
  const createDisclosure = findByClass(app.root, 'students-create');

  assert.ok(heading, app.root.textContent);
  assert.equal(heading.textContent, 'Schüler');
  assert.match(app.root.textContent, /Stammdaten und Kurszuordnungen/);
  assert.ok(createButton, 'die primäre Anlageaktion muss im Seitenkopf erreichbar sein');
  assert.ok(createDisclosure, 'das vorhandene Anlageformular muss in einem eigenen Bereich liegen');
  assert.equal(createDisclosure.open, false, 'das Anlageformular startet geschlossen');
  assert.equal(createButton.getAttribute('aria-controls'), 'students-create-form');
  assert.equal(createButton.getAttribute('aria-expanded'), 'false');

  await createButton.dispatch('click');
  const lastName = findByAttribute(createDisclosure, 'id', 'students-create-last-name');
  assert.equal(createDisclosure.open, true);
  assert.equal(createButton.getAttribute('aria-expanded'), 'true');
  assert.equal(app.document.activeElement, lastName, 'Öffnen fokussiert den Nachnamen als ersten sinnvollen Schritt');

  for (const [labelText, id] of [
    ['Nachname', 'students-create-last-name'],
    ['Vorname', 'students-create-first-name'],
    ['Geburtsdatum (optional)', 'students-create-birth-date'],
    ['Stammklasse', 'students-create-home-class']
  ]) {
    const label = createDisclosure._find(element => element.tagName === 'LABEL' && element.textContent === labelText);
    assert.ok(label, `${labelText} braucht eine sichtbare Beschriftung`);
    assert.equal(label.getAttribute('for'), id);
    assert.ok(findByAttribute(createDisclosure, 'id', id));
  }

  lastName.value = 'Entwurf bleibt';
  await findByText(createDisclosure, 'Schließen').dispatch('click');
  assert.equal(createDisclosure.open, false);
  assert.equal(createButton.getAttribute('aria-expanded'), 'false');
  assert.equal(app.document.activeElement, createButton, 'Schließen gibt den Fokus an die auslösende Aktion zurück');
  await createButton.dispatch('click');
  assert.equal(lastName.value, 'Entwurf bleibt', 'reines Ein- und Ausblenden darf den Formularentwurf nicht verwerfen');
});

test('klar beschriftete Filter kombinieren Namen, reine Stammklasse und Kurs mit live aktualisierter Anzahl', async () => {
  const { app, mathematics } = await studentsApp();
  const filterPanel = findByClass(app.root, 'students-filters');
  const tableBody = findByClass(app.root, 'students-list-body');
  const count = findByAttribute(app.root, 'id', 'students-filter-count');
  const labels = [
    ['Name suchen', 'students-name-filter'],
    ['Stammklasse filtern', 'students-class-filter'],
    ['Kurs filtern', 'students-course-filter']
  ];

  assert.ok(filterPanel);
  for (const [labelText, id] of labels) {
    const label = filterPanel._find(element => element.tagName === 'LABEL' && element.textContent === labelText);
    assert.ok(label, `${labelText} muss sichtbar sein`);
    assert.equal(label.getAttribute('for'), id);
    assert.ok(findByAttribute(filterPanel, 'id', id));
  }
  assert.equal(count.textContent, '2 von 2 Personen');

  const classFilter = findByAttribute(filterPanel, 'id', 'students-class-filter');
  classFilter.value = '9b';
  await classFilter.dispatch('change');
  assert.match(tableBody.textContent, /Keine Personen für diese Filterkombination/,
    'eine Kursklasse darf weder eine andere noch eine leere Stammklasse ersetzen');
  assert.equal(count.textContent, '0 von 2 Personen');

  classFilter.value = '';
  await classFilter.dispatch('change');

  const courseFilter = findByAttribute(filterPanel, 'id', 'students-course-filter');
  courseFilter.value = mathematics.id;
  await courseFilter.dispatch('change');
  assert.equal(tableBody.children.length, 1);
  assert.match(tableBody.textContent, /Noether, Emmy/);

  const nameFilter = findByAttribute(filterPanel, 'id', 'students-name-filter');
  nameFilter.value = 'Gauss';
  await nameFilter.dispatch('input');
  assert.equal(tableBody.children.length, 1, 'der leere Trefferzustand bleibt als Tabellenzeile lesbar');
  assert.match(tableBody.textContent, /Keine Personen für diese Filterkombination/);
  assert.equal(count.textContent, '0 von 2 Personen');
});

test('die Personenliste zeigt lesbare Kursmitgliedschaften und hält Berichte untergeordnet erreichbar', async () => {
  const { app } = await studentsApp();
  const tableBox = findByClass(app.root, 'students-list');
  const rows = findByClass(app.root, 'students-list-body').children;
  const badges = rows[1]._findAll(element => element.classList && element.classList.contains('students-course-badge'));
  const reports = findByClass(app.root, 'students-reports');

  assert.ok(tableBox);
  assert.equal(rows.length, 2, 'die sortierte Liste behält beide Personen');
  assert.match(rows[0].textContent, /Gauss, Carl/);
  assert.match(rows[1].textContent, /Noether, Emmy/);
  assert.equal(badges.length, 2);
  assert.match(badges[0].textContent + badges[1].textContent, /Biologie.*10a/);
  assert.match(badges[0].textContent + badges[1].textContent, /Mathematik.*9b/);
  const detailsButton = findByText(rows[1], 'Details');
  assert.ok(detailsButton);
  assert.ok(findByText(rows[1], 'Edit'));
  assert.ok(findByText(rows[1], 'Löschen'));

  await detailsButton.dispatch('click');
  const detailDialog = findByClass(app.document.body, 'students-detail-dialog');
  assert.equal(detailDialog.getAttribute('role'), 'dialog');
  assert.equal(detailDialog.getAttribute('aria-modal'), 'true');
  const detailTermLabel = detailDialog._find(element => element.tagName === 'LABEL' && element.textContent === 'Filter nach Halbjahr:');
  assert.equal(detailTermLabel.getAttribute('for'), 'students-detail-term-students-emmy');
  assert.ok(findByAttribute(detailDialog, 'id', 'students-detail-term-students-emmy'));
  const closeDialog = findByText(detailDialog, 'Schließen');
  assert.equal(app.document.activeElement, closeDialog, 'die geöffnete Detailansicht fokussiert ihre Schließen-Aktion');
  await closeDialog.dispatch('click');
  assert.equal(app.document.activeElement, detailsButton, 'Schließen kehrt zur auslösenden Zeilenaktion zurück');

  assert.ok(reports, 'der bestehende Sammeldruck bleibt erreichbar');
  assert.equal(reports.open, false, 'Berichte stehen visuell hinter der Personenliste zurück');
  assert.match(reports.textContent, /Berichte für angezeigte Personen/);
  assert.ok(findByText(reports, 'PDF für alle angezeigten Schüler drucken'));
});

test('die Inline-Bearbeitung nutzt beschriftete Stammdatenfelder und behält die vorhandenen Aktionen', async () => {
  const { app } = await studentsApp();
  const emmyRow = findByAttribute(app.root, 'data-student-id', 'students-emmy');
  await findByText(emmyRow, 'Edit').dispatch('click');

  const editFields = [
    ['Nachname', 'students-edit-students-emmy-last-name'],
    ['Vorname', 'students-edit-students-emmy-first-name'],
    ['Geburtsdatum', 'students-edit-students-emmy-birth-date'],
    ['Stammklasse', 'students-edit-students-emmy-home-class']
  ];
  for (const [labelText, id] of editFields) {
    const label = emmyRow._find(element => element.tagName === 'LABEL' && element.textContent === labelText);
    assert.ok(label, `${labelText} muss im Bearbeitungszustand sichtbar benannt sein`);
    assert.equal(label.getAttribute('for'), id);
    assert.ok(findByAttribute(emmyRow, 'id', id));
  }
  assert.equal(app.document.activeElement, findByAttribute(emmyRow, 'id', editFields[0][1]));
  assert.ok(findByText(emmyRow, 'Speichern'));
  assert.ok(findByText(emmyRow, 'Abbrechen'));
  assert.ok(findByText(emmyRow, 'Löschen'));
});

test('freie Geburtstagstexte bleiben beim Bearbeiten erhalten und lassen sich bewusst löschen', async () => {
  const { app } = await studentsApp();
  let emmyRow = findByAttribute(app.root, 'data-student-id', 'students-emmy');
  await findByText(emmyRow, 'Edit').dispatch('click');

  const birthDate = findByAttribute(emmyRow, 'id', 'students-edit-students-emmy-birth-date');
  const lastName = findByAttribute(emmyRow, 'id', 'students-edit-students-emmy-last-name');
  const homeClass = findByAttribute(emmyRow, 'id', 'students-edit-students-emmy-home-class');
  assert.equal(birthDate.type, 'text', 'bestehende freie Datumswerte brauchen ein Textfeld');
  assert.equal(birthDate.value, '23.03.1882');

  lastName.value = 'Noether-Test';
  homeClass.value = '10b';
  await findByText(emmyRow, 'Speichern').dispatch('click');
  let stored = await app.Storage.loadState();
  let storedEmmy = stored.students.find(student => student.id === 'students-emmy');
  assert.deepEqual(
    { lastName: storedEmmy.lastName, birthDate: storedEmmy.birthDate, homeClass: storedEmmy.homeClass },
    { lastName: 'Noether-Test', birthDate: '23.03.1882', homeClass: '10b' },
    'eine reine Namens- oder Klassenänderung darf den freien Geburtstagswert nicht verändern'
  );

  emmyRow = findByAttribute(app.root, 'data-student-id', 'students-emmy');
  await findByText(emmyRow, 'Edit').dispatch('click');
  const reopenedBirthDate = findByAttribute(emmyRow, 'id', 'students-edit-students-emmy-birth-date');
  reopenedBirthDate.value = '';
  await findByText(emmyRow, 'Speichern').dispatch('click');
  stored = await app.Storage.loadState();
  storedEmmy = stored.students.find(student => student.id === 'students-emmy');
  assert.equal(storedEmmy.birthDate, null, 'bewusstes Leeren bleibt als null gespeichert');
});

test('die Schüleranlage speichert ein frei eingegebenes Geburtsdatum unverändert', async () => {
  const { app } = await studentsApp();
  const createButton = findByText(app.root, 'Schüler anlegen');
  await createButton.dispatch('click');
  const createDisclosure = findByClass(app.root, 'students-create');
  const lastName = findByAttribute(createDisclosure, 'id', 'students-create-last-name');
  const firstName = findByAttribute(createDisclosure, 'id', 'students-create-first-name');
  const birthDate = findByAttribute(createDisclosure, 'id', 'students-create-birth-date');
  assert.equal(birthDate.type, 'text', 'die Anlage muss freie Datumsformate annehmen');

  lastName.value = 'Curie';
  firstName.value = 'Marie';
  birthDate.value = '07.11.1867';
  let pendingSave = null;
  const saveState = app.Storage.saveState;
  app.Storage.saveState = function (nextState) {
    pendingSave = saveState(nextState);
    return pendingSave;
  };
  await findByText(createDisclosure, 'Anlegen').dispatch('click');
  await pendingSave;

  const stored = await app.Storage.loadState();
  const created = stored.students.find(student => student.lastName === 'Curie' && student.firstName === 'Marie');
  assert.ok(created, 'die neu angelegte Person muss gespeichert sein');
  assert.equal(created.birthDate, '07.11.1867');
});

test('der Detaildialog hält Tab und Shift+Tab mit Halbjahresauswahl im Dialog und schließt per Escape', async () => {
  const { app } = await studentsApp();
  const emmyRow = findByAttribute(app.root, 'data-student-id', 'students-emmy');
  const detailsButton = findByText(emmyRow, 'Details');
  await detailsButton.dispatch('click');

  const dialog = findByClass(app.document.body, 'students-detail-dialog');
  const termSelect = findByAttribute(dialog, 'id', 'students-detail-term-students-emmy');
  const closeButton = findByText(dialog, 'Schließen');
  let prevented = 0;
  assert.equal(app.document.activeElement, closeButton);
  await dialog.dispatch('keydown', { key: 'Tab', preventDefault() { prevented += 1; } });
  assert.equal(app.document.activeElement && app.document.activeElement.id, termSelect.id,
    'Tab am letzten Element springt zum ersten Dialogfeld');
  await dialog.dispatch('keydown', { key: 'Tab', shiftKey: true, preventDefault() { prevented += 1; } });
  assert.equal(app.document.activeElement && app.document.activeElement.textContent, 'Schließen',
    'Shift+Tab am ersten Element springt zum letzten Dialogfeld');
  assert.equal(prevented, 2);

  await dialog.dispatch('keydown', { key: 'Escape', preventDefault() { prevented += 1; } });
  assert.equal(app.document.activeElement, detailsButton, 'Escape gibt den Fokus an die auslösende Aktion zurück');
  assert.equal(findByClass(app.document.body, 'students-detail-dialog'), null);
  assert.equal(dialog._listeners('keydown').length, 0, 'beim Schließen bleibt kein Dialog-Listener zurück');
  await dialog.dispatch('keydown', { key: 'Tab', preventDefault() { prevented += 1; } });
  assert.equal(prevented, 3, 'nach dem Escape-Schließen wirkt der entfernte Dialog-Listener nicht weiter');
  assert.equal(app.document.activeElement, detailsButton);
});

test('der Detaildialog hält die Tabgrenzen auch ohne Kurs- und Halbjahresauswahl', async () => {
  const { app } = await studentsApp({ enrollCarl: false });
  const carlRow = findByAttribute(app.root, 'data-student-id', 'students-carl');
  const detailsButton = findByText(carlRow, 'Details');
  await detailsButton.dispatch('click');

  const dialog = findByClass(app.document.body, 'students-detail-dialog');
  const printButton = findByText(dialog, '📄 PDF Notenübersicht drucken');
  const closeButton = findByText(dialog, 'Schließen');
  assert.equal(dialog.querySelector('select'), null, 'ohne Kurse gibt es keine Halbjahresauswahl');
  assert.equal(app.document.activeElement, closeButton);
  await dialog.dispatch('keydown', { key: 'Tab' });
  assert.equal(app.document.activeElement && app.document.activeElement.textContent, printButton.textContent,
    'Tab springt ohne Select zur ersten Aktion');
  await dialog.dispatch('keydown', { key: 'Tab', shiftKey: true });
  assert.equal(app.document.activeElement && app.document.activeElement.textContent, 'Schließen',
    'Shift+Tab springt zurück zur letzten Aktion');
  await dialog.dispatch('keydown', { key: 'Escape' });
  assert.equal(app.document.activeElement, detailsButton);
  assert.equal(findByClass(app.document.body, 'students-detail-dialog'), null);
  assert.equal(dialog._listeners('keydown').length, 0);
});
