# Abnahme und Prüfgrenzen – Version 1.7.0

**Stand: 16.10.2026.** Version 1.7.0 ergänzt den Offline-Wiederherstellungscode
und die Härtung von Speicherübergängen. Der Nutzer hat die Veröffentlichung
beauftragt. Die folgenden Nachweise beschreiben ihren tatsächlichen Umfang;
sie sind keine vollständige Freigabe aller Browser und Geräte.

## Ergebniskategorien

`PASS` bezeichnet einen am genannten Stand tatsächlich bestandenen Fall.
`FAIL` kennzeichnet eine Abweichung, `BLOCKED` eine konkrete äußere Hürde und
`NOT RUN` einen fehlenden Nachweis. Automatisierte Tests und DOM-Harnesses
ersetzen keine Bedienprüfung im realen Browser.

## Aktueller Stand

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

## Desktop- und Browsergrenzen

Die Anwendung richtet sich vor allem an Desktop-PCs und Laptops. Das frühere
M06-Dateistartgate mit Edge, Chrome und Firefox belegt die Architektur der
Fenstersperre im damaligen Umfang; es ist keine vollständige Browserabnahme
von 1.7.0. Frühere technische Prüfungen und persönliche Stichproben zu 1.6.0
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
