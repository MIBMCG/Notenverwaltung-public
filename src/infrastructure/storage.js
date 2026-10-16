import {
  _bufToBase64, _base64ToBuf, _deriveKey, _encryptJsonWithKey, _decryptWithKey
} from './encryption.js';

import { createEnvelope, unlockEnvelope, reencryptState, inspectEnvelope, normalizeRecoveryCode, disposeEnvelopeSession } from './recovery-envelope.js';
import { validateImportedState, validateRawTermResults, validateRawUpperSecContexts } from '../transfer/import-validation.js';

export function createStorage({ DomainModel, createInitialState, sessionCoordinator }) {
      const STORAGE_KEY = "notenverwaltung_v1_state"; // legacy / Klartext
      const STORAGE_KEY_ENC_FLAG = "notenverwaltung_v1_encrypted"; // '1' wenn verschlüsselt
      const STORAGE_KEY_ENC_PAYLOAD = "notenverwaltung_v1_state_enc"; // base64(iv)+":"+base64(ciphertext)
      const STORAGE_KEY_SALT = "notenverwaltung_v1_salt"; // base64 salt
      const STORAGE_KEY_JOURNAL = "notenverwaltung_v1_credential_journal";

      if (!sessionCoordinator || typeof sessionCoordinator.assertHeld !== 'function') {
        throw new TypeError('sessionCoordinator ist erforderlich.');
      }
      const STORAGE_KEY_MIGRATION = "notenverwaltung_v2_migration_backup";
      const _storageKeys = [STORAGE_KEY_ENC_PAYLOAD, STORAGE_KEY_SALT, STORAGE_KEY_ENC_FLAG, STORAGE_KEY, STORAGE_KEY_JOURNAL, STORAGE_KEY_MIGRATION];
      let _confirmedSnapshot = null;
      const _pendingWrites = new Set();

      // Zwischenspeicher im Arbeitsspeicher für das Sitzungspasswort
      let _sessionPassword = null;
      let _v2Session = null;
      let _v2StateJson = null;
      const _privateTokens = new Map();
      const _receipts = new Map();
      const TOKEN_TTL = 15 * 60 * 1000;
      function _discardPrivateTokens() {
        for (const entry of _privateTokens.values()) {
          if (entry.session) disposeEnvelopeSession(entry.session);
          clearTimeout(entry.timer);
          entry.password = entry.code = entry.json = null;
        }
        _privateTokens.clear();
        _receipts.clear();
      }
      function _discardV2Session() {
        if (_v2Session) disposeEnvelopeSession(_v2Session);
        _v2Session = null;
        _v2StateJson = null;
      }
      function _replaceV2Session(session, json) {
        _discardV2Session();
        _discardPrivateTokens();
        _sessionGeneration++;
        _sessionPassword = null;
        _sessionKeyCache = null;
        _v2Session = session;
        _v2StateJson = json;
        _resetInactivityTimer();
      }
      let _sessionGeneration = 0;
      let _sessionKeyCache = null;
      let _localStorageOperationTail = Promise.resolve();
      // Inaktivitäts-Timeout (Standard: 15 Minuten)
      let _inactivityTimeoutMs = 15 * 60 * 1000;
      let _inactivityTimerId = null;
      // Referenz auf den Benutzer-Aktivitäts-Handler (einmal registriert)
      let _userActivityHandler = null;

      function _clearInactivityTimer() {
        if (_inactivityTimerId) {
          try { clearTimeout(_inactivityTimerId); } catch (e) {}
          _inactivityTimerId = null;
        }
      }

      function _startInactivityTimer() {
        _clearInactivityTimer();
        if (!hasSessionPassword()) return;
        const generation = _sessionGeneration;
        _inactivityTimerId = setTimeout(() => {
          if (generation !== _sessionGeneration) return;
          try { _lockSession(); } catch (e) {}
        }, _inactivityTimeoutMs);
      }

      function _resetInactivityTimer() {
        if (!hasSessionPassword()) return;
        _startInactivityTimer();
      }

      function _discardSessionKeyCache() {
        _sessionGeneration += 1;
        _sessionKeyCache = null;
      }

      function _replaceSessionSecrets(password, key, saltB64) {
        _discardV2Session();
        _discardPrivateTokens();
        _sessionGeneration += 1;
        _sessionPassword = password;
        _sessionKeyCache = key && saltB64 ? {
          generation: _sessionGeneration,
          saltB64,
          keyPromise: Promise.resolve(key)
        } : null;
      }

      function _advanceSessionGenerationPreservingSecrets() {
        _discardPrivateTokens();
        _sessionGeneration += 1;
        if (_sessionKeyCache) {
          _sessionKeyCache = {
            generation: _sessionGeneration,
            saltB64: _sessionKeyCache.saltB64,
            keyPromise: _sessionKeyCache.keyPromise
          };
        }
        _resetInactivityTimer();
      }

      function _clearSessionPassword() {
        _discardV2Session();
        _discardPrivateTokens();
        _confirmedSnapshot = null;
        _sessionPassword = null;
        _discardSessionKeyCache();
        _clearInactivityTimer();
      }

      // Alle lokalen Speicher- und Credential-Übergänge teilen eine einzige,
      // fehlertolerante FIFO-Warteschlange. So kann kein älterer Save einen
      // Payload nach einem Passwortwechsel oder einer Deaktivierung schreiben.
      function _enqueueLocalStorageOperation(operation, isWrite = true) {
        const operationPromise = _localStorageOperationTail.then(operation);
        _localStorageOperationTail = operationPromise.then(
          function () {},
          function () {}
        );
        if (isWrite) {
          _pendingWrites.add(operationPromise);
          operationPromise.then(() => _pendingWrites.delete(operationPromise), () => _pendingWrites.delete(operationPromise));
        }
        return operationPromise;
      }

      async function flushPendingWrites() {
        const results = Promise.all(Array.from(_pendingWrites, promise => promise.then(
          () => ({ ok: true }), error => ({ ok: false, error })
        )));
        await _enqueueLocalStorageOperation(() => {}, false);
        const failed = (await results).find(result => !result.ok);
        if (failed) throw failed.error;
      }

      // Interne Hilfsfunktion: sperrt die Sitzung (löscht Session-Passwort,
      // stoppt Timer, dispatcht Event und zeigt optional Debug-Toast).
      function _lockSession() {
        try { _clearSessionPassword(); } catch (e) {}
        const release = sessionCoordinator.release();
        try { window.dispatchEvent(new Event('sessionCleared')); } catch (e) {}
        return release;
      }

      function setSessionTimeoutMinutes(minutes) {
        const m = Number(minutes) || 0;
        // Debug-Log entfernt (Produktivmodus)
        if (!Number.isFinite(m) || m <= 0) return;
        const newMs = Math.max(60000, Math.floor(m) * 60 * 1000);
        _inactivityTimeoutMs = newMs;
        _resetInactivityTimer();
      }

      function getSessionTimeoutMinutes() {
        return Math.floor(_inactivityTimeoutMs / (60 * 1000));
      }

      // Registriere einen einfachen Listener für Benutzeraktivität, um den Inaktivitäts-Timer zurückzusetzen
      try {
        _userActivityHandler = function () { _resetInactivityTimer(); };
        ['mousemove', 'keydown', 'click', 'touchstart'].forEach(ev => {
          try { window.addEventListener(ev, _userActivityHandler); } catch (e) {}
        });
      } catch (e) {}

      function _staleStorageGenerationError() {
        const error = new Error('Der Speichervorgang gehört zu einer nicht mehr aktiven Sitzung. Es wurde nichts gespeichert.');
        error.code = 'STORAGE_GENERATION_STALE';
        return error;
      }

      function _assertStorageGeneration(expectedGeneration) {
        if (_sessionGeneration !== expectedGeneration) {
          throw _staleStorageGenerationError();
        }
      }

      function _localStorageIntegrityError(message) {
        const error = new Error(message);
        error.code = 'LOCAL_STORAGE_INTEGRITY_INVALID';
        return error;
      }

      function _encryptedFormatError() {
        const error = new Error('Das Format der verschlüsselten Daten ist beschädigt oder unvollständig. Die Originaldaten wurden nicht verändert.');
        error.code = 'ENCRYPTED_FORMAT_INVALID';
        return error;
      }

      function _cryptoOperationError() {
        const error = new Error('Die kryptografische Verarbeitung ist technisch fehlgeschlagen. Bitte den Browser neu starten oder einen unterstützten Browser verwenden. Die Originaldaten wurden nicht verändert.');
        error.code = 'CRYPTO_OPERATION_FAILED';
        return error;
      }

      function _decodeEncryptedParts(payload, saltB64) {
        const parts = typeof payload === 'string' ? payload.split(':') : [];
        const decode = value => {
          if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw _encryptedFormatError();
          try { return _base64ToBuf(value); } catch (error) { throw _encryptedFormatError(); }
        };
        if (parts.length !== 2) throw _encryptedFormatError();
        const salt = decode(saltB64), iv = decode(parts[0]), cipher = decode(parts[1]);
        // These are the lengths produced by every supported local/backup format.
        if (salt.byteLength !== 16 || iv.byteLength !== 12 || cipher.byteLength < 16) throw _encryptedFormatError();
        return { salt, iv, cipher };
      }

      function _incompleteLocalStateError() {
        return _localStorageIntegrityError('Der lokale verschlüsselte Bestand ist unvollständig oder widersprüchlich. Eine Neueinrichtung wurde zum Schutz der Originaldaten gesperrt. Bitte den Bestand für eine Wiederherstellung aufbewahren.');
      }

      function _completeCredentials(fields) {
        return Array.isArray(fields) && fields.length === 3 &&
          typeof fields[0] === 'string' && fields[0].length > 0 &&
          typeof fields[1] === 'string' && fields[1].length > 0 && fields[2] === '1';
      }

      function _readLocalRecord() {
        const snapshot = _readSnapshot();
        const fields = snapshot.slice(0, 3);
        if (snapshot[4] !== null) {
          let journal;
          try { journal = JSON.parse(snapshot[4]); } catch (error) { throw _incompleteLocalStateError(); }
          if (!journal || !['notenverwaltung_credentials_v1', 'notenverwaltung_credentials_v2'].includes(journal.format) ||
              !_completeCredentials(journal.after) ||
              !(journal.before === null || _completeCredentials(journal.before)) ||
              !(journal.legacyHash === null || (typeof journal.legacyHash === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(journal.legacyHash)))) {
            throw _incompleteLocalStateError();
          }
          const previous = journal.format === 'notenverwaltung_credentials_v2' ? journal.previous : [];
          if (!Array.isArray(previous) || !previous.every(candidate => candidate === null || _completeCredentials(candidate))) throw _incompleteLocalStateError();
          const candidates = [journal.after, journal.before, ...previous].map(candidate => candidate || [null,null,null]);
          if (!fields.every((value, index) => candidates.some(candidate => value === candidate[index])) ||
              (snapshot[3] !== null && journal.legacyHash === null)) throw _incompleteLocalStateError();
          _validateCredentialFields(journal.after);
          if (journal.before) _validateCredentialFields(journal.before);
          for (const candidate of previous.filter(Boolean)) _validateCredentialFields(candidate);
          if (journal.format === 'notenverwaltung_credentials_v2') {
            if (![journal.migrationBefore, journal.migrationAfter].includes(snapshot[5]) ||
                ![journal.migrationBefore, journal.migrationAfter].every(value => value === null || _validMigrationBackup(value))) throw _incompleteLocalStateError();
          }
          return { fields, journal, legacy: snapshot[3] };
        }
        if (fields.some(value => value !== null) && !_completeCredentials(fields)) throw _incompleteLocalStateError();
        if (_completeCredentials(fields)) _validateCredentialFields(fields);
        return { fields, journal: null, legacy: snapshot[3] };
      }

      function _validateCredentialFields(fields) {
        if (fields[1] === 'v2-envelope') inspectEnvelope(fields[0]);
        else _decodeEncryptedParts(fields[0], fields[1]);
      }
      function _validMigrationBackup(text) {
        try { const obj = JSON.parse(text); if (obj.format !== 'notenverwaltung_enc_v1') return false; _decodeEncryptedParts(obj.payload, obj.salt); return true; } catch (_) { return false; }
      }
      async function _legacyHash(raw, expectedGeneration) {
        if (raw === null) return null;
        try {
          return _bufToBase64(await _guardAsync(crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)), expectedGeneration));
        } catch (error) {
          if (error && ['STORAGE_EXTERNAL_CHANGE', 'STORAGE_GENERATION_STALE', 'SESSION_NOT_OWNER'].includes(error.code)) throw error;
          throw _cryptoOperationError();
        }
      }

      // The journal is temporary: completed transactions retain the legacy
      // iv:ciphertext + salt + flag format, including compatibility with 1.6.0.
      // Never copy legacy plaintext into it, even during a failed migration.
      async function _writeCredentialTransaction(operations, expectedGeneration) {
        const original = _beginSnapshot(expectedGeneration);
        const after = original.slice(0, 3);
        for (const operation of operations) {
          const index = _storageKeys.indexOf(operation.key);
          if (index < 3) after[index] = operation.type === 'remove' ? null : String(operation.value);
        }
        const journal = JSON.stringify({
          format: 'notenverwaltung_credentials_v1',
          before: _completeCredentials(original.slice(0, 3)) ? original.slice(0, 3) : null,
          after,
          legacyHash: await _legacyHash(original[3], expectedGeneration)
        });
        _writeStorageTransaction([
          { type: 'set', key: STORAGE_KEY_JOURNAL, value: journal },
          ...operations,
          { type: 'remove', key: STORAGE_KEY_JOURNAL }
        ], expectedGeneration);
      }

      function _rollbackFailureError(originalError, rollbackErrors) {
        const rollbackDetails = rollbackErrors.map(function (error) {
          return error && error.message ? error.message : String(error);
        }).join('; ');
        const originalDetails = originalError && originalError.message
          ? originalError.message
          : String(originalError);
        const error = new Error('Lokaler Schreibfehler: ' + originalDetails + '. Rücknahme fehlgeschlagen: ' + rollbackDetails);
        error.code = 'STORAGE_ROLLBACK_FAILED';
        error.cause = originalError;
        error.rollbackErrors = rollbackErrors;
        return error;
      }

      function _readSnapshot() {
        return _storageKeys.map(key => localStorage.getItem(key));
      }

      function _sameSnapshot(left, right) {
        return left && right && left.every((value, index) => value === right[index]);
      }

      function _externalChangeError() {
        const error = new Error('Der lokale Bestand wurde in einem anderen Fenster verändert. Bitte erneut entsperren.');
        error.code = 'STORAGE_EXTERNAL_CHANGE';
        return error;
      }

      function _assertSession(expectedGeneration, expectedSnapshot = _confirmedSnapshot) {
        // An old continuation must never invalidate or release a new session.
        _assertStorageGeneration(expectedGeneration);
        try { sessionCoordinator.assertHeld(); } catch (error) { _clearSessionPassword(); throw error; }
        if (expectedSnapshot && !_sameSnapshot(_readSnapshot(), expectedSnapshot)) {
          const error = _externalChangeError();
          _lockSession();
          throw error;
        }
      }

      function _beginSnapshot(expectedGeneration) {
        _assertSession(expectedGeneration);
        if (!_confirmedSnapshot) _confirmedSnapshot = _readSnapshot();
        return _confirmedSnapshot;
      }

      async function _guardAsync(promise, expectedGeneration) {
        try {
          const value = await promise;
          _assertSession(expectedGeneration);
          return value;
        } catch (error) {
          if (error && error.code === 'STORAGE_EXTERNAL_CHANGE') throw error;
          _assertSession(expectedGeneration);
          throw error;
        }
      }

      function _writeStorageTransaction(operations, expectedGeneration) {
        _assertSession(expectedGeneration);
        const original = _confirmedSnapshot.slice();
        const staged = original.slice();
        const attempted = [];
        let failing = null;
        function assertStaged(allowFailing = false) {
          _assertStorageGeneration(expectedGeneration);
          sessionCoordinator.assertHeld();
          const actual = _readSnapshot();
          if (!actual.every((value, index) => value === staged[index] ||
              (allowFailing && failing && index === failing.index && value === failing.value))) {
            throw _externalChangeError();
          }
          return actual;
        }
        try {
          for (const operation of operations) {
            assertStaged();
            const index = _storageKeys.indexOf(operation.key);
            const value = operation.type === 'remove' ? null : String(operation.value);
            failing = { index, value };
            attempted.push(index);
            if (value === null) localStorage.removeItem(operation.key);
            else localStorage.setItem(operation.key, value);
            staged[index] = value;
            failing = null;
          }
          assertStaged();
          _confirmedSnapshot = staged;
        } catch (originalError) {
          try {
            const actual = assertStaged(true);
            for (let index = 0; index < staged.length; index++) staged[index] = actual[index];
            failing = null;
            const restored = new Set();
            const rollbackErrors = [];
            const journalIndex = _storageKeys.indexOf(STORAGE_KEY_JOURNAL);
            const journalWrite = operations.find(operation => operation.key === STORAGE_KEY_JOURNAL && operation.type === 'set');
            const recoveryJournal = original[journalIndex] || (journalWrite && String(journalWrite.value));
            // Cleanup may mutate then throw. Re-establish recovery protection
            // BEFORE reverting any credential, and discard it only LAST.
            if (recoveryJournal && attempted.some(index => index !== journalIndex) && staged[journalIndex] !== recoveryJournal) {
              assertStaged();
              localStorage.setItem(STORAGE_KEY_JOURNAL, recoveryJournal);
              staged[journalIndex] = recoveryJournal;
            }
            const rollbackOrder = attempted.slice().reverse().filter(index => index !== journalIndex);
            if (attempted.includes(journalIndex)) rollbackOrder.push(journalIndex);
            for (const index of rollbackOrder) {
              if (restored.has(index)) continue;
              restored.add(index);
              assertStaged();
              if (index === journalIndex && !staged.every((value, i) => i === journalIndex || value === original[i])) continue;
              failing = { index, value: original[index] };
              try {
                if (original[index] === null) localStorage.removeItem(_storageKeys[index]);
                else localStorage.setItem(_storageKeys[index], original[index]);
                staged[index] = original[index];
              } catch (error) {
                // A mutate-then-throw restoration may already have restored this
                // key. Continue only after verifying every staged field.
                rollbackErrors.push(error);
                const restoredActual = assertStaged(true);
                for (let i = 0; i < staged.length; i++) staged[i] = restoredActual[i];
              }
              failing = null;
            }
            assertStaged();
            if (rollbackErrors.length) throw _rollbackFailureError(originalError, rollbackErrors);
          } catch (rollbackError) {
            // A stale rollback is forbidden from touching a later session.
            if (_sessionGeneration === expectedGeneration) _lockSession();
            if (rollbackError.code === 'STORAGE_GENERATION_STALE' ||
                rollbackError.code === 'SESSION_NOT_OWNER' || rollbackError.code === 'STORAGE_EXTERNAL_CHANGE') {
              rollbackError.cause = originalError;
              throw rollbackError;
            }
            if (rollbackError.code === 'STORAGE_ROLLBACK_FAILED') throw rollbackError;
            throw _rollbackFailureError(originalError, [rollbackError]);
          }
          throw originalError;
        }
      }

      function _getOrCreateSessionKey(password, saltB64) {
        if (!_sessionPassword || password !== _sessionPassword) {
          return _deriveKey(password, _base64ToBuf(saltB64));
        }
        if (_sessionKeyCache &&
            _sessionKeyCache.generation === _sessionGeneration &&
            _sessionKeyCache.saltB64 === saltB64) {
          return _sessionKeyCache.keyPromise;
        }
        const generation = _sessionGeneration;
        const keyPromise = _deriveKey(password, _base64ToBuf(saltB64));
        _sessionKeyCache = { generation, saltB64, keyPromise };
        keyPromise.catch(function () {
          if (_sessionKeyCache && _sessionKeyCache.keyPromise === keyPromise) {
            _sessionKeyCache = null;
          }
        });
        return keyPromise;
      }

      async function _encryptJsonWithSaltBuffer(jsonStr, password, saltBuf) {
        const key = await _deriveKey(password, saltBuf);
        return _encryptJsonWithKey(jsonStr, key);
      }

      async function _encryptLocalJson(jsonStr, password, expectedGeneration) {
        const saltB64 = localStorage.getItem(STORAGE_KEY_SALT);
        if (!saltB64) {
          if (localStorage.getItem(STORAGE_KEY_ENC_PAYLOAD)) {
            throw _localStorageIntegrityError('Die verschlüsselte Nutzlast ist vorhanden, aber der zugehörige Salt fehlt. Die Originaldaten wurden nicht verändert.');
          }
          throw _localStorageIntegrityError('Der Salt für die verschlüsselte Speicherung fehlt. Es wurde nichts gespeichert.');
        }
        const key = await _guardAsync(_getOrCreateSessionKey(password, saltB64), expectedGeneration);
        return {
          payload: await _guardAsync(_encryptJsonWithKey(jsonStr, key), expectedGeneration),
          key,
          saltB64
        };
      }

      // Für Backup-Button: Verschlüsselt mit eigenem Salt (portabel zwischen Rechnern)
      async function _encryptJsonWithSalt(jsonStr, password) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const saltBuf = salt.buffer;
        const key = await _deriveKey(password, saltBuf);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(jsonStr);
        const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
        // Format: salt:iv:ciphertext (portabel)
        const payload = _bufToBase64(saltBuf) + ':' + _bufToBase64(iv.buffer) + ':' + _bufToBase64(cipher);
        return payload;
      }

      async function _decryptPayload(payload, password) {
        const parts = String(payload).split(':');

        // Neues Format mit Salt: salt:iv:ciphertext (3 Teile - portabel)
        if (parts.length === 3) {
          const saltBuf = _base64ToBuf(parts[0]);
          const ivBuf = _base64ToBuf(parts[1]);
          const cipherBuf = _base64ToBuf(parts[2]);
          const key = await _deriveKey(password, saltBuf);
          const decrypted = await _decryptWithKey(new Uint8Array(ivBuf), key, cipherBuf);
          return new TextDecoder().decode(decrypted);
        }

        // Altes Format: iv:ciphertext (2 Teile, benötigt localStorage Salt)
        if (parts.length === 2) {
          const ivBuf = _base64ToBuf(parts[0]);
          const cipherBuf = _base64ToBuf(parts[1]);
          const saltB64 = localStorage.getItem(STORAGE_KEY_SALT);
          if (!saltB64) throw new Error('fehlender Salt');
          const saltBuf = _base64ToBuf(saltB64);
          const key = await _deriveKey(password, saltBuf);
          const decrypted = await _decryptWithKey(new Uint8Array(ivBuf), key, cipherBuf);
          return new TextDecoder().decode(decrypted);
        }

        throw new Error('ungültiges Payload-Format');
      }

      async function _decryptLocalPayload(payload, password, expectedGeneration, saltB64 = localStorage.getItem(STORAGE_KEY_SALT)) {
        if (saltB64 === 'v2-envelope') {
          const opened = await unlockEnvelope(payload, {kind:'password',value:password}).catch(error => { _assertSession(expectedGeneration); throw error; });
          try { _assertSession(expectedGeneration); return {json:opened.stateJson, session:opened.session}; }
          catch (error) { disposeEnvelopeSession(opened.session); throw error; }
        }
        const parts = _decodeEncryptedParts(payload, saltB64);
        const cached = _sessionPassword === password && _sessionKeyCache &&
          _sessionKeyCache.generation === _sessionGeneration &&
          _sessionKeyCache.saltB64 === saltB64
          ? _sessionKeyCache.keyPromise
          : null;
        let key;
        try { key = await _guardAsync(cached || _deriveKey(password, parts.salt), expectedGeneration); }
        catch (error) {
          if (error && ['STORAGE_EXTERNAL_CHANGE', 'STORAGE_GENERATION_STALE', 'SESSION_NOT_OWNER'].includes(error.code)) throw error;
          throw _cryptoOperationError();
        }
        let decrypted;
        try { decrypted = await _guardAsync(_decryptWithKey(new Uint8Array(parts.iv), key, parts.cipher), expectedGeneration); }
        catch (error) {
          if (error && ['STORAGE_EXTERNAL_CHANGE', 'STORAGE_GENERATION_STALE', 'SESSION_NOT_OWNER'].includes(error.code)) throw error;
          if (error && error.name === 'OperationError') {
            const authError = new Error('Passwort falsch oder die verschlüsselten Daten konnten nicht authentifiziert werden.');
            authError.code = 'AUTH';
            throw authError;
          }
          throw _cryptoOperationError();
        }
        return { json: new TextDecoder().decode(decrypted), key, saltB64 };
      }

      async function _decryptLocalRecord(record, password, expectedGeneration) {
        if (!record.journal) return _decryptLocalPayload(record.fields[0], password, expectedGeneration, record.fields[1]);
        const candidates = [record.journal.after, record.journal.before, ...(record.journal.previous || [])].filter(Boolean);
        for (const [index, candidate] of candidates.entries()) {
          try {
            const decrypted = await _decryptLocalPayload(candidate[0], password, expectedGeneration, candidate[1]);
            return { ...decrypted, recoveredFields: candidate };
          } catch (error) {
            // Never conceal a provider/format error by trying another password state.
            if (!error || error.code !== 'AUTH' || index === candidates.length - 1) throw error;
          }
        }
      }

      // Exportiert den State als verschlüsselten JSON-String (inkl. Salt im Export)
      async function exportStateEncrypted(password, state) {
        const json = JSON.stringify(state || createInitialState(new Date()));
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const saltBuf = salt.buffer;
        const key = await _deriveKey(password, saltBuf);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(json);
        const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
        const payload = _bufToBase64(iv.buffer) + ':' + _bufToBase64(cipher);
        const out = {
          format: 'notenverwaltung_enc_v1',
          salt: _bufToBase64(saltBuf),
          payload: payload
        };
        return JSON.stringify(out, null, 2);
      }

      // Importiert einen verschlüsselten Export (JSON-String) mit dem angegebenen Passwort
      async function importStateEncryptedFromText(text, password) {
        let obj;
        try {
          obj = JSON.parse(text);
        } catch (err) {
          throw new Error('Ungültiges JSON');
        }
        if (obj && obj.format === 'notenverwaltung_envelope') return _importV2(text, {kind:'password',value:password});
        if (!obj || obj.format !== 'notenverwaltung_enc_v1' || !obj.salt || !obj.payload) {
          throw new Error('Unbekanntes verschlüsseltes Format');
        }
        const saltBuf = _base64ToBuf(obj.salt);
        const parts = String(obj.payload).split(':');
        if (parts.length !== 2) throw new Error('ungültiges Payload-Format');
        const ivBuf = _base64ToBuf(parts[0]);
        const cipherBuf = _base64ToBuf(parts[1]);
        const key = await _deriveKey(password, saltBuf);
        const decrypted = await _decryptWithKey(new Uint8Array(ivBuf), key, cipherBuf);
        const json = new TextDecoder().decode(decrypted);
        const parsed = JSON.parse(json);
        return parsed;
      }

      // Öffentliche API: prüfe, ob encrypted flag gesetzt ist
      function _isEncryptedFlagSet() {
        return localStorage.getItem(STORAGE_KEY_ENC_FLAG) === '1';
      }

      function _stateContentError(cause) {
        const archiveDetail = cause && cause.code === 'ARCHIVE_INTEGRITY_INVALID'
          ? ' ' + cause.message
          : '';
        const error = new Error('Die gespeicherten Daten konnten nicht gelesen werden. Die Originaldaten wurden nicht verändert.' + archiveDetail);
        error.code = 'STATE_CONTENT_INVALID';
        return error;
      }

      function _parseStoredState(json) {
        try {
          const parsed = JSON.parse(json);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('ungueltige Wurzelstruktur');
          }
          return DomainModel.ensureStateShape(parsed);
        } catch (err) {
          console.error('[Storage.loadState] Gespeicherter Dateninhalt ist ungueltig.');
          throw _stateContentError(err);
        }
      }

      // loadState: wenn verschlüsselt, fragt Passwort ab und entschlüsselt (asynchron)
      async function loadState(options = {}) {
        let expectedGeneration = _sessionGeneration;
        _beginSnapshot(expectedGeneration);
        const record = _readLocalRecord();
        if (record.journal && record.legacy !== null &&
            await _legacyHash(record.legacy, expectedGeneration) !== record.journal.legacyHash) throw _incompleteLocalStateError();
        if (record.journal || _completeCredentials(record.fields)) {

          // Nur Authentifizierungsfehler öffnen die Passwort-Wiederholung.
          // Inhaltsfehler gehen an den Startpfad zur sicheren Sitzungsbereinigung.
          while (true) {
            if (_v2Session) { _assertSession(expectedGeneration); return _parseRecoveryState(_v2StateJson); }
            const alreadyUnlocked = !!_sessionPassword;
            let recoveredReceipt = null;
            const onRecovery = typeof options.onRecoveryRequested === 'function' ? async () => {
              _assertSession(expectedGeneration);
              const result = await options.onRecoveryRequested();
              const receipt = result && _receipts.get(result.receipt);
              if (!receipt || receipt.generation !== _sessionGeneration || !_v2Session) return false;
              _assertSession(receipt.generation, receipt.snapshot);
              if (receipt.generation <= expectedGeneration) return false;
              recoveredReceipt = receipt;
              _receipts.delete(result.receipt);
              return true;
            } : undefined;
            const pwd = _sessionPassword || await window.promptPassword({ message: 'Der gespeicherte Zustand ist verschlüsselt. Bitte Passwort eingeben:', onRecovery });
            if (recoveredReceipt) {
              _assertSession(recoveredReceipt.generation, recoveredReceipt.snapshot);
              if (!_v2Session) throw _staleStorageGenerationError();
              return _parseRecoveryState(_v2StateJson);
            }
            _assertSession(expectedGeneration);
            if (!pwd) {
              // Abbruch → leeren Zustand zurückgeben, NICHT automatisch speichern
              _lockSession();
              const fresh = createInitialState(new Date());
              return fresh;
            }

            let decrypted;
            try {
              decrypted = await _decryptLocalRecord(record, pwd, expectedGeneration);
            } catch (err) {
              if (!err || err.code !== 'AUTH') throw err;
              // Eine ältere Entschlüsselung darf eine spätere Sitzung nicht
              // löschen oder deren Passwortabfrage starten.
              _assertSession(expectedGeneration);
              console.error('[Storage.loadState] Authentifizierung oder Entschluesselung fehlgeschlagen.');
              const snapshot = _confirmedSnapshot;
              _clearSessionPassword();
              _confirmedSnapshot = snapshot;
              expectedGeneration = _sessionGeneration;
              const tryAgain = window.confirm('Passwort falsch oder die verschlüsselten Daten konnten nicht authentifiziert werden. Nochmals versuchen?');
              _assertSession(expectedGeneration);
              if (!tryAgain) {
                _lockSession();
                const fresh = createInitialState(new Date());
                return fresh;
              }
              continue;
            }

            _assertSession(expectedGeneration);
            // Unlocked parallel reads share the current session. Replacing the
            // same secrets here would stale the other read for no reason.
            let state;
            try { state = decrypted.session ? _parseRecoveryState(decrypted.json) : _parseStoredState(decrypted.json); }
            catch (error) { if (decrypted.session) disposeEnvelopeSession(decrypted.session); throw error; }
            if (decrypted.recoveredFields) {
              await _enqueueLocalStorageOperation(() => {
                _assertSession(expectedGeneration);
                _writeStorageTransaction([
                  ...decrypted.recoveredFields.map((value, index) => ({ type: 'set', key: _storageKeys[index], value })),
                  { type: 'remove', key: STORAGE_KEY },
                  ...(record.journal.format === 'notenverwaltung_credentials_v2' && record.journal.migrationAfter !== null ? [{type:'set',key:STORAGE_KEY_MIGRATION,value:record.journal.migrationAfter}] : []),
                  { type: 'remove', key: STORAGE_KEY_JOURNAL }
                ], expectedGeneration);
              });
              _assertSession(expectedGeneration);
            }
            if (!alreadyUnlocked) {
              if (decrypted.session) _replaceV2Session(decrypted.session, decrypted.json);
              else _replaceSessionSecrets(pwd, decrypted.key, decrypted.saltB64);
            }
            try { _resetInactivityTimer(); } catch (e) {}
            return state;
          }
        }

        // Klartext-Modus ist ausschliesslich fuer den ersten Start oder einen
        // vorhandenen Altbestand gedacht; er ist kein Fehler-Fallback.
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
          const fresh = createInitialState(new Date());
          // Nicht automatisch speichern: zwinge den Benutzer, in den Einstellungen Verschlüsselung zu aktivieren
          return fresh;
        }
        const state = _parseStoredState(raw);
        return state;
      }

      // Recovery after a failed exclusive operation is a read-only operation
      // in the existing Storage FIFO. It never prompts, unlocks, or refreshes
      // the inactivity timer, and rejects if its captured session went stale.
      function loadCurrentSessionState() {
        const expectedGeneration = _sessionGeneration;
        return _enqueueLocalStorageOperation(async function () {
          _assertSession(expectedGeneration);
          if (!_isEncryptedFlagSet() || !hasSessionPassword()) {
            throw new Error('Die Anwendung muss verschlüsselt und entsperrt sein, um den bestätigten Zustand zu lesen.');
          }
          if (_v2Session) return _parseRecoveryState(_v2StateJson);
          const payload = localStorage.getItem(STORAGE_KEY_ENC_PAYLOAD);
          if (!payload) throw _stateContentError();
          const password = _sessionPassword;
          let decrypted;
          try {
            decrypted = await _decryptLocalPayload(payload, password, expectedGeneration);
          } catch (error) {
            if (error && error.code === 'STORAGE_EXTERNAL_CHANGE') throw error;
            _assertSession(expectedGeneration);
            throw error;
          }
          _assertSession(expectedGeneration);
          return _parseStoredState(decrypted.json);
        }, false);
      }

      // saveState: wenn Verschlüsselung aktiv und Passwort in dieser Sitzung vorhanden,
      // wird asynchron verschlüsselt gespeichert. Wenn Verschlüsselung aktiv ist, aber
      // kein Session-Passwort vorliegt, wird KEIN Klartext geschrieben (Verhinderung von Leak).
      function saveState(state) {
        try { _assertSession(_sessionGeneration); } catch (error) { return Promise.reject(error); }
        let json;
        try {
          json = JSON.stringify(state);
        } catch (error) {
          return Promise.reject(error);
        }
        const expectedGeneration = _sessionGeneration;
        return _enqueueLocalStorageOperation(function () {
          return _saveStateNow(json, expectedGeneration);
        });
      }

      function _enqueueExclusiveStateReplacement(state, reset = false) {
        let json;
        try {
          json = JSON.stringify(state);
        } catch (error) {
          return Promise.reject(error);
        }
        const expectedGeneration = _sessionGeneration;
        return _enqueueLocalStorageOperation(async function () {
          await _saveStateNow(json, expectedGeneration, reset);
          _assertSession(expectedGeneration);
          _advanceSessionGenerationPreservingSecrets();
          return state;
        });
      }

      function replaceState(state) {
        try { _assertSession(_sessionGeneration); } catch (error) { return Promise.reject(error); }
        if (!_isEncryptedFlagSet() || !hasSessionPassword()) {
          return Promise.reject(new Error('Die Anwendung muss entsperrt und verschlüsselt sein.'));
        }
        return _enqueueExclusiveStateReplacement(state);
      }

      function resetState() {
        try { _assertSession(_sessionGeneration); } catch (error) { return Promise.reject(error); }
        if (!_isEncryptedFlagSet() || !hasSessionPassword()) {
          return Promise.reject(new Error('Die Anwendung muss entsperrt und verschlüsselt sein.'));
        }
        const fresh = createInitialState(new Date());
        return _enqueueExclusiveStateReplacement(fresh, true);
      }

      async function _saveStateNow(stateOrJson, expectedGeneration, reset = false) {
        const json = typeof stateOrJson === 'string' ? stateOrJson : JSON.stringify(stateOrJson);
        _assertSession(expectedGeneration);
        if (!_isEncryptedFlagSet()) {
          throw new Error('Verschlüsselte Speicherung ist nicht eingerichtet. Es wurde nichts gespeichert.');
        }
        if (_v2Session) {
          _parseRecoveryState(json);
          const envelope = await _guardAsync(reencryptState(_v2Session, json), expectedGeneration);
          _writeStorageTransaction([
            {type:'set',key:STORAGE_KEY_ENC_PAYLOAD,value:envelope},
            ...(reset ? [{type:'remove',key:STORAGE_KEY_MIGRATION}] : [])
          ], expectedGeneration);
          _v2StateJson = json;
          return true;
        }
        if (!_sessionPassword) {
          throw new Error('Kein Sitzungspasswort vorhanden. Es wurde nichts gespeichert.');
        }
        const password = _sessionPassword;
        const encrypted = await _encryptLocalJson(json, password, expectedGeneration);
        _writeStorageTransaction([
          { type: 'set', key: STORAGE_KEY_ENC_PAYLOAD, value: encrypted.payload },
          { type: 'set', key: STORAGE_KEY_ENC_FLAG, value: '1' },
          { type: 'remove', key: STORAGE_KEY },
          ...(reset ? [{type:'remove',key:STORAGE_KEY_MIGRATION}] : [])
        ], expectedGeneration);
        return true;
      }

      // Aktiviert Verschlüsselung: verschlüsselt aktuellen state und speichert
      async function enableEncryption(password, state) {
        _assertSession(_sessionGeneration);
        if (localStorage.getItem(STORAGE_KEY_SALT) === 'v2-envelope') throw _recoveryError('RECOVERY_CONFIRMATION_REQUIRED');
        if (!password) throw new Error('Passwort erforderlich');
        if (password.length < 6) throw new Error('Passwort muss mindestens 6 Zeichen lang sein');
        const json = JSON.stringify(state || createInitialState(new Date()));
        const expectedGeneration = _sessionGeneration;
        return _enqueueLocalStorageOperation(async function () {
          _beginSnapshot(expectedGeneration);
          const record = _readLocalRecord();
          if (record.journal) throw _incompleteLocalStateError();
          if (_completeCredentials(record.fields) && !_sessionPassword) {
            const error = new Error('Bitte den vorhandenen lokalen Bestand zuerst laden und entsperren. Eine Neueinrichtung wurde gesperrt.');
            error.code = 'STORAGE_SESSION_NOT_INITIALIZED';
            throw error;
          }
          const salt = crypto.getRandomValues(new Uint8Array(16));
          const saltB64 = _bufToBase64(salt.buffer);
          const key = await _guardAsync(_deriveKey(password, salt.buffer), expectedGeneration);
          const payload = await _guardAsync(_encryptJsonWithKey(json, key), expectedGeneration);
          await _writeCredentialTransaction([
            { type: 'set', key: STORAGE_KEY_ENC_PAYLOAD, value: payload },
            { type: 'set', key: STORAGE_KEY_SALT, value: saltB64 },
            { type: 'set', key: STORAGE_KEY_ENC_FLAG, value: '1' },
            { type: 'remove', key: STORAGE_KEY }
          ], expectedGeneration);
          _assertSession(expectedGeneration);
          _replaceSessionSecrets(password, key, saltB64);
          try { _resetInactivityTimer(); } catch (e) {}
          return true;
        });
      }

      // Ändert das Passwort: entschlüsselt mit altem Passwort und reverschlüsselt mit neuem
      async function changePassword(oldPassword, newPassword) {
        if (localStorage.getItem(STORAGE_KEY_SALT) === 'v2-envelope') throw _recoveryError('RECOVERY_CONFIRMATION_REQUIRED');
        _assertSession(_sessionGeneration);
        if (!_confirmedSnapshot || !_sessionPassword) {
          const error = new Error('Bitte den lokalen Bestand zuerst laden und entsperren, bevor das Passwort geändert wird.');
          error.code = 'STORAGE_SESSION_NOT_INITIALIZED';
          throw error;
        }
        if (!oldPassword || !newPassword) throw new Error('altes und neues Passwort erforderlich');
        if (newPassword.length < 6) throw new Error('Passwort muss mindestens 6 Zeichen lang sein');
        const expectedGeneration = _sessionGeneration;
        return _enqueueLocalStorageOperation(async function () {
          _assertSession(expectedGeneration);
          const payload = localStorage.getItem(STORAGE_KEY_ENC_PAYLOAD);
          if (!payload) throw new Error('kein verschlüsselter Payload vorhanden');
          const decrypted = await _decryptLocalPayload(payload, oldPassword, expectedGeneration);
          const newSalt = crypto.getRandomValues(new Uint8Array(16));
          const newSaltB64 = _bufToBase64(newSalt.buffer);
          const newKey = await _guardAsync(_deriveKey(newPassword, newSalt.buffer), expectedGeneration);
          const newPayload = await _guardAsync(_encryptJsonWithKey(decrypted.json, newKey), expectedGeneration);
          await _writeCredentialTransaction([
            { type: 'set', key: STORAGE_KEY_ENC_PAYLOAD, value: newPayload },
            { type: 'set', key: STORAGE_KEY_SALT, value: newSaltB64 }
          ], expectedGeneration);
          _assertSession(expectedGeneration);
          _replaceSessionSecrets(newPassword, newKey, newSaltB64);
          try { _resetInactivityTimer(); } catch (e) {}
          return true;
        });
      }

      function hasSessionPassword() {
        return !!(_sessionPassword || _v2Session);
      }

      // Verschlüsselt JSON-Daten mit dem Session-Passwort für Backup-Zwecke.
      // Das Passwort verlässt dadurch nicht das Storage-Modul.
      async function encryptForBackup(json) {
        if (!hasSessionPassword()) throw new Error('kein Sitzungspasswort vorhanden');
        const generation = _sessionGeneration;
        _assertSession(generation);
        return _guardAsync(_v2Session ? reencryptState(_v2Session, json) : _encryptJsonWithSalt(json, _sessionPassword), generation);
      }

      function _recoveryError(code) {
        const messages = {
          RECOVERY_CONFIRMATION_REQUIRED: 'Der neue Wiederherstellungscode muss zuerst vollständig bestätigt werden.',
          RECOVERY_TOKEN_INVALID: 'Die Vorbereitung ist abgelaufen oder wurde verworfen. Bitte erneut beginnen.',
          RECOVERY_REPLACEMENT_REQUIRED: 'Das Ersetzen des vorhandenen Bestands muss ausdrücklich bestätigt werden.',
          RECOVERY_MIGRATION_CONFLICT: 'Eine abweichende verschlüsselte Alt-Sicherung ist bereits vorhanden.',
          AUTH: 'Der Zugang konnte nicht authentifiziert werden.'
        };
        const error = new Error(messages[code] || 'Die Wiederherstellung konnte nicht abgeschlossen werden.');
        error.code = code;
        return error;
      }
      function _parseRecoveryState(json) {
        try {
          const raw = JSON.parse(json);
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('root');
          validateRawTermResults(raw);
          validateRawUpperSecContexts(raw);
          validateImportedState(raw);
          const state = DomainModel.ensureStateShape(raw);
          validateImportedState(state);
          return state;
        } catch (_) { throw _stateContentError(); }
      }
      function _summary(json, metadata = null) {
        const state = _parseRecoveryState(json);
        return {students:state.students.length,courses:state.courses.length,assessments:state.assessments.length,metadata};
      }
      function getRecoveryStatus() {
        const record = _readLocalRecord();
        const fields = record.journal ? record.journal.after : record.fields;
        const metadata = fields[1] === 'v2-envelope' ? inspectEnvelope(fields[0]) : null;
        return {enabled:!!metadata,metadata,migrationBackupAvailable:getRecoveryMigrationBackup() !== null,
          hasLocalData:!!(record.journal || _completeCredentials(fields) || record.legacy !== null)};
      }
      function getRecoveryMigrationBackup() {
        const text = localStorage.getItem(STORAGE_KEY_MIGRATION);
        if (text !== null && !_validMigrationBackup(text)) throw _incompleteLocalStateError();
        return text;
      }
      function _capturePreparation() {
        const generation = _sessionGeneration;
        const snapshot = _beginSnapshot(generation).slice();
        return {generation,snapshot,expiresAt:Date.now()+TOKEN_TTL};
      }
      function _assertPreparation(entry) {
        if (!entry || Date.now() >= entry.expiresAt) throw _recoveryError('RECOVERY_TOKEN_INVALID');
        _assertSession(entry.generation, entry.snapshot);
      }
      function _tokenEntry(token, kind) {
        const entry = _privateTokens.get(token);
        if (!entry || entry.kind !== kind) throw _recoveryError('RECOVERY_TOKEN_INVALID');
        try { _assertPreparation(entry); } catch (error) { cancelPreparedProtection(token); throw error; }
        return entry;
      }
      function _registerToken(entry) {
        _assertPreparation(entry);
        const token = Object.freeze({});
        entry.timer = setTimeout(() => {
          if (_privateTokens.has(token)) _lockSession();
        }, Math.max(1, entry.expiresAt-Date.now()));
        _privateTokens.set(token,entry);
        return token;
      }
      function cancelPreparedProtection(token) {
        const entry = _privateTokens.get(token);
        if (!entry) return;
        _privateTokens.delete(token);
        clearTimeout(entry.timer);
        if (entry.session) disposeEnvelopeSession(entry.session);
        entry.session = entry.password = entry.code = entry.json = null;
      }
      async function _openChecked(text, access, preparation) {
        const opened = await unlockEnvelope(text,access).catch(error => { _assertPreparation(preparation); throw error; });
        try {
          _assertPreparation(preparation);
          _parseRecoveryState(opened.stateJson);
          return opened;
        } catch (error) { disposeEnvelopeSession(opened.session); throw error; }
      }
      async function _draftFromJson(json, password, context, details = {}) {
        if (typeof password !== 'string' || password.length < 6) throw new Error('Passwort muss mindestens 6 Zeichen lang sein');
        _parseRecoveryState(json);
        _assertPreparation(context);
        const candidate = await createEnvelope(json,password,details.datasetId ? {datasetId:details.datasetId} : undefined)
          .catch(error => { _assertPreparation(context); throw error; });
        try {
          _assertPreparation(context);
          // Authenticate both independently wrapped keys before making a candidate available.
          for (const access of [{kind:'password',value:password},{kind:'recovery',value:candidate.recoveryCode}]) {
            const checked = await _openChecked(candidate.envelopeText,access,context);
            try { if (checked.stateJson !== json) throw _stateContentError(); }
            finally { disposeEnvelopeSession(checked.session); }
          }
          _assertPreparation(context);
          const metadata = inspectEnvelope(candidate.envelopeText);
          const entry = {...context,...details,kind:'draft',json,password,code:candidate.recoveryCode,
            envelopeText:candidate.envelopeText,session:candidate.session,confirmed:false,metadata};
          const token = _registerToken(entry);
          return {token,recoveryCode:candidate.recoveryCode,metadata,summary:_summary(json,metadata),replacesExisting:!!details.replacesExisting};
        } catch (error) { disposeEnvelopeSession(candidate.session); throw error; }
      }
      async function prepareRecoveryEnrollment({password,state} = {}) {
        const context = _capturePreparation();
        return _enqueueLocalStorageOperation(async () => {
          _assertPreparation(context);
          const record = _readLocalRecord();
          if (record.journal) throw _incompleteLocalStateError();
          if (record.fields[1] === 'v2-envelope') throw _recoveryError('RECOVERY_CONFIRMATION_REQUIRED');
          let json, migration = null;
          if (_completeCredentials(record.fields)) {
            const decrypted = await _decryptLocalRecord(record,password,context.generation);
            _assertPreparation(context);
            json = decrypted.json;
            migration = JSON.stringify({format:'notenverwaltung_enc_v1',salt:record.fields[1],payload:record.fields[0]});
          } else if (record.legacy !== null) {
            json = record.legacy;
            _parseRecoveryState(json);
            migration = await exportStateEncrypted(password,JSON.parse(json));
            _assertPreparation(context);
          } else json = JSON.stringify(state || createInitialState(new Date()));
          if (migration !== null && context.snapshot[5] !== null && context.snapshot[5] !== migration) throw _recoveryError('RECOVERY_MIGRATION_CONFLICT');
          return _draftFromJson(json,password,context,{migration,replacesExisting:false});
        },false);
      }
      async function prepareCredentialRotation({currentPassword,newPassword,reason} = {}) {
        const context = _capturePreparation();
        return _enqueueLocalStorageOperation(async () => {
          _assertPreparation(context);
          if (!['password-change','code-replacement'].includes(reason)) throw _recoveryError('RECOVERY_TOKEN_INVALID');
          const record = _readLocalRecord();
          if (record.journal || !_completeCredentials(record.fields)) throw _incompleteLocalStateError();
          if (record.fields[1] !== 'v2-envelope') {
            const decrypted = await _decryptLocalRecord(record,currentPassword,context.generation);
            _assertPreparation(context);
            const migration = JSON.stringify({format:'notenverwaltung_enc_v1',salt:record.fields[1],payload:record.fields[0]});
            if (context.snapshot[5] !== null && context.snapshot[5] !== migration) throw _recoveryError('RECOVERY_MIGRATION_CONFLICT');
            return _draftFromJson(decrypted.json,newPassword,context,{migration});
          }
          const opened = await _openChecked(record.fields[0],{kind:'password',value:currentPassword},context);
          try { return await _draftFromJson(opened.stateJson,newPassword,context,{datasetId:inspectEnvelope(record.fields[0]).datasetId}); }
          finally { disposeEnvelopeSession(opened.session); }
        },false);
      }
      async function openRecoverySource({source,text,code} = {}) {
        const context = _capturePreparation();
        return _enqueueLocalStorageOperation(async () => {
          _assertPreparation(context);
          if (!['local','backup'].includes(source)) throw _recoveryError('RECOVERY_TOKEN_INVALID');
          let candidates;
          if (source === 'local') {
            const record = _readLocalRecord();
            if (record.journal && record.legacy !== null && await _legacyHash(record.legacy,context.generation) !== record.journal.legacyHash) throw _incompleteLocalStateError();
            candidates = (record.journal ? [record.journal.after,record.journal.before,...(record.journal.previous || [])].filter(Boolean) : [record.fields])
              .filter(fields => fields[1] === 'v2-envelope').map(fields => fields[0]);
          } else candidates = [text];
          if (!candidates.length) throw _encryptedFormatError();
          for (let index=0;index<candidates.length;index++) {
            let opened;
            try { opened = await _openChecked(candidates[index],{kind:'recovery',value:code},context); }
            catch (error) { if (error.code === 'AUTH' && index < candidates.length-1) continue; throw error; }
            try {
              _assertPreparation(context);
              const metadata = inspectEnvelope(candidates[index]);
              const sourceToken = _registerToken({...context,kind:'source',json:opened.stateJson,metadata,source});
              return {sourceToken,summary:_summary(opened.stateJson,metadata)};
            } finally { disposeEnvelopeSession(opened.session); }
          }
        },false);
      }
      async function prepareRecoveredProtection(sourceToken,{newPassword} = {}) {
        const source = _tokenEntry(sourceToken,'source');
        return _enqueueLocalStorageOperation(async () => {
          _tokenEntry(sourceToken,'source');
          const draft = await _draftFromJson(source.json,newPassword,source,{
            datasetId:source.metadata.datasetId,
            replacesExisting:source.source === 'backup' && source.snapshot.slice(0,5).some(value => value !== null)
          });
          try { _tokenEntry(sourceToken,'source'); }
          catch (error) { cancelPreparedProtection(draft.token); throw error; }
          cancelPreparedProtection(sourceToken);
          return draft;
        },false);
      }
      async function confirmPreparedProtection(token,enteredCode) {
        const entry = _tokenEntry(token,'draft');
        const normalized = await normalizeRecoveryCode(enteredCode).catch(error => { _tokenEntry(token,'draft'); throw error; });
        _tokenEntry(token,'draft');
        if (normalized !== entry.code) throw _recoveryError('AUTH');
        entry.confirmed = true;
      }
      function commitPreparedProtection(token,options = {}) {
        return _enqueueLocalStorageOperation(async () => {
          const entry = _tokenEntry(token,'draft');
          if (!entry.confirmed) throw _recoveryError('RECOVERY_CONFIRMATION_REQUIRED');
          if (entry.replacesExisting && options.replaceExisting !== true) throw _recoveryError('RECOVERY_REPLACEMENT_REQUIRED');
          const original = entry.snapshot;
          const oldRecord = _readLocalRecord();
          const before = oldRecord.journal ? oldRecord.journal.after : (_completeCredentials(oldRecord.fields) ? oldRecord.fields : null);
          const after = [entry.envelopeText,'v2-envelope','1'];
          const migrationAfter = entry.migration || original[5] || (oldRecord.journal && oldRecord.journal.migrationAfter) || null;
          const previous = oldRecord.journal ? [oldRecord.journal.before,...(oldRecord.journal.previous || [])] : [];
          const journal = JSON.stringify({format:'notenverwaltung_credentials_v2',before,after,previous,
            legacyHash:await _legacyHash(original[3],entry.generation),migrationBefore:original[5],migrationAfter});
          _tokenEntry(token,'draft');
          // Consumption is irrevocable once persistence starts, including failed commits.
          _privateTokens.delete(token);
          clearTimeout(entry.timer);
          try {
            _writeStorageTransaction([
              {type:'set',key:STORAGE_KEY_JOURNAL,value:journal},
              ...(migrationAfter !== null ? [{type:'set',key:STORAGE_KEY_MIGRATION,value:migrationAfter}] : []),
              ...after.map((value,index)=>({type:'set',key:_storageKeys[index],value})),
              {type:'remove',key:STORAGE_KEY}
            ],entry.generation);
            const committedSnapshot = _confirmedSnapshot.slice();
            const committed = {...entry,snapshot:committedSnapshot};
            for (const access of [{kind:'password',value:entry.password},{kind:'recovery',value:entry.code}]) {
              const checked = await _openChecked(localStorage.getItem(STORAGE_KEY_ENC_PAYLOAD),access,committed);
              try { if (checked.stateJson !== entry.json) throw _stateContentError(); }
              finally { disposeEnvelopeSession(checked.session); }
            }
            _assertPreparation(committed);
            _writeStorageTransaction([{type:'remove',key:STORAGE_KEY_JOURNAL}],entry.generation);
            await Promise.resolve();
            _assertSession(entry.generation);
            const session = entry.session;
            entry.session = null;
            _replaceV2Session(session,entry.json);
            const receipt = Object.freeze({});
            _receipts.set(receipt,{generation:_sessionGeneration,snapshot:_confirmedSnapshot.slice()});
            return {receipt,metadata:entry.metadata};
          } catch (error) {
            if (_sessionGeneration === entry.generation) _lockSession();
            throw error;
          } finally {
            if (entry.session) disposeEnvelopeSession(entry.session);
            entry.session = entry.password = entry.code = entry.json = null;
          }
        });
      }
      async function verifyRecoveryCode(options) {
        const result = await openRecoverySource(options);
        try { _tokenEntry(result.sourceToken,'source'); return result.summary; }
        finally { cancelPreparedProtection(result.sourceToken); }
      }
      async function _importV2(text,access) {
        const context = _capturePreparation();
        const opened = await _openChecked(text,access,context);
        try { _assertPreparation(context); return _parseRecoveryState(opened.stateJson); }
        finally { disposeEnvelopeSession(opened.session); }
      }
      function importStateEncryptedWithRecovery(text,code) { return _importV2(text,{kind:'recovery',value:code}); }

      function isEncrypted() {
        return _isEncryptedFlagSet() || localStorage.getItem(STORAGE_KEY_JOURNAL) !== null;
      }

      // Lifecycle checks supplement the mandatory guards around every async write.
      try {
        ['beforeunload', 'pagehide'].forEach(type => window.addEventListener(type, () => { _lockSession(); }));
        const checkCurrent = () => {
          if (!_confirmedSnapshot || sessionCoordinator.getStatus() !== 'held') return;
          try { _assertSession(_sessionGeneration); } catch (error) {}
        };
        window.addEventListener('storage', event => {
          if (event.key === null || _storageKeys.includes(event.key)) checkCurrent();
        });
        window.addEventListener('focus', checkCurrent);
        window.addEventListener('pageshow', checkCurrent);
      } catch (e) {}

      return {
        loadState,
        getRecoveryStatus, getRecoveryMigrationBackup, prepareRecoveryEnrollment, prepareCredentialRotation,
        openRecoverySource, prepareRecoveredProtection, confirmPreparedProtection, commitPreparedProtection,
        cancelPreparedProtection, verifyRecoveryCode, importStateEncryptedWithRecovery,
        loadCurrentSessionState,
        saveState,
        flushPendingWrites,
        replaceState,
        resetState,
        enableEncryption,
        hasSessionPassword,
        encryptForBackup,
        // Sperrt die Sitzung manuell (löscht das Sitzungspasswort und dispatcht `sessionCleared`)
        lockSession: _lockSession,
        exportStateEncrypted,
        importStateEncryptedFromText,
        isEncrypted,
        changePassword,
        setSessionTimeoutMinutes,
        getSessionTimeoutMinutes,
        // Für portable Backups: Verschlüsselt mit eigenem Salt (Backup-Fallback)
        _encryptJsonWithSalt,
        // Für Backup-Import: Entschlüsselt raw payload
        _decryptPayload
      };
}
