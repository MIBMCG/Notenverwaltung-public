'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDashboardUi, findByText, findByAttribute } = require('./harness/dashboard-app');

async function settleRender() {
  await new Promise(resolve => setImmediate(resolve));
}

async function waitForRender(predicate, message) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await settleRender();
  }
  assert.fail(message);
}

async function coursesApp() {
  const probe = await loadDashboardUi();
  const state = probe.DomainModel.createEmptyState();
  const first = probe.DomainModel.createCourse({
    id: 'courses-first', name: 'Biologie', subject: 'Biologie', classLabel: '10a'
  });
  const second = probe.DomainModel.createCourse({
    id: 'courses-second', name: 'Biologie', subject: 'Biologie', classLabel: '10b'
  });
  const archived = probe.DomainModel.createCourse({
    id: 'courses-archived', name: 'Chemie Archiv', subject: 'Chemie', classLabel: '9a'
  });
  const student = probe.DomainModel.createStudent({
    id: 'courses-student', firstName: 'Emmy', lastName: 'Noether', homeClass: '10b'
  });
  probe.DomainModel.addStudentToState(state, student);
  probe.DomainModel.addCourseToState(state, first);
  probe.DomainModel.addCourseToState(state, second);
  probe.DomainModel.addCourseToState(state, archived);
  probe.DomainModel.enrollStudentInCourse(state, second.id, student.id);
  probe.DomainModel.archiveCourse(state, archived.id, 'manual', {});
  const app = await loadDashboardUi({ state });
  await app.UiShell.init('app');
  await findByText(app.root, 'Kurse').dispatch('click');
  await settleRender();
  return { app, first, second, archived };
}

function cardAction(app, courseId, role) {
  const card = findByAttribute(app.root, 'data-course-id', courseId);
  return card && findByAttribute(card, 'data-role', role);
}

function courseEditor(app) {
  return app.root._find(element => element.tagName === 'DETAILS' &&
    element.classList && element.classList.contains('courses-editor'));
}

function courseEditorTab(editor, tab) {
  return editor._find(element => element.getAttribute &&
    element.getAttribute('data-course-editor-tab') === tab);
}

function courseEditorPanel(editor, tab) {
  return editor._find(element => element.getAttribute &&
    element.getAttribute('data-course-editor-panel') === tab);
}

test('das echte Kursmenü zeigt aktive Konzeptkarten, getrenntes Archiv und geschlossene Hinweise', async () => {
  const { app, first, second, archived } = await coursesApp();
  const overview = app.root._find(element => element.classList &&
    element.classList.contains('courses-active-overview'));
  const notices = app.root._find(element => element.tagName === 'DETAILS' &&
    element.classList && element.classList.contains('courses-notices'));
  const cards = overview._findAll(element => element.getAttribute && element.getAttribute('data-role') === 'card');

  assert.equal(app.root.querySelector('h2').textContent, 'Kurse');
  assert.ok(findByText(app.root, 'KURSVERWALTUNG'));
  assert.ok(findByText(app.root, 'Kurs anlegen'));
  assert.ok(findByText(app.root, 'Schuljahreswechsel'));
  assert.ok(findByText(app.root, '2 aktive Kurse'));
  assert.equal(cards.length, 2);
  assert.ok(findByAttribute(overview, 'data-course-id', first.id));
  assert.match(findByAttribute(overview, 'data-course-id', second.id).textContent, /1 Schüler/);
  assert.equal(findByAttribute(overview, 'data-course-id', archived.id), null);
  assert.equal(overview._find(element => element.tagName === 'TABLE'), null,
    'die aktive Übersicht darf nicht auf die alte Kurstabelle zurückfallen');
  assert.equal(courseEditor(app).open, false, 'das vorhandene Bearbeitungsformular startet geschlossen');
  assert.equal(notices.open, false);
  assert.ok(findByText(notices, 'Hinweise zu Speicherung und Bewertung'));
  assert.match(notices.textContent, /Die Anwendung speichert Daten lokal/);
  assert.match(notices.textContent, /Auswahl des Bewertungsschemas/);
  assert.match(app.root.textContent, /Archivierte Kurse \(1\)/);
});

test('Kurs bearbeiten öffnet den richtigen bestehenden Editor und hält ihn nach Speichern offen', async () => {
  const { app, first, second } = await coursesApp();
  const originalCreateElement = app.document.createElement.bind(app.document);
  let scrollRequest = null;
  app.document.createElement = tagName => {
    const element = originalCreateElement(tagName);
    element.scrollIntoView = options => { scrollRequest = { element, options }; };
    return element;
  };
  await cardAction(app, second.id, 'edit').dispatch('click');

  let editor = courseEditor(app);
  assert.equal(editor.open, true);
  assert.match(editor.textContent, /Aktueller Kurs: Biologie \(10b\)/);
  assert.ok(app.document.activeElement === editor.querySelector('summary'),
    'Kurs bearbeiten muss den geöffneten Verwaltungsbereich fokussieren');
  assert.ok(scrollRequest && scrollRequest.element === editor,
    'Kurs bearbeiten muss den tief liegenden Editor sichtbar an den Fensteranfang holen');
  assert.equal(scrollRequest.options.block, 'start');
  const nameInput = editor._find(element => element.tagName === 'INPUT' && element.value === 'Biologie');
  assert.ok(nameInput, 'das vorhandene Kursformular muss im nativen Detailbereich liegen');
  nameInput.value = 'Biologie Leistungskurs';
  await nameInput.dispatch('change');
  await waitForRender(
    () => /Biologie Leistungskurs/.test(courseEditor(app).textContent),
    'das gespeicherte Kursformular wurde nicht neu gerendert'
  );

  editor = courseEditor(app);
  assert.equal(editor.open, true, 'ein Speichern mit Re-Render darf den geöffneten Editor nicht schließen');
  assert.match(editor.textContent, /Aktueller Kurs: Biologie Leistungskurs \(10b\)/);
  const select = findByAttribute(app.root, 'id', 'current-course-select');
  select.value = first.id;
  await select.dispatch('change');
  await settleRender();
  assert.equal(courseEditor(app).open, false, 'die Kopfauswahl darf keinen Editor des vorherigen Kurses offen lassen');
  assert.match(courseEditor(app).textContent, /Aktueller Kurs: Biologie \(10a\)/);
});

test('der Kurseditor trennt allgemeine Angaben, Zuordnung und Bewertung als zugängliche Bereiche', async () => {
  const { app, second } = await coursesApp();
  await cardAction(app, second.id, 'edit').dispatch('click');

  const editor = courseEditor(app);
  const tablist = editor._find(element => element.getAttribute && element.getAttribute('role') === 'tablist');
  const general = courseEditorTab(editor, 'general');
  const students = courseEditorTab(editor, 'students');
  const grading = courseEditorTab(editor, 'grading');
  assert.ok(tablist, 'die drei Kursbereiche brauchen eine gemeinsame zugängliche Navigation');
  assert.equal(general.getAttribute('role'), 'tab');
  assert.equal(general.getAttribute('aria-selected'), 'true');
  assert.equal(students.getAttribute('aria-selected'), 'false');
  assert.equal(grading.getAttribute('aria-selected'), 'false');
  assert.match(courseEditorPanel(editor, 'general').textContent, /Kursname/);
  assert.equal(courseEditorPanel(editor, 'students').hidden, true);
  assert.equal(courseEditorPanel(editor, 'grading').hidden, true);

  await grading.dispatch('click');
  assert.equal(grading.getAttribute('aria-selected'), 'true');
  assert.equal(courseEditorPanel(editor, 'grading').hidden, false);
  assert.equal(courseEditorPanel(editor, 'general').hidden, true);
  assert.equal(app.document.activeElement, grading, 'der aktivierte Bereich bleibt für die Tastatur fokussiert');
  assert.match(courseEditorPanel(editor, 'grading').textContent, /Bewertungsschema/);
  assert.match(courseEditorPanel(editor, 'grading').textContent, /Gewichtungsvorlage/);
  assert.match(courseEditorPanel(editor, 'grading').textContent, /Änderungen.*sofort.*Berechnung/);
});

test('der Kurseditor verknüpft seine zentralen Angaben mit ihren sichtbaren Beschriftungen', async () => {
  const { app, second } = await coursesApp();
  await cardAction(app, second.id, 'edit').dispatch('click');

  const editor = courseEditor(app);
  const labelledControls = [
    ['general', 'Kursname:', 'INPUT'],
    ['general', 'Fach:', 'INPUT'],
    ['general', 'Klasse / Kursbezeichnung:', 'INPUT'],
    ['grading', 'Bewertungsschema:', 'SELECT'],
    ['grading', 'Gewichtungsvorlage:', 'SELECT'],
    ['students', 'Schüler aus Stammdaten:', 'SELECT']
  ];
  for (const [panelId, labelText, tagName] of labelledControls) {
    const panel = courseEditorPanel(editor, panelId);
    const label = panel._find(element => element.tagName === 'LABEL' && element.textContent === labelText);
    const control = panel._find(element => element.tagName === tagName && label && element.id === label.getAttribute('for'));
    assert.ok(label, `${labelText} muss als sichtbare Formularbeschriftung vorliegen`);
    assert.ok(control, `${labelText} muss ihr Feld über for und id benennen`);
  }
});

test('Tastaturwechsel behält ungespeicherte Stichtage im selben Kurseditor', async () => {
  const { app, second } = await coursesApp();
  await cardAction(app, second.id, 'edit').dispatch('click');
  const editor = courseEditor(app);
  const general = courseEditorTab(editor, 'general');
  const students = courseEditorTab(editor, 'students');
  const cutoffToggle = courseEditorPanel(editor, 'general')._find(element =>
    element.tagName === 'INPUT' && element.type === 'checkbox'
  );
  const cutoffDate = courseEditorPanel(editor, 'general')._find(element =>
    element.tagName === 'INPUT' && element.type === 'date'
  );
  cutoffToggle.checked = true;
  await cutoffToggle.dispatch('change');
  cutoffDate.value = '2026-01-31';

  await general.dispatch('keydown', { key: 'ArrowRight' });
  assert.equal(students.getAttribute('aria-selected'), 'true');
  assert.equal(courseEditorPanel(editor, 'general').hidden, true);
  await students.dispatch('keydown', { key: 'Home' });
  assert.equal(general.getAttribute('aria-selected'), 'true');
  assert.equal(cutoffDate.value, '2026-01-31', 'Bereichswechsel darf den noch nicht gespeicherten Stichtag nicht verwerfen');
});

test('der Bewertungsbereich zeigt den vollständigen Sek-II-Kontext und behält einen unvollständigen Entwurf beim Bereichswechsel', async () => {
  const { app, second } = await coursesApp();
  await cardAction(app, second.id, 'edit').dispatch('click');
  const editor = courseEditor(app);
  const grading = courseEditorTab(editor, 'grading');
  const students = courseEditorTab(editor, 'students');
  await grading.dispatch('click');

  const gradingPanel = courseEditorPanel(editor, 'grading');
  const schemaSelect = findByAttribute(gradingPanel, 'id', 'course-editor-schema');
  schemaSelect.value = app.DomainModel.SCHEMA_MODES.UPPERSEC;
  await schemaSelect.dispatch('change');
  assert.match(gradingPanel.textContent, /Kursart/);
  assert.match(gradingPanel.textContent, /Qualifikationsabschnitt/);
  assert.match(gradingPanel.textContent, /Begründung der Abweichung/);

  const courseTypeSelect = gradingPanel._find(element => element.tagName === 'SELECT' &&
    element.children.some(option => option.value === app.DomainModel.UPPERSEC_COURSE_TYPES.BASIC));
  const qualificationYearSelect = gradingPanel._find(element => element.tagName === 'SELECT' &&
    element.children.some(option => option.value === app.DomainModel.QUALIFICATION_YEARS.Q1_Q2));
  courseTypeSelect.value = app.DomainModel.UPPERSEC_COURSE_TYPES.BASIC;
  await courseTypeSelect.dispatch('change');
  assert.equal(qualificationYearSelect.value, '', 'der Entwurf ist vor der vollständigen Auswahl noch nicht speicherbar');

  await students.dispatch('click');
  await grading.dispatch('click');
  assert.equal(courseTypeSelect.value, app.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
    'ein Bereichswechsel darf die noch unvollständige Kursart nicht verwerfen');
  assert.equal(qualificationYearSelect.value, '',
    'ein Bereichswechsel darf den unvollständigen Sek-II-Entwurf nicht künstlich vervollständigen');
});

test('Speichern behält den aktiven Kursbereich, Kurs- und Bereichswechsel setzen ihn zurück', async () => {
  const { app, first, second } = await coursesApp();
  await cardAction(app, second.id, 'edit').dispatch('click');
  let editor = courseEditor(app);
  let grading = courseEditorTab(editor, 'grading');
  await grading.dispatch('click');
  const nameInput = courseEditorPanel(editor, 'general')._find(element =>
    element.tagName === 'INPUT' && element.type === 'text' && element.value === 'Biologie'
  );
  nameInput.value = 'Biologie Leistungskurs';
  await nameInput.dispatch('change');
  await waitForRender(() => courseEditor(app).textContent.includes('Biologie Leistungskurs'),
    'das Speichern im selben Kurs wurde nicht neu gerendert');
  editor = courseEditor(app);
  grading = courseEditorTab(editor, 'grading');
  assert.equal(grading.getAttribute('aria-selected'), 'true', 'ein Speichern darf den gewählten Bereich nicht zurücksetzen');
  assert.equal(app.document.activeElement, grading, 'nach dem Speichern soll die Kursbereichsnavigation erneut fokussiert werden');

  const select = findByAttribute(app.root, 'id', 'current-course-select');
  select.value = first.id;
  await select.dispatch('change');
  await settleRender();
  assert.equal(courseEditorTab(courseEditor(app), 'general').getAttribute('aria-selected'), 'true');

  await findByText(app.root, 'Übersicht').dispatch('click');
  await settleRender();
  await findByText(app.root, 'Kurse').dispatch('click');
  await settleRender();
  assert.equal(courseEditorTab(courseEditor(app), 'general').getAttribute('aria-selected'), 'true');
});

test('ein später abgeschlossener Speichervorgang fokussiert den inzwischen gewählten Kursbereich', { timeout: 5000 }, async () => {
  const { app, second } = await coursesApp();
  await cardAction(app, second.id, 'edit').dispatch('click');
  const editor = courseEditor(app);
  const nameInput = findByAttribute(courseEditorPanel(editor, 'general'), 'id', 'course-editor-name');
  const grading = courseEditorTab(editor, 'grading');
  const originalSaveState = app.Storage.saveState;
  let finishSave;
  let markSaveStarted;
  const saveGate = new Promise(resolve => { finishSave = resolve; });
  const saveStarted = new Promise(resolve => { markSaveStarted = resolve; });
  app.Storage.saveState = async candidate => {
    markSaveStarted();
    await saveGate;
    return originalSaveState.call(app.Storage, candidate);
  };

  try {
    nameInput.value = 'Biologie mit verzögertem Speichern';
    const saving = nameInput.dispatch('change');
    await Promise.race([
      saveStarted,
      new Promise((resolve, reject) => setTimeout(() => reject(new Error('Der Speicheraufschub wurde nicht erreicht.')), 250))
    ]);
    await grading.dispatch('click');
    assert.equal(app.document.activeElement, grading, 'vor Abschluss des Speicherns ist Bewertung aktiv');

    finishSave();
    await saving;
    await waitForRender(
      () => courseEditor(app).textContent.includes('Biologie mit verzögertem Speichern'),
      'der verzögerte Speichervorgang muss den Kurseditor neu rendern'
    );

    const refreshedEditor = courseEditor(app);
    const selectedTab = courseEditorTab(refreshedEditor, 'grading');
    assert.equal(selectedTab.getAttribute('aria-selected'), 'true');
    const stored = await app.Storage.loadState();
    assert.equal(stored.courses.find(course => course.id === second.id).name, 'Biologie mit verzögertem Speichern');
    assert.ok(app.document.activeElement === selectedTab,
      'ein alter Speichervorgang darf keinen inzwischen inaktiven Bereich fokussieren');
  } finally {
    app.Storage.saveState = originalSaveState;
    if (typeof finishSave === 'function') finishSave();
  }
});

test('Noten öffnen aus dem Kursmenü verwendet die geklickte Kurs-ID', async () => {
  const { app, second } = await coursesApp();
  await cardAction(app, second.id, 'open').dispatch('click');

  assert.equal(app.root.querySelector('h2').textContent, 'Noteneingabe');
  assert.ok(findByText(app.root, 'Biologie · 10b'));
});

for (const role of ['open', 'edit']) {
  test(`${role}: eine inzwischen inaktive Kurs-ID bleibt im Kursmenü gesperrt`, async () => {
    const { app, first } = await coursesApp();
    const notices = [];
    app.sandbox.window.alert = message => notices.push(String(message));
    const action = cardAction(app, first.id, role);
    const originalListActiveCourses = app.DomainModel.listActiveCourses;
    app.DomainModel.listActiveCourses = () => [];
    try {
      await action.dispatch('click');
    } finally {
      app.DomainModel.listActiveCourses = originalListActiveCourses;
    }

    assert.equal(app.root.querySelector('h2').textContent, 'Kurse');
    assert.match(notices[0], /nicht mehr aktiv/i);
    assert.equal(findByText(app.root, 'Noteneingabe'), null);
    assert.equal(courseEditor(app), null);
  });
}

test('Sitzungssperre entfernt Kurskarten und macht alte Verwaltungs-Callbacks wirkungslos', async () => {
  const { app, second } = await coursesApp();
  const open = cardAction(app, second.id, 'open');
  const edit = cardAction(app, second.id, 'edit');

  app.Storage.lockSession();
  assert.ok(findByText(app.root, 'Anwendung gesperrt'));
  assert.equal(findByAttribute(app.root, 'data-course-id', second.id), null);
  assert.doesNotMatch(app.root.textContent, /Biologie|Noether/);

  await open.dispatch('click');
  await edit.dispatch('click');
  assert.ok(findByText(app.root, 'Anwendung gesperrt'));
  assert.equal(findByText(app.root, 'Noteneingabe'), null);
  assert.doesNotMatch(app.root.textContent, /Biologie|Noether/);
});

test('Sperren und Entsperren setzt den geöffneten Kurseditor auf Allgemeines zurück', async () => {
  const { app, second } = await coursesApp({ encrypted: true });
  await cardAction(app, second.id, 'edit').dispatch('click');
  const editor = courseEditor(app);
  await courseEditorTab(editor, 'grading').dispatch('click');
  assert.equal(courseEditorTab(editor, 'grading').getAttribute('aria-selected'), 'true');

  app.Storage.lockSession();
  const unlock = findByText(app.root, 'Entsperren');
  app.sandbox.window.promptPassword = async () => app.password;
  await unlock.dispatch('click');
  await findByText(app.root, 'Kurse').dispatch('click');
  await settleRender();

  assert.equal(courseEditorTab(courseEditor(app), 'general').getAttribute('aria-selected'), 'true');
  assert.equal(courseEditorTab(courseEditor(app), 'grading').getAttribute('aria-selected'), 'false');
});

test('nur im Kursmenü wird die native Kopfauswahl als ruhiger Kontext dargestellt', async () => {
  const { app } = await coursesApp();
  let wrapper = app.root._find(element => element.classList && element.classList.contains('course-select-wrapper'));
  assert.equal(wrapper.classList.contains('course-select-wrapper--quiet'), true);
  const select = findByAttribute(wrapper, 'id', 'current-course-select');
  assert.equal(select.tagName, 'SELECT');
  assert.equal(wrapper._find(element => element.tagName === 'LABEL').getAttribute('for'), select.id);

  await findByText(app.root, 'Übersicht').dispatch('click');
  await settleRender();
  wrapper = app.root._find(element => element.classList && element.classList.contains('course-select-wrapper'));
  assert.equal(wrapper.classList.contains('course-select-wrapper--quiet'), false);
});
