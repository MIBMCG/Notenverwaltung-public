# Notenverwaltung – Kurzanleitung

Diese Anleitung beschreibt den vorgesehenen Alltag mit der lokalen
`Notenverwaltung.html`. Die Anwendung benötigt keine Installation und keinen
Internetanschluss.

Version 1.6.0 ist ein unveröffentlichter Prüfkandidat für Desktop-PCs und
Laptops. Die abschließende Desktopprüfung und damit die verbindliche Liste
unterstützter Dateibrowser stehen noch aus. Für Tablets und Smartphones liegt
keine umfassende Prüfung dieser Fassung vor. Der frühe Dateistarttest mit
Edge, Chrome und Firefox belegt die Fenstersperre im geprüften Umfang, noch
nicht die gesamte Bedienung dieser Programmfassung.

## Anwendung starten

1. Lege die endgültige Datei `Notenverwaltung.html` an einem festen Ort ab.
2. Öffne sie per Doppelklick im vorgesehenen Browser.
3. Optional das neutrale `placeholder-logo.svg` im selben Ordner lassen.
   Ein eigenes `Logo.png` hat Vorrang; alternativ ein PNG in den Einstellungen auswählen.

Das Logo steht in der Seitenleiste oberhalb des App-Namens. Im Dunkelmodus
wird es automatisch hell dargestellt. In Aurora/Hell gilt dies nur beim
Standardhintergrund; bei einer eigenen Hintergrundfarbe bleibt das Logo dunkel.
Im Druck bleibt das Original erhalten.
Ohne Bilddatei erscheint in der Seitenleiste stattdessen „NV“. Auf schmalen
Bildschirmen bleibt dieser Seitenleistenkopf wie bisher ausgeblendet.

### Eigene Schule einrichten (ab 1.4.0)

Unter **Einstellungen → Schule und Logo** den Schulnamen eintragen und bei Bedarf
ein PNG-Logo auswählen. Der Dateiname ist beliebig. Ab Version 1.5.0 darf eine
neu ausgewählte Datei höchstens 256 KiB und 4096 × 4096 Pixel groß sein. Bereits
gespeicherte gültige Logos bis zur bisherigen Grenze von 2 MiB bleiben im
Bestand und in vollständigen Backups erhalten. Mit **Schule und Logo speichern**
übernehmen.
Die Angaben erscheinen auch unter „Über die Anwendung“ und auf Ausdrucken und
werden in verschlüsselten Backups mitgesichert. Ein leerer Schulname wird
ausgeblendet. Der Sperrbildschirm bleibt neutral.

**Logo entfernen** blendet das Logo vollständig aus. **Logo aus Programmordner
verwenden** aktiviert die Suche nach `Logo.png`, danach `placeholder-logo.svg`.
**Änderungen verwerfen** stellt die zuletzt gespeicherten Angaben wieder her.

Eine Adresse wie `http://127.0.0.1:43180/Notenverwaltung.html` ist eine
vorübergehende Entwicklungsansicht. Sie funktioniert nur, solange der zugehörige
lokale Server läuft, und sollte nicht als dauerhafter Programmeinstieg dienen.

Die Daten liegen verschlüsselt im lokalen Speicher des Browsers. Sie gehören zum
verwendeten Browserprofil und zur jeweiligen Adresse beziehungsweise Öffnungsart.
Ein anderer Browser, ein anderes Profil, ein privates Fenster oder der Wechsel
zwischen der HTML-Datei und einer `127.0.0.1`-Adresse kann deshalb wie ein leerer
Datenbestand aussehen. Die Programmdatei selbst enthält die eingegebenen Daten
nicht.

## Erster Start und Passwort

Beim ersten Start verlangt die Anwendung die Einrichtung der Verschlüsselung.
Das Passwort muss mindestens sechs Zeichen lang sein.

- Bewahre das Passwort getrennt von Programmdatei und Backup auf.
- Trage kein echtes Passwort in Dateinamen, Dokumentationen oder Begleitdateien ein.
- Ohne das richtige Passwort lassen sich der lokale Bestand und verschlüsselte
  Backups nicht öffnen.

Unter **Einstellungen** kannst du das Passwort später über **Passwort ändern** wechseln.
Dafür brauchst du das bisherige Passwort. Bereits erstellte Backups werden dadurch nicht geändert und benötigen weiterhin ihr damaliges Passwort.

## Sperren und entsperren

Mit **Sperren** verdeckt die Anwendung private Inhalte sofort und schließt
begonnene gültige Eingaben geordnet ab. Währenddessen erscheint ein neutraler
Zwischenhinweis. Nach bestätigter Speicherung wird die Sitzung freigegeben.
Bei ungültiger Eingabe, Speicherfehler oder Ablauf der Wartezeit sperrt sie
ebenfalls und meldet den möglichen Verlust der letzten Eingabe ohne private
Details. Prüfe den Stand nach dem Entsperren. **Sofort sperren und
ungespeicherte Eingaben verwerfen** bricht den Abschluss bewusst ab.

Die automatische Sperre nach Inaktivität (voreingestellt 15 Minuten) und das
Schließen oder Neuladen der Seite sperren sofort. Gerade offene Eingaben
können dabei verloren gehen; ein Speichern beim Schließen ist nicht gesichert.

Zum Weiterarbeiten wählst du **Entsperren** und gibst das Passwort des lokalen Datenbestands ein.
Wenn du die Passwortabfrage abbrichst oder das Passwort nicht stimmt, bleibt die Anwendung gesperrt. Wähle erneut **Entsperren**.

## Ein Fenster bearbeitet den Bestand

Für denselben Browserbestand darf jeweils ein Fenster bearbeiten. Ein
weiteres Fenster zeigt zunächst einen neutralen Hinweis. Sperre oder schließe
das erste Fenster; wähle danach im zweiten **Erneut versuchen** und melde dich
neu an. Ein anderer Browser, ein anderes Profil, ein privates Fenster oder
ein anderer Öffnungspfad kann einen getrennten Bestand verwenden. Vergleiche
vor der Arbeit den erwarteten Kursbestand. Unterschiedliche Bestände werden
nicht automatisch abgeglichen; dafür ein verschlüsseltes Backup verwenden.
Fehlt eine verlässliche Fenstersperre, bleibt die Bearbeitung deaktiviert.

## Vollständiges Backup erstellen

1. Entsperre den richtigen Datenbestand und prüfe stichprobenartig Kurs und Personen.
2. Wähle oben **Backup**. Offene gültige Eingaben werden zuerst abgeschlossen
   und gespeichert. Bei einer ungültigen Eingabe oder einem Speicherfehler
   startet kein Download.
3. Die Sicherung wird mit dem aktuellen Sitzungspasswort verschlüsselt.
4. Prüfe anschließend im Downloadordner, ob eine Datei wie
   `notenverwaltung_backup_<Zeitstempel>.enc.json` tatsächlich vorhanden ist.
5. Bewahre die Datei sicher auf und halte das zugehörige Passwort getrennt fest.

Die Meldung **„Backup-Download gestartet“** bestätigt nur, dass der Browser den
Download angestoßen hat. Eine sichtbare Datei bestätigt nur ihre Anwesenheit. Ob sie
lesbar und vollständig ist, zeigt erst eine kontrollierte Wiederherstellungsprobe in einem getrennten Testbestand.

## Backup wiederherstellen

Erstelle vor jeder Wiederherstellung zuerst ein Backup des aktuellen
Zielbestands. Öffne dann **Import / Export** und dort **Backup wiederherstellen**.

1. Entscheide vor der Dateiauswahl zwischen den beiden Verfahren:
   - Ohne Häkchen wird der Zielbestand nach Bestätigung vollständig ersetzt.
   - Mit **Merge-Modus** werden Quelle und Ziel zusammengeführt. Bei gemeldeten
     Konflikten bleiben die vorhandenen lokalen Werte erhalten.
2. Wähle die Backup-Datei aus.
3. Gib das Passwort ein, mit dem dieses Backup auf dem Quellgerät erstellt wurde.
4. Prüfe die angezeigten Mengen und das genannte Zielverfahren.
5. Bestätige die Übernahme. Beim vollständigen Ersetzen folgt eine zweite Warnung.
6. Sperre oder lade die Anwendung danach neu und kontrolliere wichtige Inhalte.

Das Quellpasswort entschlüsselt nur die ausgewählte Sicherungsdatei. Der übernommene
Bestand wird anschließend mit dem bereits eingerichteten Passwort des Zielbrowsers
gespeichert. Beide Passwörter dürfen verschieden sein. Bei einem neuen Zielbrowser richtest du daher zuerst ein Zielpasswort ein und gibst beim Import zusätzlich das Passwort des Quellbackups ein.

Auch **vollständig ersetzen** überträgt nicht sämtliche Einstellungen: Halbjahresgrenzen
und Halbjahresnamen des Zielbrowsers bleiben erhalten. Prüfe diese Angaben nach der Wiederherstellung gesondert.

## Welches Austauschformat ist richtig?

| Format | Zweck | Wieder in die Anwendung einlesen? | Schutz |
| --- | --- | --- | --- |
| **Verschlüsseltes Backup** (`.enc.json`) | Vollständiger Datenbestand mit Personen, Kursen, Leistungen und Archiven | Ja, über **Backup wiederherstellen** | Verschlüsselt; Passwort erforderlich |
| **CSV für Import** (`.csv`) | Kurs-, Personen- und Zuordnungsdaten austauschen oder gesammelt erfassen | Ja, über **CSV-Import** | Nicht verschlüsselt; keine vollständige Notensicherung |
| **Excel für Kolleg:innen** (`.xlsx`) | Lesbare Notenübersicht weitergeben; ein Arbeitsblatt je Kurs | Nein | Nicht verschlüsselte Excel-Arbeitsmappe |

Der Excel-Export ist eine echte XLSX-Arbeitsmappe. Zahlen bleiben Zahlen,
Namen und andere Texte werden als Text gespeichert. Die Datei ist als Leseansicht gedacht. Für einen Import in
die Notenverwaltung verwende CSV; für eine vollständige Sicherung ausschließlich
das verschlüsselte Backup. CSV- und Excel-Dateien können personenbezogene Daten
im Klartext enthalten und müssen entsprechend geschützt werden.

## Auf ein anderes Gerät umziehen

1. Erstelle auf dem Quellgerät aus dem richtigen Browserprofil ein neues Backup
   und prüfe die heruntergeladene Datei.
   Vor dem Versionswechsel alle Fenster der alten Fassung schließen.
2. Übertrage eine frische endgültige `Notenverwaltung.html` und die verschlüsselte
   Backup-Datei auf sicherem Weg. Übermittle das Backup-Passwort getrennt.
3. Öffne auf dem Zielgerät die HTML-Datei im vorgesehenen Browser und richte das
   Zielpasswort ein.
4. Stelle das Backup wie oben beschrieben wieder her. Auf einem leeren Ziel ist
   **vollständig ersetzen** in der Regel die passende Wahl.
5. Lade neu, entsperre mit dem Zielpasswort und vergleiche Kurse, Personen,
   Leistungen, Noten und Archive stichprobenartig mit der Quelle. Prüfe außerdem
   die am Ziel erhaltenen Halbjahresgrenzen und Halbjahresnamen.

Das Kopieren der HTML-Datei, Git oder eine Ordnersynchronisierung übertragen die
Browserdaten nicht. Für den Datenumzug ist die verschlüsselte Backup-Datei nötig.

## Kurssymbole und Kurse ohne Leistungen

Beim Anlegen eines Kurses und unter **Kurse → Kurs bearbeiten → Allgemeines**
steht die Auswahl **Kurssymbol** bereit. **Automatisch nach Fach** schlägt etwa
Blatt für Biologie, Globus für Geografie und Buch für Sprachen vor. Für andere
Fächer gibt es weitere Symbole; alternativ wählst du eines selbst aus. Die
Vorschau zeigt das Ergebnis. Im bestehenden Kurs wird die Auswahl sofort gespeichert.

Die eigene Auswahl bleibt nach Neuladen, in verschlüsselten Backups und im
Nachfolgekurs erhalten. Beim Zusammenführen gilt für vorhandene Kurse die
lokale Auswahl. Eine CSV-Datei überträgt keine Symbolwahl.

In der Sek-I-Notenansicht werden zugeordnete Schüler:innen bereits angezeigt,
wenn noch keine Leistung angelegt ist. Die Namenssuche funktioniert auch dort.

## Hinweis zum aktuellen Prüfstand

Der aktuelle technische Stand, die noch ausstehenden Desktopfälle und die
Grenzen stehen in [ABNAHME.md](ABNAHME.md). Frühere persönliche Stichproben
belegen nur ihre jeweils genannte Fassung. Ein Geräteumzug benötigt eine
kontrollierte Wiederherstellungsprobe im Zielbrowser und eine aufbewahrte
Quellsicherung.
