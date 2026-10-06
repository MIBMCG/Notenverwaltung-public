# Abnahme und Prüfgrenzen – Version 1.6.0

**Status: lokal am 06.10.2026 gebaut, unveröffentlicht.** Eine Freigabe für die öffentliche
Nutzung und eine vollständige Desktopabnahme liegen noch nicht vor. Die letzte
private Freigabe ist Version 1.5.1. Frühere persönliche Prüfungen der Version
1.3.0 und technische Zwischenstände belegen nur die jeweils geprüfte Fassung.

## Ergebniskategorien

`PASS` bedeutet, dass der benannte Fall am angegebenen Stand tatsächlich
bestanden wurde. `FAIL` kennzeichnet eine Abweichung. `BLOCKED` bezeichnet
einen wegen konkreter äußerer Hürde nicht ausführbaren Fall. `NOT RUN`
bedeutet, dass der geforderte Nachweis noch fehlt. Ein automatisierter Test
oder DOM-Harness ersetzt keinen realen Desktopbrowser.

## Aktueller Stand

| Bereich | Status | Reichweite |
| --- | --- | --- |
| Frühes M06-Dateistartgate | PASS | Synthetische `file:`-Probe mit Edge, Chrome und Firefox: gemeinsamer Speicher und wirksame Sperrkonkurrenz, Pfad- und Profilvarianten sowie dokumentierter Neustart. Das belegt die Architekturentscheidung vor der Produktintegration. |
| Technische Produktkorrekturen | PASS am Task-7-Abschlussstand | Unabhängig geprüfte Korrekturen für Einfensterbetrieb, Abschluss offener Eingaben, Sperren, CSV-Auswahl, Tendenzen und Wiederherstellung/Sicherheitsgrenzen. Die technischen Nachweise sind an ihre jeweiligen Commits gebunden. |
| Integrierter Quellstand einschließlich Datums- und Textänderungen | PASS (lokal, Node 22.23.3) | 1344/1344 automatisierte Tests; Syntax, Build-Identität, Befundregister, Dokumentlinks und Releasepaket-Regressionen lokal geprüft. Das ist keine reale Browserabnahme und kein CI-Nachweis für den künftigen öffentlichen Commit. |
| Reale Desktopbedienung von 1.6.0 | Teilweise frisch belegt; weitere Wiederholung ausdrücklich aufgehoben | Edge: gespeicherte 2, sofortige Maskierung sowie Ben leer nach Entsperren als Teilbeobachtungen berichtet; vollständiger L01-D-Fall wegen unbeobachtetem neutralem Zwischenhinweis nicht frisch verifiziert. Start/Zweitfensterblockade und aktuelle Fensterübernahme ebenfalls nur teilweise berichtet. Der Nutzer bestätigt früher durchgeführte Praxisprüfungen und hat weitere manuelle Wiederholungen am 05.10.2026 beendet. Eine frische vollständige Prüfung aller Desktopfälle und Browser wird daraus nicht behauptet. |
| Öffentlicher Download und Rückkontrolle | NOT RUN | Lokaler Dateibaum und Paket werden für die Freigabe vorbereitet. Repository, Tag, erreichbare Links und anonymer Download stehen noch aus; bei späterem Veröffentlichungstag ist ein neuer Datumsbuild nötig. |

## Desktop- und Browsergrenzen

Edge und Chrome sind für den vollständigen Windows-Desktopkernlauf vorgesehen.
Firefox erhält denselben Kernlauf; eine Unterstützungsaussage folgt seinem
Ergebnis. Das M06-Gate allein gibt keinen dieser Browser für die gesamte
Version 1.6.0 frei. Safari/macOS sind ohne reale Prüfung nicht verifiziert.
Für Tablets und Smartphones liegt keine umfassende Prüfung von 1.6.0 vor;
sie sind kein Freigabegate für die auf Desktop-PCs und Laptops ausgerichtete
Anwendung.

Die vollständige frische Wiederholung der Desktopmatrix wurde am 05.10.2026 auf ausdrücklichen Nutzerentscheid beendet; vorhandene Praxisrückmeldungen und aktuelle Teilnachweise bleiben getrennt dokumentiert. Noch nicht frisch belegte Abläufe sind keine neuen PASS-Nachweise. Der technische Gesamtreview und die lokale Kandidatenvorbereitung werden fortgesetzt.

Zum definierten Prüfbereich gehören der lokale `file:`-Start, Einfensterübernahme, Backup und Wiederherstellung,
Sperr- und Abbruchwege, CSV- und Tendenzänderungen, Offlinebetrieb, Tastatur,
Zoom, Druck und ein größerer synthetischer Bestand.
Dabei zählen Browser, Version, Gerät, Windowsversion, Datum,
Commit und HTML-Prüfsumme. Profil und Öffnungspfad sind getrennt zu erfassen.
Ein anderes Profil oder ein anderer Dateipfad kann einen eigenen Bestand
anzeigen. Die HTML-Datei enthält keine eingegebenen Noten; für den Umzug
ist eine verschlüsselte Backup-Datei erforderlich.

Auch nach erfolgreicher Abnahme wäre keine vollständige Prüfung aller
Geräte, Farbkombinationen oder denkbaren Eingaben behauptet. Eine gestartete
Backup-Datei ist erst nach Dateiprüfung und kontrollierter Wiederherstellung
als nutzbare Sicherung belegt. Die Anwendung trifft keine abschließende
pädagogische Entscheidung über Kursnoten.
