'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDashboardUi, findByText, findByAttribute } = require('./harness/dashboard-app');

async function appWithCourse(cardHue) {
  const probe = await loadDashboardUi();
  const state = probe.DomainModel.createEmptyState();
  state.courses.push(probe.DomainModel.createCourse({
    id: 'color-course', name: 'TEST Biologie', subject: 'Biologie', classLabel: '10a', cardHue
  }));
  const app = await loadDashboardUi({ state });
  await app.UiShell.init('app');
  return app;
}

function card(app) { return findByAttribute(app.root, 'data-course-id', 'color-course'); }
function slider(app) { return findByAttribute(app.root, 'id', 'course-editor-color'); }
async function edit(app) {
  await findByText(app.root, 'Kurse').dispatch('click');
  await findByAttribute(card(app), 'data-role', 'edit').dispatch('click');
  assert.ok(slider(app), 'Der Kurseditor braucht einen Farbregler.');
}

test('Fachfarben erscheinen in beiden Übersichten; die individuelle Farbe überlebt verschlüsseltes Neuladen', async () => {
  const app = await appWithCourse();
  assert.equal(card(app).getAttribute('data-course-hue'), '145');
  await edit(app);
  assert.equal(card(app).getAttribute('data-course-hue'), '145');
  const input = slider(app);
  input.focus();
  input.value = '0';
  await input.dispatch('input');
  assert.equal((await app.Storage.loadState()).courses[0].cardHue, undefined, 'Ziehen allein darf nicht speichern.');
  await input.dispatch('change');
  assert.equal((await app.Storage.loadState()).courses[0].cardHue, 0);
  assert.equal(card(app).getAttribute('data-course-hue'), '0');
  assert.ok(app.document.activeElement === slider(app), 'Nach dem Speichern bleibt der Farbregler per Tastatur bedienbar.');
  await findByText(app.root, 'Übersicht').dispatch('click');
  assert.equal(card(app).getAttribute('data-course-hue'), '0');
  await app.Storage.lockSession();
  const reloaded = await loadDashboardUi({ storage: app.storage, lockManager: app.lockManager, useExistingStorage: true });
  await reloaded.UiShell.init('app');
  assert.equal(card(reloaded).getAttribute('data-course-hue'), '0');
});

test('Fachwechsel folgt der Automatik, bewahrt eine eigene Farbe und Zurücksetzen aktiviert die Automatik wieder', async () => {
  const app = await appWithCourse();
  await edit(app);
  let subject = findByAttribute(app.root, 'id', 'course-editor-subject');
  subject.value = 'Mathematik';
  await subject.dispatch('change');
  assert.equal(card(app).getAttribute('data-course-hue'), '215');
  slider(app).value = '310';
  await slider(app).dispatch('change');
  subject = findByAttribute(app.root, 'id', 'course-editor-subject');
  subject.value = 'Chemie';
  await subject.dispatch('change');
  assert.equal(card(app).getAttribute('data-course-hue'), '310');
  await findByText(app.root, 'Fachfarbe verwenden').dispatch('click');
  assert.equal((await app.Storage.loadState()).courses[0].cardHue, undefined);
  assert.equal(card(app).getAttribute('data-course-hue'), '175');
  assert.equal(slider(app).value, '175');
});

test('Speicherfehler stellt bestätigte Farbe und Automatik wieder her', async () => {
  for (const initial of [undefined, 0]) {
    const app = await appWithCourse(initial);
    await edit(app);
    const alerts = [];
    app.sandbox.window.alert = message => alerts.push(String(message));
    const realSave = app.Storage.saveState;
    app.Storage.saveState = async () => { throw new Error('Synthetischer Speicherfehler'); };
    slider(app).value = '280';
    await slider(app).dispatch('input');
    await slider(app).dispatch('change');
    app.Storage.saveState = realSave;
    assert.equal((await app.Storage.loadState()).courses[0].cardHue, initial);
    assert.equal(slider(app).value, initial === undefined ? '145' : '0');
    assert.equal(card(app).getAttribute('data-course-hue'), initial === undefined ? '145' : '0');
    assert.equal(findByText(app.root, 'Fachfarbe verwenden').disabled, initial === undefined);
    assert.ok(alerts.some(message => /nicht gespeichert/.test(message)));
  }
});

test('fehlgeschlagener Fachwechsel stellt auch die automatische Farbvorschau wieder her', async () => {
  const app = await appWithCourse();
  await edit(app);
  app.sandbox.window.alert = () => {};
  const subject = findByAttribute(app.root, 'id', 'course-editor-subject');
  const realSave = app.Storage.saveState;
  app.Storage.saveState = async () => { throw new Error('Synthetischer Speicherfehler'); };
  subject.value = 'Mathematik';
  await subject.dispatch('input');
  assert.equal(slider(app).value, '215');
  await subject.dispatch('change');
  app.Storage.saveState = realSave;
  assert.equal(subject.value, 'Biologie');
  assert.equal(slider(app).value, '145');
});

test('alter Farbregler darf nach Sperren und erneutem Initialisieren keinen aktuellen Kurs überschreiben', async () => {
  const app = await appWithCourse();
  await edit(app);
  const oldSlider = slider(app);
  await app.Storage.lockSession();
  await app.UiShell.init('app');
  await edit(app);
  const name = findByAttribute(app.root, 'id', 'course-editor-name');
  name.value = 'TEST Neue Sitzung';
  await name.dispatch('change');
  oldSlider.value = '310';
  await oldSlider.dispatch('change');
  const saved = (await app.Storage.loadState()).courses[0];
  assert.equal(saved.name, 'TEST Neue Sitzung');
  assert.equal(saved.cardHue, undefined);
});

test('neue Kurse übernehmen die Farbauswahl, Abbrechen legt keinen Kurs an', async () => {
  const app = await appWithCourse();
  await findByText(app.root, 'Kurse').dispatch('click');
  await findByText(app.root, 'Kurs anlegen').dispatch('click');
  let input = findByAttribute(app.document.body, 'id', 'new-course-color');
  assert.ok(input, 'Auch der Anlegedialog bietet die Farbauswahl.');
  input.value = '0';
  await input.dispatch('input');
  await findByText(app.document.body, 'Abbrechen').dispatch('click');
  assert.equal((await app.Storage.loadState()).courses.length, 1);
  await findByText(app.root, 'Kurs anlegen').dispatch('click');
  const fields = app.document.body._findAll(element => element.tagName === 'INPUT');
  fields.find(element => element.placeholder === 'z. B. 10c Biologie').value = 'TEST Neuer Kurs';
  fields.find(element => element.placeholder === 'z. B. Biologie').value = 'Chemie';
  fields.find(element => element.placeholder === 'z. B. 10c').value = '10c';
  // The lightweight DOM does not select the first option like a browser does.
  const schema = app.document.body._find(element => element.tagName === 'SELECT' &&
    element.children.some(option => option.textContent === 'Noten (1–6)'));
  schema.value = app.DomainModel.SCHEMA_MODES.GRADES;
  input = findByAttribute(app.document.body, 'id', 'new-course-color');
  input.value = '0';
  await input.dispatch('input');
  await input.dispatch('change');
  await findByText(app.document.body, 'Anlegen').dispatch('click');
  const created = (await app.Storage.loadState()).courses.find(course => course.name === 'TEST Neuer Kurs');
  assert.ok(created);
  assert.equal(created.cardHue, 0);
});
