# Passwortwiederherstellung – Implementierungsnachweis

Stand: 16.10.2026. Lokale, unveröffentlichte Weiterentwicklung auf Basis der
öffentlichen Version 1.6.0 (`09b8b42`) und der geprüften Speicherhärtung (`289e7ae`).
Produktstand: `684dbc9a88aabb7d27bf90fac55f7ffde333c573`, Branch
`codex/password-recovery`. Die nachfolgende Dokumentation und Entfernung einer
überzähligen Test-Leerzeile ändern das geprüfte Programm nicht.

## Umgesetzt

Neue Einrichtungen sichern und bestätigen einen separaten Wiederherstellungscode.
Bestehende zugängliche Bestände können ihn freiwillig nachrüsten. Lokale Daten und
neue Backups lassen sich mit ihrem Code wiederherstellen; dabei werden ein neues
Passwort und ein neuer bestätigter Code eingerichtet. Passwortwechsel und Codeersatz
erneuern auch Datenschlüssel und Generation. Ein normaler Import behält den
lokalen Schutz. Die [Kurzanleitung](../KURZANLEITUNG.md) beschreibt die Bedienung.

Vorbereitung und Codeprüfung schreiben keine Daten. Erst die vollständige
Rückeingabe des Codes erlaubt die Übernahme. Journal, Rücklesen über beide Zugänge,
Snapshot-/Fenster-/Sitzungsprüfungen und eine verschlüsselte Migrationskopie schützen
den Übergang. Bestehende Sicherungen behalten ihre bisherigen Zugangsdaten.
Ein gesperrter Altbestand ohne zuvor eingerichteten Code wird dadurch nicht
nachträglich entschlüsselbar.

## Verifikation

Alle Prüfungen verwendeten synthetische Daten. Der finale Gesamtlauf am genannten
Produktstand ergab **1.482 Tests: 1.469 bestanden, 13 fehlgeschlagen, keine
übersprungenen Tests** (137,22 Sekunden; Prozess-Exit 1).

Die 13 Fehler gehören ausschließlich zu `tests/public-snapshot.test.js`:
OneDrive-Reparsepunkte werden absichtlich abgewiesen, außerdem fehlen in dieser
Umgebung Symlinkrechte. Die vollständige Liste der 13 fehlgeschlagenen Testnamen
stimmt mit dem separat protokollierten Lauf auf der unveränderten öffentlichen
1.6.0-Basis überein. Es bleiben **keine neuen Testfehler**. Die Schutzprüfungen
wurden nicht abgeschwächt.

Weitere abschließende Ergebnisse:

- Syntaxprüfung: bestanden.
- Generiertes HTML: bytegleich zu den Quellen.
- Befundregister: 78 bestehende Befunde, 42 aktuelle Source-Hashes; historische
  Befundstatus unverändert.
- Dokumentprüfung: 19 Dokumente und 54 lokale Links bestanden; externe Links
  wurden dabei nicht auf Erreichbarkeit geprüft.
- Unabhängige Reviews von Kryptografie, Speicherung, Oberfläche und Gesamtänderung:
  abgeschlossen, keine offenen konkreten Produktbefunde.
- Vollständiger Branch-Diff: keine Whitespacefehler nach Bereinigung einer
  überzähligen Leerzeile in einem Test.

Die Tests des tatsächlich gebauten HTML umfassen Einrichtung, Backup, frischen
gesperrten Programmstart, lokale und Datei-Wiederherstellung, ausdrückliches
Ersetzen, Codeprüfung/-ersatz, Passwortwechsel sowie V1-/V2-Import mit unverändertem
lokalem Schutz. Ergänzende Fehlerprüfungen behandeln abgebrochene Vorbereitungen,
falsche Zugänge, Besitzerverlust, Zeitablauf, Schreibpräfixe, Quota und wiederholte
Rollbackfehler. Gefundene Journal- und Abbruchfehler wurden mit Regressionstests
korrigiert und unabhängig nachgeprüft.

SHA-256 der geprüften `Notenverwaltung.html`:

`209c8d19695b68fd4ddf855699f4303dc72958937e4b5dd61442c454c99dd66f`

## Noch offene Praxisabnahme

Die DOM-/HTML-Prüfungen liefen im Node-Testharness. Native Safari/macOS- und
Chrome-Bedienung, tatsächlicher Druck, Zielgeräte-Laufzeit und physische
Crash-Durabilität sind nicht nachgewiesen. Vor Veröffentlichung mit synthetischen
Daten prüfen: vollständige Einrichtung samt Ausdruck/Rückeingabe, Neustart und
Recovery, Dateiaustausch, freiwillige Nachrüstung, Sperren und parallele Fenster.
Die Programmversion wurde noch nicht erhöht; Veröffentlichung und Releasepaket
sind ein eigener nachfolgender Schritt.
