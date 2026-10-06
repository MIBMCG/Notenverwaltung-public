'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadModules, localStorageStub } = require('./harness/load.js');
const { openStorageSession } = require('./harness/storage-session');

const PASSWORD = 'Synthetisches-Testpasswort-2026';

function seededState(modules) {
  const { DomainModel } = modules;
  const state = DomainModel.createEmptyState();
  const course = DomainModel.createCourse({ name: 'Synthetischer Kurs', subject: 'Testfach', classLabel: 'T1' });
  DomainModel.addCourseToState(state, course);
  return state;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createCryptoFacade({ beforeEncrypt, beforeDeriveKey } = {}) {
  const subtle = crypto.subtle;
  return {
    getRandomValues: crypto.getRandomValues.bind(crypto),
    subtle: {
      importKey: subtle.importKey.bind(subtle),
      deriveKey: async (...args) => {
        if (beforeDeriveKey) await beforeDeriveKey();
        return subtle.deriveKey(...args);
      },
      encrypt: async (...args) => {
        if (beforeEncrypt) await beforeEncrypt();
        return subtle.encrypt(...args);
      },
      decrypt: subtle.decrypt.bind(subtle)
    }
  };
}

function createDerivationCounter() {
  let count = 0;
  return {
    cryptoImpl: createCryptoFacade({ beforeDeriveKey: async () => { count += 1; } }),
    count: () => count
  };
}

async function createLocalEncryptedFixture(modules, storage, json, password) {
  const portable = await modules.Storage._encryptJsonWithSalt(json, password);
  const [saltB64, ivB64, cipherB64] = portable.split(':');
  storage.setItem('notenverwaltung_v1_salt', saltB64);
  return `${ivB64}:${cipherB64}`;
}

const LOCAL_STORAGE_KEYS = [
  'notenverwaltung_v1_state_enc',
  'notenverwaltung_v1_salt',
  'notenverwaltung_v1_encrypted',
  'notenverwaltung_v1_state'
];

function snapshotLocalStorage(storage) {
  return Object.fromEntries(LOCAL_STORAGE_KEYS.map(key => [key, storage.getItem(key)]));
}

function assertLocalStorageSnapshot(storage, expected, message = 'lokaler Bestand wurde verändert') {
  assert.deepEqual(snapshotLocalStorage(storage), expected, message);
}

function interceptStorageMutations(storage, { primaryFailureCall = null, rollbackFailureCall = null } = {}) {
  const setItem = storage.setItem.bind(storage);
  const removeItem = storage.removeItem.bind(storage);
  let calls = 0;
  const mutate = (operation, args) => {
    calls += 1;
    operation(...args);
    if (calls === primaryFailureCall) throw new Error(`Synthetischer Schreibfehler ${calls}`);
    if (calls === rollbackFailureCall) throw new Error(`Synthetischer Rollbackfehler ${calls}`);
  };
  storage.setItem = (...args) => mutate(setItem, args);
  storage.removeItem = (...args) => mutate(removeItem, args);
  return { calls: () => calls };
}

const STORAGE_RETURN_MARKER = '      return {\n        loadState,';

function exposeSessionKeyCacheForTest(storageSource) {
  const marker = STORAGE_RETURN_MARKER;
  const markerCount = storageSource.split(marker).length - 1;
  if (markerCount !== 1) {
    throw new Error(`Storage-Returnmarker muss genau einmal vorkommen, gefunden: ${markerCount}`);
  }
  return storageSource.replace(
    marker,
    '      return {\n        __testHasSessionKeyCache: () => _sessionKeyCache !== null,\n        __testClearSessionKeyCache: () => { _sessionKeyCache = null; },\n        loadState,'
  );
}

function createCachedKeyCryptoFacade({ beforeEncrypt } = {}) {
  const subtle = crypto.subtle;
  let importedKey = null;
  let derivedKey = null;
  return {
    getRandomValues: crypto.getRandomValues.bind(crypto),
    subtle: {
      importKey: async (...args) => {
        if (importedKey) return importedKey;
        importedKey = await subtle.importKey(...args);
        return importedKey;
      },
      deriveKey: async (...args) => {
        if (derivedKey) return derivedKey;
        derivedKey = await subtle.deriveKey(...args);
        return derivedKey;
      },
      encrypt: async (...args) => {
        if (beforeEncrypt) await beforeEncrypt();
        return subtle.encrypt(...args);
      },
      decrypt: subtle.decrypt.bind(subtle)
    }
  };
}

test('Storage contains no encrypted-to-plaintext downgrade path', () => {
  const storageSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'infrastructure', 'storage.js'), 'utf8');
  assert.doesNotMatch(storageSource, /\bfunction\s+disableEncryption\s*\(/);
  assert.doesNotMatch(
    storageSource,
    /localStorage\.setItem\(STORAGE_KEY,\s*result\.json\)/
  );
});

test('a saved state round-trips through a fresh sandbox', async () => {
  const storage = localStorageStub();
  const first = (await openStorageSession({ storage, password: PASSWORD }));
  await first.Storage.enableEncryption(PASSWORD, seededState(first));

  const second = (await openStorageSession({ storage, password: PASSWORD }));
  await second.sessionCoordinator.acquire();
  const restored = await second.Storage.loadState();
  assert.equal(restored.courses[0].name, 'Synthetischer Kurs');
});

test('M32: encrypted storage preserves finalized upper-sec points', async () => {
  const storage = localStorageStub();
  const first = (await openStorageSession({ storage, password: PASSWORD }));
  const state = first.DomainModel.createEmptyState();
  const student = first.DomainModel.createStudent({ lastName: 'Beispiel', firstName: 'Ada' });
  const course = first.DomainModel.createCourse({
    name: 'Sek II', schemaMode: first.DomainModel.SCHEMA_MODES.UPPERSEC
  });
  first.DomainModel.addStudentToState(state, student);
  first.DomainModel.addCourseToState(state, course);
  first.DomainModel.enrollStudentInCourse(state, course.id, student.id);
  first.DomainModel.setTermResult(state, course.id, student.id, '2025-H1', 12);
  await first.Storage.enableEncryption(PASSWORD, state);

  const second = (await openStorageSession({ storage, password: PASSWORD }));
  await second.sessionCoordinator.acquire();
  const loaded = await second.Storage.loadState();
  assert.equal(second.DomainModel.getTermResult(loaded.courses[0], student.id, '2025-H1'), 12);
});

test('M31: encrypted storage preserves Sek-II course context and the personal Q4 exam flag', async () => {
  const storage = localStorageStub();
  const first = (await openStorageSession({ storage, password: PASSWORD }));
  const state = first.DomainModel.createEmptyState();
  const student = first.DomainModel.createStudent({ lastName: 'Kontext', firstName: 'Klara' });
  const course = first.DomainModel.createCourse({
    name: 'GK Biologie',
    schemaMode: first.DomainModel.SCHEMA_MODES.UPPERSEC,
    upperSecContext: {
      courseType: first.DomainModel.UPPERSEC_COURSE_TYPES.BASIC,
      qualificationYear: first.DomainModel.QUALIFICATION_YEARS.Q3_Q4,
      weightingDeviationReason: 'Pädagogisch begründet'
    }
  });
  first.DomainModel.addStudentToState(state, student);
  first.DomainModel.addCourseToState(state, course);
  first.DomainModel.enrollStudentInCourse(state, course.id, student.id);
  first.DomainModel.setWrittenExamSubjectQ4(state, course.id, student.id, true);
  await first.Storage.enableEncryption(PASSWORD, state);

  const second = (await openStorageSession({ storage, password: PASSWORD }));
  await second.sessionCoordinator.acquire();
  const loaded = await second.Storage.loadState();
  const loadedCourse = loaded.courses[0];

  assert.deepEqual(JSON.parse(JSON.stringify(loadedCourse.upperSecContext)), {
    courseType: 'basic',
    qualificationYear: 'q3-q4',
    weightingDeviationReason: 'Pädagogisch begründet'
  });
  assert.equal(second.DomainModel.findEnrollment(loadedCourse, student.id).writtenExamSubjectQ4, true);
});

test('nothing is written in plain text', async () => {
  const storage = localStorageStub();
  const modules = (await openStorageSession({ storage, password: PASSWORD }));
  await modules.Storage.enableEncryption(PASSWORD, seededState(modules));

  for (const key of storage._keys()) {
    assert.ok(!String(storage.getItem(key)).includes('Synthetischer Kurs'), `Klartext in ${key}`);
  }

  // Die Abwesenheit des Klartexts allein wuerde auch base64-kodierten
  // Klartext durchgehen lassen. Deshalb zusaetzlich die Struktur pruefen.
  assert.equal(storage.getItem('notenverwaltung_v1_encrypted'), '1',
    'Verschluesselungsflag nicht gesetzt');
  assert.equal(storage.getItem('notenverwaltung_v1_state'), null,
    'Klartextschluessel wurde nicht entfernt');
  const payload = storage.getItem('notenverwaltung_v1_state_enc');
  assert.ok(typeof payload === 'string' && payload.length > 0, 'kein Payload gespeichert');
  const parts = payload.split(':');
  assert.equal(parts.length, 2, 'Payload hat nicht die Form iv:ciphertext');
  assert.ok(parts.every(part => /^[A-Za-z0-9+/]+={0,2}$/.test(part)),
    'Payload-Teile sind nicht base64');
});

test('saveState refuses when no session password is held', async () => {
  const storage = localStorageStub();
  // Erst Verschluesselung einrichten, damit das Flag gesetzt ist. Sonst
  // scheitert saveState bereits an der vorgelagerten Pruefung "nicht
  // eingerichtet" und dieser Test wuerde den falschen Zweig belegen.
  const first = (await openStorageSession({ storage, password: PASSWORD }));
  await first.Storage.enableEncryption(PASSWORD, seededState(first));

  // Frische Instanz ohne Sitzungspasswort. loadState wird bewusst nicht
  // aufgerufen, weil der promptPassword-Stub sonst ein Passwort setzen wuerde.
  const second = (await openStorageSession({ storage, password: null }));
  assert.equal(second.Storage.isEncrypted(), true, 'Flag nicht gesetzt');
  assert.equal(second.Storage.hasSessionPassword(), false, 'unerwartet ein Sitzungspasswort');
  await assert.rejects(
    () => second.Storage.saveState(seededState(second)),
    /Kein Sitzungspasswort vorhanden/
  );
});

test('a backup round-trips and rejects a wrong password', async () => {
  const modules = (await openStorageSession({ password: PASSWORD }));
  const backup = await modules.Storage.exportStateEncrypted(PASSWORD, seededState(modules));
  const restored = await modules.Storage.importStateEncryptedFromText(backup, PASSWORD);
  assert.equal(restored.courses[0].name, 'Synthetischer Kurs');
  await assert.rejects(() => modules.Storage.importStateEncryptedFromText(backup, 'Falsches-Passwort'));
});

test('legacy raw iv:ciphertext backup decrypts with the already stored local salt', async () => {
  const storage = localStorageStub();
  const writer = (await openStorageSession({ storage, password: PASSWORD }));
  await writer.Storage.enableEncryption(PASSWORD, seededState(writer));

  const legacyRawBackup = storage.getItem('notenverwaltung_v1_state_enc');
  assert.equal(legacyRawBackup.split(':').length, 2, 'Fixture ist kein Legacy-Raw-Backup');
  assert.ok(storage.getItem('notenverwaltung_v1_salt'), 'Lokaler Salt fehlt');

  const freshReader = (await openStorageSession({ storage, password: PASSWORD }));
  const restoredJson = await freshReader.Storage._decryptPayload(legacyRawBackup, PASSWORD);
  const restored = freshReader.DomainModel.ensureStateShape(JSON.parse(restoredJson));
  assert.equal(restored.courses[0].name, 'Synthetischer Kurs');
});

test('a tampered ciphertext is rejected', async () => {
  const modules = (await openStorageSession({ password: PASSWORD }));
  const backup = await modules.Storage.exportStateEncrypted(PASSWORD, seededState(modules));
  const parsed = JSON.parse(backup);
  const index = Math.floor(parsed.payload.length * 0.75);
  parsed.payload = parsed.payload.slice(0, index)
    + (parsed.payload[index] === 'A' ? 'B' : 'A')
    + parsed.payload.slice(index + 1);
  await assert.rejects(() => modules.Storage.importStateEncryptedFromText(JSON.stringify(parsed), PASSWORD));
});

test('successfully decrypted invalid JSON is reported as content damage and closes the unsuccessful session', async () => {
  const storage = localStorageStub();
  const writer = (await openStorageSession({ storage, password: PASSWORD }));
  const payload = await createLocalEncryptedFixture(writer, storage, '{"students":', PASSWORD);
  storage.setItem('notenverwaltung_v1_encrypted', '1');
  storage.setItem('notenverwaltung_v1_state_enc', payload);

  const reader = (await openStorageSession({ storage, password: null }));
  let passwordPrompts = 0;
  let authenticationRetries = 0;
  reader.sandbox.window.promptPassword = async () => {
    passwordPrompts += 1;
    return PASSWORD;
  };
  reader.sandbox.window.confirm = () => {
    authenticationRetries += 1;
    return false;
  };

  await reader.sessionCoordinator.acquire();

  await assert.rejects(
    () => reader.Storage.loadState(),
    error => error && error.code === 'STATE_CONTENT_INVALID'
      && !/Passwort|students/i.test(String(error.message))
  );

  assert.equal(reader.Storage.hasSessionPassword(), false, 'an unsuccessful session must release its credentials');
  assert.equal(passwordPrompts, 1);
  assert.equal(authenticationRetries, 0, 'Inhaltsfehler geriet in den Passwort-Retry');
  assert.equal(storage.getItem('notenverwaltung_v1_state_enc'), payload, 'Chiffrat wurde veraendert');

  await reader.sessionCoordinator.acquire();

  await assert.rejects(
    () => reader.Storage.loadState(),
    error => error && error.code === 'STATE_CONTENT_INVALID'
  );
  assert.equal(passwordPrompts, 2, 'a fresh retry must authenticate again after the failed session');
  assert.equal(authenticationRetries, 0);
  assert.equal(storage.getItem('notenverwaltung_v1_state_enc'), payload, 'Retry veraenderte das Chiffrat');
});

test('successfully decrypted non-object JSON is rejected without treating the password as wrong', async () => {
  const storage = localStorageStub();
  const writer = (await openStorageSession({ storage, password: PASSWORD }));
  const payload = await createLocalEncryptedFixture(writer, storage, 'null', PASSWORD);
  storage.setItem('notenverwaltung_v1_encrypted', '1');
  storage.setItem('notenverwaltung_v1_state_enc', payload);

  const reader = (await openStorageSession({ storage, password: PASSWORD }));
  let authenticationRetries = 0;
  reader.sandbox.window.confirm = () => {
    authenticationRetries += 1;
    return false;
  };

  await reader.sessionCoordinator.acquire();

  await assert.rejects(
    () => reader.Storage.loadState(),
    error => error && error.code === 'STATE_CONTENT_INVALID'
  );
  assert.equal(reader.Storage.hasSessionPassword(), false);
  assert.equal(authenticationRetries, 0);
  assert.equal(storage.getItem('notenverwaltung_v1_state_enc'), payload);
});

test('an unknown backup format is rejected', async () => {
  const modules = (await openStorageSession({ password: PASSWORD }));
  const backup = await modules.Storage.exportStateEncrypted(PASSWORD, seededState(modules));
  const parsed = JSON.parse(backup);
  parsed.format = 'unbekanntes_testformat';
  await assert.rejects(() => modules.Storage.importStateEncryptedFromText(JSON.stringify(parsed), PASSWORD));
});

test('M23: changePassword enforces the six-character minimum', async () => {
  const storage = localStorageStub();
  const modules = (await openStorageSession({ storage, password: PASSWORD }));
  await modules.Storage.enableEncryption(PASSWORD, seededState(modules));
  await assert.rejects(() => modules.Storage.changePassword(PASSWORD, 'kurz'));
});

test('M23: changePassword rotates the salt and preserves data only for the new password', async () => {
  const storage = localStorageStub();
  const modules = (await openStorageSession({ storage, password: PASSWORD }));
  await modules.Storage.enableEncryption(PASSWORD, seededState(modules));
  const saltBefore = storage.getItem('notenverwaltung_v1_salt');
  const newPassword = 'Neues-Synthetisches-Testpasswort';
  await modules.Storage.changePassword(PASSWORD, newPassword);
  assert.notEqual(storage.getItem('notenverwaltung_v1_salt'), saltBefore, 'Salt wurde nicht rotiert');

  const newPasswordReader = (await openStorageSession({ storage, password: newPassword }));
  await newPasswordReader.sessionCoordinator.acquire();
  const restored = await newPasswordReader.Storage.loadState();
  assert.equal(restored.courses[0].name, 'Synthetischer Kurs');

  const oldPasswordReader = (await openStorageSession({ storage, password: PASSWORD }));
  await oldPasswordReader.sessionCoordinator.acquire();
  const rejected = await oldPasswordReader.Storage.loadState();
  assert.equal(rejected.courses.length, 0, 'Altes Passwort konnte den Zustand weiterhin lesen');
  assert.equal(oldPasswordReader.Storage.hasSessionPassword(), false);
});

test('M23: a failed password change preserves the old encrypted state', async () => {
  const storage = localStorageStub();
  const modules = (await openStorageSession({ storage, password: PASSWORD }));
  await modules.Storage.enableEncryption(PASSWORD, seededState(modules));
  const payloadBefore = storage.getItem('notenverwaltung_v1_state_enc');
  const saltBefore = storage.getItem('notenverwaltung_v1_salt');
  const setItem = storage.setItem.bind(storage);
  let rejectSaltWrite = true;
  storage.setItem = (key, value) => {
    if (key === 'notenverwaltung_v1_salt' && rejectSaltWrite) {
      rejectSaltWrite = false;
      throw new Error('QuotaExceededError');
    }
    setItem(key, value);
  };

  await assert.rejects(
    () => modules.Storage.changePassword(PASSWORD, 'Neues-Synthetisches-Testpasswort')
  );

  assert.equal(storage.getItem('notenverwaltung_v1_state_enc'), payloadBefore);
  assert.equal(storage.getItem('notenverwaltung_v1_salt'), saltBefore);
  assert.equal(modules.Storage.hasSessionPassword(), true, 'Altes Sitzungspasswort ging verloren');

  const stateAfterFailure = seededState(modules);
  stateAfterFailure.courses[0].name = 'Nach Rollback gespeichert';
  await modules.Storage.saveState(stateAfterFailure);
  const reader = (await openStorageSession({ storage, password: PASSWORD }));
  await reader.sessionCoordinator.acquire();
  const restored = await reader.Storage.loadState();
  assert.equal(restored.courses[0].name, 'Nach Rollback gespeichert');
});

test('M23: a failed payload write leaves password, payload, salt and session unchanged', async () => {
  const storage = localStorageStub();
  const modules = (await openStorageSession({ storage, password: PASSWORD }));
  await modules.Storage.enableEncryption(PASSWORD, seededState(modules));
  const payloadBefore = storage.getItem('notenverwaltung_v1_state_enc');
  const saltBefore = storage.getItem('notenverwaltung_v1_salt');
  const setItem = storage.setItem.bind(storage);
  let rejectPayloadWrite = true;
  storage.setItem = (key, value) => {
    if (key === 'notenverwaltung_v1_state_enc' && rejectPayloadWrite) {
      rejectPayloadWrite = false;
      throw new Error('QuotaExceededError');
    }
    setItem(key, value);
  };

  await assert.rejects(
    () => modules.Storage.changePassword(PASSWORD, 'Neues-Synthetisches-Testpasswort')
  );

  assert.equal(storage.getItem('notenverwaltung_v1_state_enc'), payloadBefore);
  assert.equal(storage.getItem('notenverwaltung_v1_salt'), saltBefore);
  assert.equal(modules.Storage.hasSessionPassword(), true);
  const reader = (await openStorageSession({ storage, password: PASSWORD }));
  await reader.sessionCoordinator.acquire();
  const restored = await reader.Storage.loadState();
  assert.equal(restored.courses[0].name, 'Synthetischer Kurs');
});

test('M22: a failed write must not leave a dangling session password', async () => {
  const storage = localStorageStub();
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  const modules = (await openStorageSession({ storage, password: PASSWORD }));
  await assert.rejects(() => modules.Storage.enableEncryption(PASSWORD, seededState(modules)));
  assert.equal(modules.Storage.hasSessionPassword(), false, 'Sitzungspasswort blieb gesetzt');
});

test('M22: a partial encryption setup restores the previous storage state', async () => {
  const storage = localStorageStub();
  const legacyState = '{"legacy":true}';
  storage.setItem('notenverwaltung_v1_state', legacyState);
  const setItem = storage.setItem.bind(storage);
  let rejectFlagWrite = true;
  storage.setItem = (key, value) => {
    if (key === 'notenverwaltung_v1_encrypted' && rejectFlagWrite) {
      rejectFlagWrite = false;
      throw new Error('QuotaExceededError');
    }
    setItem(key, value);
  };

  const modules = (await openStorageSession({ storage, password: PASSWORD }));
  await assert.rejects(() => modules.Storage.enableEncryption(PASSWORD, seededState(modules)));

  assert.equal(storage.getItem('notenverwaltung_v1_state'), legacyState);
  assert.equal(storage.getItem('notenverwaltung_v1_state_enc'), null);
  assert.equal(storage.getItem('notenverwaltung_v1_salt'), null);
  assert.equal(storage.getItem('notenverwaltung_v1_encrypted'), null);
  assert.equal(modules.Storage.hasSessionPassword(), false);
});

test('M19/D6: locking aborts encryption setup before its first storage mutation', async () => {
  const storage = localStorageStub();
  const writer = (await openStorageSession({ storage, password: PASSWORD }));
  await writer.Storage.enableEncryption(PASSWORD, seededState(writer));
  const deriveStarted = deferred();
  const releaseDerivation = deferred();
  let deriveCalls = 0;
  const modules = (await openStorageSession({
    storage,
    cryptoImpl: createCryptoFacade({
      beforeDeriveKey: async () => {
        deriveCalls += 1;
        if (deriveCalls === 1) {
          deriveStarted.resolve();
          await releaseDerivation.promise;
        }
      }
    })
  }));
  const enabledState = seededState(modules);
  enabledState.courses[0].name = 'Nach Neuer Einrichtung gespeichert';
  const before = snapshotLocalStorage(storage);
  const enablePromise = modules.Storage.enableEncryption(
    'Neues-Synthetisches-Testpasswort',
    enabledState
  );
  await deriveStarted.promise;
  modules.Storage.lockSession();
  releaseDerivation.resolve();
  await assert.rejects(enablePromise, error => error && error.code === 'STORAGE_GENERATION_STALE');
  assert.equal(modules.Storage.hasSessionPassword(), false);
  assertLocalStorageSnapshot(storage, before);
  const reader = (await openStorageSession({ storage, password: PASSWORD }));
  await reader.sessionCoordinator.acquire();
  const restored = await reader.Storage.loadState();
  assert.equal(restored.courses[0].name, 'Synthetischer Kurs');
});

test('M19/D6: locking aborts password rotation before its first storage mutation', async () => {
  const storage = localStorageStub();
  const writer = (await openStorageSession({ storage, password: PASSWORD }));
  await writer.Storage.enableEncryption(PASSWORD, seededState(writer));
  const deriveStarted = deferred();
  const releaseDerivation = deferred();
  let rotationStarted = false;
  const modules = (await openStorageSession({
    storage,
    password: PASSWORD,
    cryptoImpl: createCryptoFacade({
      beforeDeriveKey: async () => {
        if (rotationStarted) {
          deriveStarted.resolve();
          await releaseDerivation.promise;
        }
      }
    })
  }));
  await modules.Storage.loadState();
  rotationStarted = true;
  const newPassword = 'Neues-Synthetisches-Testpasswort';
  const before = snapshotLocalStorage(storage);
  const changePromise = modules.Storage.changePassword(PASSWORD, newPassword);
  await deriveStarted.promise;
  modules.Storage.lockSession();
  releaseDerivation.resolve();
  await assert.rejects(changePromise, error => error && error.code === 'STORAGE_GENERATION_STALE');
  assert.equal(modules.Storage.hasSessionPassword(), false);
  assertLocalStorageSnapshot(storage, before);
  const reader = (await openStorageSession({ storage, password: PASSWORD }));
  await reader.sessionCoordinator.acquire();
  const restored = await reader.Storage.loadState();
  assert.equal(restored.courses[0].name, 'Synthetischer Kurs');
});

test('M22: a failed setup salt write restores all storage values and the active session', async () => {
  const storage = localStorageStub();
  const modules = (await openStorageSession({ storage, password: PASSWORD }));
  await modules.Storage.enableEncryption(PASSWORD, seededState(modules));
  storage.setItem('notenverwaltung_v1_state', '{"legacy":true}');
  await modules.Storage.lockSession();
  await modules.sessionCoordinator.acquire();
  await modules.Storage.loadState();
  const keys = [
    'notenverwaltung_v1_state_enc',
    'notenverwaltung_v1_encrypted',
    'notenverwaltung_v1_salt',
    'notenverwaltung_v1_state'
  ];
  const before = Object.fromEntries(keys.map(key => [key, storage.getItem(key)]));
  const setItem = storage.setItem.bind(storage);
  let rejectSaltWrite = true;
  storage.setItem = (key, value) => {
    if (key === 'notenverwaltung_v1_salt' && rejectSaltWrite) {
      rejectSaltWrite = false;
      throw new Error('QuotaExceededError');
    }
    setItem(key, value);
  };

  await assert.rejects(
    () => modules.Storage.enableEncryption('Neues-Synthetisches-Testpasswort', seededState(modules)),
    /QuotaExceededError/
  );

  for (const key of keys) {
    assert.equal(storage.getItem(key), before[key], `${key} wurde nicht zurueckgerollt`);
  }
  assert.equal(modules.Storage.hasSessionPassword(), true, 'aktive Sitzung wurde verworfen');

  const state = seededState(modules);
  state.courses[0].name = 'Nach Setup-Rollback gespeichert';
  await modules.Storage.saveState(state);
  const reader = (await openStorageSession({ storage, password: PASSWORD }));
  await reader.sessionCoordinator.acquire();
  const restored = await reader.Storage.loadState();
  assert.equal(restored.courses[0].name, 'Nach Setup-Rollback gespeichert');
});

test('M21: a successful local load supplies one key for later saves', async () => {
  const storage = localStorageStub();
  const writer = (await openStorageSession({ storage, password: PASSWORD }));
  await writer.Storage.enableEncryption(PASSWORD, seededState(writer));
  const counter = createDerivationCounter();
  const modules = (await openStorageSession({ storage, password: PASSWORD, cryptoImpl: counter.cryptoImpl }));

  await modules.sessionCoordinator.acquire();
  const state = await modules.Storage.loadState();
  assert.equal(counter.count(), 1);
  state.courses[0].name = 'Erste Aenderung';
  await modules.Storage.saveState(state);
  state.courses[0].name = 'Zweite Aenderung';
  await modules.Storage.saveState(state);
  assert.equal(counter.count(), 1, 'lokale Saves muessen den authentifizierten Schluessel wiederverwenden');
});

test('M21: locking discards the cached local key', async () => {
  const storage = localStorageStub();
  const writer = (await openStorageSession({ storage, password: PASSWORD }));
  await writer.Storage.enableEncryption(PASSWORD, seededState(writer));
  const counter = createDerivationCounter();
  const modules = (await openStorageSession({
    storage,
    password: PASSWORD,
    cryptoImpl: counter.cryptoImpl,
    storageSourceTransform: exposeSessionKeyCacheForTest
  }));
  await modules.sessionCoordinator.acquire();
  await modules.Storage.loadState();
  assert.equal(counter.count(), 1);
  assert.equal(modules.Storage.__testHasSessionKeyCache(), true, 'Load muss den Test-Cache befuellen');

  modules.Storage.lockSession();
  assert.equal(modules.Storage.__testHasSessionKeyCache(), false, 'Lock muss den privaten Cache direkt freigeben');
  await assert.rejects(() => modules.Storage.saveState(seededState(modules)), { code: 'SESSION_NOT_OWNER' });
  await modules.sessionCoordinator.acquire();
  await modules.Storage.loadState();
  await modules.Storage.saveState(seededState(modules));
  assert.equal(counter.count(), 2, 'eine neue Sitzung muss genau einmal neu ableiten');
});

test('M21: encryption setup caches its derived key and reset preserves it', async () => {
  const storage = localStorageStub();
  const counter = createDerivationCounter();
  const modules = (await openStorageSession({ storage, password: PASSWORD, cryptoImpl: counter.cryptoImpl }));
  await modules.Storage.enableEncryption(PASSWORD, seededState(modules));
  assert.equal(counter.count(), 1);
  await modules.Storage.saveState(seededState(modules));
  const fresh = await modules.Storage.resetState();
  assert.equal(fresh.courses.length, 0);
  assert.equal(modules.Storage.hasSessionPassword(), true);
  assert.equal(counter.count(), 1, 'Daten-Reset und Folgesaves behalten die gueltige Sitzung');

  const reader = (await openStorageSession({ storage, password: PASSWORD }));
  await reader.sessionCoordinator.acquire();
  const restored = await reader.Storage.loadState();
  assert.equal(restored.courses.length, 0, 'Reset muss den gespeicherten Zustand wirklich leeren');
  assert.equal(reader.Storage.hasSessionPassword(), true, 'gleiches Passwort muss den Reset-Zustand lesen');
});

test('M21/R23: an external salt change invalidates the cached session without deriving or writing', async () => {
  const storage = localStorageStub();
  const writer = await openStorageSession({ storage, password: PASSWORD });
  await writer.Storage.enableEncryption(PASSWORD, seededState(writer));
  const counter = createDerivationCounter();
  const modules = await openStorageSession({ storage, password: PASSWORD, cryptoImpl: counter.cryptoImpl });
  const state = await modules.Storage.loadState();
  assert.equal(counter.count(), 1);
  storage.setItem('notenverwaltung_v1_salt', Buffer.alloc(16, 7).toString('base64'));
  const before = snapshotLocalStorage(storage);
  await assert.rejects(modules.Storage.saveState(state), { code: 'STORAGE_EXTERNAL_CHANGE' });
  assert.equal(counter.count(), 1);
  assertLocalStorageSnapshot(storage, before);
  assert.equal(modules.Storage.hasSessionPassword(), false);
});

test('M21: a rejected cached derivation is removed before retry', async () => {
  const storage = localStorageStub();
  const writer = (await openStorageSession({ storage, password: PASSWORD }));
  await writer.Storage.enableEncryption(PASSWORD, seededState(writer));
  let derivations = 0;
  let rejectNextDerivation = false;
  const modules = (await openStorageSession({
    storage,
    password: PASSWORD,
    storageSourceTransform: exposeSessionKeyCacheForTest,
    cryptoImpl: createCryptoFacade({
      beforeDeriveKey: async () => {
        derivations += 1;
        if (rejectNextDerivation) {
          rejectNextDerivation = false;
          throw new Error('Synthetischer Ableitungsfehler');
        }
      }
    })
  }));
  await modules.sessionCoordinator.acquire();
  await modules.Storage.loadState();
  assert.equal(derivations, 1);
  modules.Storage.__testClearSessionKeyCache();
  rejectNextDerivation = true;

  await assert.rejects(
    () => modules.Storage.saveState(seededState(modules)),
    /Synthetischer Ableitungsfehler/
  );
  await modules.Storage.saveState(seededState(modules));
  assert.equal(derivations, 3, 'Retry muss nach einer abgelehnten Ableitung frisch ableiten');
});

test('M21/D6: locking during an in-flight derivation aborts the save and prevents cache revival', async () => {
  const storage = localStorageStub();
  const writer = (await openStorageSession({ storage, password: PASSWORD }));
  await writer.Storage.enableEncryption(PASSWORD, seededState(writer));
  const derivationStarted = deferred();
  const releaseDerivation = deferred();
  let derivations = 0;
  const modules = (await openStorageSession({
    storage,
    password: PASSWORD,
    cryptoImpl: createCryptoFacade({
      beforeDeriveKey: async () => {
        derivations += 1;
        if (derivations === 2) {
          derivationStarted.resolve();
          await releaseDerivation.promise;
        }
      }
    }),
    storageSourceTransform: exposeSessionKeyCacheForTest
  }));
  await modules.sessionCoordinator.acquire();
  await modules.Storage.loadState();
  const before = snapshotLocalStorage(storage);
  modules.Storage.__testClearSessionKeyCache();
  const runningSave = modules.Storage.saveState(seededState(modules));
  await derivationStarted.promise;
  assert.equal(modules.Storage.__testHasSessionKeyCache(), true, 'laufende Ableitung muss im Cache liegen');

  modules.Storage.lockSession();
  assert.equal(modules.Storage.__testHasSessionKeyCache(), false, 'Lock muss die laufende Ableitung direkt freigeben');
  releaseDerivation.resolve();
  await assert.rejects(runningSave, error => error && error.code === 'STORAGE_GENERATION_STALE');
  assertLocalStorageSnapshot(storage, before);
  assert.equal(
    modules.Storage.__testHasSessionKeyCache(),
    false,
    'alte Ableitung darf den Cache nach ihrer Aufloesung nicht wiederbeleben'
  );
  assert.equal(modules.Storage.hasSessionPassword(), false);
  await assert.rejects(() => modules.Storage.saveState(seededState(modules)), { code: 'SESSION_NOT_OWNER' });

  await modules.sessionCoordinator.acquire();
  await modules.Storage.loadState();
  assert.equal(derivations, 3, 'neue Sitzung muss trotz spaeter Promise-Aufloesung frisch ableiten');
  await modules.Storage.saveState(seededState(modules));
  assert.equal(derivations, 3, 'die neue Sitzung muss ihren eigenen Cache verwenden');
});

test('M21: beforeunload invalidates the active local key cache', async () => {
  const storage = localStorageStub();
  const writer = (await openStorageSession({ storage, password: PASSWORD }));
  await writer.Storage.enableEncryption(PASSWORD, seededState(writer));
  const counter = createDerivationCounter();
  const modules = (await openStorageSession({
    storage,
    password: PASSWORD,
    cryptoImpl: counter.cryptoImpl,
    storageSourceTransform: exposeSessionKeyCacheForTest
  }));
  await modules.sessionCoordinator.acquire();
  await modules.Storage.loadState();
  assert.equal(counter.count(), 1);
  assert.equal(modules.Storage.__testHasSessionKeyCache(), true, 'Load muss den Test-Cache befuellen');

  modules.sandbox.window.dispatchEvent(new Event('beforeunload'));
  assert.equal(modules.Storage.hasSessionPassword(), false);
  assert.equal(
    modules.Storage.__testHasSessionKeyCache(),
    false,
    'beforeunload muss den privaten Cache direkt freigeben'
  );
  await assert.rejects(() => modules.Storage.saveState(seededState(modules)), { code: 'SESSION_NOT_OWNER' });
  await modules.sessionCoordinator.acquire();
  await modules.Storage.loadState();
  await modules.Storage.saveState(seededState(modules));
  assert.equal(counter.count(), 2, 'Seitenabbruch muss fuer die neue Sitzung frisch ableiten');
});

test('M21: normal production module exports no session-key-cache test getter', async () => {
  const modules = (await openStorageSession());
  assert.equal(modules.Storage.__testHasSessionKeyCache, undefined);
});

test('M21: session-key-cache transform requires exactly one return marker', () => {
  assert.throws(() => exposeSessionKeyCacheForTest('const Storage = {};'));
  assert.throws(() => exposeSessionKeyCacheForTest(
    `${STORAGE_RETURN_MARKER}\n${STORAGE_RETURN_MARKER}`
  ));
});

test('M21: a successful password change replaces the cached key once', async () => {
  const storage = localStorageStub();
  const writer = (await openStorageSession({ storage, password: PASSWORD }));
  await writer.Storage.enableEncryption(PASSWORD, seededState(writer));
  const counter = createDerivationCounter();
  const modules = (await openStorageSession({ storage, password: PASSWORD, cryptoImpl: counter.cryptoImpl }));
  await modules.sessionCoordinator.acquire();
  await modules.Storage.loadState();
  const newPassword = 'Neues-Synthetisches-Testpasswort';
  await modules.Storage.changePassword(PASSWORD, newPassword);
  await modules.Storage.saveState(seededState(modules));
  assert.equal(counter.count(), 2, 'Load und neuer Salt leiten jeweils genau einmal ab');
});

test('M21: a failed password change preserves the old cached key', async () => {
  const storage = localStorageStub();
  const writer = (await openStorageSession({ storage, password: PASSWORD }));
  await writer.Storage.enableEncryption(PASSWORD, seededState(writer));
  const counter = createDerivationCounter();
  const modules = (await openStorageSession({ storage, password: PASSWORD, cryptoImpl: counter.cryptoImpl }));
  await modules.sessionCoordinator.acquire();
  await modules.Storage.loadState();
  const setItem = storage.setItem.bind(storage);
  let rejectSaltWrite = true;
  storage.setItem = (key, value) => {
    if (key === 'notenverwaltung_v1_salt' && rejectSaltWrite) {
      rejectSaltWrite = false;
      throw new Error('QuotaExceededError');
    }
    setItem(key, value);
  };

  await assert.rejects(
    () => modules.Storage.changePassword(PASSWORD, 'Neues-Synthetisches-Testpasswort'),
    /QuotaExceededError/
  );
  await modules.Storage.saveState(seededState(modules));
  assert.equal(counter.count(), 2, 'nur der verworfene neue Salt darf eine Zusatzableitung kosten');
});

test('M21: portable backup operations always bypass the local session cache', async () => {
  const storage = localStorageStub();
  const writer = (await openStorageSession({ storage, password: PASSWORD }));
  await writer.Storage.enableEncryption(PASSWORD, seededState(writer));
  const counter = createDerivationCounter();
  const modules = (await openStorageSession({ storage, password: PASSWORD, cryptoImpl: counter.cryptoImpl }));
  await modules.sessionCoordinator.acquire();
  const state = await modules.Storage.loadState();
  assert.equal(counter.count(), 1);

  await modules.Storage.encryptForBackup(JSON.stringify(state));
  const exported = await modules.Storage.exportStateEncrypted(PASSWORD, state);
  await modules.Storage.importStateEncryptedFromText(exported, PASSWORD);
  assert.equal(counter.count(), 4, 'jede portable Operation braucht ihre eigene Ableitung');
  await modules.Storage.saveState(state);
  assert.equal(counter.count(), 4, 'portable Operationen duerfen den lokalen Cache nicht ersetzen');
});

test('M21: exported portable and legacy decrypt helpers bypass a populated local cache', async () => {
  const storage = localStorageStub();
  const writer = (await openStorageSession({ storage, password: PASSWORD }));
  await writer.Storage.enableEncryption(PASSWORD, seededState(writer));
  const legacyPayload = storage.getItem('notenverwaltung_v1_state_enc');
  const portablePayload = await writer.Storage._encryptJsonWithSalt(
    JSON.stringify(seededState(writer)),
    PASSWORD
  );
  const counter = createDerivationCounter();
  const modules = (await openStorageSession({ storage, password: PASSWORD, cryptoImpl: counter.cryptoImpl }));
  await modules.sessionCoordinator.acquire();
  const localState = await modules.Storage.loadState();
  assert.equal(counter.count(), 1);

  const portableJson = await modules.Storage._decryptPayload(portablePayload, PASSWORD);
  const legacyJson = await modules.Storage._decryptPayload(legacyPayload, PASSWORD);
  assert.equal(JSON.parse(portableJson).courses[0].name, 'Synthetischer Kurs');
  assert.equal(JSON.parse(legacyJson).courses[0].name, 'Synthetischer Kurs');
  assert.equal(counter.count(), 3, 'beide exportierten Decrypt-Pfade muessen frisch ableiten');

  await modules.Storage.saveState(localState);
  assert.equal(counter.count(), 3, 'Backup-Decrypt darf den lokalen Cache nicht ersetzen');
});

test('M21: a wrong password never populates the local key cache', async () => {
  const storage = localStorageStub();
  const writer = (await openStorageSession({ storage, password: PASSWORD }));
  await writer.Storage.enableEncryption(PASSWORD, seededState(writer));
  const counter = createDerivationCounter();
  const modules = (await openStorageSession({ storage, password: 'Falsches-Passwort', cryptoImpl: counter.cryptoImpl }));
  await modules.sessionCoordinator.acquire();
  const empty = await modules.Storage.loadState();
  assert.equal(empty.courses.length, 0);
  assert.equal(modules.Storage.hasSessionPassword(), false);
  assert.equal(counter.count(), 1);

  modules.sandbox.window.promptPassword = async () => PASSWORD;
  await modules.sessionCoordinator.acquire();
  await modules.Storage.loadState();
  await modules.Storage.saveState(seededState(modules));
  assert.equal(counter.count(), 2, 'das korrekte Passwort muss nach dem Fehlversuch neu ableiten');
});

test('M19: overlapping saveState calls encrypt and commit in invocation order', async () => {
  const storage = localStorageStub();
  const writer = (await openStorageSession({ storage, password: PASSWORD }));
  await writer.Storage.enableEncryption(PASSWORD, seededState(writer));

  const firstEncryptStarted = deferred();
  const releaseFirstEncrypt = deferred();
  let encryptCalls = 0;
  const cryptoImpl = createCryptoFacade({
    beforeEncrypt: async () => {
      encryptCalls += 1;
      if (encryptCalls === 1) {
        firstEncryptStarted.resolve();
        await releaseFirstEncrypt.promise;
      }
    }
  });
  const modules = (await openStorageSession({ storage, password: PASSWORD, cryptoImpl }));
  await modules.sessionCoordinator.acquire();
  await modules.Storage.loadState();

  const firstState = seededState(modules);
  firstState.courses[0].name = 'Erster Snapshot';
  const secondState = seededState(modules);
  secondState.courses[0].name = 'Zweiter Snapshot';
  const firstSave = modules.Storage.saveState(firstState);
  const secondSave = modules.Storage.saveState(secondState);

  await firstEncryptStarted.promise;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(encryptCalls, 1, 'der zweite Auftrag darf die Verschluesselung noch nicht starten');
  releaseFirstEncrypt.resolve();
  assert.deepEqual(await Promise.all([firstSave, secondSave]), [true, true]);

  const reader = (await openStorageSession({ storage, password: PASSWORD }));
  await reader.sessionCoordinator.acquire();
  const restored = await reader.Storage.loadState();
  assert.equal(restored.courses[0].name, 'Zweiter Snapshot');
});

test('M19: one rejected save does not poison the following queued save', async () => {
  const storage = localStorageStub();
  const writer = (await openStorageSession({ storage, password: PASSWORD }));
  await writer.Storage.enableEncryption(PASSWORD, seededState(writer));
  const firstEncryptStarted = deferred();
  const releaseFirstEncrypt = deferred();
  let encryptCalls = 0;
  const modules = (await openStorageSession({
    storage,
    password: PASSWORD,
    cryptoImpl: createCachedKeyCryptoFacade({
      beforeEncrypt: async () => {
        encryptCalls += 1;
        if (encryptCalls === 1) {
          firstEncryptStarted.resolve();
          await releaseFirstEncrypt.promise;
        }
      }
    })
  }));
  await modules.sessionCoordinator.acquire();
  await modules.Storage.loadState();
  const setItem = storage.setItem.bind(storage);
  let rejectNextPayload = true;
  storage.setItem = (key, value) => {
    if (key === 'notenverwaltung_v1_state_enc' && rejectNextPayload) {
      rejectNextPayload = false;
      throw new Error('QuotaExceededError');
    }
    setItem(key, value);
  };

  const rejectedState = seededState(modules);
  rejectedState.courses[0].name = 'Nicht gespeichert';
  const acceptedState = seededState(modules);
  acceptedState.courses[0].name = 'Nach Fehler gespeichert';
  const rejectedSave = modules.Storage.saveState(rejectedState);
  const acceptedSave = modules.Storage.saveState(acceptedState);

  await firstEncryptStarted.promise;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(encryptCalls, 1, 'der Folgeauftrag muss bis zum Fehler des ersten warten');
  releaseFirstEncrypt.resolve();
  await assert.rejects(rejectedSave, /QuotaExceededError/);
  assert.equal(await acceptedSave, true);
  const reader = (await openStorageSession({ storage, password: PASSWORD }));
  await reader.sessionCoordinator.acquire();
  const restored = await reader.Storage.loadState();
  assert.equal(restored.courses[0].name, 'Nach Fehler gespeichert');
});

test('M19/D6: locking rejects both an in-flight save and a queued save', async () => {
  const storage = localStorageStub();
  const writer = (await openStorageSession({ storage, password: PASSWORD }));
  await writer.Storage.enableEncryption(PASSWORD, seededState(writer));
  const firstEncryptStarted = deferred();
  const releaseFirstEncrypt = deferred();
  let encryptCalls = 0;
  const modules = (await openStorageSession({
    storage,
    password: PASSWORD,
    cryptoImpl: createCryptoFacade({
      beforeEncrypt: async () => {
        encryptCalls += 1;
        if (encryptCalls === 1) {
          firstEncryptStarted.resolve();
          await releaseFirstEncrypt.promise;
        }
      }
    })
  }));
  await modules.sessionCoordinator.acquire();
  await modules.Storage.loadState();
  const running = modules.Storage.saveState(seededState(modules));
  const waiting = modules.Storage.saveState(seededState(modules));
  await firstEncryptStarted.promise;
  await new Promise(resolve => setImmediate(resolve));
  modules.Storage.lockSession();
  releaseFirstEncrypt.resolve();

  await assert.rejects(running, error => error && error.code === 'STORAGE_GENERATION_STALE');
  await assert.rejects(waiting, error => error && error.code === 'STORAGE_GENERATION_STALE');
  assert.equal(encryptCalls, 1);
});

test('M19 final: password change waits for an overlapping save and preserves a decryptable payload', async () => {
  const storage = localStorageStub();
  const writer = (await openStorageSession({ storage, password: PASSWORD }));
  await writer.Storage.enableEncryption(PASSWORD, seededState(writer));

  const firstEncryptStarted = deferred();
  const releaseFirstEncrypt = deferred();
  let encryptCalls = 0;
  const modules = (await openStorageSession({
    storage,
    password: PASSWORD,
    cryptoImpl: createCryptoFacade({
      beforeEncrypt: async () => {
        encryptCalls += 1;
        if (encryptCalls === 1) {
          firstEncryptStarted.resolve();
          await releaseFirstEncrypt.promise;
        }
      }
    })
  }));
  await modules.sessionCoordinator.acquire();
  await modules.Storage.loadState();
  const state = seededState(modules);
  state.courses[0].name = 'Vor Passwortwechsel gespeichert';
  const savePromise = modules.Storage.saveState(state);
  await firstEncryptStarted.promise;

  let changeFinished = false;
  const changePromise = modules.Storage.changePassword(PASSWORD, 'Neues-Synthetisches-Testpasswort')
    .finally(() => { changeFinished = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(changeFinished, false, 'Passwortwechsel darf den laufenden Save nicht überholen');

  releaseFirstEncrypt.resolve();
  await Promise.all([savePromise, changePromise]);

  const reader = (await openStorageSession({ storage, password: 'Neues-Synthetisches-Testpasswort' }));
  await reader.sessionCoordinator.acquire();
  const restored = await reader.Storage.loadState();
  assert.equal(restored.courses[0].name, 'Vor Passwortwechsel gespeichert');
  assert.equal(storage.getItem('notenverwaltung_v1_encrypted'), '1');
  assert.ok(storage.getItem('notenverwaltung_v1_salt'));
  const oldPasswordState = await (await openStorageSession({ storage, password: PASSWORD })).Storage.loadState();
  assert.equal(oldPasswordState.courses.length, 0, 'der alte Schlüssel darf den neuen Payload nicht entschlüsseln');
});

test('M19 final: enable waits for an overlapping save and atomically rotates credentials', async () => {
  const storage = localStorageStub();
  const writer = (await openStorageSession({ storage, password: PASSWORD }));
  await writer.Storage.enableEncryption(PASSWORD, seededState(writer));

  const firstEncryptStarted = deferred();
  const releaseFirstEncrypt = deferred();
  let encryptCalls = 0;
  const modules = (await openStorageSession({
    storage,
    password: PASSWORD,
    cryptoImpl: createCryptoFacade({
      beforeEncrypt: async () => {
        encryptCalls += 1;
        if (encryptCalls === 1) {
          firstEncryptStarted.resolve();
          await releaseFirstEncrypt.promise;
        }
      }
    })
  }));
  await modules.sessionCoordinator.acquire();
  await modules.Storage.loadState();
  const saveState = seededState(modules);
  saveState.courses[0].name = 'Vor Neueinrichtung gespeichert';
  const savePromise = modules.Storage.saveState(saveState);
  await firstEncryptStarted.promise;

  const enabledState = seededState(modules);
  enabledState.courses[0].name = 'Nach Neueinrichtung gespeichert';
  let enableFinished = false;
  const enablePromise = modules.Storage.enableEncryption(
    'Neues-Synthetisches-Testpasswort',
    enabledState
  ).finally(() => { enableFinished = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(enableFinished, false, 'Neueinrichtung darf den laufenden Save nicht überholen');

  releaseFirstEncrypt.resolve();
  await Promise.all([savePromise, enablePromise]);

  const reader = (await openStorageSession({ storage, password: 'Neues-Synthetisches-Testpasswort' }));
  await reader.sessionCoordinator.acquire();
  const restored = await reader.Storage.loadState();
  assert.equal(restored.courses[0].name, 'Nach Neueinrichtung gespeichert');
  assert.equal(storage.getItem('notenverwaltung_v1_encrypted'), '1');
  assert.ok(storage.getItem('notenverwaltung_v1_salt'));
});

test('M19 final: a password change queued before locking cannot revive the session', async () => {
  const storage = localStorageStub();
  const writer = (await openStorageSession({ storage, password: PASSWORD }));
  await writer.Storage.enableEncryption(PASSWORD, seededState(writer));
  const firstEncryptStarted = deferred();
  const releaseFirstEncrypt = deferred();
  let encryptCalls = 0;
  const modules = (await openStorageSession({
    storage,
    password: PASSWORD,
    cryptoImpl: createCryptoFacade({
      beforeEncrypt: async () => {
        encryptCalls += 1;
        if (encryptCalls === 1) {
          firstEncryptStarted.resolve();
          await releaseFirstEncrypt.promise;
        }
      }
    })
  }));
  await modules.sessionCoordinator.acquire();
  await modules.Storage.loadState();
  const savePromise = modules.Storage.saveState(seededState(modules));
  await firstEncryptStarted.promise;
  const changePromise = modules.Storage.changePassword(PASSWORD, 'Neues-Synthetisches-Testpasswort');
  await new Promise(resolve => setImmediate(resolve));
  modules.Storage.lockSession();
  releaseFirstEncrypt.resolve();
  await assert.rejects(savePromise, error => error && error.code === 'STORAGE_GENERATION_STALE');
  await assert.rejects(changePromise, error => error && error.code === 'STORAGE_GENERATION_STALE');
  assert.equal(modules.Storage.hasSessionPassword(), false);
});

test('M19 final: an enable queued before locking cannot revive the session', async () => {
  const storage = localStorageStub();
  const writer = (await openStorageSession({ storage, password: PASSWORD }));
  await writer.Storage.enableEncryption(PASSWORD, seededState(writer));
  const firstEncryptStarted = deferred();
  const releaseFirstEncrypt = deferred();
  let encryptCalls = 0;
  const modules = (await openStorageSession({
    storage,
    password: PASSWORD,
    cryptoImpl: createCryptoFacade({
      beforeEncrypt: async () => {
        encryptCalls += 1;
        if (encryptCalls === 1) {
          firstEncryptStarted.resolve();
          await releaseFirstEncrypt.promise;
        }
      }
    })
  }));
  await modules.sessionCoordinator.acquire();
  await modules.Storage.loadState();
  const savePromise = modules.Storage.saveState(seededState(modules));
  await firstEncryptStarted.promise;
  const enabledState = seededState(modules);
  enabledState.courses[0].name = 'Nach Neueinrichtung gespeichert';
  const enablePromise = modules.Storage.enableEncryption(
    'Neues-Synthetisches-Testpasswort',
    enabledState
  );
  await new Promise(resolve => setImmediate(resolve));
  modules.Storage.lockSession();
  releaseFirstEncrypt.resolve();
  await assert.rejects(savePromise, error => error && error.code === 'STORAGE_GENERATION_STALE');
  await assert.rejects(enablePromise, error => error && error.code === 'STORAGE_GENERATION_STALE');
  assert.equal(modules.Storage.hasSessionPassword(), false);
});

test('R21/D6: an existing encrypted payload without its salt rejects save before any write', async () => {
  const storage = localStorageStub();
  const modules = (await openStorageSession({ storage, password: PASSWORD }));
  await modules.Storage.enableEncryption(PASSWORD, seededState(modules));
  const originalPayload = storage.getItem('notenverwaltung_v1_state_enc');
  const originalFlag = storage.getItem('notenverwaltung_v1_encrypted');
  storage.removeItem('notenverwaltung_v1_salt');
  const mutations = interceptStorageMutations(storage);

  await assert.rejects(
    () => modules.Storage.saveState(seededState(modules)),
    error => error && error.code === 'STORAGE_EXTERNAL_CHANGE'
  );

  assert.equal(mutations.calls(), 0);
  assert.equal(storage.getItem('notenverwaltung_v1_state_enc'), originalPayload);
  assert.equal(storage.getItem('notenverwaltung_v1_salt'), null);
  assert.equal(storage.getItem('notenverwaltung_v1_encrypted'), originalFlag);
});

test('D6: every ordinary save mutation rolls back to the previously readable bytes', async t => {
  for (const failureCall of [1, 2, 3]) {
    await t.test(`mutation ${failureCall}`, async () => {
      const storage = localStorageStub();
      const modules = (await openStorageSession({ storage, password: PASSWORD }));
      await modules.Storage.enableEncryption(PASSWORD, seededState(modules));
      storage.setItem('notenverwaltung_v1_state', '{"legacy":"keep"}');
      await modules.Storage.lockSession();
      await modules.sessionCoordinator.acquire();
      await modules.Storage.loadState();
      const before = snapshotLocalStorage(storage);
      interceptStorageMutations(storage, { primaryFailureCall: failureCall });
      const candidate = seededState(modules);
      candidate.courses[0].name = `Nicht gespeichert ${failureCall}`;

      await assert.rejects(() => modules.Storage.saveState(candidate), /Synthetischer Schreibfehler/);

      assertLocalStorageSnapshot(storage, before);
      const restored = await (await openStorageSession({ storage, password: PASSWORD })).Storage.loadState();
      assert.equal(restored.courses[0].name, 'Synthetischer Kurs');
    });
  }
});

test('D6: every encryption setup mutation rolls back payload, salt, flag, and plaintext', async t => {
  for (const failureCall of [1, 2, 3, 4]) {
    await t.test(`mutation ${failureCall}`, async () => {
      const storage = localStorageStub();
      const modules = (await openStorageSession({ storage, password: PASSWORD }));
      await modules.Storage.enableEncryption(PASSWORD, seededState(modules));
      storage.setItem('notenverwaltung_v1_state', '{"legacy":"keep"}');
      await modules.Storage.lockSession();
      await modules.sessionCoordinator.acquire();
      await modules.Storage.loadState();
      const before = snapshotLocalStorage(storage);
      interceptStorageMutations(storage, { primaryFailureCall: failureCall });

      await assert.rejects(
        () => modules.Storage.enableEncryption('Neues-Synthetisches-Testpasswort', seededState(modules)),
        /Synthetischer Schreibfehler/
      );

      assertLocalStorageSnapshot(storage, before);
      const restored = await (await openStorageSession({ storage, password: PASSWORD })).Storage.loadState();
      assert.equal(restored.courses[0].name, 'Synthetischer Kurs');
    });
  }
});

test('D6: every password-change mutation rolls back to the old credentials', async t => {
  for (const failureCall of [1, 2]) {
    await t.test(`mutation ${failureCall}`, async () => {
      const storage = localStorageStub();
      const modules = (await openStorageSession({ storage, password: PASSWORD }));
      await modules.Storage.enableEncryption(PASSWORD, seededState(modules));
      const before = snapshotLocalStorage(storage);
      interceptStorageMutations(storage, { primaryFailureCall: failureCall });

      await assert.rejects(
        () => modules.Storage.changePassword(PASSWORD, 'Neues-Synthetisches-Testpasswort'),
        /Synthetischer Schreibfehler/
      );

      assertLocalStorageSnapshot(storage, before);
      const restored = await (await openStorageSession({ storage, password: PASSWORD })).Storage.loadState();
      assert.equal(restored.courses[0].name, 'Synthetischer Kurs');
    });
  }
});

test('D6: every rollback mutation failure stays visible as a distinct storage error', async t => {
  for (const rollbackFailureCall of [5, 6, 7, 8]) {
    await t.test(`rollback mutation ${rollbackFailureCall - 4}`, async () => {
      const storage = localStorageStub();
      storage.setItem('notenverwaltung_v1_state', '{"legacy":"keep"}');
      const before = snapshotLocalStorage(storage);
      const modules = (await openStorageSession({ storage, password: PASSWORD }));
      interceptStorageMutations(storage, {
        primaryFailureCall: 4,
        rollbackFailureCall
      });

      await assert.rejects(
        () => modules.Storage.enableEncryption(PASSWORD, seededState(modules)),
        error => error && error.code === 'STORAGE_ROLLBACK_FAILED' &&
          /Synthetischer Schreibfehler/.test(String(error.message)) &&
          /Synthetischer Rollbackfehler/.test(String(error.message))
      );
      assertLocalStorageSnapshot(storage, before);
      assert.equal(modules.Storage.hasSessionPassword(), false);
    });
  }
});

test('D6: lock, unlock, inactivity, and beforeunload stop an in-flight save before storage writes', async t => {
  const cases = [
    ['manual lock', async modules => { modules.Storage.lockSession(); }],
    ['lock and unlock', async modules => {
      modules.Storage.lockSession();
      await modules.sessionCoordinator.acquire();
      await modules.Storage.loadState();
    }],
    ['beforeunload', async modules => {
      modules.sandbox.window.dispatchEvent(new Event('beforeunload'));
    }],
    ['inactivity timeout', async (_modules, timer) => { timer(); }]
  ];

  for (const [label, crossBoundary] of cases) {
    await t.test(label, async () => {
      const storage = localStorageStub();
      const writer = (await openStorageSession({ storage, password: PASSWORD }));
      await writer.Storage.enableEncryption(PASSWORD, seededState(writer));
      const encryptionStarted = deferred();
      const releaseEncryption = deferred();
      let timerCallback = null;
      const modules = (await openStorageSession({
        storage,
        password: PASSWORD,
        cryptoImpl: createCryptoFacade({
          beforeEncrypt: async () => {
            encryptionStarted.resolve();
            await releaseEncryption.promise;
          }
        }),
        setTimeoutImpl: callback => { timerCallback = callback; return 1; },
        clearTimeoutImpl: () => {}
      }));
      await modules.sessionCoordinator.acquire();
      await modules.Storage.loadState();
      const before = snapshotLocalStorage(storage);
      const mutations = interceptStorageMutations(storage);
      const candidate = seededState(modules);
      candidate.courses[0].name = `Veraltet nach ${label}`;
      const save = modules.Storage.saveState(candidate);
      await encryptionStarted.promise;

      await crossBoundary(modules, timerCallback);
      releaseEncryption.resolve();

      await assert.rejects(save, error => error && error.code === 'STORAGE_GENERATION_STALE');
      assert.equal(mutations.calls(), 0);
      assertLocalStorageSnapshot(storage, before);
    });
  }
});

test('D6: credential change rejects a save queued during the rotation', async () => {
  const storage = localStorageStub();
  const writer = (await openStorageSession({ storage, password: PASSWORD }));
  await writer.Storage.enableEncryption(PASSWORD, seededState(writer));
  const encryptionStarted = deferred();
  const releaseEncryption = deferred();
  const modules = (await openStorageSession({
    storage,
    password: PASSWORD,
    cryptoImpl: createCryptoFacade({
      beforeEncrypt: async () => {
        encryptionStarted.resolve();
        await releaseEncryption.promise;
      }
    })
  }));
  await modules.sessionCoordinator.acquire();
  await modules.Storage.loadState();
  const change = modules.Storage.changePassword(PASSWORD, 'Neues-Synthetisches-Testpasswort');
  await encryptionStarted.promise;
  const staleSave = modules.Storage.saveState(seededState(modules));
  releaseEncryption.resolve();
  await change;
  const afterChange = snapshotLocalStorage(storage);

  await assert.rejects(staleSave, error => error && error.code === 'STORAGE_GENERATION_STALE');
  assertLocalStorageSnapshot(storage, afterChange);
});

test('D6: replacement runs after older queued saves and rejects saves queued during replacement', async () => {
  const storage = localStorageStub();
  const writer = (await openStorageSession({ storage, password: PASSWORD }));
  await writer.Storage.enableEncryption(PASSWORD, seededState(writer));
  const firstEncryptionStarted = deferred();
  const releaseFirstEncryption = deferred();
  let encryptCalls = 0;
  const modules = (await openStorageSession({
    storage,
    password: PASSWORD,
    cryptoImpl: createCryptoFacade({
      beforeEncrypt: async () => {
        encryptCalls += 1;
        if (encryptCalls === 1) {
          firstEncryptionStarted.resolve();
          await releaseFirstEncryption.promise;
        }
      }
    })
  }));
  await modules.sessionCoordinator.acquire();
  await modules.Storage.loadState();
  const older = seededState(modules);
  older.courses[0].name = 'Älterer Queue-Save';
  const replacement = seededState(modules);
  replacement.courses[0].name = 'Exklusiver Ersatz';
  const stale = seededState(modules);
  stale.courses[0].name = 'Während Ersatz eingereiht';

  const olderSave = modules.Storage.saveState(older);
  await firstEncryptionStarted.promise;
  const replace = modules.Storage.replaceState(replacement);
  const staleSave = modules.Storage.saveState(stale);
  releaseFirstEncryption.resolve();

  assert.equal(await olderSave, true);
  assert.strictEqual(await replace, replacement);
  await assert.rejects(staleSave, error => error && error.code === 'STORAGE_GENERATION_STALE');
  const restored = await (await openStorageSession({ storage, password: PASSWORD })).Storage.loadState();
  assert.equal(restored.courses[0].name, 'Exklusiver Ersatz');
});

test('D6: a failed replacement keeps its generation so the next queued save can succeed', async () => {
  const storage = localStorageStub();
  const modules = (await openStorageSession({ storage, password: PASSWORD }));
  await modules.Storage.enableEncryption(PASSWORD, seededState(modules));
  interceptStorageMutations(storage, { primaryFailureCall: 1 });
  const replacement = seededState(modules);
  replacement.courses[0].name = 'Fehlgeschlagener Ersatz';
  const following = seededState(modules);
  following.courses[0].name = 'Save nach Ersatzfehler';

  const failedReplace = modules.Storage.replaceState(replacement);
  const followingSave = modules.Storage.saveState(following);

  await assert.rejects(failedReplace, /Synthetischer Schreibfehler/);
  assert.equal(await followingSave, true);
  const restored = await (await openStorageSession({ storage, password: PASSWORD })).Storage.loadState();
  assert.equal(restored.courses[0].name, 'Save nach Ersatzfehler');
});

test('D6: reset is an exclusive replacement and rejects a save queued while it encrypts', async () => {
  const storage = localStorageStub();
  const writer = (await openStorageSession({ storage, password: PASSWORD }));
  await writer.Storage.enableEncryption(PASSWORD, seededState(writer));
  const encryptionStarted = deferred();
  const releaseEncryption = deferred();
  const modules = (await openStorageSession({
    storage,
    password: PASSWORD,
    cryptoImpl: createCryptoFacade({
      beforeEncrypt: async () => {
        encryptionStarted.resolve();
        await releaseEncryption.promise;
      }
    })
  }));
  await modules.sessionCoordinator.acquire();
  await modules.Storage.loadState();
  const reset = modules.Storage.resetState();
  await encryptionStarted.promise;
  const staleSave = modules.Storage.saveState(seededState(modules));
  releaseEncryption.resolve();

  const fresh = await reset;
  assert.equal(fresh.courses.length, 0);
  await assert.rejects(staleSave, error => error && error.code === 'STORAGE_GENERATION_STALE');
  const restored = await (await openStorageSession({ storage, password: PASSWORD })).Storage.loadState();
  assert.equal(restored.courses.length, 0);
});
