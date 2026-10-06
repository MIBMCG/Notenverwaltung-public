'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { loadModules } = require('./harness/load');
const { loadDashboardUi, loadGeneratedDashboardUi, findByText, findByAttribute } = require('./harness/dashboard-app');

test('generated HTML retains a failed school-profile draft and persists its retry through real encrypted storage', async () => {
  const modules = loadModules();
  const state = modules.DomainModel.createEmptyState();
  state.settings.schoolProfile = { name: 'Synthetische Ausgangsschule', logoMode: 'none', logoDataUrl: '' };
  const { buildArtifact } = await import(pathToFileURL(path.join(__dirname, '..', 'scripts', 'build.mjs')).href);
  const app = await loadGeneratedDashboardUi({ artifact: await buildArtifact(), state });
  await app.start();
  await findByText(app.root, 'Einstellungen').dispatch('click');
  await findByAttribute(app.root, 'data-settings-area', 'school').dispatch('click');
  const nameInput = findByAttribute(app.root, 'id', 'settings-school-name');
  nameInput.value = 'Synthetische bestätigte Schule';
  await nameInput.dispatch('input');
  const storage = app.sandbox.localStorage;
  const snapshot = () => Object.fromEntries(storage._keys().map(key => [key, storage.getItem(key)]));
  const before = snapshot();
  const originalSetItem = storage.setItem.bind(storage);
  let rejectNextPayload = true;
  storage.setItem = (key, value) => {
    if (key === 'notenverwaltung_v1_state_enc' && rejectNextPayload) {
      rejectNextPayload = false;
      const error = new Error('Synthetischer Quotenfehler am verschlüsselten Schreibzugriff');
      error.name = 'QuotaExceededError';
      throw error;
    }
    originalSetItem(key, value);
  };

  await findByAttribute(app.root, 'id', 'settings-school-save').dispatch('click');
  assert.equal(rejectNextPayload, false, 'the generated handler must reach the real encrypted write');
  assert.deepEqual(snapshot(), before, 'a failed write must preserve every stored key');
  assert.equal(findByAttribute(app.root, 'id', 'settings-school-name').value, 'Synthetische bestätigte Schule');
  assert.match(findByAttribute(app.root, 'id', 'settings-school-status').textContent, /nicht gespeichert/);
  assert.equal(findByAttribute(app.root, 'id', 'settings-school-save').disabled, false);

  await findByAttribute(app.root, 'id', 'settings-school-save').dispatch('click');
  assert.match(findByAttribute(app.root, 'id', 'settings-school-status').textContent, /gespeichert/);
  assert.notEqual(storage.getItem('notenverwaltung_v1_state_enc'), before.notenverwaltung_v1_state_enc);
  assert.equal(storage.getItem('notenverwaltung_v1_state'), null, 'retry must not create plaintext state');
  await app.Storage.lockSession();
  const restarted = await loadDashboardUi({ storage, lockManager: app.lockManager, useExistingStorage: true });
  await restarted.UiShell.init('app');
  assert.equal((await restarted.Storage.loadState()).settings.schoolProfile.name, 'Synthetische bestätigte Schule');
});
