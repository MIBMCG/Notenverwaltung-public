'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { bundleEsmGraph, loadEsmGraph } = require('./harness/load-esm-graph.js');
const { loadModules, localStorageStub } = require('./harness/load.js');
const { openStorageSession } = require('./harness/storage-session');
const { buildCourseState } = require('./harness/fixtures.js');

const { createLockManagerStub } = require('./harness/shared-session');
const { createSessionCoordinator } = loadEsmGraph('src/infrastructure/session-coordinator.js').exports;
const newCoordinator = () => createSessionCoordinator({ lockManager: createLockManagerStub(), resourceName: 'notenverwaltung-v1-editor' });

const LOCAL_PASSWORD = 'Synthetisches-Archivpasswort-2026';
const STORAGE_KEY_ENC_PAYLOAD = 'notenverwaltung_v1_state_enc';
const STORAGE_KEY_SALT = 'notenverwaltung_v1_salt';
const STORAGE_KEY_ENC_FLAG = 'notenverwaltung_v1_encrypted';

const API_KEYS = [
  'loadState', 'loadCurrentSessionState', 'flushPendingWrites', 'saveState', 'replaceState', 'resetState', 'enableEncryption', 'hasSessionPassword',
  'encryptForBackup', 'lockSession', 'exportStateEncrypted',
  'importStateEncryptedFromText', 'isEncrypted', 'changePassword',
  'setSessionTimeoutMinutes', 'getSessionTimeoutMinutes', '_encryptJsonWithSalt',
  '_decryptPayload'
];

function createCryptoGate() {
  const gate = { encrypt: null, decrypt: null };
  const source = crypto;
  const subtle = new Proxy(source.subtle, {
    get(target, property) {
      const method = Reflect.get(target, property, target);
      if (typeof method !== 'function') return method;
      return (...args) => {
        const activeGate = property === 'encrypt' ? gate.encrypt : property === 'decrypt' ? gate.decrypt : null;
        const run = () => method.apply(target, args);
        return activeGate ? activeGate(run) : run();
      };
    }
  });
  const cryptoImpl = new Proxy(source, {
    get(target, property) {
      if (property === 'subtle') return subtle;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  return { cryptoImpl, gate };
}

function createGate() {
  let release;
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  return {
    started,
    release() { release(); },
    async wait(run) {
      signalStarted();
      await released;
      return run();
    }
  };
}

async function createEncryptedStorageFixture({
  state = { courses: [], assessments: [], students: [] }, cryptoImpl = crypto,
  setTimeoutImpl = () => 0, clearTimeoutImpl = () => {}
} = {}) {
  const storage = localStorageStub();
  const writer = (await openStorageSession({ storage, password: LOCAL_PASSWORD, seed: 641, cryptoImpl, setTimeoutImpl, clearTimeoutImpl }));
  await writer.Storage.enableEncryption(LOCAL_PASSWORD, state);
  return { storage, writer, state };
}

function createFactorySandbox() {
  const listenerTypes = [];
  const window = {
    addEventListener(type) { listenerTypes.push(type); },
    dispatchEvent() {},
    promptPassword: async () => null,
    alert() {},
    confirm() { return false; }
  };
  return {
    globals: {
      Date,
      Event,
      TextEncoder,
      TextDecoder,
      btoa,
      atob,
      crypto,
      localStorage: localStorageStub(),
      window,
      setTimeout() { throw new Error('Timer darf bei Fabrikerzeugung nicht starten.'); },
      clearTimeout() {},
      console: { error() {}, warn() {}, log() {}, info() {}, debug() {} }
    },
    listenerTypes
  };
}

test('Storage-Modul importiert ohne Browser-Globals und exportiert nur die Fabrik', () => {
  const loaded = loadEsmGraph('src/infrastructure/storage.js');
  assert.deepEqual(Object.keys(loaded.exports), ['createStorage']);
  assert.equal(typeof loaded.exports.createStorage, 'function');
});

test('createStorage erzeugt die unveraenderte API und registriert erst dann neun Listener', () => {
  const { globals, listenerTypes } = createFactorySandbox();
  const { exports } = loadEsmGraph('src/infrastructure/storage.js', { globals });
  assert.deepEqual(listenerTypes, []);
  assert.equal(Object.hasOwn(globals.window, 'Storage'), false);
  const storage = exports.createStorage({
    sessionCoordinator: newCoordinator(),
    DomainModel: { ensureStateShape: state => state },
    createInitialState: () => ({ courses: [] })
  });
  assert.deepEqual(Object.keys(storage).sort(), API_KEYS.slice().sort());
  assert.deepEqual(listenerTypes.sort(), ['beforeunload', 'click', 'focus', 'keydown', 'mousemove', 'pagehide', 'pageshow', 'storage', 'touchstart']);
  assert.equal(Object.hasOwn(globals.window, 'Storage'), false);
});

test('zwei Storage-Instanzen behalten Timeout und Sitzungszustand getrennt', async () => {
  const { globals } = createFactorySandbox();
  const { exports } = loadEsmGraph('src/infrastructure/storage.js', { globals });
  const dependencies = {
    sessionCoordinator: newCoordinator(),
    DomainModel: { ensureStateShape: state => state },
    createInitialState: () => ({ courses: [] })
  };
  const first = exports.createStorage(dependencies);
  const second = exports.createStorage({ ...dependencies, sessionCoordinator: newCoordinator() });
  await dependencies.sessionCoordinator.acquire();
  first.setSessionTimeoutMinutes(3);
  assert.equal(first.getSessionTimeoutMinutes(), 3);
  assert.equal(second.getSessionTimeoutMinutes(), 15);
  await first.enableEncryption('synthetisches-passwort', { courses: [] });
  assert.equal(first.hasSessionPassword(), true);
  assert.equal(second.hasSessionPassword(), false);
});

test('Fabrikerzeugung beruehrt weder Speicher, Kryptografie noch Timer-Globals', () => {
  const listenerTypes = [];
  const timerAccesses = { setTimeout: 0, clearTimeout: 0 };
  const forbidden = name => new Proxy({}, { get() { throw new Error(`${name} wurde beruehrt.`); } });
  const sandbox = {
    window: { addEventListener(type) { listenerTypes.push(type); } },
    localStorage: forbidden('localStorage'),
    crypto: forbidden('crypto'),
    console: { error() {}, warn() {}, log() {}, info() {}, debug() {} }
  };
  Object.defineProperties(sandbox, {
    setTimeout: {
      get() { timerAccesses.setTimeout += 1; return () => {}; }
    },
    clearTimeout: {
      get() { timerAccesses.clearTimeout += 1; return () => {}; }
    }
  });
  vm.createContext(sandbox);
  vm.runInContext(bundleEsmGraph('src/infrastructure/storage.js', { globalName: '__storage_exports' }), sandbox);
  sandbox.__storage_exports.createStorage({
    sessionCoordinator: newCoordinator(),
    DomainModel: { ensureStateShape: state => state },
    createInitialState: () => ({ courses: [] })
  });
  assert.equal(listenerTypes.length, 9);
  assert.deepEqual(timerAccesses, { setTimeout: 0, clearTimeout: 0 });
});

async function buildEncryptedArchiveFixture(storage, snapshot, seed) {
  const writer = (await openStorageSession({ storage, password: LOCAL_PASSWORD, seed }));
  const { state, course, categoryIds } = buildCourseState(writer, { studentCount: 1 });
  for (const [index, categoryId] of [categoryIds.oral, categoryIds.written].entries()) {
    writer.DomainModel.addAssessmentToState(state, writer.DomainModel.createAssessment({
      id: `assessment_storage_integrity_${index + 1}`,
      courseId: course.id,
      categoryId,
      title: `Synthetische Speicherleistung ${index + 1}`,
      term: '2025-H1'
    }));
  }
  writer.DomainModel.archiveCourse(state, course.id, 'manual', {});
  course.id = 'course_storage_archive_integrity';
  course.archiveSnapshot = snapshot;
  for (const assessment of state.assessments) assessment.courseId = course.id;
  return { writer, state, course };
}

test('R02: encrypted local load rejects malformed archive snapshots without any storage write', async t => {
  for (const [index, snapshot] of [null, [], 'x', {}].entries()) {
    await t.test(`snapshot ${JSON.stringify(snapshot)}`, async () => {
      const storage = localStorageStub();
      const { writer, state, course } = await buildEncryptedArchiveFixture(storage, snapshot, 151 + index);
      await writer.Storage.enableEncryption(LOCAL_PASSWORD, state);
      const originalPayload = storage.getItem(STORAGE_KEY_ENC_PAYLOAD);
      const originalSalt = storage.getItem(STORAGE_KEY_SALT);
      let writes = 0;
      const originalSetItem = storage.setItem.bind(storage);
      const originalRemoveItem = storage.removeItem.bind(storage);
      storage.setItem = (...args) => { writes += 1; return originalSetItem(...args); };
      storage.removeItem = (...args) => { writes += 1; return originalRemoveItem(...args); };
      const reader = (await openStorageSession({ storage, password: LOCAL_PASSWORD, seed: 160 + index }));

      await reader.sessionCoordinator.acquire();

      await assert.rejects(
        () => reader.Storage.loadState(),
        error => error && error.code === 'STATE_CONTENT_INVALID' &&
          String(error.message).includes(course.id) && /Backup/.test(String(error.message))
      );
      assert.equal(writes, 0, 'Laden eines beschädigten Bestands darf keinen Speicherzugriff schreiben');
      assert.equal(storage.getItem(STORAGE_KEY_ENC_PAYLOAD), originalPayload);
      assert.equal(storage.getItem(STORAGE_KEY_SALT), originalSalt);
    });
  }
});

test('R02: encrypted local load retains a complete internally consistent empty archive', async () => {
  const storage = localStorageStub();
  const fixture = await buildEncryptedArchiveFixture(storage, null, 155);
  fixture.state.assessments = [];
  fixture.course.archiveSnapshot = fixture.writer.DomainModel.createArchiveSnapshot(fixture.state, fixture.course);
  fixture.course.archiveSnapshot.categories = [];
  fixture.course.archiveSnapshot.weightTemplate = null;
  fixture.course.weightTemplateId = null;
  await fixture.writer.Storage.enableEncryption(LOCAL_PASSWORD, fixture.state);
  const reader = (await openStorageSession({ storage, password: LOCAL_PASSWORD, seed: 165 }));

  await reader.sessionCoordinator.acquire();
  const restored = await reader.Storage.loadState();

  assert.equal(restored.courses[0].id, fixture.course.id);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.courses[0].archiveSnapshot.categories)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.assessments)), []);
});

test('R19: encrypted local load rejects unknown dated, undated, and archived terms without writes', async t => {
  for (const [index, fixture] of [
    { label: 'dated active', date: '2026-02-05', archived: false },
    { label: 'undated active', date: null, archived: false },
    { label: 'dated archived', date: '2026-02-05', archived: true }
  ].entries()) {
    await t.test(fixture.label, async () => {
      const storage = localStorageStub();
      const writer = (await openStorageSession({ storage, password: LOCAL_PASSWORD, seed: 180 + index }));
      const { state, course, categoryIds } = buildCourseState(writer, { studentCount: 1 });
      const assessment = writer.DomainModel.createAssessment({
        id: `invalid-term-${index}`,
        courseId: course.id,
        categoryId: categoryIds.written,
        title: fixture.label,
        date: fixture.date,
        term: '2025-H2',
        termAssignment: 'manual'
      });
      writer.DomainModel.addAssessmentToState(state, assessment);
      if (fixture.archived) writer.DomainModel.archiveCourse(state, course.id, 'manual', {});
      assessment.term = '2025-H3';

      const portable = await writer.Storage._encryptJsonWithSalt(JSON.stringify(state), LOCAL_PASSWORD);
      const [salt, iv, cipher] = portable.split(':');
      storage.setItem(STORAGE_KEY_SALT, salt);
      storage.setItem(STORAGE_KEY_ENC_PAYLOAD, `${iv}:${cipher}`);
      storage.setItem('notenverwaltung_v1_encrypted', '1');
      const originalPayload = storage.getItem(STORAGE_KEY_ENC_PAYLOAD);
      const originalSalt = storage.getItem(STORAGE_KEY_SALT);
      let writes = 0;
      const originalSetItem = storage.setItem.bind(storage);
      const originalRemoveItem = storage.removeItem.bind(storage);
      storage.setItem = (...args) => { writes += 1; return originalSetItem(...args); };
      storage.removeItem = (...args) => { writes += 1; return originalRemoveItem(...args); };
      const reader = (await openStorageSession({ storage, password: LOCAL_PASSWORD, seed: 190 + index }));

      await reader.sessionCoordinator.acquire();

      await assert.rejects(
        () => reader.Storage.loadState(),
        error => error && error.code === 'STATE_CONTENT_INVALID' &&
          /Originaldaten wurden nicht verändert/.test(String(error.message))
      );
      assert.equal(writes, 0, 'Integritätsprüfung muss vor jeder lokalen Speichermutation abbrechen');
      assert.equal(storage.getItem(STORAGE_KEY_ENC_PAYLOAD), originalPayload);
      assert.equal(storage.getItem(STORAGE_KEY_SALT), originalSalt);
    });
  }
});

test('exclusive recovery read waits behind a real save, returns its latest state, and never prompts or writes', async () => {
  const { cryptoImpl, gate } = createCryptoGate();
  const saveGate = createGate();
  let timerStarts = 0;
  const { storage, writer } = await createEncryptedStorageFixture({
    cryptoImpl,
    setTimeoutImpl() { timerStarts++; return timerStarts; },
    clearTimeoutImpl() {}
  });
  let promptCalls = 0;
  writer.sandbox.window.promptPassword = async () => { promptCalls++; return LOCAL_PASSWORD; };
  let writes = 0;
  const setItem = storage.setItem.bind(storage);
  const removeItem = storage.removeItem.bind(storage);
  storage.setItem = (...args) => { writes++; return setItem(...args); };
  storage.removeItem = (...args) => { writes++; return removeItem(...args); };

  gate.encrypt = saveGate.wait;
  const latest = { courses: [{ id: 'after-save', name: 'latest confirmed state' }], assessments: [], students: [] };
  const saving = writer.Storage.saveState(latest);
  await saveGate.started;
  const recovery = writer.Storage.loadCurrentSessionState();
  saveGate.release();
  await saving;
  const writeCountAfterSave = writes;
  const restored = await recovery;

  assert.equal(restored.courses[0].id, 'after-save');
  assert.equal(restored.courses[0].name, 'latest confirmed state');
  assert.equal(writes, writeCountAfterSave, 'the recovery read itself must not mutate local storage');
  assert.equal(promptCalls, 0, 'an already-unlocked recovery read must never prompt');
  assert.equal(writer.Storage.hasSessionPassword(), true);
  assert.equal(timerStarts, 1, 'the recovery read must not reset the inactivity timer');
});

test('exclusive recovery read refuses a locked session without prompting or restoring credentials', async () => {
  const { writer } = await createEncryptedStorageFixture();
  writer.Storage.lockSession();
  let promptCalls = 0;
  writer.sandbox.window.promptPassword = async () => { promptCalls++; return LOCAL_PASSWORD; };

  await assert.rejects(
    () => writer.Storage.loadCurrentSessionState(),
    { code: 'SESSION_NOT_OWNER' }
  );

  assert.equal(promptCalls, 0);
  assert.equal(writer.Storage.hasSessionPassword(), false);
});

test('exclusive recovery read rejects a lock that occurs during real decryption without restoring credentials', async () => {
  const { cryptoImpl, gate: cryptoGate } = createCryptoGate();
  const { storage, writer } = await createEncryptedStorageFixture({ cryptoImpl });
  await writer.sessionCoordinator.acquire();
  await writer.Storage.loadState();
  const decryptGate = createGate();
  cryptoGate.decrypt = decryptGate.wait;
  const recovery = writer.Storage.loadCurrentSessionState();
  await decryptGate.started;
  writer.Storage.lockSession();
  decryptGate.release();

  await assert.rejects(recovery, error => error && error.code === 'STORAGE_GENERATION_STALE');
  assert.equal(writer.Storage.hasSessionPassword(), false);
});

test('exclusive recovery read surfaces invalid salt and invalid content without changing storage', async t => {
  await t.test('invalid salt', async () => {
    const { storage, writer } = await createEncryptedStorageFixture();
    await writer.sessionCoordinator.acquire();
    await writer.Storage.loadState();
    storage.setItem(STORAGE_KEY_SALT, '%%%');
    const beforePayload = storage.getItem(STORAGE_KEY_ENC_PAYLOAD);
    const beforeSalt = storage.getItem(STORAGE_KEY_SALT);
    let writes = 0;
    const setItem = storage.setItem.bind(storage);
    const removeItem = storage.removeItem.bind(storage);
    storage.setItem = (...args) => { writes++; return setItem(...args); };
    storage.removeItem = (...args) => { writes++; return removeItem(...args); };

    await assert.rejects(() => writer.Storage.loadCurrentSessionState());

    assert.equal(writes, 0);
    assert.equal(storage.getItem(STORAGE_KEY_ENC_PAYLOAD), beforePayload);
    assert.equal(storage.getItem(STORAGE_KEY_SALT), beforeSalt);
    assert.equal(writer.Storage.hasSessionPassword(), false);
  });

  await t.test('invalid content', async () => {
    const { storage, writer } = await createEncryptedStorageFixture();
    await writer.sessionCoordinator.acquire();
    await writer.Storage.loadState();
    const portable = await writer.Storage._encryptJsonWithSalt('{ invalid json', LOCAL_PASSWORD);
    const [salt, iv, cipher] = portable.split(':');
    storage.setItem(STORAGE_KEY_SALT, salt);
    storage.setItem(STORAGE_KEY_ENC_PAYLOAD, `${iv}:${cipher}`);
    const beforePayload = storage.getItem(STORAGE_KEY_ENC_PAYLOAD);
    const beforeSalt = storage.getItem(STORAGE_KEY_SALT);
    let writes = 0;
    const setItem = storage.setItem.bind(storage);
    const removeItem = storage.removeItem.bind(storage);
    storage.setItem = (...args) => { writes++; return setItem(...args); };
    storage.removeItem = (...args) => { writes++; return removeItem(...args); };

    await assert.rejects(
      () => writer.Storage.loadCurrentSessionState(),
      error => error && error.code === 'STORAGE_EXTERNAL_CHANGE'
    );

    assert.equal(writes, 0);
    assert.equal(storage.getItem(STORAGE_KEY_ENC_PAYLOAD), beforePayload);
    assert.equal(storage.getItem(STORAGE_KEY_SALT), beforeSalt);
    assert.equal(writer.Storage.hasSessionPassword(), false);
  });
});

test('loadState cannot complete a password prompt after a later lock', async () => {
  const fixture = await createEncryptedStorageFixture();
  fixture.writer.Storage.lockSession();
  const promptGate = createGate();
  fixture.writer.sandbox.window.promptPassword = () => promptGate.wait(async () => LOCAL_PASSWORD);
  await fixture.writer.sessionCoordinator.acquire();
  const loading = fixture.writer.Storage.loadState();
  await promptGate.started;
  fixture.writer.Storage.lockSession();
  promptGate.release();

  await assert.rejects(loading, error => error && error.code === 'STORAGE_GENERATION_STALE');
  assert.equal(fixture.writer.Storage.hasSessionPassword(), false);
});

test('stale decrypt failure after a newer login does not clear the newer session', async () => {
  const { cryptoImpl, gate } = createCryptoGate();
  const fixture = await createEncryptedStorageFixture({ cryptoImpl });
  fixture.writer.Storage.lockSession();
  const oldDecryptGate = createGate();
  let decryptCalls = 0;
  gate.decrypt = async run => {
    decryptCalls++;
    if (decryptCalls === 1) {
      await oldDecryptGate.wait(async () => undefined);
      throw new Error('obsolete authentication failure');
    }
    return run();
  };
  const prompts = [LOCAL_PASSWORD, LOCAL_PASSWORD];
  fixture.writer.sandbox.window.promptPassword = async () => prompts.shift();
  fixture.writer.sandbox.window.confirm = () => true;
  await fixture.writer.sessionCoordinator.acquire();
  const staleLoad = fixture.writer.Storage.loadState();
  await new Promise(resolve => setImmediate(resolve));
  await oldDecryptGate.started;
  fixture.writer.Storage.lockSession();
  await fixture.writer.sessionCoordinator.acquire();
  const newLoad = fixture.writer.Storage.loadState();
  const loaded = await newLoad;
  oldDecryptGate.release();

  await assert.rejects(staleLoad, error => error && error.code === 'STORAGE_GENERATION_STALE');
  assert.equal(loaded.courses.length, 0);
  assert.equal(fixture.writer.Storage.hasSessionPassword(), true);
});

test('loadState retries a wrong password and permits parallel reads of one unlocked session', async () => {
  const fixture = await createEncryptedStorageFixture();
  fixture.writer.Storage.lockSession();
  const passwords = ['falsches-passwort', LOCAL_PASSWORD];
  let promptCalls = 0;
  fixture.writer.sandbox.window.promptPassword = async () => { promptCalls++; return passwords.shift(); };
  fixture.writer.sandbox.window.confirm = () => true;

  await fixture.writer.sessionCoordinator.acquire();
  const loaded = await fixture.writer.Storage.loadState();
  assert.equal(promptCalls, 2, 'a real authentication failure must still permit a legitimate retry');
  assert.equal(loaded.courses.length, 0);
  assert.equal(fixture.writer.Storage.hasSessionPassword(), true);

  const decryptGate = createGate();
  const { cryptoImpl, gate } = createCryptoGate();
  // Use a new module instance over the same encrypted bytes so both reads share a gated real decrypt.
  const reader = (await openStorageSession({ storage: fixture.storage, password: LOCAL_PASSWORD, seed: 642, cryptoImpl }));
  await reader.sessionCoordinator.acquire();
  await reader.Storage.loadState();
  let decryptCalls = 0;
  gate.decrypt = async run => {
    decryptCalls++;
    if (decryptCalls <= 2) await decryptGate.wait(async () => undefined);
    return run();
  };
  await reader.sessionCoordinator.acquire();
  const first = reader.Storage.loadState();
  await reader.sessionCoordinator.acquire();
  const second = reader.Storage.loadState();
  await decryptGate.started;
  decryptGate.release();
  const results = await Promise.all([first, second]);
  assert.equal(results.length, 2);
  assert.equal(reader.Storage.hasSessionPassword(), true);
});
