# Änderungen

## 1.6.0 – unveröffentlichter Prüfkandidat

- Pro Browserbestand darf ein Fenster bearbeiten; nach Freigabe kann ein
  zweites Fenster den aktuellen Stand bewusst übernehmen.
- Backups schließen offene gültige Eingaben ab und warten auf bestätigte
  Speicherung. Ungültige Eingaben oder Speicherfehler verhindern den Download.
- Manuelles Sperren verdeckt Inhalte sofort, speichert geordnet und meldet
  nicht gespeicherte Eingaben neutral. Sofortiges und automatisches Sperren
  bleiben harte Grenzen.
- Übersprungene CSV-Warnzeilen beeinflussen übernommene Personen-, Kurs- und
  Q4-Angaben nicht mehr. Tendenzen verwenden gültige Rohwerte und
  aktualisieren sich nach bestätigten Änderungen.
- Technische Prüfungen und Reviews sind abgeschlossen; die reale
  Desktopabnahme für 1.6.0 steht noch aus.

[Release-Hinweise und Umstieg](docs/releases/1.6.0.md).

## 1.5.1 – 22.09.2026

- Mitgeliefertes Schullogo durch ein neutrales NV-Platzhalterlogo ersetzt.
- Ältere Bestände ohne eigenes Schulprofil verwenden „Meine Schule“;
  ausdrücklich gespeicherte Schulprofile bleiben unverändert.
- Automatische Logoanzeige, Druck und Einstellungen verwenden `Logo.png`
  beziehungsweise `placeholder-logo.svg`. Aktuelle Anleitungen und Bildhinweise
  sind entsprechend angepasst.

[Release-Hinweise und Umstieg](docs/releases/1.5.1.md).

## 1.5.0 – 22.09.2026

- Änderungen am Bestand werden geordnet aus dem zuletzt bestätigten Zustand
  erzeugt und erst nach erfolgreicher verschlüsselter Speicherung angezeigt.
  Speicherfehler lassen bestätigte Daten unverändert und erhalten bearbeitbare
  Entwürfe für eine bewusste Wiederholung.
- Backup-Zusammenführungen erhalten stabile Personen-, Kurs- und Leistungs-IDs,
  erkennen widersprüchliche Zuordnungen vor dem Speichern und weisen Metadaten-,
  Noten-, Festsetzungs- und Archivkonflikte getrennt aus.
- CSV-Exporte verwenden ein 14-spaltiges Format mit `CSV-Schutz`, damit nur vom
  Export ergänzte Schutzapostrophe sicher zurückgenommen werden. Ältere Formate
  mit 8 bis 13 Spalten bleiben importierbar.
- Ungültiges UTF-8 wird nicht still durch Ersatzzeichen übernommen. Stattdessen
  kann die Datei ausdrücklich als Windows-1252 gelesen, geprüft, verworfen oder
  anschließend bewusst importiert werden.
- Manuelle und automatische Halbjahrszuordnungen werden unterschieden. Manuelle
  Zuordnungen bleiben bei Datums- und Stichtagsänderungen erhalten; automatische
  Zuordnungen folgen den wirksamen kalendarischen Grenzen.
- **Neue Leistung anlegen** öffnet aus der Notenansicht direkt das bestehende
  Leistungsformular des aktuellen bearbeitbaren Kurses.
- Neu ausgewählte Logos sind auf 256 KiB und 4096 × 4096 Pixel begrenzt.
  Bereits gespeicherte gültige Logos bis zur bisherigen Grenze von 2 MiB bleiben
  in Beständen und Backups erhalten.

[Release-Hinweise und Umstieg](docs/releases/1.5.0.md).

## 1.4.0 – 19.09.2026

- Schulname und PNG-Logo unter „Einstellungen → Schule und Logo“ anpassen;
  lokal verschlüsselt gespeichert und in vollständigen Backups enthalten.
- Schulbezeichnung einheitlich in Seitenleiste, Browsertitel, „Über die Anwendung“
  sowie Einzel- und Sammeldruck; Sperrbildschirm neutral.
- Automatische Logo-Suche unterstützt `Logo.png` vor `hwg-logo.png`; eigenes
  Logo mit beliebigem Dateinamen und ausdrücklich ausgeblendetes Logo möglich.
- Neue Datenbestände starten ohne Schulnamen; bisherige Bestände behalten
  zunächst die bisherige Schulbezeichnung.

## 1.3.0 – 15.09.2026

- Die integrierte Oberfläche mit Klassisch, Modern ruhig und Aurora ist für die
  reguläre Nutzung freigegeben; Desktop-Abnahme und Android-Touch-Stichprobe
  sind im [Abnahmeprotokoll](docs/ABNAHME.md) dokumentiert.
- Kurssymbole mit Fachautomatik und manueller Auswahl; Schüler:innen sind auch
  ohne angelegte Leistungen als kompakte Namensfelder sichtbar und durchsuchbar.
- Zentriertes HWG-Logo mit passender Hell-/Dunkeldarstellung, korrigierten
  Schriftfarben und abgestimmten Abständen in der Seitenleiste.
- Sek-I-Jahresansicht mit einzelnen gerundeten Notenflächen sowie echter
  XLSX-Export mit getrennten Kursblättern.
- Die Änderungen und Absicherungen der Vorabfassung sind enthalten. Die
  Versionsfreigabe ändert keine Notenregeln und keine gespeicherten Datenformate.
- Eigenständiges Downloadpaket mit Programmdatei, Logo, Kurzanleitung,
  Release-Hinweisen und Hinweisen zu mitgelieferten Bibliotheken.

[Release-Hinweise und Umstieg](docs/releases/1.3.0.md).
Die nachfolgenden Einträge dokumentieren die vorherigen Entwicklungsstände.

## Lokale Nachkorrekturen – 14.09.2026

- Einzelne gerundete Notenflächen in der Sek-I-Jahresansicht; Leistungsanzahlen
  stehen außerhalb der farbigen Flächen.
- Excel-Export als echte `.xlsx`-Arbeitsmappe mit einem Blatt je ausgewähltem
  Kurs, Zahlenzellen und ausdrücklich als Text gespeicherten Namen/Angaben.
  Die bisherige HTML-Datei mit `.xls`-Endung wird ersetzt.
- Prüfstand und Grenzen: [Abnahmeprotokoll](docs/ABNAHME.md).

## 1.3.0-rc.1 – 13.09.2026 – zur Abnahme vorbereitet

Diese Vorabfassung enthält die integrierte Konzeptoberfläche. Den technischen
Prüfstand nennt [PUBLICATION.md](docs/quality/PUBLICATION.md). Die endgültige Freigabe folgt
nach der noch offenen persönlichen Geräteabnahme.

### Bedienung und Darstellung

- Überarbeitete Übersichten für Kurse und Personen sowie geordnete Bereiche für
  Einstellungen, Statistik, Berichte und Import/Export.
- Noteneingabe mit Schülerfilter, Leistungsverwaltung, Statusfeldern,
  feststehenden Namen und Überschriften sowie gerundeten Notenfeldern.
- Jahresansicht der Sek I mit getrennten Halbjahres- und Jahreswerten.
- Kräftigere Notenfarben in Modern/Aurora, angepasste Designflächen und
  Statistikfarben. Aurora erhält den einstellbaren Hover-Flash; Kursinformationen
  bleiben auch bei dezenter Bewegung sichtbar.
- Sanfter beschleunigte und abgebremste Kurskartendrehung bei Aurora / Deutlich.
- Der zuletzt geöffnete Kurs kann nach dem Entsperren über die Übersicht
  fortgesetzt werden.
- Nach einem vorübergehenden Speicherfehler wird die Fortsetzen-Zuordnung beim
  erneuten Öffnen desselben Kurses nochmals gespeichert. Ein verspäteter Fehler
  eines älteren Besuchs überschreibt keine neuere erfolgreiche Zuordnung.

### Berichte und Datenübertragung

- Beim Zusammenführen zählen identische Noten und unveränderte Archivleistungen
  nicht mehr als Konflikte oder übersprungene Änderungen. Echte Unterschiede
  werden weiterhin gemeldet; lokale Werte und bestehende Archive bleiben erhalten.

- Druckabschluss langer Personenberichte so angepasst, dass Datum und
  Unterschriften besser mit dem letzten Berichtsabschnitt zusammenbleiben.
- Lesefehler beim Auswählen einer Backup- oder CSV-Datei werden verständlich
  gemeldet; eine erneute Dateiauswahl ist möglich.
- Zusätzliche Prüfungen für Importabbrüche, CSV-Konflikte, Jahresberechnung,
  Q4-Regeln, gültige 0 Punkte, leere Felder und Sonderzeichen in Excel-Ausgaben.
- Neue [Kurzanleitung](docs/KURZANLEITUNG.md) für Start, Sicherung,
  Wiederherstellung und Gerätewechsel sowie fiktive Dateien für CSV-Gegenproben.

### Hinweise zum Wechsel

- Vor dem Wechsel ein verschlüsseltes Backup des Browserbestands erstellen.
  Die HTML-Datei und Git übertragen keine eingegebenen Browserdaten.
- Vorhandene Backup- und CSV-Formate bleiben erhalten. CSV enthält keine
  vollständigen Noten; der Excel-Export ist eine Leseansicht, kein Importformat.
- Beim Ersetzen aus einem Backup bleiben Halbjahresgrenzen und Halbjahresnamen
  des Zielbrowsers erhalten. Diese nach einem Gerätewechsel prüfen.
- CSV-Formelschutz bleibt unverändert: ein dafür vorangestelltes Apostroph bleibt
  beim erneuten Import erhalten.
- Die angezeigte Programmversion ist unabhängig von der internen Datenversion.

### Noch vor endgültiger Freigabe

Zum Zeitpunkt der Vorabfassung standen persönliche Geräteprüfungen noch aus.
Der später erreichte Stand und seine Grenzen sind in [ABNAHME.md](docs/ABNAHME.md)
zusammengefasst. Diese Vorabfassung wurde nicht als finale Version veröffentlicht.


## Frühere veröffentlichte Fassungen

## Version 1.2.0 – 29.08.2026

- Die vorhandenen Einzel- und Sammeldrucke wurden durch den Anwender in Microsoft Edge und Mozilla Firefox vollständig sichtgeprüft; Layout, Seitenränder und die unterschiedlichen Ausdrucke waren in beiden Browsern unauffällig.
- Einzel- und Sammeldruck zeigen nun auf jeder Schülerseite das Logo aus der Begleitdatei `hwg-logo.png`. Bei einem Schulwechsel kann die Datei unter demselben Namen ersetzt werden, ohne den Programmcode zu ändern.
- Der Druck wartet auf das Laden des Logos. Fehlt die Datei oder kann sie nicht geladen werden, wird das defekte Bild ausgeblendet und der Ausdruck bleibt nutzbar.
- Fünf neue Regressionstests sichern gemeinsamen Druckkopf, Einzel-/Sammeldruck, Ladeverzögerung, Fehlerfall, Sicherheitstimeout und den Ladeabschluss während der Listener-Anmeldung. Der vollständige Entwicklungsstand besteht mit 269/269 Tests und 1/1 Syntaxprüfung.
- Das ergänzte Logo wurde anschließend ebenfalls in Edge und Firefox sichtgeprüft und vom Anwender freigegeben. Damit sind die reale Druckabnahme und der technische Releaseumfang abgeschlossen. Schulungsunterlagen sind ausdrücklich nicht Teil dieser Version.

## Version 1.1.0 – 22.08.2026

### Hinzugefügt

- optionales Aufbewahrungsdatum und optionale Notiz beim manuellen Archivieren
- gemeinsame Aufbewahrungsangaben beim Schuljahreswechsel
- nachträgliches Bearbeiten der Aufbewahrungsangaben, ohne historische Leistungsdaten zu verändern
- lokal begrenzter synthetischer Belastungs- und Sicherheitstest

### Geprüft

- rückwärtskompatible Migration alter Kurse ohne neue Archivfelder
- verschlüsselte Persistenz und Backup-Rundlauf der Archivmetadaten
- Ablehnung falscher Passwörter, beschädigter Backups, manipulierten Ciphertexts und unbekannter Formate
- großer synthetischer Bestand mit 240 Personen, 10 Kursen, 180 Leistungen und 43.200 Score-Einträgen
- fünf aufeinanderfolgende Schuljahreswechsel mit insgesamt 20 Archiven

## Version 1.0.0 – 21.08.2026

Erste ausdrücklich versionierte und umfassend geprüfte Freigabe.

### Hinzugefügt

- sichtbare Programmversion in Kopfzeile, Browser-Titel und „Über diese Anwendung“
- Änderungsprotokoll `AENDERUNGEN.md`
- Kursarchiv mit Nur-Lese-Ansicht, verschlüsseltem Export und Wiederherstellung
- gemeinsamer Schuljahreswechsel mit Vorschau und neuen leistungsfreien Nachfolgekursen
- Sek-I-Notenstufe `1+`

### Geändert

- getrennte und anpassbare Bewertungsprofile für Sek I, reguläre Oberstufe und Berliner Abiturprüfungen 2024–2029
- historische Auswertungen archivierter Kurse verwenden den gespeicherten Bewertungs- und Halbjahresstand
- Import-, Export-, Merge-, Statistik- und Druckpfade wurden robuster und datensparsamer gestaltet

### Geprüft

- Import und Export mit gültigen, gewarnten und fatal fehlerhaften synthetischen Dateien
- Sek-I- und Sek-II-Notenberechnung, Gewichtungen, Statuswerte und Statistiken
- verschlüsselte Backups, Archivierung, Wiederherstellung und Schuljahreswechsel
- Einzel- und Sammeldruck sowie strukturelle JavaScript-Syntax

Weitere Einzelheiten stehen in `PRUEFBERICHT.md`.
