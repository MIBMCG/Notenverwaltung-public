'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { loadModules } = require('./harness/load');
const { loadDashboardUi, loadGeneratedDashboardUi, findByText, findByAttribute } = require('./harness/dashboard-app');
const { createReleaseFixtures } = require('./fixtures/release-readiness');

const PAYLOAD_KEY = 'notenverwaltung_v1_state_enc';
const KEYS = [PAYLOAD_KEY, 'notenverwaltung_v1_salt', 'notenverwaltung_v1_encrypted', 'notenverwaltung_v1_state'];
const plain = value => JSON.parse(JSON.stringify(value));
const bytes = storage => KEYS.map(key => storage.getItem(key));

async function builtArtifact() {
  const { buildArtifact } = await import(pathToFileURL(path.join(__dirname, '..', 'scripts', 'build.mjs')).href);
  return buildArtifact();
}

async function importHarness({ generated = false } = {}) {
  const { DomainModel } = loadModules();
  const { normal } = createReleaseFixtures(DomainModel);
  const app = generated
    ? await loadGeneratedDashboardUi({ artifact: await builtArtifact(), state: normal.state })
    : await loadDashboardUi({ state: normal.state });
  if (generated) await app.start();
  else {
    app.sandbox.mergeImportedStateIntoCurrent =
      app.sandbox.__module_exports.ImportMerge.mergeImportedStateIntoCurrent;
    await app.UiShell.init('app');
  }
  const password = 'Synthetisches-Testpasswort-2026';
  await findByText(app.root._find(item => item.classList?.contains('nav-main')), 'Import / Export').dispatch('click');
  const input = findByAttribute(app.root, 'id', 'json-import-file');
  const merge = findByAttribute(app.root, 'id', 'json-import-merge-checkbox');
  const alerts = [];
  const confirmations = [];
  let readComplete = Promise.resolve();
  app.sandbox.window.alert = value => alerts.push(String(value));
  app.sandbox.window.confirm = value => { confirmations.push(String(value)); return true; };
  app.sandbox.window.promptPassword = async () => password;
  app.sandbox.FileReader = class {
    readAsText(file, encoding) {
      assert.equal(encoding, 'utf-8');
      readComplete = Promise.resolve().then(() => this.onload({ target: { result: file.text } }));
    }
  };
  async function submit(text, mergeMode = false) {
    merge.checked = mergeMode;
    input.files = [{ name: 'synthetic-backup.enc.json', text }];
    input.value = 'synthetic-backup.enc.json';
    await input.dispatch('change');
    await readComplete;
  }
  return { app, submit, alerts, confirmations, password };
}

test('tampered AES-GCM backup changes neither confirmed state nor encrypted target bytes through Storage and rendered import', async () => {
  const h = await importHarness();
  const before = bytes(h.app.storage);
  const stateBefore = plain(await h.app.Storage.loadCurrentSessionState());
  const exported = JSON.parse(await h.app.Storage.exportStateEncrypted(h.app.password, stateBefore));
  const [iv, encodedCipher] = exported.payload.split(':');
  const cipher = Buffer.from(encodedCipher, 'base64');
  cipher[0] ^= 1;
  exported.payload = iv + ':' + cipher.toString('base64');
  const text = JSON.stringify(exported);

  await assert.rejects(h.app.Storage.importStateEncryptedFromText(text, h.app.password));
  assert.deepEqual(bytes(h.app.storage), before);
  assert.deepEqual(plain(await h.app.Storage.loadCurrentSessionState()), stateBefore);

  for (const mergeMode of [false, true]) {
    await h.submit(text, mergeMode);
    assert.deepEqual(bytes(h.app.storage), before);
    assert.deepEqual(plain(await h.app.Storage.loadCurrentSessionState()), stateBefore);
    assert.equal(h.confirmations.length, 0, 'damaged backup must not reach Replace or Merge confirmation');
    assert.match(h.alerts.at(-1), /^Import fehlgeschlagen\. Der bisherige Datenbestand bleibt erhalten\./);
    assert.doesNotMatch(h.alerts.at(-1), /Testperson 001|Synthetisches-Testpasswort-2026/);
  }
});

test('truncated backup and invalid references cannot replace or merge a valid encrypted target', async () => {
  const h = await importHarness();
  const before = bytes(h.app.storage);
  const confirmed = plain(await h.app.Storage.loadCurrentSessionState());
  const valid = JSON.parse(await h.app.Storage.exportStateEncrypted(h.app.password, confirmed));
  const invalidReference = plain(confirmed);
  invalidReference.assessments[0].courseId = 'missing-synthetic-course';
  const cases = [
    JSON.stringify({ ...valid, payload: valid.payload.slice(0, -12) }),
    await h.app.Storage.exportStateEncrypted(h.app.password, invalidReference),
    '{"format":"notenverwaltung_enc_v1","salt":'
  ];
  for (const text of cases) {
    for (const mergeMode of [false, true]) {
      await h.submit(text, mergeMode);
      assert.deepEqual(bytes(h.app.storage), before);
      assert.deepEqual(plain(await h.app.Storage.loadCurrentSessionState()), confirmed);
      assert.equal(h.confirmations.length, 0);
      assert.match(h.alerts.at(-1), /^Import fehlgeschlagen\./);
    }
  }
});

test('generated HTML import rejects wrong password, altered and truncated ciphertext, malformed JSON and invalid references', async () => {
  const h = await importHarness({ generated: true });
  const before = bytes(h.app.storage);
  const confirmed = plain(await h.app.Storage.loadCurrentSessionState());
  const valid = JSON.parse(await h.app.Storage.exportStateEncrypted(h.password, confirmed));
  const [iv, encodedCipher] = valid.payload.split(':');
  const cipher = Buffer.from(encodedCipher, 'base64');
  cipher[0] ^= 1;
  const invalidReference = plain(confirmed);
  invalidReference.assessments[0].courseId = 'missing-synthetic-course';
  const cases = [
    ['wrong password', JSON.stringify(valid), 'Synthetisches-falsches-Passwort'],
    ['tampered ciphertext', JSON.stringify({ ...valid, payload: iv + ':' + cipher.toString('base64') }), h.password],
    ['truncated ciphertext', JSON.stringify({ ...valid, payload: valid.payload.slice(0, -12) }), h.password],
    ['invalid references', await h.app.Storage.exportStateEncrypted(h.password, invalidReference), h.password],
    ['malformed JSON', '{"format":"notenverwaltung_enc_v1","salt":', h.password]
  ];
  for (const [label, text, enteredPassword] of cases) {
    h.app.sandbox.window.promptPassword = async () => enteredPassword;
    for (const merge of [false, true]) {
      await h.submit(text, merge);
      assert.deepEqual(bytes(h.app.storage), before, label);
      assert.deepEqual(plain(await h.app.Storage.loadCurrentSessionState()), confirmed, label);
      assert.equal(h.confirmations.length, 0, label);
      assert.match(h.alerts.at(-1), /^Import fehlgeschlagen\./, label);
      assert.doesNotMatch(h.alerts.at(-1), /Testperson 001|Synthetisches-Testpasswort-2026/, label);
      assert.equal(h.app.storage.getItem('notenverwaltung_v1_state'), null, label);
    }
  }
});

test('missing local salt preserves ciphertext and cannot silently load an empty replacement', async () => {
  const h = await importHarness();
  const encrypted = h.app.storage.getItem(PAYLOAD_KEY);
  h.app.storage.removeItem('notenverwaltung_v1_salt');
  await assert.rejects(h.app.Storage.loadCurrentSessionState());
  assert.equal(h.app.storage.getItem(PAYLOAD_KEY), encrypted);
  assert.equal(h.app.storage.getItem('notenverwaltung_v1_state'), null);
  await assert.rejects(h.app.Storage.saveState(plain(await h.app.DomainModel.createEmptyState())));
  assert.equal(h.app.storage.getItem(PAYLOAD_KEY), encrypted);
});

test('generated HTML fails closed on missing salt and corrupt local ciphertext without creating an empty replacement', async () => {
  const { DomainModel } = loadModules();
  const { normal } = createReleaseFixtures(DomainModel);
  const artifact = await builtArtifact();
  for (const damage of ['missing salt', 'corrupt ciphertext']) {
    const app = await loadGeneratedDashboardUi({ artifact, state: normal.state });
    const originalPayload = app.storage.getItem(PAYLOAD_KEY);
    if (damage === 'missing salt') app.storage.removeItem('notenverwaltung_v1_salt');
    else app.storage.setItem(PAYLOAD_KEY, originalPayload.slice(0, -12) + 'tampered');
    const before = bytes(app.storage);
    await app.start();
    assert.deepEqual(bytes(app.storage), before, damage);
    assert.equal(app.storage.getItem('notenverwaltung_v1_state'), null, damage);
    assert.equal(app.Storage.hasSessionPassword(), false, damage);
    await assert.rejects(app.Storage.saveState(plain(normal.state)), undefined, damage);
    assert.deepEqual(bytes(app.storage), before, damage);
    assert.match(app.root.textContent, /Entsperren|Fehler|beschädigt|gesperrt/i, damage);
  }
});

test('generated HTML exposes rollback failure and blocks further writes after the session is closed', async () => {
  const { DomainModel } = loadModules();
  const { normal } = createReleaseFixtures(DomainModel);
  const app = await loadGeneratedDashboardUi({ artifact: await builtArtifact(), state: normal.state });
  await app.start();
  await findByText(app.root._find(item => item.classList?.contains('nav-main')), 'Einstellungen').dispatch('click');
  await findByAttribute(app.root, 'data-settings-area', 'school').dispatch('click');
  const schoolName = findByAttribute(app.root, 'id', 'settings-school-name');
  schoolName.value = 'Nicht gespeicherte Synthetische Schule';
  await schoolName.dispatch('input');
  await app.Storage.flushPendingWrites();
  const before = bytes(app.storage);
  const setItem = app.storage.setItem.bind(app.storage);
  let payloadSets = 0;
  app.storage.setItem = (key, value) => {
    if (key === PAYLOAD_KEY && ++payloadSets <= 2) {
      throw new Error(payloadSets === 1 ? 'synthetic primary failure' : 'synthetic rollback failure');
    }
    return setItem(key, value);
  };
  await findByAttribute(app.root, 'id', 'settings-school-save').dispatch('click');
  assert.equal(payloadSets, 2);
  assert.match(app.root.textContent, /Entsperren|gesperrt|nicht gespeichert/i);
  assert.deepEqual(bytes(app.storage), before);
  assert.equal(app.Storage.hasSessionPassword(), false);
  await assert.rejects(app.Storage.saveState(plain(normal.state)));
  assert.deepEqual(bytes(app.storage), before);
  assert.equal(app.storage.getItem('notenverwaltung_v1_state'), null);
  assert.doesNotMatch(JSON.stringify(app.logs), /Testperson 001|Synthetisches-Testpasswort-2026/);
});

test('manual lock view, URL and storage disclose no synthetic person or password while keeping only encrypted state', async () => {
  const h = await importHarness();
  const privateMarkers = ['Testperson 001', 'Vorname 001', h.app.password];
  const lock = h.app.root._find(item => item.className === 'header-action header-lock');
  await lock.dispatch('click');
  const visible = h.app.document.body.textContent;
  const location = JSON.stringify(h.app.sandbox.window.location);
  const stored = h.app.storage._keys().map(key => [key, h.app.storage.getItem(key)]);
  const logs = JSON.stringify(h.app.logs);
  for (const marker of privateMarkers) {
    assert.equal(visible.includes(marker), false);
    assert.equal(location.includes(marker), false);
    assert.equal(JSON.stringify(stored).includes(marker), false);
    assert.equal(logs.includes(marker), false);
  }
  assert.equal(h.app.storage.getItem('notenverwaltung_v1_state'), null);
  assert.ok(h.app.storage.getItem(PAYLOAD_KEY));
  assert.equal(h.app.Storage.hasSessionPassword(), false);
});
