# Aktueller Arbeitsstand

## Version 1.7.2: Zeiträume aus Backups wiederherstellen – 04.11.2026

Arbeitsordner: `Notenverwaltung-public`, Branch `codex/backup-period-settings`,
Basis `c1049461e66aff9f6dff74f79b3caef3053cfe35` (öffentliches Release 1.7.1).
Der Nutzer hat die Veröffentlichung als **1.7.2** ausdrücklich beauftragt.
Produktversion und Datum sind auf 1.7.2 / 04.11.2026 gesetzt. Integration,
CI-Ergebnisse und öffentliche Downloads werden am endgültigen Commit geprüft;
die folgenden lokalen Nachweise ersetzen diese Veröffentlichungskontrolle nicht.

Der versionierte Releasequellstand 1.7.2 bestand anschließend erneut
**1.513/1.513 Tests** (Windows/Node 22.23.4, 75,5 Sekunden), 0 Fehler und
0 übersprungene Fälle. Alle 21 Paket-/Dokumenttests, Syntax, bytegenaue
HTML-Buildidentität, Befundregister und Dokumentlinks bestanden.
Release-Review und Nachreview ohne offene Befunde; 257 öffentliche Dateien
explizit im Manifest, keine privaten Supportdateien. Eine noch auf 1.7.1
festgelegte negative Pakettesterwartung wurde an die Releaseversion gebunden.
Finales lokales Protokoll: `.superpowers/release-1.7.2-full-final.log`.

Die gesicherten Einstellungen waren bereits vollständig im Backup enthalten.
Der normale Ersetzen-Import überschrieb jedoch `halfYearSettings` und
`halfYearNames` mit den lokalen Werten. Er übernimmt jetzt die gesicherten
Grenzen und Bezeichnungen für Sek I und Sek II. Zusammenführen behält die
lokalen globalen Vorgaben. Fehlen ganze Einstellungsgruppen oder Stufeneinträge
in alten Dateien, werden lokale Vorgaben vor der Migration ergänzt. Einzelne
fehlende Felder normalisiert weiterhin die bestehende Migration.

Auch V2-Entschlüsselung liefert nach vollständiger Inhaltsprüfung die rohen
Importdaten zurück, damit fehlende Angaben bis zum Import erkennbar bleiben.
Authentifizierung, Sitzungsprüfung und Verschlüsselung sind unverändert.

Regressionen prüfen tatsächliches Speichern der Einstellungen, den Backupknopf
mit V1/V2, Dateiimport und erneutes Öffnen sowie alte Sicherungen mit fehlenden
Gruppen/Stufen über V1-Passwort, V2-Passwort und V2-Code. Automatische
Leistungszuordnung wird anhand der tatsächlich übernommenen Grenzen geprüft.
Zusätzliche Prüfungen decken das gebaute HTML und unveränderte Merge-Vorgaben ab.
Vor der Korrektur wurden die Importverluste beobachtbar reproduziert.

Abschließend am 04.11.2026 unter Windows/Node 22.23.4 geprüft:
**1.513/1.513 Tests bestanden**, 0 Fehler, 0 übersprungen (74,5 Sekunden).
79 gezielte Import-/Recovery-/Workflowtests bestanden zuvor ebenfalls.
Syntax, bytegenaue HTML-Buildidentität, Befundregister (78/44), lokale
Dokumentlinks und `git diff --check` bestanden. Der erste Gesamtlauf enthielt
vier Sandbox-Rechtefehler beim Anlegen temporärer Hardlinks/Junctions sowie
einen fehlenden Hinweis auf den standardmäßigen Ersetzen-Modus. Der Hinweis
ist ergänzt; der abschließende Lauf lief außerhalb der Sandbox mit
unveränderten Schutztests und festem temporärem Testordner.

Ein unabhängiges Review fand die verfrühte Normalisierung im V2-Import.
Der Befund ist korrigiert und durch vorher fehlgeschlagene Regressionen
abgesichert; enger Nachreview ohne weitere Befunde. Prüfungen verwenden
ausschließlich synthetische Daten und DOM-Harnesses, keine neue native
Browser-/Geräteabnahme. Lokale, nicht versionierte Protokolle liegen unter
`.superpowers/backup-periods-*.log`; der finale Lauf ist
`.superpowers/backup-periods-full-final.log`.

## Version 1.7.1: einstellbare Kursfarben – 02.11.2026

Aktiver Arbeitsordner: `Notenverwaltung-public`. Implementierungszweig:
`codex/course-card-colors`, Basis `c636a4d17562d80340d0116e2910e37e57091c3e`.
Der öffentliche Hauptbranch wurde vor der Integration am 02.11.2026 lesend
auf diese Basis abgeglichen. Der Nutzer hat anschließend Push, Integration
und Veröffentlichung als **1.7.1** ausdrücklich beauftragt. Produktversion und
Datum sind auf 1.7.1 / 02.11.2026 gesetzt. Der endgültige GitHub-Stand ist über
[Release und Download](https://github.com/MIBMCG/Notenverwaltung-public/releases/tag/v1.7.1)
und die [commitbezogenen CI-Läufe](https://github.com/MIBMCG/Notenverwaltung-public/actions)
nachvollziehbar; frühere Prüfungen ersetzen diese Nachweise nicht.

### Umsetzung

- Automatische Fachfarben in Übersicht und Kursverwaltung, auch für bestehende
  Kurse ohne gespeicherte Farbe. Fachaliasse und unbekannte Fächer werden
  deterministisch zugeordnet; Kurssymbole beeinflussen die Farbe nicht.
- Farbtonregler mit Vorschau beim Anlegen und unter Kurs bearbeiten →
  Allgemeines. Speichern beim Loslassen bzw. Tastaturschritt; Zurücksetzen mit
  „Fachfarbe verwenden“. Sättigung und Helligkeit sichern lesbare Farbflächen.
- Optionales `cardHue` als ganze Zahl 0–359; fehlender Wert bedeutet Automatik.
  Ungültige Importwerte fallen auf Automatik zurück. Verschlüsselte
  Speicherung/Backups, Archivieren und Folgekurse erhalten die Auswahl.
  Zusammenführen bewahrt die lokale Auswahl bei bestehenden Kursen.
- Farbänderungen aktualisieren nur die Kachel, erhalten den Editor und seinen
  Fokus. Fehlgeschlagene Speicherungen stellen die bestätigte Auswahl wieder
  her. Ein abgelöster Regler aus einer früheren Ansicht/Sitzung darf nicht
  schreiben.

### Prüfung und Grenzen

Die fachbezogenen, Picker- und Integrationstests wurden vor der Umsetzung
beobachtbar rot ausgeführt und anschließend bestanden. Ein unabhängiges
Review fand einen alten Sitzungs-Callback, Fokusverlust und eine veraltete
Vorschau nach abgelehntem Fachwechsel. Alle drei Befunde sind korrigiert,
mit Regressionen abgedeckt und im Nachreview ohne Restbefund geschlossen.

Der Kontrasttest prüft alle 360 Farbtöne für Haupt- und Nebenbeschriftungen
gegen Kartenflächen einschließlich Aurora-Überlagerungen in hell, dunkel und
Systemdarstellung auf mindestens 4,5:1. Er ersetzt keine Browser-Sichtprüfung.
Die Browserwerkzeuge konnten die lokale Vorschau nicht öffnen (HTTP-Timeout;
lokale `file:`-Adressen sind durch die Werkzeugrichtlinie gesperrt). Daher
bleiben native Sicht-, Touch- und persönliche Designabnahme offen.

Der erste Gesamtprüflauf fand zwei anzupassende isolierte Testkontexte und
die neue erlaubte Modulabhängigkeit. Diese Testanpassungen sind erledigt.
Die bestehenden Snapshot-Schutztests lehnten außerdem den temporären
Sandbox-Pfad mit geschweiften Klammern ab. Die Schutzprüfungen bleiben
unverändert; der abschließende Lauf verwendet einen normalen temporären
Ordner außerhalb von OneDrive.

Die neu erzeugte `Notenverwaltung.html` stimmt bytegenau mit den Quellen
überein. Syntaxprüfung und Befundregister (78 Befunde, 44 Quellhashes)
bestanden. Historische Befundstatus und frühere Abnahmegrenzen sind unverändert.

Abschließende Gesamtsuite des versionierten Releasequellstands 1.7.1 am
02.11.2026 unter Windows/Node 22.23.4: **1.505/1.505 bestanden**, 0 Fehler,
0 übersprungen (84,3 Sekunden). Alle 21 Pakettests bestanden; tatsächliches
Zehn-Dateien-Paket zweimal bytegleich erzeugt und gegen Quellen sowie innere
und äußere Prüfsummen geprüft. Eine noch auf 1.7.0 festgelegte Testerwartung
wurde für die neue Versionsnummer angepasst. Lokales Prüfprotokoll
(nicht versioniert): `.superpowers/release-1.7.1-tests-final.log`.

### Fortsetzung

Produkt lokal über `Notenverwaltung.html` öffnen; Quellen ausschließlich unter
`src/` ändern und mit `npm.cmd run build` neu erzeugen. Die Veröffentlichung
1.7.1 ist ausdrücklich freigegeben; die persönliche Sichtprüfung bleibt als
separate Praxisgrenze offen. Nach Integration vom öffentlichen `main` bzw.
Release-Tag fortsetzen. Die ältere private Ablage ist kein Spiegel dieses
öffentlichen Projekts.
