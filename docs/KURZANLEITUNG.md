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

Beim ersten Start richtest du ein Passwort mit mindestens sechs Zeichen und einen
Wiederherstellungscode ein. Gib das Passwort zweimal ein. Sichere anschließend
den vollständig angezeigten Code getrennt von deinen Backup-Dateien, zum Beispiel
auf einem sicher verwahrten Ausdruck. **Code drucken** enthält nur Code, Datum und
nicht geheime Kennungen, keine Noten oder Schülerdaten. Nach **Code gesichert –
weiter** verschwindet die Anzeige; gib den Code aus deiner gesicherten Kopie
vollständig erneut ein. Erst **Code bestätigen und speichern** übernimmt den
neuen Schutz. Abbruch vor diesem Schritt lässt die Einrichtung unverbindlich.

Der Code ist ein zweiter gleichwertiger geheimer Zugang. Wer Code und passende
Sicherung besitzt, kann deren Daten lesen. Trage weder Passwort noch Code in
Dateinamen, Supportnachrichten oder ungeschützte Begleitdateien ein. Nach Abschluss
zeigt die Anwendung den Code nicht erneut an. Lade das angebotene neue Backup
herunter und prüfe den Downloadordner.

Bei einem bisherigen Bestand ohne Code funktioniert das bisherige Passwort
weiter. Unter **Einstellungen → Sicherheit** bietet **Wiederherstellungscode jetzt
einrichten** eine freiwillige Nachrüstung. Dafür bestätigst du dein aktuelles
Passwort. Die Nachrüstung verwendet ein neues Datenformat: ältere HTML-Versionen
können neue Bestände und Sicherungen nicht lesen. Eine verschlüsselte Alt-Kopie
kannst du dort herunterladen; sie benötigt weiterhin ihr bisheriges Passwort.

### Zugang mit Code wiederherstellen

1. Wähle im Start-Passwortdialog oder auf dem Sperrbildschirm **Zugang
   wiederherstellen**. Die Anwendung muss zuerst den Bestand für dieses Fenster
   freigeben; sperre gegebenenfalls das andere Fenster.
2. Wähle den **lokalen Bestand** oder eine **Sicherungsdatei** mit Codezugang und
   gib den zu genau dieser Generation gehörenden Code vollständig ein.
3. Nach erfolgreicher Prüfung erscheinen Mengen und authentifizierte
   **Sicherungszeit**. Bei einer Dateiwiederherstellung musst du das vollständige
   Ersetzen eines vorhandenen lokalen Bestands ausdrücklich bestätigen.
4. Lege ein neues Passwort zweimal fest. Sichere und bestätige den neu erzeugten
   Code wie bei der Ersteinrichtung. Erst danach wird gespeichert.
5. Erstelle ein neues Backup und kontrolliere den wiederhergestellten Bestand.

Eine Wiederherstellung erzeugt neue Zugangsdaten. Der alte Code öffnet den neuen
Bestand nicht. Bereits vorhandene Dateien bleiben unverändert und benötigen ihre
damaligen Zugangsdaten. Nach einer nicht bestätigten Speicherung öffne die
Anwendung erneut und prüfe den Bestand mit den bisherigen oder den neu bestätigten
Zugangsdaten; bewahre vorhandene Sicherungen auf.

Unter **Einstellungen → Sicherheit → Code prüfen** kannst du den lokalen Bestand
oder eine Datei mit Code vollständig prüfen, ohne Daten zu übernehmen. Angezeigt
werden nur Status, Datum und Kennungen, kein gespeicherter Code.
**Code ersetzen** hilft bei verlorenem oder offengelegtem Code, solange das
Passwort bekannt ist. Dabei darf das Passwort gleich bleiben; der neue Code muss
erneut gesichert und vollständig bestätigt werden. **Passwort ändern** benötigt
das bisherige Passwort und erzeugt ebenfalls einen neuen Code. Bei bisherigen
Beständen ohne Code wird dabei der Codezugang eingerichtet. Erstelle danach ein
neues Backup. Alte Archive und Sicherungen ändern sich durch diese Vorgänge nicht.

Sind sowohl Passwort als auch der passende Code verloren, gibt es keinen Reset,
kein Masterpasswort und keinen Support-Zugang. Alte Sicherungen ohne Codezugang
benötigen ihr damaliges Passwort. Die neue Funktion kann einen bereits gesperrten
Bestand ohne zuvor eingerichteten Code nicht nachträglich öffnen.

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
3. Die Sicherung wird mit dem aktuellen lokalen Schutz verschlüsselt. Bei eingerichtetem Codezugang öffnen das aktuelle Passwort oder der zugehörige Code die Datei.
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
3. Gib das damalige Passwort der Datei ein. Bei einer neuen Sicherung mit Codezugang kannst du im Passwortdialog auch **Zugang wiederherstellen** und den zugehörigen Code wählen.
4. Prüfe die angezeigten Mengen und das genannte Zielverfahren.
5. Bestätige die Übernahme. Beim vollständigen Ersetzen folgt eine zweite Warnung.
6. Sperre oder lade die Anwendung danach neu und kontrolliere wichtige Inhalte.

Das Quellpasswort entschlüsselt nur die ausgewählte Sicherungsdatei. Der übernommene
Bestand wird anschließend mit dem bereits eingerichteten Passwort des Zielbrowsers
gespeichert. Ein eingerichteter lokaler Code und seine Generation bleiben beim normalen Import ebenfalls erhalten. Beide Passwörter dürfen verschieden sein. Bei einem neuen Zielbrowser richtest du daher zuerst ein Zielpasswort ein und gibst beim Import zusätzlich das Passwort des Quellbackups ein.

Auch **vollständig ersetzen** überträgt nicht sämtliche Einstellungen: Halbjahresgrenzen
und Halbjahresnamen des Zielbrowsers bleiben erhalten. Prüfe diese Angaben nach der Wiederherstellung gesondert.

## Welches Austauschformat ist richtig?

| Format | Zweck | Wieder in die Anwendung einlesen? | Schutz |
| --- | --- | --- | --- |
| **Verschlüsseltes Backup** (`.enc.json`) | Vollständiger Datenbestand mit Personen, Kursen, Leistungen und Archiven | Ja, über **Backup wiederherstellen** | Verschlüsselt; damaliges Passwort oder eingerichteter Code erforderlich |
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
