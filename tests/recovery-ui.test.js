'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { importEsmSource } = require('./harness/import-esm-source');
const { createStartDocument } = require('./harness/start-dom');
const tick = () => new Promise(resolve => setImmediate(resolve));
const CODE = 'NV2-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH-IIII-JJJJ-KKKK-LLLL-MMMM-NNNN';
async function environment(overrides = {}) {
  const { createRecoveryUi } = await importEsmSource('src/ui/recovery-dialog.js');
  const { document } = createStartDocument();
  const events = new Map(); const prints = []; const committed = []; const cancelled = [];
  const metadata = { createdAt: '2026-10-16T08:00:00.000Z', savedAt: '2026-10-16T09:00:00.000Z', datasetId: 'dataset', generationId: 'generation' };
  const draft = { token: Object.freeze({}), recoveryCode: CODE, metadata, summary: { students: 2, courses: 1, assessments: 3, metadata }, replacesExisting: false };
  const Storage = {
    getRecoveryStatus: () => ({ enabled: false, hasLocalData: false, metadata: null }),
    prepareRecoveryEnrollment: async () => draft,
    confirmPreparedProtection: async (token, code) => { if (code !== CODE) throw new Error('Code falsch'); },
    commitPreparedProtection: async (token, options) => { committed.push(options); return { receipt: {}, metadata }; },
    cancelPreparedProtection: token => cancelled.push(token),
    getRecoveryMigrationBackup: () => null,
    ...overrides
  };
  const window = {
    addEventListener: (type, fn) => { if (!events.has(type)) events.set(type, []); events.get(type).push(fn); },
    removeEventListener: (type, fn) => events.set(type, (events.get(type) || []).filter(item => item !== fn)),
    open: () => { const dom = createStartDocument({ includeAppRoot: false }); const popup = { document: dom.document, print() {}, close() { this.closed = true; } }; prints.push(popup); return popup; }
  };
  const ui = createRecoveryUi({ window, document, Storage, downloadText: async () => {} });
  const find = text => document.body._find(el => el.tagName === 'BUTTON' && el.textContent === text);
  const input = label => document.body._find(el => el.getAttribute('aria-label') === label);
  return { ui, document, window, prints, committed, cancelled, draft, find, input, async click(text) { const button = find(text); assert.ok(button, 'button ' + text); await button.dispatch('click'); await tick(); }, async emit(type, event = {}) { for (const fn of events.get(type) || []) await fn(event); await tick(); } };
}
test('enrollment commits only after complete code reentry and clears the code and print view', async () => {
  const e = await environment(); const result = e.ui.enroll({ password: 'synthetic-password', state: { students: ['must-not-print'] } }); await tick();
  assert.ok(e.document.body.textContent.includes(CODE));
  await e.click('Code drucken');
  assert.ok(e.prints[0].document.body.textContent.includes(CODE));
  assert.ok(!e.prints[0].document.body.textContent.includes('must-not-print'));
  await e.click('Code gesichert – weiter');
  assert.ok(!e.document.body.textContent.includes(CODE));
  e.input('Wiederherstellungscode vollständig eingeben').value = 'wrong'; await e.click('Code bestätigen und speichern');
  assert.equal(e.committed.length, 0);
  e.input('Wiederherstellungscode vollständig eingeben').value = CODE; await e.click('Code bestätigen und speichern');
  await e.click('Fertig');
  assert.ok(await result); assert.equal(e.committed.length, 1); assert.ok(!e.document.body.textContent.includes(CODE)); assert.equal(e.prints[0].closed, true);
});
test('cancel and lock clean code fields and never commit a prepared transition', async () => {
  for (const action of ['cancel', 'sessionCleared', 'pagehide']) {
    const e = await environment(); const result = e.ui.enroll({ password: 'synthetic-password', state: {} }); await tick();
    await e.click('Code gesichert – weiter');
    const field = e.input('Wiederherstellungscode vollständig eingeben'); field.value = CODE;
    if (action === 'cancel') await e.click('Abbrechen'); else await e.emit(action);
    assert.equal(await result, null); assert.equal(e.committed.length, 0); assert.equal(field.value, ''); assert.ok(!e.document.body.textContent.includes(CODE)); assert.equal(e.cancelled.length, 1);
  }
});
test('lock while prepare is pending discards the late draft without showing its code', async () => {
  let finish; const e = await environment({ prepareRecoveryEnrollment: () => new Promise(resolve => { finish = resolve; }) });
  const result = e.ui.enroll({ password: 'synthetic-password', state: {} }); await tick(); await e.emit('sessionCleared'); finish(e.draft); await tick();
  assert.equal(await result, null); assert.ok(!e.document.body.textContent.includes(CODE)); assert.equal(e.cancelled.length, 1);
});


async function passwordPrompt(callback, options = {}) {
  const fs = require('node:fs'); const vm = require('node:vm');
  const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'src/legacy/application.js'), 'utf8');
  const { document } = createStartDocument(); const listeners = new Map();
  const window = { alert() {}, addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); }, removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter(item => item !== fn)); } };
  vm.runInNewContext(source.slice(source.indexOf('window.promptPassword = function'), source.indexOf('// Debug-Toast-Funktion entfernt')), { document, window, console });
  const result = window.promptPassword({ onRecovery: callback, ...options });
  return { document, result, button: document.body._find(el => el.tagName === 'BUTTON' && el.textContent === 'Zugang wiederherstellen') };
}
test('password prompt recovery success resolves null and clears password without changing string/null contract', async () => {
  const e = await passwordPrompt(async () => true); assert.ok(e.button, 'startup offers recovery');
  const field = e.document.body.querySelector('input'); field.value = 'discard-this-secret';
  await e.button.dispatch('click'); await tick();
  assert.equal(await e.result, null); assert.equal(field.value, ''); assert.equal(e.document.body.querySelector('input'), null);
});
test('cancelled recovery returns to the ordinary password input', async () => {
  const e = await passwordPrompt(async () => false); assert.ok(e.button);
  await e.button.dispatch('click'); await tick();
  const field = e.document.body.querySelector('input'); field.value = 'synthetic-password';
  await e.document.body._find(el => el.tagName === 'BUTTON' && el.textContent === 'OK').dispatch('click');
  assert.equal(await e.result, 'synthetic-password');
});

async function realUiEnvironment() {
  const { loadModules } = require('./harness/load');
  const modules = loadModules(); await modules.sessionReady;
  const { document } = createStartDocument();
  const { createRecoveryUi } = await importEsmSource('src/ui/recovery-dialog.js');
  const downloads = [];
  const ui = createRecoveryUi({ window: modules.sandbox.window, document, Storage: modules.Storage, downloadText: (text, filename) => downloads.push({ text, filename }) });
  const find = text => document.body._find(el => el.tagName === 'BUTTON' && el.textContent === text);
  return { ...modules, ui, document, downloads, input: label => document.body._find(el => el.getAttribute('aria-label') === label), async click(text) { const button = find(text); assert.ok(button, text); await button.dispatch('click'); await tick(); }, async waitFor(text) { for (let count = 0; count < 400 && !find(text); count++) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(find(text), 'wait ' + text); }, code() { return document.body._find(el => el.dataset.recoveryCode === 'true').textContent; } };
}
test('real storage UI enrollment, V2 backup and locked recovery rotate the code without exposing data on lock', async () => {
  const e = await realUiEnvironment();
  const state = e.DomainModel.createEmptyState(); state.settings.schoolProfile = { name: 'Synthetische Schule' };
  const setup = e.ui.enroll({ password: 'synthetic-password-2026', state });
  await e.waitFor('Code gesichert – weiter'); const oldCode = e.code();
  await e.click('Code gesichert – weiter'); e.input('Wiederherstellungscode vollständig eingeben').value = oldCode;
  await e.click('Code bestätigen und speichern'); await e.waitFor('Fertig');
  await e.click('Neues Backup herunterladen'); assert.equal(JSON.parse(e.downloads[0].text).version, 2);
  await e.click('Fertig'); assert.ok(await setup);
  await e.Storage.lockSession(); assert.ok(!e.document.body.textContent.includes(oldCode));
  await e.sessionCoordinator.acquire();
  const restored = e.ui.recover(); await e.waitFor('Weiter'); await e.click('Weiter');
  e.input('Vorhandenen Wiederherstellungscode eingeben').value = oldCode;
  await e.click('Bestand authentifizieren'); await e.waitFor('Diesen Bestand wiederherstellen');
  assert.match(e.document.body.textContent, /Sicherungszeit: 20/);
  await e.click('Diesen Bestand wiederherstellen'); e.input('Neues Passwort').value = 'synthetic-new-password'; e.input('Neues Passwort wiederholen').value = 'synthetic-new-password';
  await e.click('Weiter'); await e.waitFor('Code gesichert – weiter'); const newCode = e.code(); assert.notEqual(newCode, oldCode);
  await e.click('Code gesichert – weiter'); e.input('Wiederherstellungscode vollständig eingeben').value = newCode;
  await e.click('Code bestätigen und speichern'); await e.waitFor('Fertig'); await e.click('Fertig'); assert.ok(await restored);
  await assert.rejects(e.Storage.verifyRecoveryCode({ source: 'local', code: oldCode }));
  assert.equal((await e.Storage.verifyRecoveryCode({ source: 'local', code: newCode })).students, 0);
  assert.equal((await e.Storage.loadCurrentSessionState()).settings.schoolProfile.name, 'Synthetische Schule');
});

test('both first-setup entry points require password confirmation and a saved recovery code before local persistence', async () => {
  const { loadDashboardUi, findByText, findByAttribute } = require('./harness/dashboard-app');
  const flow = require('./harness/recovery-flow');
  for (const entry of ['Verschlüsselung jetzt einrichten', 'Verschlüsselung einrichten']) {
    const app = await loadDashboardUi({ encrypted: false }); await app.UiShell.init('app');
    if (entry === 'Verschlüsselung einrichten') await findByAttribute(app.root, 'data-settings-area', 'security').dispatch('click');
    const original = app.storage.getItem('notenverwaltung_v1_state_enc');
    const pending = flow.button(app, entry).dispatch('click');
    await flow.waitFor(app, () => flow.field(app, 'Neues Passwort'), 'new setup');
    flow.field(app, 'Neues Passwort').value = 'synthetic-setup-password'; flow.field(app, 'Neues Passwort wiederholen').value = 'mismatch';
    await flow.click(app, 'Weiter'); assert.equal(app.storage.getItem('notenverwaltung_v1_state_enc'), original);
    flow.field(app, 'Neues Passwort wiederholen').value = 'synthetic-setup-password'; await flow.click(app, 'Weiter');
    await flow.waitFor(app, () => flow.button(app, 'Code gesichert – weiter'), 'code'); assert.equal(app.storage.getItem('notenverwaltung_v1_state_enc'), original);
    await flow.confirmCode(app); await pending;
    assert.equal(app.Storage.getRecoveryStatus().enabled, true); assert.ok(findByText(app.root, 'Einstellungen')); assert.equal(app.root.inert, false);
    await app.Storage.lockSession();
  }
});


const artifactText = () => require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'Notenverwaltung.html'), 'utf8');
async function generatedApp(options = {}) {
  const { loadGeneratedDashboardUi } = require('./harness/dashboard-app');
  const app = await loadGeneratedDashboardUi({ artifact: artifactText(), encrypted: false, ...options });
  await app.start(); return app;
}
async function saveNewCode(app) { return require('./harness/recovery-flow').confirmCode(app); }
test('shipped HTML setup → backup → lock → recovery from the real startup password dialog completes a normal UI start', async () => {
  const flow = require('./harness/recovery-flow');
  let app = await generatedApp();
  const code = await flow.completeSetup(app, flow.button(app, 'Verschlüsselung jetzt einrichten'));
  await flow.click(app, 'Backup');
  assert.equal(app.downloads.length, 1); const backup = await app.downloads[0].blob.text();
  assert.equal(JSON.parse(backup).version, 2);
  const previousGeneration = app.Storage.getRecoveryStatus().metadata.generationId;
  await app.root._find(node => node.className === 'header-action header-lock').dispatch('click');
  assert.ok(flow.button(app, 'Entsperren')); assert.equal(app.Storage.hasSessionPassword(), false);
  const { loadGeneratedDashboardUi } = require('./harness/dashboard-app');
  app = await loadGeneratedDashboardUi({ artifact: artifactText(), storage: app.storage, lockManager: app.lockManager, useExistingStorage: true });
  app.sandbox.window.promptPassword = app.productPromptPassword;
  const unlock = app.start();
  await flow.waitFor(app, () => app.document.body._find(node => node.tagName === 'INPUT' && node.type === 'password'), 'startup password dialog');
  const recoveryFromPrompt = flow.button(app, 'Zugang wiederherstellen').dispatch('click');
  await flow.click(app, 'Weiter');
  flow.field(app, 'Vorhandenen Wiederherstellungscode eingeben').value = code;
  await flow.click(app, 'Bestand authentifizieren'); await flow.click(app, 'Diesen Bestand wiederherstellen');
  flow.field(app, 'Neues Passwort').value = 'Synthetic-restored-password'; flow.field(app, 'Neues Passwort wiederholen').value = 'Synthetic-restored-password';
  await flow.click(app, 'Weiter'); const renewedCode = await saveNewCode(app); await recoveryFromPrompt; await unlock;
  assert.equal(app.Storage.hasSessionPassword(), true); assert.notEqual(app.Storage.getRecoveryStatus().metadata.generationId, previousGeneration);
  assert.ok(flow.button(app, 'Backup')); assert.equal(app.document.body.querySelectorAll('[data-recovery-dialog="true"]').length, 0);
  await assert.rejects(app.Storage.verifyRecoveryCode({ source: 'local', code }));
  assert.ok(await app.Storage.verifyRecoveryCode({ source: 'local', code: renewedCode }));
  assert.ok(await app.Storage.importStateEncryptedWithRecovery(backup, code));
  await app.Storage.lockSession();
});


test('shipped HTML restores a V2 file from the lock screen without the local password and requires explicit replacement', async () => {
  const flow = require('./harness/recovery-flow');
  const source = await generatedApp(); const sourceCode = await flow.completeSetup(source, flow.button(source, 'Verschlüsselung jetzt einrichten'));
  await flow.click(source, 'Backup'); const backup = await source.downloads[0].blob.text(); const savedAt = JSON.parse(backup).data.savedAt;
  await source.Storage.lockSession();
  const target = await generatedApp(); const targetCode = await flow.completeSetup(target, flow.button(target, 'Verschlüsselung jetzt einrichten'));
  const before = target.storage.getItem('notenverwaltung_v1_state_enc');
  await target.root._find(node => node.className === 'header-action header-lock').dispatch('click');
  let passwordRequests = 0; target.sandbox.window.promptPassword = async () => { passwordRequests++; throw new Error('Local password is unavailable in this scenario'); };
  async function openFile() {
    const pending = flow.button(target, 'Zugang wiederherstellen').dispatch('click');
    await flow.click(target, 'Sicherungsdatei wählen'); await flow.click(target, 'Weiter');
    flow.field(target, 'Verschlüsselte Sicherungsdatei').files = [{ size: Buffer.byteLength(backup), text: async () => backup }];
    flow.field(target, 'Vorhandenen Wiederherstellungscode eingeben').value = sourceCode;
    await flow.click(target, 'Bestand authentifizieren');
    await flow.waitFor(target, () => flow.button(target, 'Vorhandenen Bestand ausdrücklich ersetzen'), 'replacement confirmation');
    assert.ok(target.document.body.textContent.includes(savedAt), 'authenticated save time shown before replacement');
    assert.match(target.document.body.textContent, /\d+ Schüler, \d+ Kurse, \d+ Leistungen/);
    assert.equal(target.storage.getItem('notenverwaltung_v1_state_enc'), before);
    return { pending };
  }
  let recovery = await openFile(); await flow.click(target, 'Abbrechen'); await recovery.pending;
  assert.equal(target.storage.getItem('notenverwaltung_v1_state_enc'), before);
  recovery = await openFile(); await flow.click(target, 'Vorhandenen Bestand ausdrücklich ersetzen');
  flow.field(target, 'Neues Passwort').value = 'Synthetic-file-restored-password'; flow.field(target, 'Neues Passwort wiederholen').value = 'Synthetic-file-restored-password';
  await flow.click(target, 'Weiter'); const renewed = await saveNewCode(target); await recovery.pending;
  assert.equal(passwordRequests, 0); assert.equal(target.Storage.hasSessionPassword(), true);
  assert.notEqual(target.storage.getItem('notenverwaltung_v1_state_enc'), before);
  await assert.rejects(target.Storage.verifyRecoveryCode({ source: 'local', code: targetCode }));
  assert.ok(await target.Storage.verifyRecoveryCode({ source: 'local', code: renewed }));
  assert.ok(flow.button(target, 'Backup')); await target.Storage.lockSession();
});

test('shipped HTML code replacement and password change require new confirmed codes and invalidate previous generations', async () => {
  const flow = require('./harness/recovery-flow'); const { findByAttribute } = require('./harness/dashboard-app');
  const app = await generatedApp(); let currentCode = await flow.completeSetup(app, flow.button(app, 'Verschlüsselung jetzt einrichten'));
  await flow.click(app, 'Einstellungen'); await findByAttribute(app.root, 'data-settings-area', 'security').dispatch('click');
  let generation = app.Storage.getRecoveryStatus().metadata.generationId;
  for (const kind of ['Code ersetzen', 'Passwort ändern']) {
    const pending = flow.button(app, kind).dispatch('click');
    await flow.waitFor(app, () => flow.field(app, 'Aktuelles Passwort'), 'current password'); flow.field(app, 'Aktuelles Passwort').value = app.password;
    await flow.click(app, 'Weiter');
    if (kind === 'Passwort ändern') {
      flow.field(app, 'Neues Passwort').value = 'Synthetic-changed-password'; flow.field(app, 'Neues Passwort wiederholen').value = 'Synthetic-changed-password'; await flow.click(app, 'Weiter');
    }
    const newCode = await saveNewCode(app); await pending;
    assert.notEqual(app.Storage.getRecoveryStatus().metadata.generationId, generation);
    await assert.rejects(app.Storage.verifyRecoveryCode({ source: 'local', code: currentCode }));
    assert.ok(await app.Storage.verifyRecoveryCode({ source: 'local', code: newCode }));
    const localText = app.storage.getItem('notenverwaltung_v1_state_enc');
    if (kind === 'Code ersetzen') assert.ok(await app.Storage.importStateEncryptedFromText(localText, app.password));
    else { await assert.rejects(app.Storage.importStateEncryptedFromText(localText, app.password)); assert.ok(await app.Storage.importStateEncryptedFromText(localText, 'Synthetic-changed-password')); }
    assert.ok(!app.root.textContent.includes(newCode)); currentCode = newCode; generation = app.Storage.getRecoveryStatus().metadata.generationId;
  }
  await app.Storage.lockSession();
});

test('shipped HTML imports V1 and V2 with password or code while retaining local credentials and generation', async () => {
  const flow = require('./harness/recovery-flow'); const { findByAttribute } = require('./harness/dashboard-app');
  const { loadModules } = require('./harness/load');
  const sourcePassword = 'Synthetic-source-password';
  const source = await generatedApp({ password: sourcePassword }); const sourceCode = await flow.completeSetup(source, flow.button(source, 'Verschlüsselung jetzt einrichten'));
  await flow.click(source, 'Einstellungen'); await findByAttribute(source.root, 'data-settings-area', 'school').dispatch('click');
  const school = findByAttribute(source.root, 'id', 'settings-school-name'); school.value = 'Synthetic imported school'; await school.dispatch('input'); await findByAttribute(source.root, 'id', 'settings-school-save').dispatch('click');
  const sourceState = await source.Storage.loadCurrentSessionState();
  await flow.click(source, 'Backup'); const v2 = await source.downloads[0].blob.text();
  const legacy = loadModules(); await legacy.sessionReady; const v1 = await legacy.Storage.exportStateEncrypted(sourcePassword, sourceState);
  const app = await generatedApp(); const localCode = await flow.completeSetup(app, flow.button(app, 'Verschlüsselung jetzt einrichten'));
  const localMetadata = app.Storage.getRecoveryStatus().metadata; app.sandbox.window.confirm = () => true;
  for (const [text, access] of [[v1, 'password'], [v2, 'password'], [v2, 'code']]) {
    await flow.click(app, 'Import / Export');
    findByAttribute(app.root, 'id', 'json-import-merge-checkbox').checked = false;
    let reader; app.sandbox.FileReader = class { readAsText() { reader = this; } };
    const file = findByAttribute(app.root, 'id', 'json-import-file'); file.files = [{ name: 'SYNTHETIC.enc.json' }]; await file.dispatch('change');
    app.sandbox.window.promptPassword = app.productPromptPassword;
    const importing = reader.onload({ target: { result: text } });
    await flow.waitFor(app, () => app.document.body._find(node => node.tagName === 'INPUT' && node.type === 'password'), 'backup access');
    if (access === 'code') {
      const codeAccess = flow.button(app, 'Zugang wiederherstellen').dispatch('click');
      const field = await flow.waitFor(app, () => app.document.body._findAll(node => node.tagName === 'INPUT' && node.type === 'password' && node.autocomplete === 'off').at(-1), 'backup recovery code');
      field.value = sourceCode; await flow.click(app, 'OK'); await codeAccess;
    } else {
      app.document.body._find(node => node.tagName === 'INPUT' && node.type === 'password').value = sourcePassword; await flow.click(app, 'OK');
    }
    await importing;
    assert.equal((await app.Storage.loadCurrentSessionState()).settings.schoolProfile.name, 'Synthetic imported school', JSON.parse(text).format + '/' + access + JSON.stringify(app.logs));
    assert.equal(app.Storage.getRecoveryStatus().metadata.datasetId, localMetadata.datasetId);
    assert.equal(app.Storage.getRecoveryStatus().metadata.generationId, localMetadata.generationId);
    const saved = app.storage.getItem('notenverwaltung_v1_state_enc');
    assert.ok(await app.Storage.importStateEncryptedFromText(saved, app.password));
    await assert.rejects(app.Storage.importStateEncryptedFromText(saved, sourcePassword));
    assert.ok(await app.Storage.verifyRecoveryCode({ source: 'local', code: localCode }));
    await assert.rejects(app.Storage.verifyRecoveryCode({ source: 'local', code: sourceCode }));
  }
  await app.Storage.lockSession(); await source.Storage.lockSession(); await legacy.Storage.lockSession();
});


test('recovery code import uses a secret field without spelling or autofill and clears it on cancel', async () => {
  const e = await passwordPrompt(undefined, { secretKind: 'recovery-code' }); const input = e.document.body.querySelector('input');
  assert.equal(input.type, 'password'); assert.equal(input.autocomplete, 'off'); assert.equal(input.getAttribute('spellcheck'), 'false'); assert.equal(input.getAttribute('autocorrect'), 'off'); assert.equal(input.getAttribute('autocapitalize'), 'off');
  input.value = CODE; await e.document.body._find(el => el.tagName === 'BUTTON' && el.textContent === 'Abbrechen').dispatch('click');
  assert.equal(await e.result, null); assert.equal(input.value, '');
});

test('user cancel and Escape are blocked once the confirmed candidate is being committed', async () => {
  let release; const writeStarted = new Promise(resolve => { release = resolve; }); let began = false;
  const e = await environment({ commitPreparedProtection: async () => { began = true; await writeStarted; return { receipt: {}, metadata: e.draft.metadata }; } });
  const result = e.ui.enroll({ password: 'synthetic-password', state: {} }); await tick();
  await e.click('Code gesichert – weiter'); e.input('Wiederherstellungscode vollständig eingeben').value = CODE;
  const submitting = e.find('Code bestätigen und speichern').dispatch('click'); await tick(); assert.equal(began, true);
  await e.click('Abbrechen'); await e.emit('keydown', { key: 'Escape', preventDefault() {} });
  assert.ok(e.find('Abbrechen'), 'cancel must leave the in-progress commit visible'); assert.equal(e.find('Abbrechen').disabled, true); assert.ok(e.document.body.textContent.includes('Speichern'));
  let ended = false; result.then(() => { ended = true; }); await tick(); assert.equal(ended, false);
  release(); await submitting; await tick(); await e.click('Fertig'); assert.ok(await result);
});



test('hard lock during a pending commit still clears secret views and suppresses delayed success', async () => {
  let release; const pendingCommit = new Promise(resolve => { release = resolve; });
  const e = await environment({ commitPreparedProtection: async () => { await pendingCommit; return { receipt: {}, metadata: e.draft.metadata }; } });
  const result = e.ui.enroll({ password: 'synthetic-password', state: {} }); await tick();
  await e.click('Code gesichert – weiter'); const codeField = e.input('Wiederherstellungscode vollständig eingeben'); codeField.value = CODE;
  const submitting = e.find('Code bestätigen und speichern').dispatch('click'); await tick();
  await e.emit('sessionCleared'); assert.equal(await result, null); assert.equal(codeField.value, '');
  release(); await submitting; await tick();
  assert.equal(e.find('Fertig'), null); assert.ok(!e.document.body.textContent.includes(CODE));
});

test('shipped HTML keeps the committing dialog visible through user cancel and Escape while the actual commit result is delayed', async () => {
  const flow = require('./harness/recovery-flow'); const { findByAttribute } = require('./harness/dashboard-app');
  const app = await generatedApp(); const oldCode = await flow.completeSetup(app, flow.button(app, 'Verschlüsselung jetzt einrichten'));
  await flow.click(app, 'Einstellungen'); await findByAttribute(app.root, 'data-settings-area', 'security').dispatch('click');
  let release, entered; const waiting = new Promise(resolve => { release = resolve; }); const started = new Promise(resolve => { entered = resolve; });
  const realCommit = app.Storage.commitPreparedProtection.bind(app.Storage);
  app.Storage.commitPreparedProtection = async (...args) => { const result = await realCommit(...args); entered(); await waiting; return result; };
  const pending = flow.button(app, 'Code ersetzen').dispatch('click');
  await flow.waitFor(app, () => flow.field(app, 'Aktuelles Passwort'), 'current password'); flow.field(app, 'Aktuelles Passwort').value = app.password; await flow.click(app, 'Weiter');
  const codeView = await flow.waitFor(app, () => app.document.body._find(node => node.dataset.recoveryCode === 'true'), 'replacement code'); const newCode = codeView.textContent;
  await flow.click(app, 'Code gesichert – weiter'); flow.field(app, 'Wiederherstellungscode vollständig eingeben').value = newCode;
  const commitClick = flow.button(app, 'Code bestätigen und speichern').dispatch('click'); await started;
  const cancel = flow.button(app, 'Abbrechen'); assert.ok(cancel); assert.equal(cancel.disabled, true); await cancel.dispatch('click');
  const escape = new Event('keydown', { cancelable: true }); Object.defineProperty(escape, 'key', { value: 'Escape' }); app.sandbox.window.dispatchEvent(escape);
  assert.ok(app.document.body.textContent.includes('Speichern…')); assert.equal(escape.defaultPrevented, true);
  const tab = new Event('keydown', { cancelable: true }); Object.defineProperty(tab, 'key', { value: 'Tab' }); app.sandbox.window.dispatchEvent(tab); assert.equal(tab.defaultPrevented, true);
  release(); await commitClick; await flow.click(app, 'Fertig'); await pending;
  assert.ok(await app.Storage.verifyRecoveryCode({ source: 'local', code: newCode })); await assert.rejects(app.Storage.verifyRecoveryCode({ source: 'local', code: oldCode }));
  await app.Storage.lockSession();
});

test('shipped HTML code checking authenticates the local source and leaves persisted bytes unchanged', async () => {
  const flow = require('./harness/recovery-flow'); const { findByAttribute } = require('./harness/dashboard-app');
  const app = await generatedApp(); const code = await flow.completeSetup(app, flow.button(app, 'Verschlüsselung jetzt einrichten'));
  await flow.click(app, 'Einstellungen'); await findByAttribute(app.root, 'data-settings-area', 'security').dispatch('click');
  const before = Object.fromEntries(app.storage._keys().map(key => [key, app.storage.getItem(key)]));
  const pending = flow.button(app, 'Code prüfen').dispatch('click'); await flow.click(app, 'Weiter');
  const input = flow.field(app, 'Vorhandenen Wiederherstellungscode eingeben'); input.value = 'incorrect'; await flow.click(app, 'Bestand authentifizieren');
  assert.ok(flow.field(app, 'Vorhandenen Wiederherstellungscode eingeben')); assert.ok(!app.document.body.textContent.includes('Code erfolgreich geprüft'));
  input.value = code; await flow.click(app, 'Bestand authentifizieren'); assert.match(app.document.body.textContent, /Code erfolgreich geprüft/);
  assert.match(app.document.body.textContent, /Sicherungszeit: 20/); await flow.click(app, 'Schließen'); await pending;
  assert.deepEqual(Object.fromEntries(app.storage._keys().map(key => [key, app.storage.getItem(key)])), before);
  assert.equal(input.value, ''); assert.ok(!app.document.body.textContent.includes(code)); await app.Storage.lockSession();
});
