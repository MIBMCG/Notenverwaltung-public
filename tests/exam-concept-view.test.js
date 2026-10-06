'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDashboardUi, findByAttribute } = require('./harness/dashboard-app');

function findElement(root, predicate) {
  return root._find(predicate);
}

function findButton(root, text) {
  return findElement(root, element => element.tagName === 'BUTTON' && element.textContent === text);
}

function findLabel(root, text) {
  return findElement(root, element => element.tagName === 'LABEL' && element.textContent === text);
}

function stage(app, stageId) {
  return findByAttribute(app.root, 'data-exam-stage', stageId);
}

function stageDetails(app, stageId) {
  return findElement(stage(app, stageId), element => element.tagName === 'DETAILS');
}

function thresholdInput(app, accessibleName) {
  return findByAttribute(app.root, 'aria-label', accessibleName);
}

async function openExam(app) {
  const navigationButton = findButton(app.root, 'Klausurnotenrechner');
  assert.ok(navigationButton, 'der Rechner muss auch ohne vorhandenen Kurs erreichbar sein');
  await navigationButton.dispatch('click');
}

async function examApp() {
  const app = await loadDashboardUi();
  await app.UiShell.init('app');
  await openExam(app);
  return app;
}

test('der echte Rechner gliedert Schema, Stufenkarten und geschlossene Prozentgrenzen zugänglich', async () => {
  const app = await examApp();
  const schema = findByAttribute(app.root, 'id', 'exam-schema');
  const sekI = stage(app, 'sek1');
  const sekII = stage(app, 'sek2');

  assert.ok(schema, 'die vorhandene Stufenauswahl braucht eine feste Formular-ID');
  assert.equal(findLabel(app.root, 'Schema').getAttribute('for'), 'exam-schema');
  assert.equal(schema.value, 'sek1');
  assert.deepEqual(schema.options.map(option => [option.value, option.textContent]), [
    ['sek1', 'Sek I (Noten 1+ … 6)'],
    ['sek2', 'Sek II (0–15 Punkte)']
  ]);
  assert.equal(sekI.style.display, '');
  assert.equal(sekII.style.display, 'none');
  assert.equal(findElement(sekI, element => element.tagName === 'H3').textContent, 'Sek I – schulinterne Beispielprofile');
  assert.equal(findElement(sekII, element => element.tagName === 'H3').textContent, 'Sek II – 0–15 Punkte');

  for (const [stageId, stageLabel, profileValue] of [
    ['sek1', 'Sek I', 'custom'],
    ['sek2', 'Sek II', 'abitur-berlin-2024-2029']
  ]) {
    const panel = stage(app, stageId);
    const maxId = `exam-${stageId}-max-points`;
    const profileId = `exam-${stageId}-profile`;
    assert.equal(findLabel(panel, 'Maximalpunkte').getAttribute('for'), maxId);
    assert.equal(findLabel(panel, 'Profil').getAttribute('for'), profileId);
    assert.equal(findByAttribute(panel, 'id', maxId).value, '50');
    assert.equal(findByAttribute(panel, 'id', maxId).min, '1');
    assert.equal(findByAttribute(panel, 'id', maxId).step, '1');
    assert.equal(findByAttribute(panel, 'id', profileId).value, profileValue);
    assert.equal(stageDetails(app, stageId).open, false, `${stageLabel}: Grenzen müssen anfangs geschlossen sein`);
    assert.equal(stageDetails(app, stageId).children[0].textContent, 'Prozentgrenzen bearbeiten');
  }

  assert.ok(thresholdInput(app, 'Prozentgrenze für Note 1+ in Sek I'));
  assert.ok(thresholdInput(app, 'Prozentgrenze für 15 Punkte in Sek II'));
  for (const heading of app.root._findAll(element => element.tagName === 'TH')) {
    assert.equal(heading.getAttribute('scope'), 'col');
  }
  assert.match(app.root.textContent, /ändert keine Kursnoten/i);
  assert.match(findByAttribute(app.root, 'id', 'exam-sek1-result').textContent, /Noch keine Tabelle berechnet/);
  assert.equal(findByAttribute(app.root, 'id', 'exam-sek1-result').getAttribute('role'), 'region');
  assert.equal(findByAttribute(app.root, 'id', 'exam-sek2-result').getAttribute('aria-label'), 'Ergebnis Sek II');
});

test('Schemawechsel bewahrt Eingaben, offene Grenzen und die berechnete Tabelle ohne Speicher- oder Downloadwirkung', async () => {
  const app = await examApp();
  let saveCalls = 0;
  let downloadCalls = 0;
  app.Storage.saveState = async () => { saveCalls += 1; };
  app.sandbox.URL = {
    createObjectURL() { downloadCalls += 1; return 'blob:unexpected'; },
    revokeObjectURL() {}
  };

  const schema = findByAttribute(app.root, 'id', 'exam-schema');
  const maxInput = findByAttribute(app.root, 'id', 'exam-sek1-max-points');
  const details = stageDetails(app, 'sek1');
  const result = findByAttribute(app.root, 'id', 'exam-sek1-result');
  maxInput.value = '20';
  details.open = true;
  await findButton(stage(app, 'sek1'), 'Tabelle berechnen (Sek I)').dispatch('click');
  const resultBody = findElement(result, element => element.tagName === 'TBODY');
  assert.equal(resultBody.children.length, 21, '0 bis 20 Punkte müssen vollständig erscheinen');

  schema.value = 'sek2';
  await schema.dispatch('change');
  assert.equal(stage(app, 'sek1').style.display, 'none');
  assert.equal(stage(app, 'sek2').style.display, '');
  assert.equal(stageDetails(app, 'sek2').open, false, 'jede Stufe verwaltet ihren eigenen Aufklappzustand');
  stageDetails(app, 'sek2').open = true;

  schema.value = 'sek1';
  await schema.dispatch('change');
  assert.equal(findByAttribute(app.root, 'id', 'exam-sek1-max-points'), maxInput);
  assert.equal(findByAttribute(app.root, 'id', 'exam-sek1-result'), result);
  assert.equal(maxInput.value, '20');
  assert.equal(details.open, true);
  assert.equal(resultBody.children.length, 21);
  assert.deepEqual({ saveCalls, downloadCalls }, { saveCalls: 0, downloadCalls: 0 });
});

test('Profilwechsel ändert Prozentgrenzen erst über die vorhandene Anwenden-Aktion', async () => {
  const app = await examApp();
  const schema = findByAttribute(app.root, 'id', 'exam-schema');
  const sekIProfile = findByAttribute(app.root, 'id', 'exam-sek1-profile');
  const sekIThreshold = thresholdInput(app, 'Prozentgrenze für Note 1 in Sek I');
  sekIThreshold.value = '42';
  sekIProfile.value = 'standard';
  await sekIProfile.dispatch('change');
  assert.equal(sekIThreshold.value, '42');
  await findButton(stage(app, 'sek1'), 'Preset anwenden').dispatch('click');
  assert.equal(sekIThreshold.value, '95');

  schema.value = 'sek2';
  await schema.dispatch('change');
  const sekIIProfile = findByAttribute(app.root, 'id', 'exam-sek2-profile');
  const sekIIThreshold = thresholdInput(app, 'Prozentgrenze für 15 Punkte in Sek II');
  sekIIThreshold.value = '42';
  sekIIProfile.value = 'custom';
  await sekIIProfile.dispatch('change');
  sekIIProfile.value = 'abitur-berlin-2024-2029';
  await sekIIProfile.dispatch('change');
  assert.equal(sekIIThreshold.value, '42');
  await findButton(stage(app, 'sek2'), 'Preset anwenden').dispatch('click');
  assert.equal(sekIIThreshold.value, '95');
});

test('beide Stufen zeigen Fehler der vorhandenen Eingabeprüfung im zugehörigen Ergebnisbereich', async () => {
  const app = await examApp();
  const sekIMax = findByAttribute(app.root, 'id', 'exam-sek1-max-points');
  sekIMax.value = '0';
  await findButton(stage(app, 'sek1'), 'Tabelle berechnen (Sek I)').dispatch('click');
  assert.match(findByAttribute(app.root, 'id', 'exam-sek1-result').textContent, /gültige Maximalpunktzahl/);

  sekIMax.value = '10';
  thresholdInput(app, 'Prozentgrenze für Note 1+ in Sek I').value = '';
  await findButton(stage(app, 'sek1'), 'Tabelle berechnen (Sek I)').dispatch('click');
  assert.equal(
    findByAttribute(app.root, 'id', 'exam-sek1-result').textContent,
    'Die Prozentgrenze für 1+ muss eine Zahl zwischen 0 und 100 sein.'
  );

  const schema = findByAttribute(app.root, 'id', 'exam-schema');
  schema.value = 'sek2';
  await schema.dispatch('change');
  thresholdInput(app, 'Prozentgrenze für 15 Punkte in Sek II').value = '90';
  await findButton(stage(app, 'sek2'), 'Tabelle berechnen (Sek II)').dispatch('click');
  assert.match(findByAttribute(app.root, 'id', 'exam-sek2-result').textContent, /grenze für 15.*Grenze für 14|grenze für 14.*Grenze für 15/i);
});

test('ein erneuter Aufruf ohne Kurse erstellt frische lokale Standardformulare', async () => {
  const app = await examApp();
  const originalMax = findByAttribute(app.root, 'id', 'exam-sek1-max-points');
  originalMax.value = '20';
  stageDetails(app, 'sek1').open = true;
  const schema = findByAttribute(app.root, 'id', 'exam-schema');
  schema.value = 'sek2';
  await schema.dispatch('change');

  await findButton(app.root, 'Übersicht').dispatch('click');
  await openExam(app);

  const freshMax = findByAttribute(app.root, 'id', 'exam-sek1-max-points');
  assert.notEqual(freshMax, originalMax);
  assert.equal(freshMax.value, '50');
  assert.equal(findByAttribute(app.root, 'id', 'exam-schema').value, 'sek1');
  assert.equal(stageDetails(app, 'sek1').open, false);
  assert.match(findByAttribute(app.root, 'id', 'exam-sek1-result').textContent, /Noch keine Tabelle berechnet/);
});
