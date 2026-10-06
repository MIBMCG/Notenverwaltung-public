'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDashboardUi, findByText, findByAttribute } = require('./harness/dashboard-app');
const { loadModules } = require('./harness/load');
const { loadEsmGraph } = require('./harness/load-esm-graph');
const { createStartDocument } = require('./harness/start-dom');

test('die Symbolvorschau behält das zuletzt eingegebene Fach beim Zurückwechseln zur Automatik', async () => {
  const { createCourseSymbolPicker } = loadEsmGraph('src/ui/course-symbol-picker.js').exports;
  const { document } = createStartDocument();
  const picker = createCourseSymbolPicker({ document, id: 'test-symbol', course: { subject: '' } });
  picker.updatePreview('Chemie');
  assert.ok(findByAttribute(picker.root, 'data-course-symbol', 'flask'));
  picker.select.value = 'music';
  await picker.select.dispatch('change');
  picker.select.value = 'auto';
  await picker.select.dispatch('change');
  assert.ok(findByAttribute(picker.root, 'data-course-symbol', 'flask'));
});

test('eine eigene Symbolwahl bleibt bei Normalisierung und Kursnachfolge erhalten', () => {
  const { DomainModel: domain } = loadModules();
  const state = domain.createEmptyState();
  const course = domain.createCourse({ id: 'symbol-course', name: 'Testkurs', subject: 'Biologie', symbolId: 'globe', schoolYearStartYear: 2026 });
  assert.equal(course.symbolId, 'globe');
  domain.addCourseToState(state, course);
  const restored = domain.ensureStateShape(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.courses[0].symbolId, 'globe');
  const next = domain.createSuccessorCourseCandidate(restored.courses[0], 2027);
  assert.equal(next.symbolId, 'globe');
});

test('unbekannte Symbolwerte aus Sicherungen fallen sicher auf die Fachautomatik zurück', () => {
  const { DomainModel: domain } = loadModules();
  const state = domain.createEmptyState();
  const course = domain.createCourse({ id: 'unknown-symbol', name: 'Testkurs', subject: 'Chemie' });
  course.symbolId = '<svg onload=alert(1)>';
  state.courses.push(course);
  const restored = domain.ensureStateShape(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.courses[0].symbolId, undefined);
});

test('Zusammenführen übernimmt neue Kurssymbole und bewahrt die lokale Auswahl bestehender Kurse', () => {
  const { DomainModel: domain, ImportMerge } = loadModules();
  const local = domain.createEmptyState();
  local.courses.push(domain.createCourse({ id: 'local', name: 'Bestehend', subject: 'Biologie', symbolId: 'leaf' }));
  const incoming = JSON.parse(JSON.stringify(local));
  incoming.courses[0].symbolId = 'music';
  incoming.courses.push(domain.createCourse({ id: 'new', name: 'Neu', subject: 'Chemie', symbolId: 'flask' }));
  const merged = ImportMerge.mergeImportedStateIntoCurrent(local, incoming);
  const result = merged.state;
  assert.equal(result.courses.find(course => course.id === 'local').symbolId, 'leaf');
  assert.equal(result.courses.find(course => course.name === 'Neu').symbolId, 'flask');
});

async function appWithCourse({ subject = 'Geografie', symbolId, student = false } = {}) {
  const probe = await loadDashboardUi();
  const state = probe.DomainModel.createEmptyState();
  const course = probe.DomainModel.createCourse({ id: 'symbol-course', name: 'TEST Fachkurs', subject, classLabel: '10a', symbolId });
  probe.DomainModel.addCourseToState(state, course);
  if (student) {
    const person = probe.DomainModel.createStudent({ id: 'synthetic-person', firstName: 'Ada', lastName: 'Beispiel' });
    probe.DomainModel.addStudentToState(state, person);
    probe.DomainModel.enrollStudentInCourse(state, course.id, person.id);
  }
  const app = await loadDashboardUi({ state });
  await app.UiShell.init('app');
  return app;
}

async function settled() { await new Promise(resolve => setImmediate(resolve)); }

test('ein fehlgeschlagenes Speichern meldet den Fehler und erhält die bisherige Symbolwahl', async () => {
  const app = await appWithCourse({ symbolId: 'leaf' });
  await findByText(app.root, 'Kurse').dispatch('click');
  const card = findByAttribute(app.root, 'data-course-id', 'symbol-course');
  await findByAttribute(card, 'data-role', 'edit').dispatch('click');
  const alerts = [];
  app.sandbox.window.alert = message => alerts.push(String(message));
  const realSave = app.Storage.saveState;
  app.Storage.saveState = async () => { throw new Error('Synthetischer Speicherfehler'); };
  const select = findByAttribute(app.root, 'id', 'course-editor-symbol');
  select.value = 'sport';
  await select.dispatch('change');
  app.Storage.saveState = realSave;
  assert.equal((await app.Storage.loadState()).courses[0].symbolId, 'leaf');
  assert.equal(findByAttribute(app.root, 'id', 'course-editor-symbol').value, 'leaf');
  assert.ok(alerts.some(message => /nicht gespeichert/i.test(message)), 'Fehler darf nicht still verschwinden');
});

test('Fachautomatik und gespeicherte Auswahl erreichen beide Kurskartenansichten', async () => {
  const app = await appWithCourse();
  assert.ok(findByAttribute(app.root, 'data-course-symbol', 'globe'), 'Geografie zeigt einen Globus');
  await findByText(app.root, 'Kurse').dispatch('click');
  await settled();
  const card = findByAttribute(app.root, 'data-course-id', 'symbol-course');
  await findByAttribute(card, 'data-role', 'edit').dispatch('click');
  const select = findByAttribute(app.root, 'id', 'course-editor-symbol');
  assert.ok(select, 'Symbolauswahl im Kurseditor vorhanden');
  assert.equal(select.value, 'auto');
  select.value = 'music';
  await select.dispatch('change');
  for (let n = 0; n < 40; n++) {
    if ((await app.Storage.loadState()).courses[0].symbolId === 'music') break;
    await settled();
  }
  assert.equal((await app.Storage.loadState()).courses[0].symbolId, 'music');
  await findByText(app.root, 'Übersicht').dispatch('click');
  await settled();
  assert.ok(findByAttribute(app.root, 'data-course-symbol', 'music'));
  await app.Storage.lockSession();
  const reloaded = await loadDashboardUi({ storage: app.storage, lockManager: app.lockManager, useExistingStorage: true });
  await reloaded.UiShell.init('app');
  assert.ok(findByAttribute(reloaded.root, 'data-course-symbol', 'music'), 'verschlüsseltes Neuladen erhält die Auswahl');
});

test('ein Sek-I-Kurs ohne Leistungen zeigt zugeordnete Schüler bereits in der Notenansicht', async () => {
  const app = await appWithCourse({ student: true });
  const card = findByAttribute(app.root, 'data-course-id', 'symbol-course');
  await findByAttribute(card, 'data-role', 'open').dispatch('click');
  await settled();
  const roster = findByAttribute(app.root, 'data-role', 'empty-course-roster');
  assert.ok(roster, 'Schülerliste darf nicht von einer Leistung abhängen');
  assert.match(roster.textContent, /Beispiel/);
  assert.match(roster.textContent, /Ada/);
  const search = findByAttribute(app.root, 'aria-label', 'Schüler in Notentabelle suchen');
  search.value = 'Nicht vorhanden';
  await search.dispatch('input');
  assert.equal(roster.querySelector('li').hidden, true, 'Namensfilter gilt auch ohne Leistungen');
  search.value = 'Ada';
  await search.dispatch('input');
  assert.equal(roster.querySelector('li').hidden, false);
  assert.equal((await app.Storage.loadState()).assessments.length, 0, 'Anzeige erzeugt keine Dummy-Leistung');
});
