# Passwortwiederherstellung – Implementierungsnachweis

Historischer Prüfstand vom 16.10.2026 vor der Versionierung: Weiterentwicklung auf Basis der
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
Crash-Durabilität sind nicht nachgewiesen. Ergänzende Zielgeräteprüfungen mit synthetischen
Daten umfassen: vollständige Einrichtung samt Ausdruck/Rückeingabe, Neustart und
Recovery, Dateiaustausch, freiwillige Nachrüstung, Sperren und parallele Fenster.
Am oben genannten historischen Produktstand war die Programmversion noch nicht
erhöht; die anschließende Freigabe ist unten gesondert eingeordnet.

## Ergänzende Nutzerrückmeldung vom 16.10.2026

Der Nutzer hat die neue Testfassung ausprobiert und bestätigt, dass sowohl das
Nachrüsten eines Wiederherstellungscodes als auch die Wiederherstellung
funktioniert haben. Beide Benutzerwege sind als erfolgreiche praktische
Nutzertests dokumentiert. Browser, Betriebssystem, genaue getestete
Datei/Prüfsumme sowie die Wiederherstellungsvariante (lokaler Bestand oder
Backup-Datei) wurden nicht genannt. Daraus wird keine Bestätigung beider
Wiederherstellungsvarianten oder bestimmter Browser/Plattformen abgeleitet.
Die oben genannten technischen Prüfungen und ihre Artefaktzuordnung bleiben
unverändert.

## Anschließende Veröffentlichung als 1.7.0

Nach diesen Nutzertests hat der Nutzer am 16.10.2026 ausdrücklich die
Aktualisierung auf GitHub und die Veröffentlichung der neuen Version beauftragt.
Version 1.7.0 erhält eigene Releasehinweise und ein neu gebautes Paket. Die
obigen Testzahlen und die HTML-Prüfsumme bleiben dem historischen Produktstand
zugeordnet; sie sind keine Prüfsumme des neu versionierten Downloads.
Der abschließende Stand wird gemäß [Veröffentlichungsablauf](PUBLICATION.md)
erneut technisch geprüft. GitHub-CI und Release-Metadaten belegen den
veröffentlichten Commit. Die begrenzte Plattformzuordnung der Nutzertests bleibt
auch nach der Veröffentlichung bestehen.

Die erneute vollständige Testsuite der versionierten 1.7.0 bestand am 16.10.2026
unter Windows mit Node 26.11.1: **1.482 von 1.482 Tests, keine Fehler und keine
übersprungenen Tests**, Exit 0, 95,97 Sekunden. Ein normaler temporärer Ordner
außerhalb von OneDrive beseitigte die historischen Dateisystem-Umgebungsfehler;
die Schutzprüfungen blieben unverändert. Auch die 16 Snapshot-Tests wurden zuvor
separat erfolgreich ausgeführt. Das neue HTML stimmt bytegenau mit den Quellen
überein; 78 Befunde und alle 42 aktuellen Quellhashes wurden erneut geprüft.
