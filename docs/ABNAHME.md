# Abnahme und Prüfgrenzen – Version 1.7.2

**Stand: 04.11.2026.** Version 1.7.2 korrigiert die Übernahme gesicherter
Halbjahres-/Semestergrenzen und Bezeichnungen beim vollständigen Ersetzen
eines Bestands. Der Nutzer hat die Veröffentlichung ausdrücklich
beauftragt. Die folgenden Nachweise beschreiben ihren tatsächlichen Umfang;
sie sind keine vollständige Freigabe aller Browser und Geräte.

## Ergebniskategorien

`PASS` bezeichnet einen am genannten Stand tatsächlich bestandenen Fall.
`FAIL` kennzeichnet eine Abweichung, `BLOCKED` eine konkrete äußere Hürde und
`NOT RUN` einen fehlenden Nachweis. Automatisierte Tests und DOM-Harnesses
ersetzen keine Bedienprüfung im realen Browser.

## Aktueller Stand 1.7.2

| Bereich | Status | Reichweite |
| --- | --- | --- |
| Gesamtsuite am versionierten Releasequellstand 1.7.2 vom 04.11.2026 | PASS (Windows, Node 22.23.4) | 1.513 von 1.513 Tests bestanden, keine Fehler oder übersprungenen Fälle; Laufzeit 75,5 Sekunden. Syntax, bytegenaue HTML-Buildidentität, Befundregister (78/44), Dokumentlinks und alle 21 Paket-/Dokumenttests bestanden ebenfalls. |
| Wiederherstellung der Zeiträume und Bezeichnungen | Technisch geprüft | Vollständiges Ersetzen übernimmt die gesicherten globalen Angaben für Sek I und Sek II; Zusammenführen erhält lokale globale Angaben. In älteren Sicherungen fehlende Einstellungsgruppen oder Stufeneinträge werden soweit vorhanden lokal ergänzt, bevor die bestehende Migration läuft. V1-Import mit Passwort sowie V2-Import mit Passwort oder passendem Code sind abgedeckt. |
| Unabhängiges Review und Nachreview | Abgeschlossen | Keine offenen konkreten Befunde am geprüften Implementierungsstand. |
| Finales Releasepaket, CI und öffentlicher Download | Commitbezogener Nachweis | [Release 1.7.2](https://github.com/MIBMCG/Notenverwaltung-public/releases/tag/v1.7.2) ordnet Paket, Prüfsummen und Tag zu; [GitHub Actions](https://github.com/MIBMCG/Notenverwaltung-public/actions) dokumentiert die Prüfungen des jeweiligen Quellstands. |
| Native Browser- und Geräteabnahme | Nicht neu durchgeführt | Für 1.7.2 wird keine neue native Sicht-, Touch-, Druck- oder Geräteabnahme behauptet. Die nachfolgenden Praxisgrenzen bleiben bestehen. |

Die Zeiträume und Bezeichnungen waren bereits in vollständigen Backups
enthalten. Der Fehler lag im Import, der sie durch lokale Werte ersetzte.
Eine vorhandene Quellsicherung kann mit der korrigierten Fassung erneut
importiert werden; vollständiges Ersetzen überschreibt den aktuellen Bestand.
Vorher diesen Bestand sichern. Verschlüsselungsformat, lokale Zugangsdaten
und die Mindestversion für Codezugang ändern sich nicht.

## Historische Nachweise zu 1.7.1

| Bereich | Status | Reichweite |
| --- | --- | --- |
| Gesamtsuite 1.7.1 am 02.11.2026 | PASS (Windows, Node 22.23.4) | 1.505 von 1.505 Tests am versionierten Releasequellstand bestanden, keine übersprungen. Syntax, Build-Identität, 78 Befunde/44 Quellhashes, Dokumentlinks und 21 Pakettests ebenfalls bestanden. |
| Kursfarben und Speicherverhalten | Technisch geprüft | Automatische Fachzuordnung, gültige Farbtöne 0–359, verschlüsselte Speicherung und Backups, Folgekurse, Tastaturbedienung, Fokus, Speicherfehler und veraltete Ansichten/Sitzungen sind durch Tests abgedeckt. Unabhängiges Nachreview ohne offene Befunde. |
| Farbkontrast | Automatisierter Test bestanden | Alle 360 Farbtöne für Haupt- und Nebenbeschriftungen einschließlich Aurora-Überlagerungen in heller, dunkler und Systemdarstellung mit mindestens 4,5:1; keine reale Browser-Sichtprüfung. |
| Browser-Sichtprüfung der Kursfarben | BLOCKED / nicht nachgewiesen | Lokale Vorschau durch Werkzeuggrenzen nicht zugänglich (HTTP-Timeout, gesperrte lokale Dateiadressen). Native Sicht-, Touch- und persönliche Designabnahme bleiben offen. Der Nutzer hat die Veröffentlichung in Kenntnis dieser Grenze beauftragt. |
| Finales Releasepaket, CI und öffentlicher Download | Commitbezogener Nachweis | [Release 1.7.1](https://github.com/MIBMCG/Notenverwaltung-public/releases/tag/v1.7.1) ordnet Paket, Prüfsummen und Tag zu; [GitHub Actions](https://github.com/MIBMCG/Notenverwaltung-public/actions) dokumentiert die Prüfungen des jeweiligen Quellstands. |

Die Wiederherstellungsfunktion und ihre Mindestversion ändern sich mit 1.7.1
nicht. Die folgenden älteren Nachweise bleiben an ihren damaligen Stand gebunden.

## Historische Nachweise zu 1.7.0

| Bereich | Status | Reichweite |
| --- | --- | --- |
| Technische Wiederherstellungsfunktion und Speicherhärtung | Geprüft am dokumentierten Implementierungsstand | Tests von Einrichtung, freiwilliger Nachrüstung, lokaler und Datei-Wiederherstellung, Codeprüfung/-ersatz, Passwortwechsel, V1-/V2-Import und Fehlerfällen; unabhängige Reviews ohne offene konkrete Produktbefunde. |
| Gesamtsuite am Implementierungsstand | Mit bekannten Umgebungsfehlern | Der dokumentierte Lauf enthält 13 Dateisystemfehler, die identisch auf der unveränderten öffentlichen 1.6.0-Basis auftreten (OneDrive-Reparsepunkte und fehlende Symlinkrechte). Das ist kein vollständig grüner Gesamtlauf. |
| Gesamtsuite der Version 1.7.0 am 16.10.2026 | PASS (Windows, Node 26.11.1) | 1.482 von 1.482 Tests bestanden, keine übersprungen. Ein normaler temporärer Ordner außerhalb von OneDrive beseitigt die genannten Umgebungsfehler, ohne Schutzprüfungen abzuschwächen. Quellstand und HTML sind buildidentisch. |
| Praktische Nutzerrückmeldung vom 16.10.2026 | PASS im berichteten Umfang | Nachrüstung eines Codes und eine tatsächliche Wiederherstellung erfolgreich. Browser, Betriebssystem, Datei/Prüfsumme und Wiederherstellungsvariante wurden nicht genannt. Beide Recoveryquellen oder bestimmte Plattformen sind damit nicht einzeln bestätigt. |
| Finales Releasepaket und öffentlicher Download | Eigene Veröffentlichungsprüfung | Build-Identität, CI, Paket und erreichbare Downloads müssen dem finalen Releasecommit zugeordnet werden. Frühere Implementierungsnachweise allein bestätigen das neue Paket nicht. |

Der [Implementierungsnachweis](https://github.com/MIBMCG/Notenverwaltung-public/blob/main/docs/quality/password-recovery-verification.md)
nennt die geprüften Stände und technischen Einzelbefunde. Die
[Release-Seite](https://github.com/MIBMCG/Notenverwaltung-public/releases/tag/v1.7.0)
enthält die Veröffentlichung und ihre Paketprüfsummen. Diese externen Links
benötigen eine Internetverbindung.

Paket, Prüfsummen und Tag der aktuellen Fassung werden der
[Release-Seite für 1.7.2](https://github.com/MIBMCG/Notenverwaltung-public/releases/tag/v1.7.2)
zugeordnet;
die [GitHub-Actions-Läufe](https://github.com/MIBMCG/Notenverwaltung-public/actions)
ordnen CI-Ergebnisse dem jeweiligen Commit zu.

## Desktop- und Browsergrenzen

Die Anwendung richtet sich vor allem an Desktop-PCs und Laptops. Das frühere
M06-Dateistartgate mit Edge, Chrome und Firefox belegt die Architektur der
Fenstersperre im damaligen Umfang; es ist keine vollständige Browserabnahme
von 1.7.2. Frühere technische Prüfungen und persönliche Stichproben zu 1.6.0
und älteren Versionen bleiben an ihre damaligen Stände gebunden. Der Nutzer
hatte die vollständige frische Wiederholung der früheren Desktopmatrix am
05.10.2026 beendet; daraus werden keine neuen PASS-Nachweise abgeleitet.

Native Safari/macOS-Bedienung, tatsächlicher Ausdruck des Codes,
Zielgeräte-Laufzeit und physische Crash-Durabilität sind nicht nachgewiesen.
Für Tablets und Smartphones liegt keine umfassende Prüfung dieser Fassung vor.
Es wird keine verbindliche umfassend geprüfte Browserliste behauptet.

Eine weitergehende Praxisprüfung sollte mit erfundenen Daten Einrichtung,
Code sichern/drucken und Rückeingabe, Neustart, beide Recoveryquellen,
freiwillige Nachrüstung, Backup-Import, Sperren und parallele Fenster abdecken.
Browser und Version, Betriebssystem, Datum, Programmversion und HTML-Prüfsumme
sowie Profil und Öffnungspfad gehören jeweils zum Nachweis. Tastatur, Zoom,
Druck und ein größerer synthetischer Bestand sind gesondert zu prüfen.

## Grenzen für Sicherung und Umstieg

Die HTML-Datei enthält keine eingegebenen Noten. Für einen Gerätewechsel ist
ein verschlüsseltes Backup erforderlich. Ein anderer Browser, ein anderes
Profil oder ein anderer Öffnungspfad kann einen eigenen Bestand anzeigen.
Vor einem Update sichern und alle Fenster der alten Fassung schließen.

V2-Bestände und Sicherungen mit Codezugang benötigen Version 1.7.0 oder neuer.
Alte Dateien behalten ihre damaligen Zugangsdaten. Ein gesperrter Altbestand
ohne zuvor eingerichteten Code ist nicht nachträglich damit entschlüsselbar.
Passwortwechsel, Codeersatz und Wiederherstellung erzeugen einen neuen Code;
vorherige Sicherungen ändern sich dadurch nicht.

Ein gestarteter Download belegt nur den Downloadstart. Die Anwesenheit einer
Datei und eine kontrollierte Wiederherstellungsprobe im getrennten Testbestand
sind eigene Prüfungen. Die vollständige Wiederherstellung ersetzt nach
Bestätigung vorhandene Daten; vorab den Zielbestand sichern. Beim normalen
Import bleiben lokales Passwort und Code erhalten. Die
[Kurzanleitung](KURZANLEITUNG.md) unterscheidet normalen Import und Wiederherstellung
mit neuem Schutz.

Auch erfolgreiche Einzelprüfungen bestätigen nicht alle Geräte,
Farbkombinationen oder denkbaren Eingaben. Abschließende pädagogische
Entscheidungen über Kursnoten trifft die Lehrkraft.
