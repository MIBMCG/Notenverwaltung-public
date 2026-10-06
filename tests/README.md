# Tests

Entwicklungsseitige Testsuite. Die ausgelieferte `Notenverwaltung.html` bleibt
unveraendert und buildfrei; diese Tests lesen die Datei nur.

## Ausfuehren

```bash
npm test              # alle Tests
npm run test:tap      # mit Zaehlern fuer pass/fail/todo
npm run check         # nur der Syntaxcheck
```

Die beiden vollständigen Testbefehle verwenden `tests/run-tests.js`. Der
plattformunabhängige Starter übergibt nur die `*.test.js`-Dateien direkt in
`tests/` an Node. Dadurch verändern verschachtelte lokale Kopien oder fremde
Testdateien außerhalb dieses Ordners die Projektbilanz nicht.

Vor dem Testlauf die gepinnten Abhängigkeiten mit `npm ci` installieren. Benötigt wird Node >=20 (aktuell
verifiziert mit Node v22.23.2) fuer `node:test` und die eingebaute WebCrypto.

## Aufbau

Die zustandslosen CSV-Formathelfer aus `src/transfer/csv-format.js` und die
CSV-Importregeln aus `src/transfer/csv-import-rules.js` werden als echte
ES-Modulgraphen vor dem `DomainModel` in `tests/harness/load.js` gebuendelt.
`Storage` wird dort als echter ES-Modulgraph aus
`src/infrastructure/storage.js` nach dem `DomainModel` erzeugt. Die
CSV-Import/-Exportverbraucher bleiben für ihre DOM-nahe Einbettung über
Zeilenmarker aus Quelle beziehungsweise gebautem HTML extrahiert;
`csv-bundle.test.js` führt sie mit den tatsächlichen CSV-Helfern und
Importregeln sowie den aus dem Artefakt extrahierten Konstanten aus. Nur `UiShell` bleibt eine ueber Zeilenmarker aus
`Notenverwaltung.html` extrahierte IIFE. Die Sandbox stellt Stubs fuer
`localStorage` und `window` bereit; Krypto wird bewusst nicht gestubbt, damit die
Verschluesselungstests echt sind. `setTimeout`/`clearTimeout` sind traege Stubs
ohne Wirkung, daher laesst sich das Inaktivitaets-Sperrverhalten dort nicht testen.

`UiShell` ist DOM-gebunden und wird nicht geladen; einzelne freistehende Helfer
daraus lassen sich ueber `extractFunction` einzeln pruefen.

`archive-ui.test.js` führt den echten Kursübersichts-Renderer mit synthetischen
Archivdaten aus. Der M28-Fall stellt sicher, dass eine nur über einen Score
referenzierte Person in der sichtbaren Archiv-Personenzahl enthalten ist.

`school-year-dialog.test.js` führt den echten Schuljahreswechsel-Assistenten
mit einem kleinen DOM-Testmodell aus. Die sieben Fälle sichern modale Semantik,
Anfangsfokus, Escape und Hintergrundklick mit Fokuswiederherstellung, die
zyklische Tab-Reihenfolge, den Aufräumpfad der Sitzungssperre sowie Escape und
Fokus beim echten verschachtelten Archivangaben-Dialog und die Fokusübergabe an
den nach erfolgreichem Neurendern ersetzten Auslöser.

`privacy.test.js` prueft die Session- und Debug-Schutzfunktionen aus `UiShell`.
Neben kleinen Helfertests werden der echte Statistik-Renderer, die tatsaechlich
exportierten Debug-Hooks, der echte Archivmetadaten-Dialog und der echte
`render()`-Sperrzweig mit einem kleinen DOM-Doppel ausgefuehrt. Zusammen mit
`load.test.js` und `grading.test.js` sichern vier Niedrig-Regressionen, dass
normale Produktpfade keine internen Zustandsdaten protokollieren, unvollstaendige
Objekte nicht an einer Logzeile scheitern und nur `DEBUG_PREVTERM` das
Berechnungs-Debuglogging aktiviert.

## Bekannte Fehler als `todo`

Tests, deren Titel mit einer Befund-ID aus `docs/quality/current-findings.json` beginnt
und die `{ todo: '<ID>' }` tragen, beschreiben das **beabsichtigte** Verhalten
eines noch offenen Befunds. Sie melden sich als `# TODO` und zaehlen nicht als
Fehlschlag, sodass die Suite gruen bleibt.

Wird ein Befund behoben, ist das `todo` aus dem betreffenden Test zu entfernen.
Der Test muss dann gruen sein. Ein `todo`-Test, der unerwartet besteht, ist ein
Hinweis darauf, dass der Befund bereits behoben wurde.

Seit Wave 9 sind die letzten drei `todo` fuer M22/M23 aktiviert und gruen. Der
aktuelle vollstaendige Lauf enthaelt keine offenen `todo` mehr.

## Testdaten

Ausschliesslich synthetisch. Keine echten Namen, Geburtsdaten, Noten oder
entschluesselten Zustaende.

## Welle 8: M32

`term-results.test.js` deckt das kursbezogene M32-Feld `termResults`, Migration,
Grenzen 0--15, kanonische Halbjahre, Loeschen und Archivreferenzen ab. Den
verschluesselten M32-Rundlauf deckt `storage.test.js` ab. Import/Merge,
Notentabelle und Ausgabewege decken `merge.test.js`, `gradesheet.test.js` und
`reporting.test.js` ab. Ein frueherer Wave-8-Zwischenstand umfasste 126 Tests:
123 bestanden, 0 regulaere Fehler und 3 unveraenderte M22/M23-`todo`. Nach
Abschluss von Wave 8 waren es 142 Tests: 139 bestanden, 0 regulaere Fehler und
3 M22/M23-`todo`.

## Welle 9: M22/M23

`storage.test.js` prueft nun die Mindestlaenge beim Passwortwechsel, echte
Salt-Rotation, Datenzugriff nur mit dem neuen Passwort, ein fehlendes
Sitzungspasswort nach gescheiterter Ersteinrichtung sowie Rollback bei
Payload- und Salt-Schreibfehlern. Der historische Wave-9-Abschlusslauf umfasst
145 Tests: 145 bestanden, 0 Fehler und 0 `todo`. Portable Befehle sind
`npm run check` und `npm test`.

## Welle 10: deterministischer Testumfang

`package-scripts.test.js` prüft, dass `npm test` und `npm run test:tap` den
plattformunabhängigen Starter `tests/run-tests.js` verwenden. Dieser übergibt
ausschließlich die Testdateien direkt in `tests/` an Node. Der historische
Wave-10-Lauf umfasste 146 Tests: 146 bestanden, 0 Fehler und 0 `todo`. Der
historische Vor-Task-7-Wave-11-Lauf umfasste **250 Tests: 250 bestanden, 0
Fehler und 0 `todo`** (identisch über beide Starter).

## Welle 11: M31 – Sek-II-Kurskontext

`uppersec-context.test.js` prüft die migrationssicheren Kurs- und Einschreibungsfelder, die GK/LK-Q1--Q4-Matrix, die Q4-Checkbox sowie Nachfolgeplanung. `grading.test.js` und `terms.test.js` sichern die personenspezifische Q4-Wertung, die strikte Sek-II-Termtrennung und die Sek-I-H2-Jahreswertung ab. `gradesheet.test.js`, `merge.test.js`, `reporting.test.js` und `storage.test.js` decken Sperre, Persistenz, Import, Archiv-Snapshot sowie Detail-/PDF-/Excel-/CSV-Semantik ab.

Der lokale Modus `?syntheticRegression=1` ergänzt diese Node-Prüfungen ohne Schreiben in den produktiven State: Altkursmigration, GK Q3 und gemischtes Q4, LK Q1--Q4, gesperrte Q4-Klausurzellen, verschlüsselter Checkbox-Rundlauf, Termsemantik, Schuljahreswechsel und Archiv-Snapshot. Die sichtbare Browserabnahme auf frischem Ursprung bleibt für Wave 11 ein separater, controllergeführter Nachweis.

Der historische Vor-Task-7-Browserlauf auf `localhost:8769` bestand mit
**49/49** Fällen und ohne Konsolenfehler oder -warnungen. Das Legacy-Raw-Backup
`iv:ciphertext` mit vorhandenem lokalem Salt ist weiterhin nicht praktisch
abgedeckt.

Der historische Vor-Task-8-Lauf nach `c9c6b8f` und `12badee` umfasste
**256/256** in beiden Startern sowie **1/1** Syntaxprüfung. Der verbindliche
aktuelle Lauf auf dem Stand `2708271` umfasst **263/263** in beiden Startern
und **1/1** Syntaxprüfung. Die frische Browserabnahme auf `localhost:8894`
bestand mit **49/49** Fällen (acht Wave-11-Fälle), ohne
`error`/`warn`/`warning`-Logs; `largeStateNormalizeMs` betrug 10,8.

### Konsolidierter Wave-11-Stand

Die drei Dokumentations-/Review-Commits `0e42349`, `22a065b` und `2708271`
sind im aktuellen Branch berücksichtigt. Die drei Re-Review-Findings sind
adressiert; neue Critical- oder Important-Folgeschäden wurden nicht gefunden.
Offen bleiben ausschließlich das praktisch nicht getestete Legacy-Raw-Backup
`iv:ciphertext` mit vorhandenem Salt sowie Drucklayout/Zielbrowser.
