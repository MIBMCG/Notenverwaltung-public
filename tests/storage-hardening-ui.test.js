'use strict';
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { openStorageSession } = require('./harness/storage-session');
const { loadGeneratedDashboardUi, findByText, findByAttribute } = require('./harness/dashboard-app');
const artifact = fs.readFileSync(path.join(__dirname, '..', 'Notenverwaltung.html'), 'utf8');
const PASSWORD = 'Synthetic-local-password-2026';
const IMPORT_PASSWORD = 'Synthetic-backup-password-2026';
const PAYLOAD = 'notenverwaltung_v1_state_enc';
const FLAG = 'notenverwaltung_v1_encrypted';
const bytes = storage => Object.fromEntries(storage._keys().sort().map(key => [key, storage.getItem(key)]));

function clickText(app, text) {
  const button = app.root._find(element => element.tagName === 'BUTTON' && element.textContent === text);
  assert.ok(button, `Button missing: ${text}`);
  return button.dispatch('click');
}

for (const kind of ['integrity', 'format', 'technical', 'content']) {
  test(`shipped HTML displays a distinct safe ${kind} diagnosis with no password retry`, async () => {
    const source = await openStorageSession();
    await source.Storage.enableEncryption(PASSWORD, source.DomainModel.createEmptyState());
    await source.Storage.lockSession();
    if (kind === 'integrity') source.storage.removeItem(FLAG);
    if (kind === 'format') source.storage.setItem(PAYLOAD, 'broken-format');
    if (kind === 'content') {
      const [salt, iv, cipher] = (await source.Storage._encryptJsonWithSalt('null', PASSWORD)).split(':');
      source.storage.setItem('notenverwaltung_v1_salt', salt);
      source.storage.setItem(PAYLOAD, `${iv}:${cipher}`);
    }
    const app = await loadGeneratedDashboardUi({ artifact, storage: source.storage, useExistingStorage: true, password: PASSWORD });
    let retries = 0, writes = 0;
    app.sandbox.window.confirm = () => { retries++; return false; };
    for (const method of ['setItem', 'removeItem']) {
      const original = app.storage[method].bind(app.storage);
      app.storage[method] = (...args) => { writes++; return original(...args); };
    }
    if (kind === 'technical') app.sandbox.crypto = {
      getRandomValues: crypto.getRandomValues.bind(crypto),
      subtle: { importKey: async () => { throw new DOMException('Synthetic secret provider detail', 'NotSupportedError'); } }
    };
    const before = bytes(app.storage);
    await app.start();
    assert.ok(findByText(app.root, 'Anwendung konnte nicht gestartet werden'));
    const expected = { integrity: /unvollständig oder widersprüchlich/, format: /Format der verschlüsselten Daten/, technical: /kryptografische Verarbeitung ist technisch/, content: /gespeicherten Daten konnten nicht gelesen/ }[kind];
    assert.match(app.root.textContent, expected);
    assert.doesNotMatch(app.root.textContent, /Synthetic secret provider detail/);
    assert.equal(retries, 0);
    assert.equal(writes, 0);
    assert.deepEqual(bytes(app.storage), before);
    assert.equal(app.Storage.hasSessionPassword(), false);
    await app.Storage.lockSession();
  });
}

for (const format of ['raw-portable', 'structured']) {
  test(`shipped HTML imports ${format} with its own password and keeps the configured local password`, async () => {
    const source = await openStorageSession();
    const state = source.DomainModel.createEmptyState();
    state.settings.schoolProfile = { name: 'Synthetic imported school', logoMode: 'none', logoDataUrl: '' };
    const backup = format === 'raw-portable'
      ? await source.Storage._encryptJsonWithSalt(JSON.stringify(state), IMPORT_PASSWORD)
      : await source.Storage.exportStateEncrypted(IMPORT_PASSWORD, state);
    const app = await loadGeneratedDashboardUi({ artifact, encrypted: false, password: PASSWORD });
    const alerts = [];
    app.sandbox.window.alert = message => alerts.push(String(message));
    app.sandbox.window.confirm = () => true;
    await app.start();
    await require('./harness/recovery-flow').completeSetup(app, app.root._find(node => node.tagName === 'BUTTON' && node.textContent === 'Verschlüsselung jetzt einrichten'), PASSWORD);
    await clickText(app, 'Import / Export');
    findByAttribute(app.root, 'id', 'json-import-merge-checkbox').checked = false;
    const input = findByAttribute(app.root, 'id', 'json-import-file');
    let reader;
    app.sandbox.FileReader = class { readAsText() { reader = this; } };
    input.files = [{ name: 'SYNTHETIC.enc.json' }];
    await input.dispatch('change');
    app.sandbox.window.promptPassword = async () => IMPORT_PASSWORD;
    await reader.onload({ target: { result: backup } });
    assert.ok(alerts.some(message => message.startsWith('Import erfolgreich')));
    assert.equal((await app.Storage.loadState()).settings.schoolProfile.name, 'Synthetic imported school');
    await clickText(app, 'Backup');
    assert.equal(app.downloads.length, 1);
    const exported = await app.downloads[0].blob.text();
    await assert.rejects(app.Storage.importStateEncryptedFromText(exported, IMPORT_PASSWORD));
    assert.equal((await app.Storage.importStateEncryptedFromText(exported, PASSWORD)).settings.schoolProfile.name, 'Synthetic imported school');
    await app.Storage.lockSession();
    app.sandbox.window.confirm = () => false;
    app.sandbox.window.promptPassword = async () => IMPORT_PASSWORD;
    await clickText(app, 'Entsperren');
    assert.equal(app.Storage.hasSessionPassword(), false);
    app.sandbox.window.promptPassword = async () => PASSWORD;
    await clickText(app, 'Entsperren');
    assert.equal(app.Storage.hasSessionPassword(), true);
    await app.Storage.lockSession();
    await source.Storage.lockSession();
  });
}

