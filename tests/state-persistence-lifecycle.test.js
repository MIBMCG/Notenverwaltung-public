'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadDashboardUi, findByText, findByAttribute } = require('./harness/dashboard-app');
const { readSourceLines } = require('./harness/extract');
const { loadEsmGraph } = require('./harness/load-esm-graph');
const { loadModules } = require('./harness/load');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function goToSchool(app) {
  await findByText(app.root, 'Einstellungen').dispatch('click');
  await findByAttribute(app.root, 'data-settings-area', 'school').dispatch('click');
}

async function startDelayedProfileSave(app, schoolName) {
  await goToSchool(app);
  const name = findByAttribute(app.root, 'id', 'settings-school-name');
  name.value = schoolName;
  await name.dispatch('input');

  const written = deferred();
  const acknowledge = deferred();
  const save = app.Storage.saveState.bind(app.Storage);
  let first = true;
  app.Storage.saveState = async candidate => {
    await save(candidate);
    if (first) {
      first = false;
      written.resolve();
      await acknowledge.promise;
    }
  };
  const pending = findByAttribute(app.root, 'id', 'settings-school-save').dispatch('click');
  await written.promise;
  return { acknowledge, pending };
}

async function startPasswordChange(app, oldPassword, newPassword) {
  await findByAttribute(app.root, 'data-settings-area', 'security').dispatch('click');
  const passwords = [oldPassword, newPassword];
  app.sandbox.window.promptPassword = async () => passwords.shift();
  const pending = findByText(app.root, 'Passwort ändern').dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  return { pending };
}

function installRealPasswordPrompt(app) {
  const source = readSourceLines().join('\n');
  const start = source.indexOf('    window.promptPassword = function');
  const end = source.indexOf('    // Debug-Toast-Funktion entfernt', start);
  assert.ok(start >= 0 && end > start, 'the production password dialog source must be available');
  vm.runInContext(source.slice(start, end), app.sandbox, { filename: 'real-password-prompt.js' });
}

test('a password dialog opened before lock cannot start a credential write after that lock', async () => {
  for (const lockDuring of ['old-password', 'new-password']) {
    const app = await loadDashboardUi();
    await app.UiShell.init('app');
    await findByText(app.root, 'Einstellungen').dispatch('click');
    await findByAttribute(app.root, 'data-settings-area', 'security').dispatch('click');
    installRealPasswordPrompt(app);
    let credentialWrites = 0;
    const realChangePassword = app.Storage.changePassword.bind(app.Storage);
    app.Storage.changePassword = (...args) => {
      credentialWrites += 1;
      return realChangePassword(...args);
    };

    const pending = findByText(app.root, 'Passwort ändern').dispatch('click');
    let inputs = app.document.body.querySelectorAll('input').filter(element => element.type === 'password');
    assert.equal(inputs.length, 1);
    inputs[0].value = app.password;
    if (lockDuring === 'new-password') {
      await findByText(app.document.body, 'OK').dispatch('click');
      await new Promise(resolve => setImmediate(resolve));
      inputs = app.document.body.querySelectorAll('input').filter(element => element.type === 'password');
      assert.equal(inputs.length, 2);
    }

    app.Storage.lockSession();
    assert.equal(app.Storage.hasSessionPassword(), false);
    assert.ok(findByText(app.root, 'Anwendung gesperrt'));
    assert.equal(app.document.body.querySelectorAll('input').filter(element => element.type === 'password').length, 0,
      'hard lock closes the old password dialog');
    await pending;

    assert.equal(credentialWrites, 0, `${lockDuring}: stale dialogs must not reach Storage.changePassword`);
    assert.equal(app.Storage.hasSessionPassword(), false, `${lockDuring}: the locked session must stay locked`);
    assert.ok(findByText(app.root, 'Anwendung gesperrt'));
  }
});

for (const passwordSucceeds of [true, false]) {
  test(`password change ${passwordSucceeds ? 'success' : 'failure'} reconciles an earlier encrypted save awaiting UI acknowledgement`, async () => {
    const app = await loadDashboardUi();
    const alerts = [];
    app.sandbox.window.alert = message => alerts.push(String(message));
    await app.UiShell.init('app');
    const delayed = await startDelayedProfileSave(app, 'Synthetischer Passwortgrenzen-Bestand');
    const passwordChange = (await startPasswordChange(
      app,
      passwordSucceeds ? app.password : 'falsches-altes-passwort',
      'neues-synthetisches-passwort'
    )).pending;

    delayed.acknowledge.resolve();
    await Promise.all([delayed.pending, passwordChange]);
    const stored = await app.Storage.loadState();
    await goToSchool(app);
    await findByText(app.root, 'Änderungen verwerfen').dispatch('click');
    assert.equal(findByAttribute(app.root, 'id', 'settings-school-name').value,
      stored.settings.schoolProfile.name);
    assert.equal(stored.settings.schoolProfile.name, 'Synthetischer Passwortgrenzen-Bestand');
    assert.ok(alerts.some(message => passwordSucceeds
      ? /Passwort erfolgreich geändert/.test(message)
      : /Passwortänderung fehlgeschlagen/.test(message)));
  });
}

test('locking supersedes a queued password change without overwriting the next session', async () => {
  const app = await loadDashboardUi();
  await app.UiShell.init('app');
  const delayed = await startDelayedProfileSave(app, 'Vor der Sperre gespeichert');
  const passwordChange = (await startPasswordChange(app, app.password, 'neues-synthetisches-passwort')).pending;

  app.Storage.lockSession();
  delayed.acknowledge.resolve();
  await Promise.all([delayed.pending, passwordChange]);
  app.sandbox.window.promptPassword = async () => app.password;
  await findByText(app.root, 'Entsperren').dispatch('click');
  assert.equal(app.Storage.hasSessionPassword(), true, 'the original password must still unlock the next session');
  assert.equal((await app.Storage.loadState()).settings.schoolProfile.name, 'Vor der Sperre gespeichert');
});

test('reset supersedes a queued password change and remains the confirmed state', async () => {
  const app = await loadDashboardUi();
  app.sandbox.window.confirm = () => true;
  await app.UiShell.init('app');
  const delayed = await startDelayedProfileSave(app, 'Vor dem Reset gespeichert');
  const passwordChange = (await startPasswordChange(app, app.password, 'neues-synthetisches-passwort')).pending;
  const reset = findByText(app.root, 'Alles zurücksetzen, Achtung!').dispatch('click');

  delayed.acknowledge.resolve();
  await Promise.all([delayed.pending, passwordChange, reset]);
  assert.equal((await app.Storage.loadState()).settings.schoolProfile.name, '');
  app.Storage.lockSession();
  app.sandbox.window.confirm = () => false;
  app.sandbox.window.promptPassword = async () => app.password;
  await findByText(app.root, 'Entsperren').dispatch('click');
  assert.equal(app.Storage.hasSessionPassword(), true, 'reset must retain the original session credential');
  await goToSchool(app);
  await findByText(app.root, 'Änderungen verwerfen').dispatch('click');
  assert.equal(findByAttribute(app.root, 'id', 'settings-school-name').value, '');
});

for (const boundary of ['reset', 'replace']) {
  for (const failBoundary of [false, true]) {
    test(`${boundary} ${failBoundary ? 'failure reconciles' : 'supersedes'} an earlier encrypted save awaiting UI acknowledgement`, async () => {
      const modules = loadModules();
      const initial = modules.DomainModel.createEmptyState();
      initial.settings.schoolProfile = { name: 'Synthetische Ausgangsschule', logoMode: 'none', logoDataUrl: '' };
      const app = await loadDashboardUi({ state: initial });
      app.sandbox.mergeImportedStateIntoCurrent = app.sandbox.__module_exports.ImportMerge.mergeImportedStateIntoCurrent;
      app.sandbox.window.confirm = () => true;
      const alerts = [];
      app.sandbox.window.alert = message => alerts.push(String(message));
      await app.UiShell.init('app');
      await goToSchool(app);
      const name = findByAttribute(app.root, 'id', 'settings-school-name');
      name.value = 'Synthetischer früherer Schreibvorgang';
      await name.dispatch('input');

      const written = deferred();
      const acknowledge = deferred();
      const save = app.Storage.saveState.bind(app.Storage);
      let first = true;
      app.Storage.saveState = async candidate => {
        // Start the real encrypted operation immediately. Only the fulfilled
        // acknowledgement is delayed; no save crosses into a new generation.
        await save(candidate);
        if (first) {
          first = false;
          written.resolve();
          await acknowledge.promise;
        }
      };
      const earlierSave = findByAttribute(app.root, 'id', 'settings-school-save').dispatch('click');
      await written.promise;
      assert.equal((await app.Storage.loadState()).settings.schoolProfile.name, name.value);

      const beforeBoundary = app.storage.getItem('notenverwaltung_v1_state_enc');
      const setItem = app.storage.setItem.bind(app.storage);
      let injected = false;
      app.storage.setItem = (key, value) => {
        if (failBoundary && !injected && key === 'notenverwaltung_v1_state_enc') {
          injected = true;
          throw Object.assign(new Error('Synthetischer Quotenfehler im Bestandswechsel'), { name: 'QuotaExceededError' });
        }
        setItem(key, value);
      };

      let boundaryAction;
      if (boundary === 'reset') {
        boundaryAction = findByText(app.root, 'Alles zurücksetzen, Achtung!').dispatch('click');
      } else {
        await findByText(app.root, 'Import / Export').dispatch('click');
        const input = findByAttribute(app.root, 'id', 'json-import-file');
        let reader;
        app.sandbox.FileReader = class { readAsText() { reader = this; } };
        input.files = [{ name: 'synthetischer-ersatz.json' }];
        await input.dispatch('change');
        const incoming = app.DomainModel.createEmptyState();
        incoming.settings.schoolProfile = { name: 'Synthetischer Ersatz', logoMode: 'none', logoDataUrl: '' };
        boundaryAction = reader.onload({ target: { result: JSON.stringify(incoming) } });
      }
      // Let the action establish its boundary before releasing the old ACK.
      await new Promise(resolve => setImmediate(resolve));
      acknowledge.resolve();
      await Promise.all([earlierSave, boundaryAction]);
      const stored = await app.Storage.loadState();
      if (failBoundary) {
        assert.equal(injected, true, 'failure must occur at a real encrypted write');
        assert.equal(app.storage.getItem('notenverwaltung_v1_state_enc'), beforeBoundary);
        assert.equal(stored.settings.schoolProfile.name, 'Synthetischer früherer Schreibvorgang');
        assert.ok(alerts.some(message => /fehlgeschlagen/.test(message)));
      } else {
        assert.equal(stored.settings.schoolProfile.name, boundary === 'replace' ? 'Synthetischer Ersatz' : '');
      }
      // Inspect confirmed profile through a fresh UI, discarding any old draft.
      await goToSchool(app);
      const cancel = findByText(app.root, 'Änderungen verwerfen');
      assert.ok(cancel, 'the profile draft can be explicitly discarded');
      await cancel.dispatch('click');
      assert.equal(findByAttribute(app.root, 'id', 'settings-school-name').value, stored.settings.schoolProfile.name,
        'a failed exclusive operation must not leave RAM older than encrypted storage');
    });
  }
}

async function lockAndUnlock(app) {
  app.Storage.lockSession();
  assert.ok(findByText(app.root, 'Anwendung gesperrt'));
  app.sandbox.window.promptPassword = async () => app.password;
  await findByText(app.root, 'Entsperren').dispatch('click');
  return JSON.stringify(await app.Storage.loadState());
}

test('repeated unlock while real decryption is pending opens exactly one session and publishes its UI', async () => {
  const app = await loadDashboardUi();
  await app.UiShell.init('app');
  app.Storage.lockSession();
  const unlock = findByText(app.root, 'Entsperren');
  assert.ok(unlock);
  app.sandbox.window.promptPassword = async () => app.password;
  const decryptStarted = deferred();
  const releaseDecrypt = deferred();
  const originalCrypto = app.sandbox.crypto;
  const subtle = new Proxy(originalCrypto.subtle, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key === 'decrypt') return async (...args) => {
        decryptStarted.resolve();
        await releaseDecrypt.promise;
        return value.apply(target, args);
      };
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  app.sandbox.crypto = new Proxy(originalCrypto, {
    get(target, key) {
      if (key === 'subtle') return subtle;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  const load = app.Storage.loadState.bind(app.Storage);
  let loads = 0;
  app.Storage.loadState = () => { loads++; return load(); };
  const first = unlock.dispatch('click');
  await decryptStarted.promise;
  // The harness dispatches the same listener even when disabled. This also
  // verifies the in-flight guard for an already queued second click event.
  const repeated = unlock.dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  releaseDecrypt.resolve();
  await Promise.all([first, repeated]);
  assert.equal(loads, 1, 'one pending login must not be superseded by a second click');
  assert.equal(app.Storage.hasSessionPassword(), true);
  assert.equal(findByText(app.root, 'Anwendung gesperrt'), null);
  assert.ok(findByText(app.root, 'Übersicht'));
  assert.ok(await load(), 'the unlocked session still decrypts its persisted state');
});

for (const boundary of ['lock', 'reset', 'replace']) {
  test(`a queued settings edit cannot cross the ${boundary} boundary`, async () => {
    const app = await loadDashboardUi();
    app.sandbox.mergeImportedStateIntoCurrent = app.sandbox.__module_exports.ImportMerge.mergeImportedStateIntoCurrent;
    app.sandbox.window.confirm = () => true;
    await app.UiShell.init('app');
    await goToSchool(app);
    const schoolName = findByAttribute(app.root, 'id', 'settings-school-name');
    schoolName.value = 'Synthetische Änderung vor Grenze';
    await schoolName.dispatch('input');
    const written = deferred();
    const acknowledge = deferred();
    const originalSave = app.Storage.saveState.bind(app.Storage);
    let ordinarySaves = 0;
    app.Storage.saveState = async candidate => {
      ordinarySaves++;
      const call = ordinarySaves;
      await originalSave(candidate);
      if (call === 1) {
        written.resolve();
        await acknowledge.promise;
      }
    };
    const earlierSave = findByAttribute(app.root, 'id', 'settings-school-save').dispatch('click');
    await written.promise;
    await findByAttribute(app.root, 'data-settings-area', 'grading').dispatch('click');
    const category = findByAttribute(app.root, 'id', 'settings-category-name-0');
    assert.ok(category);
    category.value = 'Veraltete wartende Änderung';
    const waitingEdit = category.dispatch('change');
    await new Promise(resolve => setImmediate(resolve));

    let boundaryAction;
    if (boundary === 'lock') {
      app.Storage.lockSession();
      boundaryAction = Promise.resolve();
    } else if (boundary === 'reset') {
      boundaryAction = findByText(app.root, 'Alles zurücksetzen, Achtung!').dispatch('click');
    } else {
      await findByText(app.root, 'Import / Export').dispatch('click');
      const input = findByAttribute(app.root, 'id', 'json-import-file');
      let reader;
      app.sandbox.FileReader = class { readAsText() { reader = this; } };
      input.files = [{ name: 'synthetische-neue-generation.json' }];
      await input.dispatch('change');
      const incoming = app.DomainModel.createEmptyState();
      boundaryAction = reader.onload({ target: { result: JSON.stringify(incoming) } });
    }
    await new Promise(resolve => setImmediate(resolve));
    acknowledge.resolve();
    await Promise.all([earlierSave, waitingEdit, boundaryAction]);
    if (boundary === 'lock') {
      app.sandbox.window.promptPassword = async () => app.password;
      await findByText(app.root, 'Entsperren').dispatch('click');
    }
    assert.equal(ordinarySaves, 1, 'the waiting old edit must be aborted before starting a storage write');
    const stored = await app.Storage.loadState();
    assert.equal(stored.settings.categories.some(item => item.name === 'Veraltete wartende Änderung'), false);
    await app.Storage.lockSession();
    const restarted = await loadDashboardUi({ storage: app.storage, lockManager: app.lockManager, useExistingStorage: true });
    await restarted.UiShell.init('app');
    assert.equal((await restarted.Storage.loadState()).settings.categories.some(item => item.name === 'Veraltete wartende Änderung'), false);
  });
}

function csvBytes(lastName = 'Muster', id = 'fresh') {
  return new TextEncoder().encode(
    'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag\n' +
    `${id}-course;Synthetischer Kurs;Biologie;9a;${id}-person;${lastName};Mia;2010-04-03`
  );
}

function windows1252Bytes() {
  const text = new TextDecoder().decode(csvBytes('M|ller'));
  return Uint8Array.from(text, char => char === '|' ? 0xfc : char.charCodeAt(0));
}

async function csvHarness() {
  const app = await loadDashboardUi();
  app.sandbox.CsvImportOrchestrator = loadEsmGraph('src/transfer/csv-import-orchestrator.js')
    .exports.createCsvImportOrchestrator({ DomainModel: app.DomainModel });
  const alerts = [];
  app.sandbox.window.alert = message => alerts.push(String(message));
  await app.UiShell.init('app');
  await findByText(app.root, 'Import / Export').dispatch('click');
  const baseline = JSON.parse(JSON.stringify(await app.Storage.loadState()));
  let pendingSave = Promise.resolve();
  let saveCalls = 0;
  const save = app.Storage.saveState.bind(app.Storage);
  app.Storage.saveState = candidate => {
    saveCalls++;
    pendingSave = save(candidate);
    return pendingSave;
  };
  const input = findByAttribute(app.root, 'id', 'csv-import-file');
  const readers = [];
  app.sandbox.FileReader = class { readAsArrayBuffer() { readers.push(this); } };
  return {
    app, alerts, input, readers, baseline, saves: () => saveCalls,
    async settle() {
      let observed;
      do {
        await new Promise(resolve => setImmediate(resolve));
        observed = pendingSave;
        await observed;
        await new Promise(resolve => setImmediate(resolve));
      } while (observed !== pendingSave);
    },
    async select(name = 'synthetisch.csv') {
      input.files = name ? [{ name }] : [];
      await input.dispatch('change');
      return readers.at(-1);
    },
    async finish(reader, bytes) {
      await reader.onload({ target: { result: Uint8Array.from(bytes).buffer } });
      await this.settle();
    },
    button(label) {
      return app.document.body._find(element => element.tagName === 'BUTTON' && element.textContent === label);
    }
  };
}

function csvConflictBytes() {
  return new TextEncoder().encode(
    'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag\n' +
    'conflict-a;Konflikt A;Biologie;9a;conflict-person;;Mia;2010-04-03\n' +
    'conflict-b;Konflikt B;Biologie;9a;conflict-person;Stale;Mia;2010-04-03'
  );
}

for (const boundary of ['lock', 'reset', 'replace']) {
  for (const decision of ['Fehlerhafte Zeilen überspringen', 'Trotz Fehler übernehmen (mit Warnung)']) {
    test(`an old CSV warning decision (${decision}) cannot cross the ${boundary} boundary`, async () => {
    const h = await csvHarness();
    h.app.sandbox.window.confirm = () => true;
    await h.finish(await h.select('konflikt.csv'), csvConflictBytes());
    const oldDecision = h.button(decision);
    assert.ok(oldDecision, 'the real CSV warning dialog must be open');

    if (boundary === 'lock') {
      await lockAndUnlock(h.app);
    } else if (boundary === 'reset') {
      await findByText(h.app.root, 'Alles zurücksetzen, Achtung!').dispatch('click');
    } else {
      const input = findByAttribute(h.app.root, 'id', 'json-import-file');
      let reader;
      h.app.sandbox.FileReader = class { readAsText() { reader = this; } };
      input.files = [{ name: 'synthetischer-ersatz.json' }];
      await input.dispatch('change');
      const incoming = h.app.DomainModel.createEmptyState();
      incoming.settings.schoolProfile = { name: 'Bestätigter JSON-Ersatz', logoMode: 'none', logoDataUrl: '' };
      await reader.onload({ target: { result: JSON.stringify(incoming) } });
    }
    const confirmed = JSON.stringify(await h.app.Storage.loadState());
    const savesBeforeDecision = h.saves();

    await oldDecision.dispatch('click');
    await h.settle();
    assert.equal(h.saves(), savesBeforeDecision, 'the stale decision must abort before starting a write');
    assert.equal(JSON.stringify(await h.app.Storage.loadState()), confirmed,
      'the stale CSV candidate must not enter the confirmed state');
    assert.equal(h.alerts.some(message => /CSV-Import abgeschlossen/.test(message)), false);
    });
  }
}

test('a current CSV warning decision remains retryable after a visible save failure', async () => {
  const h = await csvHarness();
  const original = JSON.stringify(await h.app.Storage.loadState());
  await h.finish(await h.select('konflikt.csv'), csvConflictBytes());
  const accept = h.button('Trotz Fehler übernehmen (mit Warnung)');
  assert.ok(accept);
  const save = h.app.Storage.saveState.bind(h.app.Storage);
  let attempts = 0;
  h.app.Storage.saveState = candidate => {
    attempts++;
    if (attempts === 1) {
      return Promise.reject(Object.assign(new Error('Synthetischer Quotenfehler'), { name: 'QuotaExceededError' }));
    }
    return save(candidate);
  };

  await accept.dispatch('click');
  assert.equal(attempts, 1);
  assert.equal(JSON.stringify(await h.app.Storage.loadState()), original);
  assert.ok(h.alerts.some(message => /Fehler beim Abschließen des Imports/.test(message)),
    'the failed write must stay visible');

  await accept.dispatch('click');
  await h.settle();
  assert.equal(attempts, 2);
  assert.notEqual(JSON.stringify(await h.app.Storage.loadState()), original);
  assert.equal(h.alerts.filter(message => /CSV-Import abgeschlossen/.test(message)).length, 1);
});

test('a replaced CSV reader cannot overwrite the later file selection', async () => {
  const h = await csvHarness();
  const first = await h.select('erste.csv');
  const second = await h.select('zweite.csv');
  await h.finish(second, csvBytes('Zweiter', 'second'));
  const accepted = JSON.stringify(await h.app.Storage.loadState());
  await h.finish(first, csvBytes('Erster', 'first'));
  assert.equal(JSON.stringify(await h.app.Storage.loadState()), accepted);
  const stored = await h.app.Storage.loadState();
  const added = stored.students.filter(student => !h.baseline.students.some(original => original.id === student.id));
  assert.deepEqual(Array.from(added, student => student.lastName), ['Zweiter']);
});

test('cancelling CSV selection before FileReader completion leaves the encrypted state untouched', async () => {
  const h = await csvHarness();
  const original = JSON.stringify(await h.app.Storage.loadState());
  const reader = await h.select();
  await h.select(null);
  await h.finish(reader, csvBytes());
  assert.equal(h.saves(), 0, 'a cancelled file selection must not start a save');
  assert.equal(JSON.stringify(await h.app.Storage.loadState()), original);
  assert.equal(h.alerts.some(message => /CSV-Import abgeschlossen/.test(message)), false);
});

test('a rejected CSV preview save keeps its decoded draft and supports one successful retry', async () => {
  const h = await csvHarness();
  const original = JSON.stringify(await h.app.Storage.loadState());
  await h.finish(await h.select(), windows1252Bytes());
  await h.button('Als Windows-1252 erneut lesen').dispatch('click');
  const before = findByAttribute(h.app.root, 'id', 'csv-import-decode-preview');
  assert.match(before.textContent, /Müller/);
  let saves = 0;
  const save = h.app.Storage.saveState.bind(h.app.Storage);
  h.app.Storage.saveState = candidate => {
    saves++;
    if (saves === 1) return Promise.reject(Object.assign(new Error('Synthetischer Quotenfehler'), { name: 'QuotaExceededError' }));
    return save(candidate);
  };
  await h.button('CSV-Vorschau übernehmen').dispatch('click');
  await h.settle();
  assert.equal(JSON.stringify(await h.app.Storage.loadState()), original);
  assert.ok(h.alerts.some(message => /fehlgeschlagen|nicht gespeichert|Quotenfehler/i.test(message)), 'save failure must be visible');
  const preview = findByAttribute(h.app.root, 'id', 'csv-import-decode-preview');
  assert.match(preview.textContent, /Müller/, 'the explicitly decoded input must stay available for retry');
  await h.button('CSV-Vorschau übernehmen').dispatch('click');
  await h.settle();
  const stored = await h.app.Storage.loadState();
  assert.equal(saves, 2);
  const added = stored.students.filter(student => !h.baseline.students.some(original => original.id === student.id));
  assert.deepEqual(Array.from(added, student => student.lastName), ['Müller']);
  assert.equal(stored.courses.length, h.baseline.courses.length + 1);
  assert.equal(stored.courses.find(course => course.importKey === 'fresh-course').enrollments.length, 1);
  assert.equal(h.alerts.filter(message => /CSV-Import abgeschlossen/.test(message)).length, 1);
});

test('an old decoded CSV preview cannot apply after locking and unlocking', async () => {
  const h = await csvHarness();
  await h.finish(await h.select(), windows1252Bytes());
  await h.button('Als Windows-1252 erneut lesen').dispatch('click');
  const oldApply = h.button('CSV-Vorschau übernehmen');
  assert.ok(oldApply);
  const afterUnlock = await lockAndUnlock(h.app);
  await oldApply.dispatch('click');
  await h.settle();
  assert.equal(h.saves(), 0, 'an invalidated preview must not start a save');
  assert.equal(JSON.stringify(await h.app.Storage.loadState()), afterUnlock);
  assert.equal(h.alerts.some(message => /CSV-Import abgeschlossen/.test(message)), false);
});

test('an old CSV read cannot import into the newly unlocked session', async () => {
  const app = await loadDashboardUi();
  app.sandbox.CsvImportOrchestrator = loadEsmGraph('src/transfer/csv-import-orchestrator.js')
    .exports.createCsvImportOrchestrator({ DomainModel: app.DomainModel });
  await app.UiShell.init('app');
  await findByText(app.root, 'Import / Export').dispatch('click');
  const input = findByAttribute(app.root, 'id', 'csv-import-file');
  let reader;
  app.sandbox.FileReader = class {
    readAsArrayBuffer() { reader = this; }
  };
  input.files = [{ name: 'synthetischer-alter-lesevorgang.csv' }];
  await input.dispatch('change');
  assert.ok(reader);

  const afterUnlock = await lockAndUnlock(app);
  const originalSave = app.Storage.saveState.bind(app.Storage);
  let saves = 0;
  let pendingSave = Promise.resolve();
  app.Storage.saveState = candidate => {
    saves++;
    pendingSave = originalSave(candidate);
    return pendingSave;
  };
  const bytes = new TextEncoder().encode(
    'KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag\n' +
    'stale-course;Alte Auswahl;Biologie;9a;stale-person;Testname;Testvorname;2010-04-03'
  );
  await reader.onload({ target: { result: bytes.buffer } });
  await pendingSave;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(saves, 0, 'the old file selection belongs to the invalidated session');
  assert.equal(JSON.stringify(await app.Storage.loadState()), afterUnlock);
});

for (const merge of [false, true]) {
  test(`an old JSON read cannot ${merge ? 'merge into' : 'replace'} the newly unlocked session`, async () => {
    const app = await loadDashboardUi();
    app.sandbox.mergeImportedStateIntoCurrent = app.sandbox.__module_exports.ImportMerge.mergeImportedStateIntoCurrent;
    const alerts = [];
    app.sandbox.window.alert = message => alerts.push(String(message));
    await app.UiShell.init('app');
    await findByText(app.root, 'Import / Export').dispatch('click');
    findByAttribute(app.root, 'id', 'json-import-merge-checkbox').checked = merge;
    const input = findByAttribute(app.root, 'id', 'json-import-file');
    let reader;
    app.sandbox.FileReader = class { readAsText() { reader = this; } };
    input.files = [{ name: 'synthetische-alte-auswahl.json' }];
    await input.dispatch('change');
    assert.ok(reader);
    const incoming = app.DomainModel.createEmptyState();
    app.DomainModel.addCourseToState(incoming, app.DomainModel.createCourse({
      id: 'old-file-course', name: 'Alte Dateiauswahl', subject: 'Biologie', classLabel: '9a'
    }));
    const afterUnlock = await lockAndUnlock(app);
    let saveCalls = 0;
    let replacementCalls = 0;
    let confirmations = 0;
    const originalSave = app.Storage.saveState.bind(app.Storage);
    const originalReplace = app.Storage.replaceState.bind(app.Storage);
    app.Storage.saveState = candidate => { saveCalls++; return originalSave(candidate); };
    app.Storage.replaceState = candidate => { replacementCalls++; return originalReplace(candidate); };
    app.sandbox.window.confirm = () => { confirmations++; return true; };
    await reader.onload({ target: { result: JSON.stringify(incoming) } });
    assert.equal(alerts.some(message => /Import fehlgeschlagen/.test(message)), false,
      'the lifecycle assertion must not pass because the harness lacks an importer dependency');
    assert.equal(saveCalls + replacementCalls, 0, 'no old selection may start a write in the new session');
    assert.equal(confirmations, 0, 'the invalidated selection must not reopen an import decision');
    assert.equal(JSON.stringify(await app.Storage.loadState()), afterUnlock);
  });
}
