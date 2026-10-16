import {
  _bufToBase64, _base64ToBuf, _deriveKey, _encryptJsonWithKey, _decryptWithKey
} from './encryption.js';

export function createStorage({ DomainModel, createInitialState, sessionCoordinator }) {
      const STORAGE_KEY = "notenverwaltung_v1_state"; // legacy / Klartext
      const STORAGE_KEY_ENC_FLAG = "notenverwaltung_v1_encrypted"; // '1' wenn verschlüsselt
      const STORAGE_KEY_ENC_PAYLOAD = "notenverwaltung_v1_state_enc"; // base64(iv)+":"+base64(ciphertext)
      const STORAGE_KEY_SALT = "notenverwaltung_v1_salt"; // base64 salt
      const STORAGE_KEY_JOURNAL = "notenverwaltung_v1_credential_journal";

      if (!sessionCoordinator || typeof sessionCoordinator.assertHeld !== 'function') {
        throw new TypeError('sessionCoordinator ist erforderlich.');
      }
      const _storageKeys = [STORAGE_KEY_ENC_PAYLOAD, STORAGE_KEY_SALT, STORAGE_KEY_ENC_FLAG, STORAGE_KEY, STORAGE_KEY_JOURNAL];
      let _confirmedSnapshot = null;
      const _pendingWrites = new Set();

      // Zwischenspeicher im Arbeitsspeicher für das Sitzungspasswort
      let _sessionPassword = null;
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
        if (!_sessionPassword) return;
        const generation = _sessionGeneration;
        _inactivityTimerId = setTimeout(() => {
          if (generation !== _sessionGeneration) return;
          try { _lockSession(); } catch (e) {}
        }, _inactivityTimeoutMs);
      }

      function _resetInactivityTimer() {
        if (!_sessionPassword) return;
        _startInactivityTimer();
      }

      function _discardSessionKeyCache() {
        _sessionGeneration += 1;
        _sessionKeyCache = null;
      }

      function _replaceSessionSecrets(password, key, saltB64) {
        _sessionGeneration += 1;
        _sessionPassword = password;
        _sessionKeyCache = key && saltB64 ? {
          generation: _sessionGeneration,
          saltB64,
          keyPromise: Promise.resolve(key)
        } : null;
      }

      function _advanceSessionGenerationPreservingSecrets() {
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
          if (!journal || journal.format !== 'notenverwaltung_credentials_v1' ||
              !_completeCredentials(journal.after) ||
              !(journal.before === null || _completeCredentials(journal.before)) ||
              !(journal.legacyHash === null || (typeof journal.legacyHash === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(journal.legacyHash)))) {
            throw _incompleteLocalStateError();
          }
          const before = journal.before || [null, null, null];
          if (!fields.every((value, index) => value === before[index] || value === journal.after[index]) ||
              (snapshot[3] !== null && journal.legacyHash === null)) throw _incompleteLocalStateError();
          _decodeEncryptedParts(journal.after[0], journal.after[1]);
          if (journal.before) _decodeEncryptedParts(journal.before[0], journal.before[1]);
          return { fields, journal, legacy: snapshot[3] };
        }
        if (fields.some(value => value !== null) && !_completeCredentials(fields)) throw _incompleteLocalStateError();
        if (_completeCredentials(fields)) _decodeEncryptedParts(fields[0], fields[1]);
        return { fields, journal: null, legacy: snapshot[3] };
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
        sessionCoordinator.assertHeld();
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
              if (index === journalIndex && !staged.slice(0, 4).every((value, i) => value === original[i])) continue;
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
        const candidates = [record.journal.after, record.journal.before].filter(Boolean);
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
      async function loadState() {
        let expectedGeneration = _sessionGeneration;
        _beginSnapshot(expectedGeneration);
        const record = _readLocalRecord();
        if (record.journal && record.legacy !== null &&
            await _legacyHash(record.legacy, expectedGeneration) !== record.journal.legacyHash) throw _incompleteLocalStateError();
        if (record.journal || _completeCredentials(record.fields)) {

          // Nur Authentifizierungsfehler öffnen die Passwort-Wiederholung.
          // Inhaltsfehler gehen an den Startpfad zur sicheren Sitzungsbereinigung.
          while (true) {
            const alreadyUnlocked = !!_sessionPassword;
            const pwd = _sessionPassword || await window.promptPassword({ message: 'Der gespeicherte Zustand ist verschlüsselt. Bitte Passwort eingeben:' });
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
            const state = _parseStoredState(decrypted.json);
            if (decrypted.recoveredFields) {
              await _enqueueLocalStorageOperation(() => {
                _assertSession(expectedGeneration);
                _writeStorageTransaction([
                  ...decrypted.recoveredFields.map((value, index) => ({ type: 'set', key: _storageKeys[index], value })),
                  { type: 'remove', key: STORAGE_KEY },
                  { type: 'remove', key: STORAGE_KEY_JOURNAL }
                ], expectedGeneration);
              });
              _assertSession(expectedGeneration);
            }
            if (!alreadyUnlocked) {
              _replaceSessionSecrets(pwd, decrypted.key, decrypted.saltB64);
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
          if (!_isEncryptedFlagSet() || !_sessionPassword) {
            throw new Error('Die Anwendung muss verschlüsselt und entsperrt sein, um den bestätigten Zustand zu lesen.');
          }
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

      function _enqueueExclusiveStateReplacement(state) {
        let json;
        try {
          json = JSON.stringify(state);
        } catch (error) {
          return Promise.reject(error);
        }
        const expectedGeneration = _sessionGeneration;
        return _enqueueLocalStorageOperation(async function () {
          await _saveStateNow(json, expectedGeneration);
          _assertSession(expectedGeneration);
          _advanceSessionGenerationPreservingSecrets();
          return state;
        });
      }

      function replaceState(state) {
        try { _assertSession(_sessionGeneration); } catch (error) { return Promise.reject(error); }
        if (!_isEncryptedFlagSet() || !_sessionPassword) {
          return Promise.reject(new Error('Die Anwendung muss entsperrt und verschlüsselt sein.'));
        }
        return _enqueueExclusiveStateReplacement(state);
      }

      function resetState() {
        try { _assertSession(_sessionGeneration); } catch (error) { return Promise.reject(error); }
        if (!_isEncryptedFlagSet() || !_sessionPassword) {
          return Promise.reject(new Error('Die Anwendung muss entsperrt und verschlüsselt sein.'));
        }
        const fresh = createInitialState(new Date());
        return _enqueueExclusiveStateReplacement(fresh);
      }

      async function _saveStateNow(stateOrJson, expectedGeneration) {
        const json = typeof stateOrJson === 'string' ? stateOrJson : JSON.stringify(stateOrJson);
        _assertSession(expectedGeneration);
        if (!_isEncryptedFlagSet()) {
          throw new Error('Verschlüsselte Speicherung ist nicht eingerichtet. Es wurde nichts gespeichert.');
        }
        if (!_sessionPassword) {
          throw new Error('Kein Sitzungspasswort vorhanden. Es wurde nichts gespeichert.');
        }
        const password = _sessionPassword;
        const encrypted = await _encryptLocalJson(json, password, expectedGeneration);
        _writeStorageTransaction([
          { type: 'set', key: STORAGE_KEY_ENC_PAYLOAD, value: encrypted.payload },
          { type: 'set', key: STORAGE_KEY_ENC_FLAG, value: '1' },
          { type: 'remove', key: STORAGE_KEY }
        ], expectedGeneration);
        return true;
      }

      // Aktiviert Verschlüsselung: verschlüsselt aktuellen state und speichert
      async function enableEncryption(password, state) {
        _assertSession(_sessionGeneration);
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
        return !!_sessionPassword;
      }

      // Verschlüsselt JSON-Daten mit dem Session-Passwort für Backup-Zwecke.
      // Das Passwort verlässt dadurch nicht das Storage-Modul.
      async function encryptForBackup(json) {
        if (!_sessionPassword) throw new Error('kein Sitzungspasswort vorhanden');
        const generation = _sessionGeneration;
        _assertSession(generation);
        return _guardAsync(_encryptJsonWithSalt(json, _sessionPassword), generation);
      }

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
