'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModules, localStorageStub } = require('./harness/load');
const { deferred, createLockManagerStub } = require('./harness/shared-session');
const PASSWORD = 'Synthetic-session-password';
const KEYS = ['notenverwaltung_v1_state_enc', 'notenverwaltung_v1_salt', 'notenverwaltung_v1_encrypted', 'notenverwaltung_v1_state'];
const snapshot = storage => KEYS.map(key => storage.getItem(key));
function cryptoGate(method) {
  const entered = deferred(), resume = deferred();
  let active = false;
  const subtle = new Proxy(crypto.subtle, { get(target, name) {
    const fn = target[name];
    return typeof fn !== 'function' ? fn : async (...args) => {
      if (active && name === method) { entered.resolve(); await resume.promise; }
      return fn.apply(target, args);
    };
  }});
  return { cryptoImpl: { subtle, getRandomValues: crypto.getRandomValues.bind(crypto) }, entered, resume, arm() { active = true; } };
}
async function ready(modules) { if (modules.sessionReady) await modules.sessionReady; }
test('password rotation requires an authenticated baseline before any crypto and permits rotation after loading', async () => {
  const storage = localStorageStub(), lockManager = createLockManagerStub();
  const writer = loadModules({ storage, lockManager, password: PASSWORD });
  await writer.sessionCoordinator.acquire();
  const state = writer.DomainModel.createEmptyState();
  writer.DomainModel.addCourseToState(state, writer.DomainModel.createCourse({ name: 'Synthetic baseline course' }));
  await writer.Storage.enableEncryption(PASSWORD, state);
  await writer.Storage.lockSession();
  let cryptoCalls = 0;
  const subtle = new Proxy(crypto.subtle, { get(target, name) {
    const fn = target[name];
    return typeof fn !== 'function' ? fn : (...args) => { cryptoCalls++; return fn.apply(target, args); };
  }});
  const reader = loadModules({ storage, lockManager, password: PASSWORD, cryptoImpl: {
    subtle, getRandomValues(...args) { cryptoCalls++; return crypto.getRandomValues(...args); }
  }});
  await reader.sessionCoordinator.acquire();
  const before = snapshot(storage), newPassword = 'Synthetic-new-session-password';
  await assert.rejects(reader.Storage.changePassword(PASSWORD, newPassword), { code: 'STORAGE_SESSION_NOT_INITIALIZED' });
  assert.equal(cryptoCalls, 0);
  assert.deepEqual(snapshot(storage), before);
  assert.equal(reader.Storage.hasSessionPassword(), false);
  assert.equal(reader.sessionCoordinator.getStatus(), 'held');
  const loaded = await reader.Storage.loadState();
  assert.equal(loaded.courses[0].name, 'Synthetic baseline course');
  assert.equal(await reader.Storage.changePassword(PASSWORD, newPassword), true);
  assert.notEqual(storage.getItem(KEYS[1]), before[1]);
  await reader.Storage.lockSession();
  const reopened = loadModules({ storage, lockManager, password: newPassword });
  await reopened.sessionCoordinator.acquire();
  const restored = await reopened.Storage.loadState();
  assert.equal(restored.courses[0].name, 'Synthetic baseline course');
  assert.equal(reopened.Storage.hasSessionPassword(), true);
  await reopened.Storage.lockSession();
});
for (const key of KEYS) {
  test(`foreign ${key} during encryption is preserved and rejects the save`, async () => {
    const gate = cryptoGate('encrypt');
    const a = loadModules({ password: PASSWORD, cryptoImpl: gate.cryptoImpl });
    await ready(a);
    await a.Storage.enableEncryption(PASSWORD, a.DomainModel.createEmptyState());
    gate.arm();
    const pending = a.Storage.saveState(a.DomainModel.createEmptyState());
    const rejection = assert.rejects(pending, { code: 'STORAGE_EXTERNAL_CHANGE' });
    await gate.entered.promise;
    a.storage.setItem(key, 'foreign-synthetic-value');
    const before = snapshot(a.storage);
    gate.resume.resolve();
    await rejection;
    assert.deepEqual(snapshot(a.storage), before);
    assert.equal(a.Storage.hasSessionPassword(), false);
  });
}
test('delayed login cannot publish or autosave a changed encrypted snapshot', async () => {
  const a = loadModules({ password: PASSWORD });
  await ready(a);
  await a.Storage.enableEncryption(PASSWORD, a.DomainModel.createEmptyState());
  a.Storage.lockSession();
  if (a.sessionCoordinator) await a.sessionCoordinator.acquire();
  const entered = deferred(), resume = deferred();
  a.sandbox.window.promptPassword = async () => { entered.resolve(); return resume.promise; };
  const pending = a.Storage.loadState();
  const rejection = assert.rejects(pending, { code: 'STORAGE_EXTERNAL_CHANGE' });
  await entered.promise;
  a.storage.setItem(KEYS[3], 'foreign-legacy-data');
  const before = snapshot(a.storage);
  resume.resolve(PASSWORD);
  await rejection;
  assert.deepEqual(snapshot(a.storage), before);
  assert.equal(a.Storage.hasSessionPassword(), false);
});
test('built application blocks a second window before password, then loads current password after handover', async () => {
  const { pathToFileURL } = require('node:url');
  const path = require('node:path');
  const { buildArtifact } = await import(pathToFileURL(path.join(__dirname, '..', 'scripts', 'build.mjs')).href);
  const { loadGeneratedDashboardUi, findByText } = require('./harness/dashboard-app');
  const artifact = await buildArtifact();
  const storage = localStorageStub(), lockManager = createLockManagerStub();
  const a = await loadGeneratedDashboardUi({ artifact, storage, lockManager, password: PASSWORD });
  await a.start();
  assert.equal(a.Storage.hasSessionPassword(), true);
  let prompts = 0;
  const b = await loadGeneratedDashboardUi({ artifact, storage, lockManager, useExistingStorage: true,
    promptPassword: async () => { prompts++; return 'Synthetic-new-password'; } });
  const before = snapshot(storage);
  await b.start();
  assert.equal(prompts, 0);
  assert.deepEqual(snapshot(storage), before);
  assert.ok(findByText(b.root, 'Erneut versuchen'));
  await a.Storage.changePassword(PASSWORD, 'Synthetic-new-password');
  await a.Storage.lockSession();
  await findByText(b.root, 'Erneut versuchen').dispatch('click');
  assert.equal(prompts, 1);
  assert.equal(b.Storage.hasSessionPassword(), true);
  await b.Storage.lockSession();
});
test('flush reports an original pending write failure and permits a later corrected flush', async () => {
  const gate = cryptoGate('encrypt');
  const a = loadModules({ password: PASSWORD, cryptoImpl: gate.cryptoImpl });
  await ready(a);
  await a.Storage.enableEncryption(PASSWORD, a.DomainModel.createEmptyState());
  gate.arm();
  const write = a.Storage.saveState(a.DomainModel.createEmptyState());
  const failedWrite = assert.rejects(write, /synthetic-quota/);
  await gate.entered.promise;
  const set = a.storage.setItem.bind(a.storage);
  let fail = true;
  a.storage.setItem = (key, value) => { if (fail) { fail = false; throw new Error('synthetic-quota'); } set(key, value); };
  const flush = a.Storage.flushPendingWrites();
  const failedFlush = assert.rejects(flush, /synthetic-quota/);
  gate.resume.resolve();
  await Promise.all([failedWrite, failedFlush]);
  await a.Storage.saveState(a.DomainModel.createEmptyState());
  await a.Storage.flushPendingWrites();
});
test('two cooperative stores reject every nonowner mutation without changing bytes', async () => {
  const storage = localStorageStub(), lockManager = createLockManagerStub();
  const a = loadModules({ storage, lockManager, password: PASSWORD });
  const b = loadModules({ storage, lockManager, password: PASSWORD });
  assert.equal(await a.sessionCoordinator.acquire(), 'acquired');
  await a.Storage.enableEncryption(PASSWORD, a.DomainModel.createEmptyState());
  assert.equal(await b.sessionCoordinator.acquire(), 'busy');
  const before = snapshot(storage), state = b.DomainModel.createEmptyState();
  for (const write of [() => b.Storage.saveState(state), () => b.Storage.enableEncryption(PASSWORD, state),
    () => b.Storage.changePassword(PASSWORD, 'Synthetic-next-password'), () => b.Storage.replaceState(state), () => b.Storage.resetState()]) {
    await assert.rejects(write, { code: 'SESSION_NOT_OWNER' });
    assert.deepEqual(snapshot(storage), before);
  }
  await a.Storage.lockSession();
  assert.equal(await b.sessionCoordinator.acquire(), 'acquired');
  assert.ok(await b.Storage.loadState());
  await b.Storage.lockSession();
});
test('a stale encryption continuation cannot close or write a newer reacquired session', async () => {
  const gate = cryptoGate('encrypt');
  const a = loadModules({ password: PASSWORD, cryptoImpl: gate.cryptoImpl });
  await ready(a);
  await a.Storage.enableEncryption(PASSWORD, a.DomainModel.createEmptyState());
  gate.arm();
  const pending = a.Storage.saveState(a.DomainModel.createEmptyState());
  const rejected = assert.rejects(pending, { code: 'STORAGE_GENERATION_STALE' });
  await gate.entered.promise;
  await a.Storage.lockSession();
  await a.sessionCoordinator.acquire();
  await a.Storage.loadState();
  const before = snapshot(a.storage);
  gate.resume.resolve();
  await rejected;
  assert.equal(a.sessionCoordinator.getStatus(), 'held');
  assert.equal(a.Storage.hasSessionPassword(), true);
  assert.deepEqual(snapshot(a.storage), before);
});
test('rollback never restores old bytes over a foreign value written by a throwing mutation', async () => {
  const a = loadModules({ password: PASSWORD });
  await ready(a);
  await a.Storage.enableEncryption(PASSWORD, a.DomainModel.createEmptyState());
  const set = a.storage.setItem.bind(a.storage);
  let once = true;
  a.storage.setItem = (key, value) => {
    if (once) { once = false; set(key, 'foreign-during-transaction'); throw new Error('injected foreign write'); }
    set(key, value);
  };
  await assert.rejects(a.Storage.saveState(a.DomainModel.createEmptyState()), { code: 'STORAGE_EXTERNAL_CHANGE' });
  assert.equal(a.storage.getItem(KEYS[0]), 'foreign-during-transaction');
  assert.equal(a.Storage.hasSessionPassword(), false);
  await assert.rejects(a.Storage.saveState(a.DomainModel.createEmptyState()), { code: 'SESSION_NOT_OWNER' });
});
test('delayed storage events compare current bytes; real changes and focus invalidate the session', async () => {
  const a = loadModules({ password: PASSWORD });
  await ready(a);
  await a.Storage.enableEncryption(PASSWORD, a.DomainModel.createEmptyState());
  const delayed = new Event('storage');
  Object.assign(delayed, { key: KEYS[0], oldValue: 'retired', newValue: 'retired-too' });
  a.sandbox.window.dispatchEvent(delayed);
  assert.equal(a.Storage.hasSessionPassword(), true);
  a.storage.setItem(KEYS[3], 'foreign');
  a.sandbox.window.dispatchEvent(new Event('focus'));
  assert.equal(a.Storage.hasSessionPassword(), false);
  assert.equal(a.sessionCoordinator.getStatus(), 'idle');
  assert.equal(a.storage.getItem(KEYS[3]), 'foreign');
});
test('initial concurrent starts, cancelled login and BFCache return preserve exclusive ownership', async () => {
  const { loadDashboardUi, findByText } = require('./harness/dashboard-app');
  const storage = localStorageStub(), lockManager = createLockManagerStub();
  const a = await loadDashboardUi({ storage, lockManager, encrypted: false });
  const b = await loadDashboardUi({ storage, lockManager, encrypted: false });
  await Promise.all([a.UiShell.init('app'), b.UiShell.init('app')]);
  assert.equal(a.sessionCoordinator.getStatus(), 'held');
  assert.equal(b.sessionCoordinator.getStatus(), 'busy');
  assert.deepEqual(snapshot(storage), [null, null, null, null]);
  a.sandbox.window.promptPassword = async () => null;
  await findByText(a.root, 'Verschlüsselung jetzt einrichten').dispatch('click');
  await a.sessionCoordinator.release();
  assert.equal(a.sessionCoordinator.getStatus(), 'idle');
  await findByText(b.root, 'Erneut versuchen').dispatch('click');
  await b.Storage.enableEncryption(PASSWORD, b.DomainModel.createEmptyState());
  await b.Storage.lockSession();
  a.sandbox.window.promptPassword = async () => null;
  await a.UiShell.init('app');
  assert.equal(a.sessionCoordinator.getStatus(), 'idle');
  assert.equal(a.Storage.hasSessionPassword(), false);
  a.sandbox.window.promptPassword = async () => PASSWORD;
  await a.UiShell.init('app');
  a.sandbox.window.dispatchEvent(new Event('pagehide'));
  assert.equal(a.Storage.hasSessionPassword(), false);
  const restored = new Event('pageshow');
  Object.assign(restored, { persisted: true });
  a.sandbox.window.dispatchEvent(restored);
  for (let i = 0; i < 100 && !a.Storage.hasSessionPassword(); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(a.Storage.hasSessionPassword(), true);
  assert.equal(a.sessionCoordinator.getStatus(), 'held');
  await a.Storage.lockSession();
});
test('a write invoked without ownership cannot become authorized while waiting in the FIFO', async () => {
  const gate = cryptoGate('encrypt');
  const a = loadModules({ password: PASSWORD, cryptoImpl: gate.cryptoImpl });
  await ready(a);
  await a.Storage.enableEncryption(PASSWORD, a.DomainModel.createEmptyState());
  gate.arm();
  const oldSave = a.Storage.saveState(a.DomainModel.createEmptyState());
  const oldRejected = assert.rejects(oldSave, { code: 'STORAGE_GENERATION_STALE' });
  await gate.entered.promise;
  await a.Storage.lockSession();
  const unauthorized = a.Storage.enableEncryption(PASSWORD, a.DomainModel.createEmptyState());
  const unauthorizedRejected = assert.rejects(unauthorized, { code: 'SESSION_NOT_OWNER' });
  await a.sessionCoordinator.acquire();
  const before = snapshot(a.storage);
  gate.resume.resolve();
  await Promise.all([oldRejected, unauthorizedRejected]);
  assert.deepEqual(snapshot(a.storage), before);
});
for (const method of ['deriveKey', 'decrypt', 'encrypt']) {
  for (const key of KEYS) {
    test(`password rotation rejects foreign ${key} while ${method} is pending`, async () => {
      const gate = cryptoGate(method);
      const a = loadModules({ password: PASSWORD, cryptoImpl: gate.cryptoImpl });
      await ready(a);
      await a.Storage.enableEncryption(PASSWORD, a.DomainModel.createEmptyState());
      gate.arm();
      const pending = a.Storage.changePassword(PASSWORD, 'Synthetic-rotated-password');
      const rejected = assert.rejects(pending, { code: 'STORAGE_EXTERNAL_CHANGE' });
      await gate.entered.promise;
      a.storage.setItem(key, 'foreign-during-' + method);
      const before = snapshot(a.storage);
      gate.resume.resolve();
      await rejected;
      assert.deepEqual(snapshot(a.storage), before);
      assert.equal(a.Storage.hasSessionPassword(), false);
    });
  }
}
test('a late cancelled startup cannot release a newer successful login or replace its UI', async () => {
  const { loadDashboardUi, findByText } = require('./harness/dashboard-app');
  const app = await loadDashboardUi();
  await app.Storage.lockSession();
  const oldPrompt = deferred(), entered = deferred();
  app.sandbox.window.promptPassword = () => { entered.resolve(); return oldPrompt.promise; };
  const oldStart = app.UiShell.init('app');
  await entered.promise;
  await app.Storage.lockSession();
  app.sandbox.window.promptPassword = async () => app.password;
  await app.UiShell.init('app');
  assert.ok(findByText(app.root, 'Übersicht'));
  const before = snapshot(app.storage);
  oldPrompt.resolve(null);
  await oldStart;
  assert.ok(findByText(app.root, 'Übersicht'));
  assert.equal(app.Storage.hasSessionPassword(), true);
  assert.equal(app.sessionCoordinator.getStatus(), 'held');
  assert.deepEqual(snapshot(app.storage), before);
  await app.Storage.lockSession();
});
test('unsupported and rejected locks show a neutral retry without prompting or writing', async () => {
  const { loadDashboardUi, findByText } = require('./harness/dashboard-app');
  for (const lockManager of [null, { request: () => Promise.reject(new Error('native denied')) }]) {
    let prompts = 0;
    const app = await loadDashboardUi({ encrypted: false, lockManager,
      promptPassword: async () => { prompts++; return PASSWORD; } });
    await app.UiShell.init('app');
    assert.ok(findByText(app.root, 'Erneut versuchen'));
    assert.equal(prompts, 0);
    assert.deepEqual(app.storage._keys(), []);
    assert.equal(app.sessionCoordinator.getStatus(), 'unsupported');
  }
});
test('replacement rechecks generation after its save completes and before advancing the session', async () => {
  const a = loadModules({ password: PASSWORD });
  await ready(a);
  await a.Storage.enableEncryption(PASSWORD, a.DomainModel.createEmptyState());
  const remove = a.storage.removeItem.bind(a.storage);
  a.storage.removeItem = key => {
    remove(key);
    if (key === KEYS[3]) Promise.resolve().then(() => a.Storage.lockSession());
  };
  await assert.rejects(a.Storage.replaceState(a.DomainModel.createEmptyState()), { code: 'STORAGE_GENERATION_STALE' });
  assert.equal(a.Storage.hasSessionPassword(), false);
});
test('replacement renews inactivity for its new generation while an old timer cannot lock it', async () => {
  const timers = new Map();
  let timerId = 0;
  const a = loadModules({ password: PASSWORD, setTimeoutImpl: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeoutImpl: id => timers.delete(id) });
  await ready(a);
  await a.Storage.enableEncryption(PASSWORD, a.DomainModel.createEmptyState());
  const oldTimer = [...timers.values()].at(-1);
  await a.Storage.replaceState(a.DomainModel.createEmptyState());
  oldTimer();
  assert.equal(a.Storage.hasSessionPassword(), true);
  [...timers.values()].at(-1)();
  assert.equal(a.Storage.hasSessionPassword(), false);
  assert.equal(a.sessionCoordinator.getStatus(), 'idle');
});
