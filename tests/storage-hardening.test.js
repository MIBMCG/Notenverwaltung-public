'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { localStorageStub } = require('./harness/load');
const { openStorageSession } = require('./harness/storage-session');
const { deferred } = require('./harness/shared-session');

const OLD = 'Synthetic-old-password-2026';
const NEW = 'Synthetic-new-password-2026';
const KEYS = ['notenverwaltung_v1_state_enc', 'notenverwaltung_v1_salt', 'notenverwaltung_v1_encrypted', 'notenverwaltung_v1_state'];
const JOURNAL = 'notenverwaltung_v1_credential_journal';
const snapshot = storage => Object.fromEntries(storage._keys().sort().map(key => [key, storage.getItem(key)]));
function restore(bytes) {
  const storage = localStorageStub();
  for (const [key, value] of Object.entries(bytes)) storage.setItem(key, value);
  return storage;
}
function observeMutations(storage, callback) {
  for (const name of ['setItem', 'removeItem']) {
    const original = storage[name].bind(storage);
    storage[name] = (...args) => { original(...args); callback(snapshot(storage), args[0]); };
  }
}
function marker(app, name = 'Synthetic preserved state') {
  const state = app.DomainModel.createEmptyState();
  state.settings.schoolProfile = { name, logoMode: 'none', logoDataUrl: '' };
  return state;
}
function cryptoFault(method, errorName) {
  return {
    getRandomValues: crypto.getRandomValues.bind(crypto),
    subtle: new Proxy(crypto.subtle, { get(target, property) {
      if (property === method) return async () => { throw new DOMException('Synthetic private provider detail', errorName); };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } })
  };
}
async function encryptedFixture() {
  const app = await openStorageSession({ password: OLD });
  await app.Storage.enableEncryption(OLD, marker(app));
  return app;
}

for (const operation of ['initial setup', 'password rotation']) {
  test(`every persisted ${operation} prefix reopens a complete state after a process restart`, async () => {
    const writer = operation === 'initial setup' ? await openStorageSession() : await encryptedFixture();
    const prefixes = [];
    observeMutations(writer.storage, bytes => prefixes.push(bytes));
    if (operation === 'initial setup') await writer.Storage.enableEncryption(NEW, marker(writer));
    else await writer.Storage.changePassword(OLD, NEW);
    await writer.Storage.lockSession();
    for (const [index, bytes] of prefixes.entries()) {
      const accepted = [];
      for (const password of operation === 'initial setup' ? [NEW] : [OLD, NEW]) {
        const reader = await openStorageSession({ storage: restore(bytes), password });
        try {
          const state = await reader.Storage.loadState();
          if (reader.Storage.hasSessionPassword()) {
            assert.equal(state.settings.schoolProfile.name, 'Synthetic preserved state');
            assert.equal(reader.storage.getItem(JOURNAL), null);
            accepted.push(password);
            await reader.Storage.saveState(marker(reader, 'Synthetic later save'));
            const again = await openStorageSession({ storage: reader.storage, password });
            assert.equal((await again.Storage.loadState()).settings.schoolProfile.name, 'Synthetic later save');
            await again.Storage.lockSession();
          }
        } finally { await reader.Storage.lockSession(); }
      }
      assert.ok(accepted.length, `prefix ${index + 1} must preserve a readable complete state`);
      if (bytes[JOURNAL] && operation === 'password rotation') {
        assert.deepEqual(accepted, [OLD, NEW], `pending rotation ${index + 1} must recover with either credential`);
      }
    }
  });
}

for (const variant of ['missing flag', 'invalid flag', 'missing salt', 'missing payload', 'salt only', 'empty payload']) {
  test(`unjournaled ${variant} blocks load and setup without writes`, async () => {
    const writer = await encryptedFixture();
    const bytes = snapshot(writer.storage);
    await writer.Storage.lockSession();
    if (variant === 'missing flag') delete bytes[KEYS[2]];
    if (variant === 'invalid flag') bytes[KEYS[2]] = '0';
    if (variant === 'missing salt') delete bytes[KEYS[1]];
    if (variant === 'missing payload') delete bytes[KEYS[0]];
    if (variant === 'salt only') { delete bytes[KEYS[0]]; delete bytes[KEYS[2]]; }
    if (variant === 'empty payload') bytes[KEYS[0]] = '';
    const app = await openStorageSession({ storage: restore(bytes), password: OLD });
    let writes = 0, prompts = 0;
    observeMutations(app.storage, () => writes++);
    app.sandbox.window.promptPassword = async () => { prompts++; return OLD; };
    await assert.rejects(app.Storage.loadState(), { code: 'LOCAL_STORAGE_INTEGRITY_INVALID' });
    await assert.rejects(app.Storage.enableEncryption(NEW, marker(app)), { code: 'LOCAL_STORAGE_INTEGRITY_INVALID' });
    assert.equal(writes, 0);
    assert.equal(prompts, 0);
    assert.deepEqual(snapshot(app.storage), bytes);
    await app.Storage.lockSession();
  });
}

test('a complete encrypted state cannot be replaced by setup before authentication', async () => {
  const writer = await encryptedFixture();
  const bytes = snapshot(writer.storage);
  const app = await openStorageSession({ storage: writer.storage });
  await assert.rejects(app.Storage.enableEncryption(NEW, marker(app)), { code: 'STORAGE_SESSION_NOT_INITIALIZED' });
  assert.deepEqual(snapshot(app.storage), bytes);
  await app.Storage.lockSession();
});

for (const [method, errorName] of [['deriveKey', 'NotSupportedError'], ['deriveKey', 'OperationError'], ['decrypt', 'NotSupportedError'], ['decrypt', 'InvalidAccessError']]) {
  test(`${method} ${errorName} is a technical error, never a password retry`, async () => {
    const writer = await encryptedFixture();
    const bytes = snapshot(writer.storage);
    const app = await openStorageSession({ storage: writer.storage, password: OLD, cryptoImpl: cryptoFault(method, errorName) });
    let retries = 0;
    app.sandbox.window.confirm = () => { retries++; return false; };
    await assert.rejects(app.Storage.loadState(), error => error.code === 'CRYPTO_OPERATION_FAILED' && !/private provider detail/.test(error.message));
    assert.equal(retries, 0);
    assert.equal(app.Storage.hasSessionPassword(), false);
    assert.deepEqual(snapshot(app.storage), bytes);
    await app.Storage.lockSession();
  });
}

for (const change of [bytes => { bytes[KEYS[0]] = 'invalid'; }, bytes => { bytes[KEYS[0]] = '!!!:AAAA'; }, bytes => { bytes[KEYS[1]] = '%%%'; }, bytes => { bytes[KEYS[0]] = 'AAAA:AAAA'; }]) {
  test('invalid encrypted encoding is rejected before any password retry or write', async () => {
    const writer = await encryptedFixture();
    const bytes = snapshot(writer.storage);
    await writer.Storage.lockSession();
    change(bytes);
    const app = await openStorageSession({ storage: restore(bytes), password: OLD });
    let retries = 0;
    app.sandbox.window.confirm = () => { retries++; return false; };
    await assert.rejects(app.Storage.loadState(), { code: 'ENCRYPTED_FORMAT_INVALID' });
    assert.equal(retries, 0);
    assert.deepEqual(snapshot(app.storage), bytes);
    await app.Storage.lockSession();
  });
}

test('real AES-GCM authentication failure alone offers password retry without writes', async () => {
  const writer = await encryptedFixture();
  const bytes = snapshot(writer.storage);
  const app = await openStorageSession({ storage: writer.storage, password: NEW });
  let retries = 0, writes = 0;
  observeMutations(app.storage, () => writes++);
  app.sandbox.window.confirm = () => { retries++; return false; };
  await app.Storage.loadState();
  assert.equal(retries, 1);
  assert.equal(writes, 0);
  assert.equal(app.Storage.hasSessionPassword(), false);
  assert.deepEqual(snapshot(app.storage), bytes);
});

async function pendingRotation() {
  const app = await encryptedFixture();
  let pending;
  observeMutations(app.storage, bytes => { if (bytes[JOURNAL] && !pending) pending = bytes; });
  await app.Storage.changePassword(OLD, NEW);
  await app.Storage.lockSession();
  assert.ok(pending, 'credential transaction must persist a recovery record first');
  return pending;
}

test('credential journal never duplicates legacy plaintext or stores passwords', async () => {
  const app = await openStorageSession();
  const state = marker(app, 'SYNTHETIC-LEGACY-PRIVATE-MARKER');
  app.storage.setItem(KEYS[3], JSON.stringify(state));
  let journal;
  observeMutations(app.storage, bytes => { if (bytes[JOURNAL]) journal = bytes[JOURNAL]; });
  await app.Storage.enableEncryption(NEW, state);
  assert.ok(journal);
  assert.ok(!journal.includes('SYNTHETIC-LEGACY-PRIVATE-MARKER'));
  assert.ok(!journal.includes(NEW));
  await app.Storage.lockSession();
});

test('every recovery mutation remains recoverable after another process restart', async () => {
  const bytes = await pendingRotation();
  const app = await openStorageSession({ storage: restore(bytes), password: NEW });
  const prefixes = [];
  observeMutations(app.storage, value => prefixes.push(value));
  await app.Storage.loadState();
  await app.Storage.lockSession();
  assert.ok(prefixes.length > 0);
  for (const prefix of prefixes) {
    const restarted = await openStorageSession({ storage: restore(prefix), password: NEW });
    assert.equal((await restarted.Storage.loadState()).settings.schoolProfile.name, 'Synthetic preserved state');
    await restarted.Storage.lockSession();
  }
});

test('a failed final journal cleanup rolls back credentials and keeps the old password usable', async () => {
  const app = await encryptedFixture();
  const before = snapshot(app.storage);
  const remove = app.storage.removeItem.bind(app.storage);
  let failed = false;
  app.storage.removeItem = key => {
    remove(key);
    if (key === JOURNAL && !failed) { failed = true; throw new Error('Synthetic journal cleanup failed'); }
  };
  await assert.rejects(app.Storage.changePassword(OLD, NEW), /Synthetic journal cleanup failed/);
  assert.equal(failed, true);
  assert.deepEqual(snapshot(app.storage), before);
  const reader = await openStorageSession({ storage: app.storage, password: OLD });
  assert.equal((await reader.Storage.loadState()).settings.schoolProfile.name, 'Synthetic preserved state');
  await reader.Storage.lockSession();
});

test('every persisted rollback prefix preserves at least one complete credential state', async () => {
  for (const failAfter of [2, 3, 4]) {
    const app = await encryptedFixture();
    const prefixes = [];
    let calls = 0;
    for (const method of ['setItem', 'removeItem']) {
      const original = app.storage[method].bind(app.storage);
      app.storage[method] = (...args) => {
        original(...args);
        prefixes.push(snapshot(app.storage));
        if (++calls === failAfter) throw new Error('Synthetic crash-triggering write failure');
      };
    }
    await assert.rejects(app.Storage.changePassword(OLD, NEW), /Synthetic crash-triggering write failure/);
    await app.Storage.lockSession();
    for (const prefix of prefixes) {
      let readable = false;
      for (const password of [OLD, NEW]) {
        const reader = await openStorageSession({ storage: restore(prefix), password });
        const state = await reader.Storage.loadState();
        if (reader.Storage.hasSessionPassword()) {
          readable = true;
          assert.equal(state.settings.schoolProfile.name, 'Synthetic preserved state');
        }
        await reader.Storage.lockSession();
      }
      assert.equal(readable, true, `rollback after failed write ${failAfter} lost both credentials`);
    }
  }
});

test('recovery cleanup failure preserves the journal for a later authenticated retry', async () => {
  const bytes = await pendingRotation();
  const app = await openStorageSession({ storage: restore(bytes), password: NEW });
  const remove = app.storage.removeItem.bind(app.storage);
  let failed = false;
  app.storage.removeItem = key => {
    if (key === JOURNAL && !failed) { failed = true; throw new Error('Synthetic recovery cleanup failure'); }
    remove(key);
  };
  await assert.rejects(app.Storage.loadState(), /Synthetic recovery cleanup failure/);
  assert.deepEqual(snapshot(app.storage), bytes);
  assert.equal(app.Storage.hasSessionPassword(), false);
  const restarted = await openStorageSession({ storage: app.storage, password: NEW });
  assert.equal((await restarted.Storage.loadState()).settings.schoolProfile.name, 'Synthetic preserved state');
  await restarted.Storage.lockSession();
});

test('recovery rejects replaced legacy plaintext without deleting or duplicating it', async () => {
  const app = await openStorageSession();
  const state = marker(app);
  app.storage.setItem(KEYS[3], JSON.stringify(state));
  let pending;
  observeMutations(app.storage, bytes => { if (bytes[JOURNAL] && !pending) pending = bytes; });
  await app.Storage.enableEncryption(NEW, state);
  await app.Storage.lockSession();
  pending[KEYS[3]] = '{"foreign":"SYNTHETIC CHANGED PLAINTEXT"}';
  const reader = await openStorageSession({ storage: restore(pending), password: NEW });
  await assert.rejects(reader.Storage.loadState(), { code: 'LOCAL_STORAGE_INTEGRITY_INVALID' });
  assert.deepEqual(snapshot(reader.storage), pending);
  await reader.Storage.lockSession();
});

test('recovery never falls back to an old candidate after a technical decrypt error', async () => {
  const bytes = await pendingRotation();
  const app = await openStorageSession({ storage: restore(bytes), password: OLD, cryptoImpl: cryptoFault('decrypt', 'NotSupportedError') });
  let retries = 0;
  app.sandbox.window.confirm = () => { retries++; return false; };
  await assert.rejects(app.Storage.loadState(), { code: 'CRYPTO_OPERATION_FAILED' });
  assert.equal(retries, 0);
  assert.deepEqual(snapshot(app.storage), bytes);
  await app.Storage.lockSession();
});

test('pending recovery cancellation and wrong password preserve every original byte', async () => {
  const bytes = await pendingRotation();
  for (const password of [null, 'Synthetic-wrong-password']) {
    const app = await openStorageSession({ storage: restore(bytes), password });
    let writes = 0;
    observeMutations(app.storage, () => writes++);
    await app.Storage.loadState();
    assert.equal(writes, 0);
    assert.deepEqual(snapshot(app.storage), bytes);
    assert.equal(app.Storage.hasSessionPassword(), false);
  }
});

test('malformed journal and fields outside its snapshots block recovery and setup', async () => {
  const valid = await pendingRotation();
  for (const bytes of [{ ...valid, [JOURNAL]: '{broken' }, { ...valid, [KEYS[1]]: 'foreign-value' }]) {
    const app = await openStorageSession({ storage: restore(bytes), password: OLD });
    await assert.rejects(app.Storage.loadState(), { code: 'LOCAL_STORAGE_INTEGRITY_INVALID' });
    await assert.rejects(app.Storage.enableEncryption(NEW, marker(app)), { code: 'LOCAL_STORAGE_INTEGRITY_INVALID' });
    assert.deepEqual(snapshot(app.storage), bytes);
    await app.Storage.lockSession();
  }
});

for (const boundary of ['lock', 'external journal change']) {
  test(`recovery interrupted by ${boundary} writes nothing after authentication`, async () => {
    const bytes = await pendingRotation();
    const entered = deferred(), resume = deferred();
    const cryptoImpl = {
      getRandomValues: crypto.getRandomValues.bind(crypto),
      subtle: new Proxy(crypto.subtle, { get(target, property) {
        const value = Reflect.get(target, property, target);
        if (property === 'decrypt') return async (...args) => { entered.resolve(); await resume.promise; return value.apply(target, args); };
        return typeof value === 'function' ? value.bind(target) : value;
      } })
    };
    const app = await openStorageSession({ storage: restore(bytes), password: NEW, cryptoImpl });
    const pending = app.Storage.loadState();
    const rejected = assert.rejects(pending, { code: boundary === 'lock' ? 'STORAGE_GENERATION_STALE' : 'STORAGE_EXTERNAL_CHANGE' });
    await entered.promise;
    if (boundary === 'lock') await app.Storage.lockSession();
    else app.storage.setItem(JOURNAL, 'foreign');
    const before = snapshot(app.storage);
    let writes = 0;
    observeMutations(app.storage, () => writes++);
    resume.resolve();
    await rejected;
    assert.equal(writes, 0);
    assert.deepEqual(snapshot(app.storage), before);
    await app.Storage.lockSession();
  });
}

for (const operation of ['setup', 'rotation', 'recovery']) {
  for (const boundary of ['lock', 'owner loss']) test(`${operation} rejects ${boundary} in a microtask after journal cleanup`, async () => {
    const app = operation === 'setup' ? await openStorageSession() : operation === 'rotation'
      ? await encryptedFixture()
      : await openStorageSession({ storage: restore(await pendingRotation()), password: NEW });
    const remove = app.storage.removeItem.bind(app.storage);
    app.storage.removeItem = key => {
      remove(key);
      if (key === JOURNAL) Promise.resolve().then(() => boundary === 'lock' ? app.Storage.lockSession() : app.sessionCoordinator.release());
    };
    const pending = operation === 'setup' ? app.Storage.enableEncryption(NEW, marker(app))
      : operation === 'rotation' ? app.Storage.changePassword(OLD, NEW) : app.Storage.loadState();
    await assert.rejects(pending, { code: boundary === 'lock' ? 'STORAGE_GENERATION_STALE' : 'SESSION_NOT_OWNER' });
    if (boundary === 'lock' || operation !== 'rotation') assert.equal(app.Storage.hasSessionPassword(), false);
    assert.equal(app.sessionCoordinator.getStatus(), 'idle');
    await app.Storage.lockSession();
  });
}
