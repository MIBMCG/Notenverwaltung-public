# Password Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Vorab gesicherter Offline-Code ermöglicht vollständige Wiederherstellung
lokaler Notendaten und neuer Backups bei vergessenem Passwort.

**Architecture:** V2-Envelope mit zufälligem Datenschlüssel und zwei unabhängigen
verschlüsselten Zugängen. Bestehende Storage-Transaktionen schützen bestätigte
Übergänge; ein separates UI-Modul orchestriert Vorbereitung, Rückprüfung und
Commit. V1 bleibt ohne ausdrückliche Nachrüstung unverändert nutzbar.

**Tech Stack:** JavaScript-ES-Module, Web Crypto, LocalStorage, bestehender
DOM-/Node-Testharness und esbuild; keine neuen Abhängigkeiten.

**Spec:** `docs/superpowers/specs/2026-10-16-password-recovery-design.md`

## Global Constraints

- Arbeitsort bestehender isolierter Worktree `Notenverwaltung-public-password-hardening`, Branch `codex/password-recovery`, geprüfte Härtungsbasis `289e7ae`.
- Nur synthetische Testdaten; keine realen Backups/Passwörter lesen, keine Browserprofile ändern.
- Kein Push, Merge, Release oder Versionssprung. Root koordiniert Builds, Register-Hashes und Commits.
- Legacy-Kryptografie unverändert; V2 AES-256-GCM/128-Bit-Tag/96-Bit-IV, Passwort PBKDF2-SHA256 exakt 600000 Iterationen, Salt16Byte mit UTF8-Präfix `notenverwaltung:password-wrap:v2\0`.
- Code aus 256 Zufallsbits, RFC4648-Base32 (52 Zeichen) plus vier Prüfsummenzeichen gemäß Spec, NV2-Präfix und Vierergruppen.
- V2-Envelope höchstens20MiBText; Nutzlast höchstens10MiBUTF8. Vor KDF prüfen. Keine unbekannten Formate still reparieren.
- V2-Sessions, Quelltokens und Vorbereitungstokens sind opaque; keine neuen Debuggetter für Schlüssel, Passwörter oder Codes.
- Keine zusätzliche Klartextkopie in Storage/Journal/Backup/Logs. UI zeigt Code nur während Einrichtung/Erneuerung, Lock/Cancellation bereinigen Ansichten und Token.
- Neue Einrichtung verpflichtend mit Rückprüfung, alte Bestände freiwillig nachrüsten. Passwort-/Codewechsel und Recovery rotieren DEK/Code/Generation. Import behält lokalen Schutz.
- Vorbereitungen sind schreibfrei; Commit nach bestätigtem Code bindet ursprünglichen Snapshot und Generation und prüft Rücklesen. Jeder async-Abschluss prüft Besitzer/Generation erneut.
- Noch vorhandene13 Dateisystem-Testfehler sind auf der unveränderten Basis bestätigt; keine Produktänderung zur Umgehung. Native Safari-Abnahme separat ausweisen.

## Review Focus

1. Veränderte nicht benutzte Schlüsselhülle: beide Zugänge müssen Manipulation entdecken (Task1).
2. Normales Speichern zwischen Codeanzeige und Rückprüfung: alten Entwurf ablehnen, keine Änderungen überschreiben (Task2).
3. Crash nach nur einem Teil des Übergangs und erneuter Crash bei Recovery: vollständiger bestätigter Kandidat bleibt lesbar (Task2).
4. Authentifiziertes `null`/`{}`/fehlerhafte Rohdaten: niemals als erfolgreich geretteten leeren Bestand übernehmen (Task2).
5. Gesperrter Start und Codeansicht während Lock/Ownerverlust: Recovery ohne normales Passwort erreichbar, keine Geheimnisse oder verspätete Session-Übernahme (Task3).

## Task 1: Selbstenthaltendes Recovery-Envelope

**Files:** Create `src/infrastructure/recovery-envelope.js`, `tests/recovery-envelope.test.js`.
Keine Änderung an bestehenden Produktdateien oder generiertem HTML.

**Interfaces:** Export exakt diese Funktionen:

```ts
type Access = {kind:"password"|"recovery", value:string};
type Info = {version:2,datasetId:string,generationId:string,createdAt:string,savedAt:string};
createEnvelope(stateJson:string,password:string,options?:{datasetId?:string})
  : Promise<{envelopeText:string,session:OpaqueSession,recoveryCode:string}>;
unlockEnvelope(envelopeText:string,access:Access)
  : Promise<{stateJson:string,session:OpaqueSession}>;
reencryptState(session:OpaqueSession,stateJson:string):Promise<string>;
inspectEnvelope(envelopeText:string):Info;
normalizeRecoveryCode(input:string):Promise<string>; // kanonisches Druckformat
disposeEnvelopeSession(session:OpaqueSession):void;
```

Module-private WeakMap, eingefrorene Tokens, immutable authentifizierte Hüllen.
`inspectEnvelope` validiert Schema, keine Behauptung von Authentifizierung.
Dispose macht auch bereits wartende Operationen ungültig. stateJson bleibt Text;
fachliche Prüfung folgt erst in Storage. createdAt ist Generation, savedAt
konkrete Nutzlast. AAD und Schema exakt aus Spec. Fehlercodes:
`ENCRYPTED_FORMAT_INVALID`, `RECOVERY_CODE_INVALID`, `AUTH`,
`CRYPTO_OPERATION_FAILED`, `RECOVERY_SESSION_INVALID`.

- [x] RED: beide Zugänge und Unicode liefern exakt den Ursprungstext; V1-Vektoren bleiben unverändert; falsches Passwort/Code liefert AUTH, falsche Code-Prüfsumme RECOVERY_CODE_INVALID; unbekannte Felder/Version/KDF/überlange Felder vor deriveKey abgewiesen.
- [x] RED: Manipulation jedes Headers, jeder Hülle einschließlich unbenutzter Hülle und Nutzlast scheitert; umgeordnete JSON-Schlüssel sind semantisch gleich; kanonische Base64-/Code-Paddingbits geprüft; ungepaarte Surrogate scheitern.
- [x] GREEN: Funktionen implementieren, unabhängigen festen Entschlüsselungsvektor mit Node-crypto statt Produktionshelfern verifizieren, normale Saves mit Session ohne Code/Passwort und frischen IVs; neue Generation enthält andere Schlüssel.
- [x] Lifecycle: fremde/verworfene Tokens und Dispose während Crypto scheitern ohne Secrets nach außen. Verschiedene Sessions isolieren.
- [x] Run `node --test tests/recovery-envelope.test.js tests/encryption.test.js`; Ergebnis und RED-Beleg im Taskbericht. Root reviewed und committet nur diese Dateien.

## Task 2: Speicherübergänge, Recovery und Backups

**Files:** Modify `src/infrastructure/storage.js`; Create `tests/storage-recovery.test.js`.
Task1-API verwenden, bestehende Härtungs-/Crosswindow-Schutzmechanismen behalten.

**Interfaces:** Zusätzlich zu unverändert kompatiblen bisherigen Methoden:

```ts
getRecoveryStatus():{enabled:boolean,metadata:Info|null,migrationBackupAvailable:boolean,hasLocalData:boolean};
getRecoveryMigrationBackup():string|null; // ausschließlich verschlüsselt
prepareRecoveryEnrollment({password:string,state?:State}):Promise<Draft>;
prepareCredentialRotation({currentPassword:string,newPassword:string,
  reason:"password-change"|"code-replacement"}):Promise<Draft>;
openRecoverySource({source:"local"|"backup",text?:string,code:string})
  :Promise<{sourceToken:OpaqueSource,summary:Summary}>;
prepareRecoveredProtection(sourceToken:OpaqueSource,{newPassword:string}):Promise<Draft>;
confirmPreparedProtection(token:OpaqueDraft,enteredCode:string):Promise<void>;
commitPreparedProtection(token:OpaqueDraft,options?:{replaceExisting?:boolean})
  :Promise<CommitResult>;
cancelPreparedProtection(token:OpaqueDraft|OpaqueSource):void;
verifyRecoveryCode({source:"local"|"backup",text?:string,code:string}):Promise<Summary>;
importStateEncryptedWithRecovery(text:string,code:string):Promise<State>;
// Draft={token,recoveryCode,metadata:Info,summary:Summary,replacesExisting:boolean}
// Summary={students:number,courses:number,assessments:number,metadata:Info|null}
// CommitResult={receipt:OpaqueReceipt,metadata:Info}
loadState(options?:{onRecoveryRequested?:()=>Promise<CommitResult|null>}):Promise<State>;
```

**Storageformat:** V2-Tripel `[envelopeText,"v2-envelope","1"]` im bisherigen
Payload-/Salt-/Flag-Satz, kein zweiter aktiver Datensatz. Journal-V1 weiter lesen;
V2-Übergang mit formatabhängig vollständigen Vorher-/Nachher-Kandidaten in neuem
Journalformat. Erst nach bestätigtem Code Journal schreiben. Zusätzlicher
`notenverwaltung_v2_migration_backup`-Key in allen Snapshots/Events; enthält einmalig
verschlüsselte Alt-Sicherung, keine Raw-Klartextkopie. Bei Legacy-Klartext vor
Migration eine verschlüsselte Alt-Kopie erzeugen. Vorhandene abweichende Alt-Kopie
nicht still überschreiben. Reset entfernt diese Alt-Kopie bei erfolgreichem Reset.

**Transitions:** private Tokens binden Generation UND Originalsnapshot über die
gesamte Dialogdauer. Prepare schreibt nichts. Enrollment `state` nur für bisher
unverschlüsselte Einrichtung; bestehende Verschlüsselung erst mit eingegebenem
Passwort authentifizieren und tatsächlichen gespeicherten State übernehmen.
Old/new Gegenprüfung über beide Zugänge vor Commit. Commit prüft die intern
bestätigte Rückeingabe, unverbrauchten Token, Ablauf und Besitzer. Backup-Recovery
mit vorhandenem Ziel verlangt `replaceExisting:true`; lokale Recovery nicht.
Journal/Tripel schreiben, rückgelesenen Inhalt über beide Zugänge vergleichen,
erst dann Journal entfernen und Session publizieren. Fehler nach begonnenem
Commit erhalten einen vollständigen Wiederherstellungskandidaten und melden
keinen Erfolg; normale/fremde Rollback-Regeln beachten. Keine pauschale Löschung.
Entwürfe und Quelltokens verfallen bei Lock/Timeout/Ownerverlust, spätestens nach
15 Minuten; auch im gesperrten Recoveryablauf. Verbrauchte Tokens erneut ablehnen.

**Session/Import:** private V2-Session ohne dauerhaftes Passwort/Code. Alter Name
`hasSessionPassword` bleibt kompatibel als "entsperrt". Timer, Save, CurrentSession,
Reset, Replace, Lock und Export behandeln V2. `encryptForBackup` übernimmt Hüllen
und erzeugt neue Nutzlast mit savedAt. `importStateEncryptedFromText` versteht V2
per Passwort, neue Methode per Code; temporäre Importsession immer verwerfen.
Legacy-Direktsetup/-Passwortwechsel darf V2 weder downgraden noch Rückprüfung
umgehen (RECOVERY_CONFIRMATION_REQUIRED). Alte V1-APIs bleiben nutzbar.

**Startup:** loadState übergibt an promptPassword optional `onRecovery`. Dieser
Callback ruft onRecoveryRequested auf und akzeptiert nur einen von dieser Storage-
Instanz ausgestellten aktuellen CommitResult.receipt. Er liefert true nur bei
gültigem neuen Commit, false bei Abbruch. promptPassword bleibt String/null.
Nach Recovery-true nicht den alten Passwort-/Generationpfad fortsetzen, sondern
aktuelle bestätigte Sitzung neu lesen. UI kann kein frei gesetztes Boolean zur
Sessionübernahme nutzen. Abbruch erhält gesperrten Ausgangsbestand.

**Validierung:** vor reparierender Domainnormalisierung Rootobjekt +
validateRawTermResults/validateRawUpperSecContexts/validateImportedState verwenden,
anschließend ensureStateShape und erneut validieren. Recovery aus Datei übernimmt
den vollständigen Dateiinhalt samt Einstellungen; unbekannter gesperrter Zielstand
kann nicht still zur Quelle lokaler Halbjahreseinstellungen werden.

- [x] RED: neues Setup mit verpflichtender Rückprüfung, Migration V1 und Plain-Legacy, Passwort-/Codewechsel, beide Recoveryquellen; kein Write vor Commit; falscher Code/gefälschter oder verbrauchter Token verhindert Commit.
- [x] RED: eigener Save/fremder Write/Lock/Ownerverlust während Prepare/Confirm/Commit verwirft Entwurf; angemessene FIFO-/Generationtests, besonders jede letzte await-Grenze.
- [x] GREEN: Implementieren; Code/Passwort/rohe Schlüssel tauchen nicht in Snapshots, Journal oder Migrationskopie auf; Codeprüfung schreibfrei, V2-Import erhält lokalen Schutz.
- [x] Crash/Quota: jeden Setup-/Migrations-/Rotation-/Recovery-Schreibpräfix neu starten; zweiter Fehler beim Rollback; Quota der Altkopie vor Aktivwechsel; mutate-then-throw und Rücklesefehler erhalten alte oder neue bestätigte Daten.
- [x] Fachlich: authentifiziertes `null`, `{}` und defekte Rohfelder ablehnen; alte Backups bleiben nach Rotation mit alten Geheimnissen lesbar, neue nicht; normaler Reset entfernt Migration-Altbestand.
- [x] Run `node --test tests/storage-recovery.test.js tests/storage-hardening.test.js tests/storage.test.js tests/storage-cross-window.test.js tests/backup-consistency.test.js`; RED/GREEN und Grenzen berichten. Taskreview vor Abschluss.

## Task 3: Bedienung, Auslieferungsartefakt und Anleitung

**Files:** Create `src/ui/recovery-dialog.js`, `tests/recovery-ui.test.js`.
Modify `src/legacy/application.js`, bestehende relevante UI-Tests bei notwendiger
neuer Bedienfolge, `docs/KURZANLEITUNG.md` und `SECURITY.md`.
Root aktualisiert danach `Notenverwaltung.html`, Source-Hash-Register und dessen
Dateiliste in `scripts/verify-findings-register.js`.

**Interfaces:** Modul exportiert `createRecoveryUi({window,document,Storage,
downloadText})`. Controller bietet `enroll({password,state})`,
`rotate({currentPassword,newPassword,reason})`, `recover()`, `checkCode()`,
`dispose()`; Methoden liefern CommitResult oder null. Exakt Storage-APIs aus Task2.
Controller ist vor Appinit verfügbar, keine Abhängigkeit auf Kurs-/Dashboard-State.
Alle Dialoge verwenden textContent/DOM-APIs, keine untrusted HTML-Interpolation.

- [x] RED: promptPassword mit optionalem onRecovery zeigt "Zugang wiederherstellen", true beendet String/null-Dialog, false bleibt zur Eingabe zurück; bestehende Passwortdialogtests erhalten.
- [x] RED: vollständiger neuer Setup mit Passwortdoppelprüfung, Codeanzeige, Druckansicht ohne Notendaten, vollständiger Rückeingabe, Abbruch/falscher Code schreibfrei. Beide vorhandenen Setuphandler verwenden denselben Controller.
- [x] GREEN: eigenständigen Dialogcontroller implementieren; Aktionen sperren Doppelclicks; Code/Textfelder/Druckfenster bei Abschluss, Abbruch, Lock, Pagehide und Ownerverlust entfernen. Dialog kennt keine DEKs oder interne Tokensinhalte; Timer aus Task2 beachten und Fehlermeldungen verständlich halten.
- [x] Start-Recovery in _initOwned über Storage.loadState({onRecoveryRequested:...}) und Sperrbildschirm anbieten; zuerst Fensterbesitz erwerben. Lokal oder Datei wählbar; vollständige Authentifizierung vor Summary, savedAt als Sicherungszeit anzeigen, vorhandenes Ziel ausdrücklich ersetzen bestätigen. Neues Passwort doppelt, neuer Code bestätigt, danach normaler UI-Start.
- [x] Einstellungen: Status/Datum/Kennung ohne Code; bei V1 Nachrüstung deutlich anbieten ohne Zwangsmodal bei jedem Start, bei V2 "Code prüfen", "Code ersetzen". Vor entsperrten Übergängen persistenceBoundary.capture() und UI-epoch/exclusiveOperation benutzen. Nach erfolgreicher Einrichtung neues Backup anbieten. Erhaltene verschlüsselte Altkopie zum Download anbieten.
- [x] Passwortwechsel über Rotationcontroller; Codeverlust+bekanntes Passwort über Codeersatz. Hinweise auf neue Zugangsdaten und unveränderte alte Archive. V2-Migration erklärt vorab, dass ältere HTML diese neuen Daten nicht lesen kann.
- [x] Normaler Backupimport erkennt V2 vor V1/Klartext und bietet Passwort oder Code; unbekannte verschlüsselte Formate ablehnen. Bestehende Merge-/Ersetzen-Bestätigungen und lokale Schutzgeneration erhalten. Header-/Archivbackup automatisch V2 über Storage.encryptForBackup.
- [x] Anleitung um Einrichtung/Aufbewahrung/Recovery/Prüfen/Wechsel/Altdateien/Verlust beider Geheimnisse ergänzen; keine behauptete Mac-Abnahme, keine Schuldzuweisung im Supportfall.
- [x] Root baut `npm run build`, aktualisiert Source-Dateiliste und aktuelle Hashes ohne historische Findingstatus zu ändern. Test im tatsächlich gebauten HTML: Setup→Backup→Lock→Code-Recovery, Datei-Recovery ohne bekanntes lokales Passwort, Codeersatz/Passwortwechsel, V1-Import und unveränderte lokale Credentials beim Import.
- [x] Gesamtabnahme durch Root: `npm test`, `npm run check`, `npm run verify:artifact`, `npm run check:findings`, `npm run check:doc-links`, `git diff --check`; unabhängiges Gesamt-Review, Findings korrigieren. Nur lokale Übergabe, native Safari-/Browserprüfung offen kennzeichnen.

## Abschluss am 16.10.2026

Implementierung und technische Prüfungen abgeschlossen; Ergebnisse und offene
Praxisgrenzen stehen im [Implementierungsnachweis](../../quality/password-recovery-verification.md).
