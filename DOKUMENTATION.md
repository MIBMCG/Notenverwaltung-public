# Notenverwaltungsprojekt - Dokumentation

## Für Lehrkräfte

`Notenverwaltung.html` per Doppelklick im Browser öffnen. Für die Nutzung sind
keine Installation, kein Server, keine Internetverbindung, kein Node.js und kein
npm erforderlich. Unter **Einstellungen → Schule und Logo** lassen sich der
Schulname und ein eigenes PNG-Bild auswählen. Ohne nutzbares Logo bleibt die
Anwendung bedienbar und druckbereit.

Der verschlüsselte Datenbestand liegt im lokalen Browserprofil und ist an
dessen Speicherbereich und Öffnungsart gebunden. Die HTML-Datei enthält keine
eingegebenen Noten. Vor einem Update im alten Fenster sichern, den Download
prüfen und alle Fenster der alten Fassung schließen. Danach im Zielbrowser den
erwarteten Bestand prüfen. Version 1.6.0 ist ein unveröffentlichter
Desktop-Prüfkandidat; [Prüfstand und Grenzen](docs/ABNAHME.md) nennen den
Status der Browserabnahme.

## Für die Entwicklung

Für Entwicklung und Veröffentlichung wird Node.js ab Version 20 benötigt. Nach
dem Klonen oder Wechseln des Arbeitsstands zuerst `npm ci` ausführen, danach
`npm test`, `npm run build` und `npm run verify:artifact`. Der Build erzeugt die
verfolgte, eigenständige `Notenverwaltung.html`; die Artefaktprüfung vergleicht
sie bytegenau mit den Quellen. Diese Werkzeuge werden nicht für die Nutzung der
ausgelieferten HTML-Datei benötigt.

`de-DE` ist das Standard-Gebietsschema der Anwendung. Gespeicherte Datums- und
Zahlenwerte bleiben gebietsschemaunabhängig; spätere Formatierer dürfen ein
anderes Gebietsschema und eine andere Zeitzone annehmen, ohne fachliche oder
gespeicherte Werte zu verändern.

## 1. Projektueberblick

Das Projekt ist eine lokale Browser-Anwendung zur Verwaltung von Kursen, Schuelerinnen und Schuelern, Leistungsnachweisen, Noten und Statistiken. Die Anwendung richtet sich an Lehrkraefte; Schulname und Logo sind an die eigene Schule anpassbar.

Die Anwendung besteht im Kern aus einer einzigen Datei:

- `Notenverwaltung.html`: HTML, CSS und JavaScript der kompletten Anwendung.
- `placeholder-logo.svg`: neutrales NV-Platzhalterlogo als optionale Begleitdatei; ein eigenes `Logo.png` oder eine PNG-Auswahl in den Einstellungen hat Vorrang.

Für die Entwicklung gibt es einen reproduzierbaren Build mit gepinnten
Entwicklungswerkzeugen; die ausgelieferte Datei benötigt weiterhin keine
Paketverwaltung und keine Serverkomponente. `Notenverwaltung.html` kann direkt
im Browser geöffnet werden. Alle Nutzdaten werden lokal im Browser gespeichert.

Programmfassung: **1.6.0, unveröffentlichter Prüfkandidat**. Ein
Veröffentlichungsdatum wird erst für den finalen Build gesetzt. Die letzte
private Freigabe war 1.5.1. Maßgeblich sind die
[Release-Hinweise für 1.6.0](docs/releases/1.6.0.md).
Die sichtbare Versionsnummer ist unabhängig von `state.version`, das nur das
gespeicherte Datenformat bezeichnet. Ältere Prüfnachweise und Versionsangaben
in den folgenden Abschnitten sind historische Zwischenstände.

Kurssymbole: `src/domain/course-symbols.js` enthält den festen SVG-Katalog,
stabile IDs und die Fachautomatik; `src/ui/course-symbol-picker.js` erzeugt
Vorschau und Auswahl. Ein Kurs speichert optional `symbolId`. Fehlende oder
unbekannte Werte verwenden die Fachautomatik, ohne Änderung der Datenversion.
Kursnachfolger erben die Auswahl. JSON-Sicherungen erhalten sie; beim Merge
bleibt für bestehende Kurse die lokale Auswahl maßgeblich. CSV dient weiterhin
dem fachlichen Kurs-/Personenaustausch und überträgt keine Symbolwahl.

## 2. Start und Nutzung

### Anwendung starten

1. Den Projektordner oeffnen.
2. `Notenverwaltung.html` in einem nach der Desktopabnahme unterstützten
   Dateibrowser oeffnen.
3. Beim ersten Start die Verschluesselung einrichten, wenn die Anwendung dies verlangt.

### Schule und Logo anpassen (ab 1.4.0)

Unter **Einstellungen → Schule und Logo** einen Schulnamen eingeben und optional
ein PNG-Bild auswählen (maximal 256 KiB, 4096 × 4096 Pixel). Nach **Schule und Logo
speichern** erscheint der Name in Seitenleiste, Browsertitel, „Über die Anwendung“
und Druckausgaben. Ein leerer Name blendet die Schulbezeichnung aus. Der
Sperrbildschirm bleibt neutral, weil die Einstellungen verschlüsselt sind.

Das ausgewählte PNG darf beliebig heißen und wird direkt im verschlüsselten
Datenbestand gespeichert. Beim vollständigen Wiederherstellen eines Backups
werden Schulname und Logo übernommen; beim Zusammenführen von Beständen bleibt
das lokale Schulprofil erhalten. CSV und Excel übertragen das Schulprofil nicht.
Die kleinere Grenze gilt nur für eine neue Dateiauswahl: Bereits gespeicherte
gültige Logos innerhalb der bisherigen 2-MiB-Grenze bleiben in Beständen und
Backups erhalten. Entscheidend sind PNG-Inhalt, erfolgreiche Bilddecodierung
und Bildmaße; eine fehlende oder abweichende MIME-Bezeichnung allein führt nicht
zur Ablehnung. Die Dateigrenze garantiert keinen freien Browserspeicher.

**Logo entfernen** blendet das Bild aus und schaltet die Dateisuche ab. **Logo aus
Programmordner verwenden** sucht zuerst `Logo.png`, danach `placeholder-logo.svg` neben
der HTML-Datei. Die Begleitdateien gehören nicht zum Backup. Der Druck wartet
kurz auf das Logo und druckt bei fehlendem oder fehlerhaftem Bild ohne Logo weiter.

Neue Bestände beginnen ohne Schulnamen. Alte Bestände ohne Schulprofil erhalten
bei der Migration zunächst „Meine Schule“, das frei geändert werden kann.
Bereits ausdrücklich gespeicherte Schulnamen und eigene Logos bleiben erhalten.
Die Entwickler- und Lizenzangaben werden durch die Schulwahl nicht geändert.

### Technische Voraussetzungen

Die Anwendung benoetigt einen Browser mit Unterstuetzung fuer:

- `localStorage`
- Web Locks für die exklusive Bearbeitung eines Browserbestands
- Web Crypto API (`crypto.subtle`)
- `FileReader`
- Blob-Downloads ueber temporaere Objekt-URLs
- moderne DOM-APIs

Das frühe M06-Architekturgate für `file:` wurde mit Edge, Chrome und Firefox
abgeschlossen. Die vollständige Desktopabnahme der integrierten Fassung 1.6.0
steht noch aus; bis dahin wird keine verbindliche Browserliste behauptet.
Fehlt die verlässliche Sperre, bleibt die Bearbeitung deaktiviert. Andere
Profile und Öffnungspfade können getrennte Bestände haben. Safari/macOS sind
für diese Fassung noch nicht real geprüft.

## 3. Architektur

Die Anwendung ist als Single-File-App aufgebaut. Im HTML-Dokument gibt es einen Root-Container:

```html
<div id="app" class="app-root"></div>
```

Beim Laden der Seite startet die Anwendung ueber:

```js
document.addEventListener("DOMContentLoaded", async function () {
  await UiShell.init("app");
});
```

### Hauptmodule

#### UI-Hilfsdialoge

Am Anfang des Skriptbereichs werden eigene Dialogfunktionen definiert:

- `window.promptText(...)`: asynchroner Textdialog.
- `window.promptPassword(...)`: asynchroner Passwortdialog mit optionaler Bestaetigung.

Diese Dialoge ersetzen einfache Browser-Prompts und werden unter anderem fuer Verschluesselung, Import und Einstellungen verwendet.

#### `DomainModel`

`DomainModel` definiert das Datenmodell und zentrale Factory- und Hilfsfunktionen. Es erzeugt und normalisiert die fachlichen Objekte der Anwendung.

Wichtige Aufgaben:

- Konstanten fuer Bewertungsschemata und Score-Status.
- Erzeugung neuer IDs.
- Erzeugung leerer States.
- Erzeugung von Schueler-, Kurs-, Kategorie-, Gewichtungs- und Leistungsobjekten.
- Suchen und Listen von Kursen, Schueler:innen und Leistungsnachweisen.
- Einschreiben von Schueler:innen in Kurse.
- Entfernen von Kursen und Schueler:innen inklusive referenzieller Bereinigung.
- Migration und Reparatur alter oder unvollstaendiger gespeicherter Daten ueber `ensureStateShape`.

Wichtige Funktionen:

- `createEmptyState()`
- `createStudent(...)`
- `createCourse(...)`
- `createCategory(...)`
- `createWeightTemplate(...)`
- `createScoreEntry(...)`
- `createAssessment(...)`
- `findStudentById(...)`
- `findCourseById(...)`
- `findAssessmentById(...)`
- `listAssessmentsForCourse(...)`
- `listEnrollmentsForCourse(...)`
- `enrollStudentInCourse(...)`
- `ensureStateShape(...)`

#### `Storage`

`Storage` kapselt das Laden, Speichern, Verschluesseln, Entschluesseln und Zuruecksetzen des Anwendungszustands.

Wichtige Aufgaben:

- Speichern des kompletten States im Browser-`localStorage`.
- Verpflichtende Verschluesselung des gespeicherten Zustands.
- Session-Passwort nur im Arbeitsspeicher halten.
- Automatisches Sperren der Sitzung nach Inaktivitaet.
- Export und Import verschluesselter Backups.
- Rueckwaertskompatibilitaet zu alten Klartext- oder aelteren verschluesselten Speicherformaten.

Wichtige `localStorage`-Keys:

- `notenverwaltung_v1_state`: Legacy-Klartextzustand.
- `notenverwaltung_v1_encrypted`: Flag fuer aktive Verschluesselung.
- `notenverwaltung_v1_state_enc`: verschluesselter Payload.
- `notenverwaltung_v1_salt`: Salt fuer die lokale Verschluesselung.
- `notenverwaltung_theme`: gespeichertes Theme.

Wichtige Funktionen:

- `loadState()`
- `saveState(state)`
- `resetState()`
- `enableEncryption(password, state)`
- `changePassword(oldPassword, newPassword)`
- `isEncrypted()`
- `hasSessionPassword()`
- `lockSession()`
- `setSessionTimeoutMinutes(minutes)`
- `getSessionTimeoutMinutes()`
- `exportStateEncrypted(password, state)`
- `importStateEncryptedFromText(text, password)`
- `encryptForBackup(json)`

#### `GradingLogic`

`GradingLogic` enthaelt die fachliche Notenlogik.

Wichtige Aufgaben:

- Striktes Parsen exakter Notenlabels fuer Sek I.
- Parsen ausschliesslich ganzzahliger Oberstufenpunkte von 0 bis 15.
- Validierung roher Eingaben.
- Umwandlung von Score-Eintraegen in numerische Werte.
- Durchschnittsberechnung je Kategorie und Unterkategorie.
- Gesamtberechnung je Schueler:in und Kurs.
- Halbjahrsfilterung inklusive optionalem Einbezug des vorherigen Halbjahrs.
- Kursstatistik mit Mittelwert, Median und Verteilung.

Wichtige Funktionen:

- `parseGradeLabel(label, mapping)`
- `parseUpperSecPoints(label)`
- `isValidRawForCourse(raw, course, settings)`
- `getNumericScoreForEntry(scoreEntry, course, settings)`
- `getUpperSecGradeLabel(points)`
- `validatePercentageThresholds(scale, thresholds, fallbackLabel)`
- `computeCategoryAverage(assessments, course, studentId, categoryId, settings)`
- `computeWeightedOverallForAssessments(assessments, course, studentId, settings)`
- `computeOverallGrade(course, studentId, state)`
- `computeCourseStatistics(course, state)`

#### `UiShell`

`UiShell` rendert die komplette Benutzeroberflaeche, verwaltet Navigation und ruft Speicher- und Fachlogik auf.

Wichtige Aufgaben:

- Initialisierung der App ueber `UiShell.init("app")`.
- Laden und Speichern des States.
- Theme-Umschaltung hell/dunkel.
- Kopfbereich mit Logo, Kursauswahl, Backup und Reset.
- Navigation zwischen den Bereichen.
- Rendering der Kursverwaltung, Stammdaten, Notentabelle, Statistik, Einstellungen, Import/Export und Klausurnotenrechner.
- Reaktion auf Session-Sperre.
- Neuberechnung von Leistungs-Halbjahren nach geaenderten Halbjahreseinstellungen.

Hauptbereiche der Navigation:

- `gradesheet`: Noten
- `courses`: Kurse
- `students`: Stammdaten
- `stats`: Statistik
- `settings`: Einstellungen
- `import`: Import / Export
- `exam`: Klausurnotenrechner

## 4. Zentrale Funktionalitaeten

### 4.1 Kursverwaltung

In der Kursverwaltung werden Kurse angelegt und gepflegt. Ein Kurs enthaelt unter anderem:

- Kursname
- Fach
- Klasse oder Kursbezeichnung
- Bewertungsschema
- Gewichtungsvorlage
- Option zum Einbezug des vorherigen Halbjahrs
- optionale eigene Halbjahrs-Stichtage
- Einschreibungen von Schueler:innen
- Archivstatus, Archivgrund und Archivzeitpunkt
- optionales Aufbewahrungsdatum und eine Verwaltungsnotiz
- optionales Ursprungsjahr und Verweis auf einen Vorgaengerkurs
- einen Snapshot der beim Archivieren gueltigen Bewertungsgrundlagen

Archivierte Kurse bleiben mit Einschreibungen, Leistungen und Scores im verschluesselten Gesamtstate. Sie werden in aktuellen Kurslisten, Noteneingabe, Statistik und Standardexporten ausgeblendet. Beim manuellen Archivieren koennen ein Aufbewahrungsdatum und eine Notiz erfasst werden; beim Schuljahreswechsel gelten die Angaben gemeinsam fuer alle alten Kurse. Beide Verwaltungsangaben lassen sich spaeter ueber `Aufbewahrung bearbeiten` korrigieren, waehrend Leistungen und Bewertungsgrundlagen unveraendert bleiben. In der Kursverwaltung oeffnet `Ansehen` eine schliessbare, tastaturbedienbare In-App-Nur-Lese-Ansicht mit Kursmetadaten, Schuelerliste und Leistungsuebersicht. Daneben koennen Archive verschluesselt exportiert oder wiederhergestellt werden. Der Archivexport nimmt neben eingeschriebenen Schueler:innen auch alle nur noch ueber Score-Schluessel referenzierten Schueler:innen auf. Schueler:innen mit Bezug zu einem archivierten Kurs koennen nicht global geloescht werden. Es erfolgt keine automatische Loeschung; das Datum dient ausschliesslich als Pruefhinweis.

Bewertungsschemata:

- `grades`: Sek-I-Noten von 1 bis 6, inklusive Tendenzen wie `1+`, `2-`.
- `uppersec`: Sek-II-Oberstufenpunkte von 0 bis 15.

Die Auswahl des Schemas beeinflusst direkt Eingabevalidierung, Berechnung, Statistik und Anzeige.

### 4.2 Stammdatenverwaltung

Die Stammdatenverwaltung pflegt die globale Schuelerliste. Ein Schuelerobjekt enthaelt:

- ID
- Nachname
- Vorname
- Geburtsdatum
- Stammklasse

Schueler:innen koennen Kursen zugeordnet werden. Die Zuordnung selbst liegt im jeweiligen Kurs als `enrollments`-Liste.

Die Schuelerdetailansicht, der Einzel-Schuelerdruck und der Sammeldruck unterscheiden aktive und archivierte Kurse. Aktive Kurse werden weiterhin mit den aktuellen globalen Einstellungen ausgewertet. Archivierte Kurse verwenden dagegen durchgaengig `gradeMapping`, Kategorien und Unterkategorien, die gespeicherte Gewichtungsvorlage sowie Halbjahrsnamen und -grenzen aus `archiveSnapshot`; spaetere globale Aenderungen verschieben historische Werte oder Bezeichnungen daher nicht. Fuer die Gesamtnote wird das juengste im Archivkurs selbst gespeicherte Halbjahr als Bezugsterm verwendet. Ist `includePrevTermGrades` aktiviert, wird dessen historischer Vorgaengerterm einbezogen; das heutige Datum filtert alte Leistungen nicht aus. Im Sammeldruck erscheinen Archive als klar gekennzeichneter Archivbereich. Beruecksichtigt werden sowohl archivierte Einschreibungen als auch Personen, die nur noch ueber einen Score referenziert sind. Ein ausgewaehlter aktiver Kursfilter beschraenkt den Sammeldruck auf genau diesen aktiven Kurs und zieht keine Archive irrtuemlich hinzu.

### 4.3 Notentabelle

Die Notentabelle ist der zentrale Arbeitsbereich fuer Leistungsnachweise und Einzelleistungen.

In der bearbeitbaren Notenansicht oeffnet **Neue Leistung anlegen** direkt das
vorhandene Formular fuer den aktuellen Kurs und fokussiert dessen Kategorie.
**Leistungen verwalten** bleibt daneben erhalten. Noch offene Noteneingaben
werden vorher abgeschlossen; eine ungueltige Eingabe oder ein fehlgeschlagener
Speichervorgang verhindert den Wechsel und bleibt zur Korrektur sichtbar.

Ein Leistungsnachweis enthaelt:

- Kursbezug
- Kategorie
- optionale Unterkategorie
- Titel
- Datum
- Halbjahr (`term`)
- Herkunft der Halbjahrszuordnung (`termAssignment`: `auto` oder `manual`)
- maximale Punktzahl
- Gewicht
- PDF-Sichtbarkeit
- Score-Eintraege pro Schueler:in

Der Schalter `In PDF-Berichten anzeigen` steuert ausschliesslich, ob eine Leistung in Einzel- und Sammel-PDFs erscheint und dort in den berichteten Durchschnitt eingeht. Eine fuer PDFs ausgeblendete Leistung bleibt in der Notentabelle sichtbar und wird weiterhin in Statistik und interner Notenberechnung beruecksichtigt. Damit kann eine Lehrkraft eine Leistung intern weiterfuehren, ohne sie bereits in einem Bericht an Schueler:innen oder Eltern auszugeben. Ist fuer einen Kurs die Einbeziehung des Vorhalbjahrs aktiviert, verwenden Einzel- und Sammelbericht fuer den Gesamtdurchschnitt dieselbe sichtbare Leistungsmenge aus ausgewaehltem und vorherigem Halbjahr; der Sammelbericht kennzeichnet diesen Wert ausdruecklich als `Gesamtdurchschnitt inkl. Vorhalbjahr`.

Score-Eintraege enthalten:

- `valueRaw`: eingegebener Originalwert.
- `status`: Status des Eintrags.
- `valueNumeric`: optional gespeicherter numerischer Wert.

Unterstuetzte Statuswerte:

- `valid`: gueltiger Wert.
- `missing`: fehlend.
- `excused`: entschuldigt.

Alle Notentabellenpfade, einschliesslich der getrennten aktuellen und vorherigen Halbjahrestabellen, validieren Eingaben vor der Speicherung. Eine leere Eingabe ist mit Status `valid` nicht zulaessig. Ungueltige Sek-I-Labels oder nicht ganzzahlige bzw. ausserhalb von 0 bis 15 liegende Sek-II-Punkte bleiben ungespeichert und werden direkt am Feld rot mit einer Fehlermeldung markiert. Beim Wechsel auf `missing` oder `excused` wird `valueNumeric` sofort geleert; beim Wechsel zurueck auf `valid` wird der vorhandene Rohwert erneut validiert und numerisch berechnet. Zellfarbe und betroffene Halbjahresdurchschnitte werden nach erfolgreicher verschluesselter Speicherung unmittelbar aktualisiert.

Fehlende oder entschuldigte Werte werden bei Berechnungen nicht als regulaere Leistungswerte behandelt.

### 4.4 Notenberechnung

Die Gesamtberechnung erfolgt in `GradingLogic.computeOverallGrade(course, studentId, state)`.

Die Berechnung arbeitet grob in diesen Schritten:

1. Alle Leistungsnachweise des Kurses laden.
2. Aktuelles Halbjahr anhand der zentralen Halbjahreseinstellungen bestimmen.
3. Optional vorheriges Halbjahr einbeziehen, wenn `course.includePrevTermGrades` aktiv ist.
4. Aktive Kategorien bestimmen.
5. Gewichtungsvorlage des Kurses laden oder ersatzweise gleichverteilt rechnen.
6. Kategorie- oder Unterkategoriedurchschnitte berechnen.
7. Kategorieergebnisse gemaess Gewichtung zu einem Gesamtergebnis kombinieren.

Die gemeinsame Funktion `computeWeightedOverallForAssessments(...)` führt diese Gewichtung auch für bereits nach Halbjahr oder Druckumfang gefilterte Leistungsmengen aus. Hauptberechnung, Schülerdetail, Einzel- und Sammeldruck sowie beide Notentabellen verwenden dadurch dieselbe Regel: Vorlageneinträge deaktivierter Kategorien werden vor der Berechnung entfernt; die verbleibenden tatsächlich beitragenden Gewichte werden über ihre Summe renormalisiert.

Bei Sek I gilt: niedrigere numerische Werte sind besser. Zulaessige Standardlabels sind ausschliesslich `1+`, `1`, `1-`, fortgesetzt bis `5-`, sowie `6`; `6+` und `6-` gehoeren nicht zur Standardskala. Die Eingabe akzeptiert nur ein exaktes Standardlabel oder einen exakten vorhandenen Mapping-Schluessel. Teilstrings wie `3abc` und freie Dezimalnoten wie `2,5` oder `2.5` werden abgelehnt. `ensureStateShape` ergaenzt fehlende Standardlabels aus dem Standardmapping, ohne vorhandene oder benutzerdefinierte Werte zu ueberschreiben.

Die Dezimalwerte des Sek-I-Mappings sind eine schulinterne Rechenkonvention und keine amtliche Berliner Umrechnung. Das Schema bildet das sechsstufige Notensystem ab. Das gesonderte 0-15-Punkte-System fuer ISS/Gemeinschaftsschulen nach Anlage 5 wird nicht unterstuetzt; ein vollstaendiger ER-/GR-Modus ist nicht Bestandteil der Anwendung.

Bei Sek II werden ausschliesslich ganze Punkte von 0 bis 15 gespeichert und eingegeben. Die feste Zuordnung lautet: `15/14/13 = 1+/1/1-`, `12/11/10 = 2+/2/2-`, `9/8/7 = 3+/3/3-`, `6/5/4 = 4+/4/4-`, `3/2/1 = 5+/5/5-`, `0 = 6`. Sie dient als nicht editierbare Orientierung. Dezimale Rechenmittel bleiben rechnerische Zwischenwerte und setzen keine Zeugnis- oder Kursnote automatisch fest; die Anwendung erfindet keine Rundungsregel.

### 4.5 Kategorien, Unterkategorien und Gewichtungen

Standardkategorien:

- Muendlich
- Schriftlich
- Sonstiges

Neue Einstellungen enthalten folgende klar beschriftete, anpassbare Berliner Profile (bei den Standardkategorien):

- Sek I mit Klassenarbeiten: 50 Prozent schriftlich, 40 Prozent muendlich, 10 Prozent sonstige Leistungen.
- Oberstufe mit einer Klausur: 33,33 Prozent schriftlich, 56,67 Prozent muendlich, 10 Prozent sonstige Leistungen.
- Oberstufe mit zwei Klausuren: 50 Prozent schriftlich, 40 Prozent muendlich, 10 Prozent sonstige Leistungen.

Jedes Profil summiert sich exakt auf 100 Prozent. Die Verteilung des nichtschriftlichen Anteils ist ein nachvollziehbares Beispiel und kann angepasst werden. Genaue schulische Regeln, Fachkonferenzbeschluesse und Sonderfaelle sind vor der Nutzung zu pruefen. Bei fehlender Kategorie `Sonstiges` wird deren Anteil dem muendlichen Bereich zugeschlagen.

Alte Zustaende behalten alle Vorlagen-IDs und Kurszuordnungen. Eine vorhandene Vorlage `Standard Sek I (67/33)` wird lediglich in `Altbestand Sek I (67/33) - Fachkonferenz pruefen` umbenannt; ihre Gewichte und Kursverweise werden nicht veraendert. Die neuen Profile werden ergaenzt, aber keinem bestehenden Kurs automatisch zugewiesen.

Kategorien koennen Unterkategorien besitzen. Hierarchisch wird erst gerechnet,
wenn jede Leistung der Kategorie einer vorhandenen Unterkategorie zugeordnet ist
und jede tatsaechlich verwendete Unterkategorie ein endliches positives Gewicht
hat. Dann wird zuerst innerhalb der Unterkategorien gemittelt; anschliessend
werden die Unterkategorie-Mittelwerte anhand ihrer Prozentgewichte kombiniert.
Solange die Einrichtung unvollstaendig ist, bleibt fuer die gesamte Kategorie
die flache Berechnung aktiv. Dadurch werden unzugeordnete Leistungen, Verweise
auf geloeschte Unterkategorien oder Leistungen in einer noch mit 0 Prozent
gewichteten Unterkategorie nicht still ignoriert. Die erste neu angelegte
Unterkategorie startet mit 100 Prozent, jede weitere mit 0 Prozent.

### 4.6 Halbjahre

Die Anwendung verwaltet Halbjahre zentral getrennt fuer Sek I und Sek II. In den Einstellungen koennen Schuljahresbeginn, Ende von H1 und Start von H2 gesetzt werden. Der H2-Beginn ist die massgebliche Zuordnungsgrenze. Das H1-Ende ist informativ: Tage in einer Luecke zwischen H1-Ende und H2-Beginn bleiben H1; bei einer Ueberlappung hat H2 ab seinem Beginn Vorrang.

Der gespeicherte Halbjahrswert eines Leistungsnachweises hat das Format:

```text
YYYY-H1
YYYY-H2
```

Beispiele:

- `2025-H1`
- `2025-H2`

Fuer Sek II koennen die Halbjahre in der UI als Q-Phasen dargestellt werden, die interne Speicherung bleibt jedoch im H-Format.

Jede Leistung speichert ausserdem die Herkunft ihrer Zuordnung. `termAssignment: "auto"` bedeutet, dass Datum und Stichtage das Halbjahr bestimmen. Aenderungen am Datum oder an globalen beziehungsweise kursbezogenen Stichtagen berechnen nur diese aktiven Leistungen neu. `termAssignment: "manual"` bezeichnet eine ausdrueckliche Auswahl im Editor; sie bleibt bei Neustart und Stichtagsaenderungen erhalten. Archivierte Kurse behalten ihre gespeicherten Zuordnungen unabhaengig von der Herkunft.

Vorhandene kanonische Halbjahre ohne Herkunftsmerkmal werden bei der Migration vorsichtig als `manual` uebernommen, weil ihre fruehere Entstehung nicht sicher feststellbar ist. Fehlt das Halbjahr, darf es nach den bestehenden Regeln abgeleitet und als `auto` markiert werden. Eindeutig korrigierbare Altwerte werden getrimmt und grossgeschrieben, zum Beispiel ` 2025-h2 ` zu `2025-H2`. Unbekannte Werte wie `2025-H3` gelten als Integritaetsfehler; die Anwendung loescht sie nicht und ordnet sie keinem vermuteten Halbjahr zu.

Die Jahresanteile der Stichtage werden als relative Offsets zum Schuljahresbeginn verwendet. Damit gelten dieselben konfigurierten Monats- und Tagesgrenzen auch in folgenden Schuljahren. Kursbezogene Monats-/Tagesgrenzen werden in das jeweils betroffene Schuljahresintervall eingeordnet. `resolveSchoolYearBoundaries` liefert dafuer die gemeinsame Grenze, die sowohl die Leistungszuordnung als auch den aktuellen Auswertungszeitraum versorgt.

### 4.7 Statistik

Die Statistikansicht nutzt `GradingLogic.computeCourseStatistics(course, state)`.

Berechnet werden:

- Anzahl auswertbarer Schueler:innen.
- Mittelwert.
- Median.
- Werteverteilung.

Fuer Sek I werden Verteilungsbereiche wie `1,0-1,9`, `2,0-2,9` usw. verwendet. Fuer Sek II werden Punktbereiche wie `0-4`, `5-9`, `10-12`, `13-15` verwendet.

### 4.8 Einstellungen

Die Einstellungen umfassen:

- Bewertungskategorien.
- Unterkategorien.
- Gewichtungsvorlagen.
- numerisches Notenmapping fuer Sek I.
- zentrale Halbjahreseinstellungen fuer Sek I und Sek II.
- Halbjahrsnamen.
- Verschluesselung.
- Session-Timeout.

Beim ersten Start oder wenn kein verschluesselter Zustand vorhanden ist, wird die Einrichtung der Verschluesselung hervorgehoben.

### 4.9 Import und Export

Die Import-/Export-Ansicht unterstuetzt:

- Wiederherstellen verschluesselter Backups.
- Import von Klartext-JSON.
- optionales Zusammenfuehren importierter Daten mit aktuellem Zustand.
- Export von Kursen und Klassen als CSV fuer den Import auf einem anderen Rechner.
- Export von Kursen und Klassen als echte `.xlsx`-Arbeitsmappe fuer Kolleg:innen ohne dieses Programm.
- Download einer CSV-Vorlage.
- CSV-Massenimport von Kurs- und Schuelerdaten.

Beim Import wird der Zustand ueber `DomainModel.ensureStateShape(...)` normalisiert.

JSON- und Backupimporte werden vor der Uebernahme strukturell und referenziell validiert. Dabei werden auch doppelte Einschreibungen derselben Schueler-ID innerhalb eines Kurses sowie doppelte Unterkategorie-IDs innerhalb eines Archiv-Snapshots abgelehnt. Die Anwendung baut zuerst einen getrennten Kandidaten-State auf und speichert ihn verschluesselt, bevor er zum aktiven Zustand wird. Der Ersetzen-Modus verlangt zwei Bestaetigungen und behaelt die lokalen Halbjahresgrenzen und Halbjahresnamen bei. Das Passwort einer Backup-Datei dient nur zu deren Entschluesselung und aendert nicht das aktuelle Anwendungspasswort.

Beim Zusammenfuehren bleiben Personen- und Leistungs-IDs erhalten. Gleiche Namen oder Leistungstitel begruenden keine gemeinsame Identitaet. Kurse werden ueber ihre ID oder eine eindeutige externe Kennung im passenden Schema-, Schuljahres- und Archivkontext zugeordnet. Widerspruechliche Kursidentitaeten und Leistungs-IDs, die auf einen anderen Zielkurs verweisen, brechen die Uebernahme vor dem Speichern ab. Dadurch fuegt der wiederholte Import desselben Bestands keine Kopien dieser Personen, Kurse oder Leistungen hinzu. Vorhandene lokale Scorewerte und Leistungsmetadaten gewinnen bei Konflikten; die Vorschau und Abschlussmeldung nennen Metadatenkonflikte getrennt von Scorekonflikten.

Kategorien, Unterkategorien und Gewichtungsvorlagen werden auf die passenden lokalen Eintraege abgebildet; dafuer koennen deren Verweise angepasst werden. Fuegt ein Merge einer gleichnamigen lokalen Kategorie erstmals Unterkategorien hinzu, bleiben bereits vorhandene unzugeordnete Leistungen durch den flachen Sicherheitsrueckfall vollstaendig in der Berechnung. Erst eine vollstaendige Zuordnung mit gueltigen positiven Gewichten aktiviert die hierarchische Berechnung. Bereits lokal archivierte Kurse sind historisch unveraenderlich: abweichende eingehende Einschreibungen, Leistungen und Scores fuer diese Kurse werden uebersprungen und als Archivkonflikte gemeldet; eine identische Wiederholung ist kein Konflikt. Auch Festsetzungen bleiben lokal erhalten: abweichende Werte einer vorhandenen Festsetzung zaehlen als Festsetzungskonflikt, verworfene neue Festsetzungen als Archivkonflikt. Ein noch nicht vorhandener eingehender Archivkurs wird als vollstaendige historische Einheit uebernommen. Seine Leistungskategorien bleiben auf den mitgefuehrten Archivsnapshot bezogen; zugeordnete Personen- und Kursverweise werden konsistent angepasst.

Der Kurs-/Klassenexport ist fuer Situationen gedacht, in denen Kurse oder Klassen im laufenden Schuljahr abgegeben, getauscht oder an Kolleg:innen uebergeben werden. Im Exportbereich kann entweder ein einzelner Kurs oder der gesamte Kursbestand ausgewaehlt werden.

Die CSV-Variante nutzt das bestehende Importformat mit den Kurs-, Personen- und Sek-II-Spalten. Neue Exporte enthalten rechts nach `Stammklasse` die 14. Spalte `CSV-Schutz`. Sie markiert ausschliesslich Apostrophe, die der Export zum Schutz vor Tabellenkalkulationsformeln hinzugefuegt hat. Beim Re-Import entfernt die Anwendung nur solche eindeutig markierten Schutzzeichen; ein echtes fuehrendes Apostroph bleibt Bestandteil des Namens. Die CSV uebertraegt Kurs- und Schuelerzuordnungen und ist deshalb fuer die Weiterarbeit mit dieser Notenverwaltung auf einem anderen Rechner geeignet. Einzelne Leistungsnoten werden bewusst nicht gespeichert. Aeltere Dateien mit 8 bis 13 Spalten bleiben importierbar; aeltere Programmversionen koennen das neue 14-spaltige Format nicht lesen.

Die Excel-Variante erzeugt eine echte XLSX-Arbeitsmappe mit einem Arbeitsblatt je ausgewähltem Kurs. Sie ist fuer Kolleg:innen gedacht, die nicht mit dem Programm arbeiten. Sie bildet die Notenuebersicht pro Kurs nach: Schueler:innen stehen in Zeilen, Leistungen in Spalten, Kategorien gruppieren die Leistungs-Spalten und Durchschnittswerte stehen rechts. Zahlen werden als Zahlen, Namen und andere Texte ausdrücklich als Text gespeichert; Notentendenzen wie `2+` bleiben als solche lesbar. Halbjahre werden anhand des Kursschemas und der wirksamen `halfYearNames` bezeichnet: Sek I verwendet standardmaessig H1/H2, die Oberstufe die zum Kurskontext passenden Q-Abschnitte. Bei archivierten Kursen gelten die Namen aus `archiveSnapshot`, sodass historische Bezeichnungen erhalten bleiben. Reine Import- oder Personaldaten wie Schueler-ID, Geburtstag und Stammklasse werden dort bewusst nicht ausgegeben.

### 4.10 Backup

Im Header gibt es den Button `Backup speichern`. Er erstellt ein verschluesseltes Backup des gesamten States.

Vor Verschlüsselung und Download werden offene Editoren abgeschlossen und
bestätigte Änderungen gespeichert. Eine ungültige Eingabe, ein Speicherfehler
oder ein Sitzungswechsel verhindert den Download. Die Erfolgsmeldung bestätigt
nur dessen Start; eine kontrollierte Wiederherstellung prüft die Datei.

Das Backup setzt eine entsperrte aktive Sitzung voraus. Es verschlüsselt den aktuell vollständig erfassten Snapshot mit dem Sitzungspasswort. Ohne aktive Sitzung wird kein Backup erstellt. Der Downloadname folgt dem Muster:

```text
notenverwaltung_backup_YYYY-MM-DDTHH-MM-SS.enc.json
```

Der bereits verschluesselte Inhalt wird als `Blob` ueber eine temporaere
Objekt-URL heruntergeladen. Die Anwendung entfernt das Download-Element und
gibt die Objekt-URL nach dem gestarteten Download auch im Fehlerfall wieder
frei. Eine speicherintensive Einbettung des gesamten Backups in eine
`data:`-URL findet nicht statt.

### 4.11 Klausurnotenrechner

Der Klausurnotenrechner erzeugt Punkt-zu-Note-Tabellen fuer:

- Sek I: fein abgestufte Noten `1+` bis `6`.
- Sek II: Oberstufenpunkte `15` bis `0`.

Die Sek-I-Prozentprofile sind ausdruecklich schulinterne Beispiele und kein amtlicher Berliner Standardschluessel. `1+` bleibt als eigene Stufe enthalten.

Fuer Sek II ist der Schluessel `95/90/85/80/75/70/65/60/55/50/45/40/33/27/20/0` als separates Preset `Abiturpruefung Berlin 2024-2029 (AV Pruefungen)` benannt. Er gilt fuer die Abiturpruefung und nicht allgemein fuer normale Oberstufenklausuren. Ein benutzerdefiniertes Fachkonferenzprofil bleibt moeglich.

Vor Berechnung und Export werden alle editierbaren Prozentgrenzen streng geprueft: jeder Wert muss zwischen 0 und 100 liegen, und die Grenzen muessen in Noten- bzw. Punktereihenfolge streng monoton fallen. Doppelte oder nicht monotone Grenzen werden mit einer verstaendlichen Fehlermeldung abgelehnt. Die generierten Tabellen koennen als CSV heruntergeladen werden; eine allgemeine Rundungsregel wird nicht angewendet.

## 5. Datenmodell

Der gesamte Zustand der Anwendung liegt in einem State-Objekt:

```js
{
  version: 1,
  students: [],
  courses: [],
  assessments: [],
  settings: {}
}
```

### `state.version`

Versionsnummer des gespeicherten Datenformats. Aktuell wird `1` verwendet.

Die sichtbare Programmversion wird getrennt davon über `APP_RELEASE` in `Notenverwaltung.html` verwaltet. Eine neue Programmversion erfordert daher nicht automatisch eine Migration der gespeicherten Daten.

### `state.students`

Liste globaler Schuelerobjekte.

```js
{
  id: "stu_...",
  lastName: "",
  firstName: "",
  birthDate: null,
  homeClass: ""
}
```

### `state.courses`

Liste der Kurse.

```js
{
  id: "course_...",
  name: "",
  subject: "",
  classLabel: "",
  schemaMode: "grades",
  weightTemplateId: null,
  includePrevTermGrades: false,
  termCutoffs: null,
  showAttendance: true,
  archivedAt: null,
  archiveReason: null,
  archiveRetentionUntil: null,
  archiveNote: null,
  schoolYearStartYear: null,
  carriedForwardFromCourseId: null,
  archiveSnapshot: null,
  importKey: null,
  enrollments: []
}
```

### `enrollment`

Kursinterne Zuordnung eines Schuelers oder einer Schuelerin.

```js
{
  studentId: "stu_...",
  subgroup: null,
  homeClassAtEnrollment: null
}
```

### `state.assessments`

Flache Liste aller Leistungsnachweise.

```js
{
  id: "asm_...",
  courseId: "course_...",
  categoryId: "cat_...",
  subcategoryId: null,
  title: "",
  date: null,
  term: null,
  maxPoints: null,
  weight: 1,
  visible: true,
  scores: {}
}
```

### `scoreEntry`

Ein einzelner Leistungswert pro Schueler:in.

```js
{
  valueRaw: null,
  status: "valid",
  valueNumeric: null
}
```

### `state.settings`

Zentrale Einstellungen.

```js
{
  gradeMapping: {},
  categories: [],
  weightTemplates: [],
  halfYearSettings: {},
  halfYearNames: {},
  termCutoffs: {}
}
```

### Kategorien

```js
{
  id: "cat_...",
  name: "",
  active: true,
  subcategories: []
}
```

Unterkategorien werden als Objekte mit ID, Name und Prozentgewicht gespeichert.

### Gewichtungsvorlagen

```js
{
  id: "wt_...",
  name: "",
  items: [
    {
      categoryId: "cat_...",
      weightPercent: 50
    }
  ]
}
```

### Halbjahrsfelder

Die zentralen Halbjahreseinstellungen enthalten unter anderem:

- `schoolYearStartYear`
- `schoolYearStartMonth`
- `schoolYearStartDay`
- `h1EndYear`
- `h1EndMonth`
- `h1EndDay`
- `h2StartYear`
- `h2StartMonth`
- `h2StartDay`

Diese Werte existieren getrennt fuer:

- `settings.halfYearSettings.seckI`
- `settings.halfYearSettings.seckII`

Die gespeicherten Jahreswerte beschreiben den Offset zum konfigurierten Schuljahresbeginn und werden fuer das jeweils betrachtete Schuljahr verschoben. Ein Kurs kann mit `termCutoffs` eigene Monats-/Tageswerte fuer H1-Ende und H2-Beginn hinterlegen; auch dort entscheidet allein der H2-Beginn ueber den Wechsel zu H2.

## 6. Speicherlogik und Datenschutz

### Lokale Speicherung

Die Anwendung speichert Daten lokal im Browserprofil. Das bedeutet:

- Daten verlassen die Anwendung nicht automatisch.
- Es gibt keine Server-Synchronisierung durch die App.
- Browserprofil-Synchronisierung oder Cloud-Backup des Betriebssystems kann lokale Daten dennoch extern sichern.
- Ein anderer Browser oder ein anderes Browserprofil hat einen eigenen Datenbestand.

Innerhalb desselben Browser-Speicherbereichs hält ein bearbeitendes Fenster die
exklusive Sitzungsberechtigung. Ein zweites Fenster lädt erst nach Freigabe und
bewusstem Wiederholversuch den aktuellen Stand. Vor Passwortabfrage und
produktiven Schreibvorgängen wird die Berechtigung geprüft; erkannte fremde
Änderungen stoppen den aktuellen Vorgang. Alte Programmfassungen beachten die
neue Sperre nicht. Deshalb vor dem Update alle alten Fenster schließen.
Ein anderer Öffnungspfad kann einen getrennten Speicherbereich verwenden;
der Pfad allein beweist eine solche Trennung nicht.

Produktive UI-Aenderungen werden als Auftraege in derselben UI-Warteschlange
ausgefuehrt. Erst am Kopf dieser Warteschlange entsteht ein Kandidat aus dem
zuletzt bestaetigten Zustand. Der Auftrag uebernimmt IDs und kopierte Eingaben;
er loest Kurse, Personen und Leistungen im aktuellen Kandidaten erneut auf.
Erst nach erfolgreichem verschluesseltem Speichern wird dieser Kandidat zum
bestaetigten Zustand. Ein fehlgeschlagener Save laesst den bestaetigten Bestand
unveraendert; Formulare behalten ihre Bearbeitung fuer einen erneuten Versuch.
Eine Groessenbegrenzung fuer Logodateien ersetzt keine Pruefung auf Speicherfehler.

Sperren und Bestandswechsel machen alte UI-Auftraege, laufende Dateiimporte und
noch offene Passwortabfragen ungueltig. Reset, vollstaendiger Import-Ersatz und
Passwortwechsel laufen exklusiv in derselben UI-Warteschlange. Falls ein frueherer
Save schon geschrieben, seine UI-Bestaetigung aber noch nicht geliefert hat,
gleichen die exklusiven Ablaeufe den RAM-Zustand vor der Queuefreigabe mit dem
tatsaechlich gespeicherten Bestand ab. Das gilt auch bei einem fehlgeschlagenen
Bestands- oder Passwortwechsel. Dazu liest
`Storage.loadCurrentSessionState()` innerhalb der vorhandenen Storage-FIFO;
der Lesevorgang fragt kein Passwort ab, stellt keine Sitzung wieder her und
bricht bei einer zwischenzeitlichen Sperre ab.

### Verschluesselung

Die Anwendung nutzt Web Crypto:

- Algorithmus: AES-GCM
- Schluessellaenge: 256 Bit
- Key Derivation: PBKDF2
- Hash: SHA-256
- Iterationen: 200000
- Salt: 16 Byte
- IV: 12 Byte

Das Passwort wird als Session-Passwort im Arbeitsspeicher gehalten und nicht dauerhaft im Klartext gespeichert. Nach Inaktivitaet wird die Sitzung gesperrt und das Passwort aus dem Speicher entfernt. Bei der Ersteinrichtung wird das Session-Passwort erst nach einem vollstaendig erfolgreichen verschluesselten Schreibvorgang uebernommen; ein Teilschreibfehler stellt den vorherigen lokalen Speicherstand wieder her.

Passwoerter muessen auch im Storage-Modul mindestens sechs Zeichen lang sein. Ein erfolgreicher Passwortwechsel erzeugt einen neuen zufaelligen 16-Byte-Salt und verschluesselt den vorhandenen Zustand damit neu. Schlaegt die Aktualisierung von Payload oder Salt fehl, bleiben der bisherige verschluesselte Zustand und das alte Passwort verwendbar.

### Backup-Formate

Die Dateiendung `.enc.json` allein bestimmt nicht das Format. Die Schreib- und
Lesepfade sind wie folgt zugeordnet:

| Pfad | Erzeugtes oder akzeptiertes Format | Umfang / Voraussetzung |
| --- | --- | --- |
| Header: **Backup speichern** | Schreibt portables Raw `salt:iv:ciphertext` | Vollstaendiger Anwendungsstand; Sitzungspasswort oder Passwortabfrage |
| Archiv: Export eines archivierten Kurses | Schreibt portables Raw `salt:iv:ciphertext` | Archivierter Kurs, seine Leistungen, referenzierte Schueler und Einstellungen; Sitzungspasswort erforderlich |
| Interne API `Storage.exportStateEncrypted(password, state)` | Schreibt strukturiertes `notenverwaltung_enc_v1` | Uebergebener State; kein Aufruf durch die beiden genannten UI-Exportwege |
| UI: JSON-Import | Liest strukturiertes Format, portables Raw und altes Raw | Backup-Passwort; bei altem Raw zusaetzlich der zugehoerige lokale Salt |

Der JSON-Import leitet das strukturierte Format an
`Storage.importStateEncryptedFromText`, Raw an `Storage._decryptPayload` weiter.
Anschliessend wird der importierte Stand validiert, normalisiert und verschluesselt
gespeichert. Die interne strukturierte Importfunktion akzeptiert nur das
strukturierte Format, nicht Raw.

#### Strukturiertes Format

```json
{
  "format": "notenverwaltung_enc_v1",
  "salt": "...",
  "payload": "iv:ciphertext"
}
```

Der Salt ist in der Datei enthalten. Zum Entschluesseln auf einem anderen Geraet
wird das Backup-Passwort benoetigt, kein Salt aus dem bisherigen Browser.

#### Raw-Format

```text
salt:iv:ciphertext
```

Auch dieses dreiteilige Format enthaelt seinen Salt und ist mit dem
Backup-Passwort auf andere Geraete uebertragbar. Es ist das aktuelle Format der
oben genannten UI-Backups, obwohl der Dateiname auf `.enc.json` endet.

Aeltere Raw-Formate koennen auch aus zwei Teilen bestehen:

```text
iv:ciphertext
```

Dieses zweiteilige Altformat ist nicht eigenstaendig portabel: Neben dem Passwort
ist der passende Salt unter `notenverwaltung_v1_salt` im lokalen Browserspeicher
erforderlich. Das Passwort allein genuegt nicht. Ein anderer Browser, ein anderes
Profil oder ein anderer Speicherbereich stellt diesen Salt nicht automatisch bereit.

Die laufende Anwendung speichert ihren verschluesselten lokalen Stand ebenfalls
zweiteilig unter `notenverwaltung_v1_state_enc`, mit separat gespeichertem Salt
unter `notenverwaltung_v1_salt`. Dieser lokale Speicher ist kein heruntergeladenes
portables Backup. Fuer einen Geraetewechsel **Backup speichern** verwenden und
die erzeugte Datei mit dem zugehoerigen Passwort auf dem Zielgeraet importieren.

## 7. Importformate

### CSV-Massenimport

Der CSV-Import erwartet eine Kopfzeile mit Semikolon-Trennung:

```text
KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag;Schema;Kursart;Qualifikationsabschnitt;3. Pruefungsfach schriftlich;Stammklasse;CSV-Schutz
```

Die Kopfzeile muss in Inhalt und Reihenfolge exakt einem unterstuetzten Praefix mit 8 bis 13 Spalten oder dem neuen 14-spaltigen Format entsprechen. Der Parser unterstuetzt gequotete Felder, verdoppelte Anfuehrungszeichen, Semikolons und Zeilenumbrueche innerhalb gequoteter Felder. Datumswerte werden kalendarisch geprueft; unmoegliche Daten brechen den Import ab. Der Import arbeitet auf einem getrennten Kandidaten-State und aktiviert ihn erst nach erfolgreicher verschluesselter Speicherung. Fehlerdialoge, Zwischenablage und Fehlerdownloads enthalten aus Datenschutzgruenden ausschliesslich Zeilennummern und datensparsame Fehlerbeschreibungen. Rohe CSV-Zeilen, Namen, IDs, Geburtsdaten und auch der eingegebene ungueltige Datumswert werden dort weder angezeigt noch ausgegeben; dies gilt fuer fatale und nichtfatale Fehler.

Dateien werden zuerst streng als UTF-8 gelesen. Ungueltige Bytefolgen werden nicht durch Ersatzzeichen in Namen uebernommen. Die Importansicht bietet stattdessen bewusst **Als Windows-1252 erneut lesen** an und zeigt das so decodierte Ergebnis zunaechst als Vorschau. Erst **CSV-Vorschau uebernehmen** startet den normalen Import; **Abbrechen** verwirft Bytes und Vorschau. Ein korrekt in UTF-8 gespeichertes `�` bleibt ein normales Zeichen und loest keinen Zeichensatzwechsel aus.

Spalten:

- `KursID`: optionale stabile externe Kurskennung.
- `Kurs`: Kursname.
- `Fach`: Fachbezeichnung.
- `Klasse`: gemeinsame Kurs- oder Gruppenbezeichnung; bleibt bei gemischten Kursen ohne solche Bezeichnung leer.
- `SchuelerID`: optionale stabile externe Schuelerkennung.
- `Nachname`: Nachname.
- `Vorname`: Vorname.
- `Geburtstag`: Geburtsdatum.
- `Schema`, `Kursart`, `Qualifikationsabschnitt`, `3. Pruefungsfach schriftlich`: optionale Sek-II-Angaben.
- `Stammklasse`: persoenliche Stammklasse der jeweiligen Person. Diese Spalte steht in neuen Exporten rechts hinter den Sek-II-Angaben.
- `CSV-Schutz`: bei neuen eigenen Exporten `nv1:<Hexmaske>`; die Bits markieren nur automatisch ergaenzte Schutzapostrophe in den ersten 13 Feldern.

Die alten Kopfzeilen mit 8 bis 13 Spalten bleiben gueltig. In diesen
Legacy-Dateien wird `Klasse` aus Kompatibilitaetsgruenden weiterhin zugleich
als Stammklasse der Person ausgewertet, wenn die eigene Stammklassenspalte fehlt.
Das 13-spaltige Format trennt Kursmerkmal und persoenliche Stammklasse; das
14-spaltige Format ergaenzt die beweissichere Kennzeichnung von Schutzapostrophen.

Zuordnungslogik:

- Kurse werden bevorzugt ueber `KursID` bzw. `importKey` erkannt.
- Ohne KursID wird anhand von Kursname und Fach zugeordnet.
- Schueler:innen werden anhand von Name und Geburtsdatum erkannt.
- Doppelte Zeilen und fehlerhafte Zeilen werden gesammelt und in Dialogen gemeldet.
- Bei fatalen Fehlern wird der Import abgebrochen und der vorherige Zustand wiederhergestellt.
- Beim Ueberspringen nichtfatal fehlerhafter Zeilen berechnet die Anwendung den Import aus den verbleibenden CSV-Records neu. Ausgeschlossene Zeilen beeinflussen weder bestehende Einschreibungen und Q4-Kennzeichen noch die Namens-, Datums- und Klassenzuordnung anderer Zeilen. Die Zeilennummer bezeichnet bei gequoteten mehrzeiligen Feldern den physischen Anfang des Records. Mehrere Warnungen derselben Zeile zaehlen beim Ueberspringen einmal. Sind alle Datenzeilen ausgeschlossen, meldet die Anwendung „Keine gültigen Zeilen übernommen“ und speichert nichts.
- Wenn das Ueberspringen neue Warnungen oder fatale Fehler in den verbleibenden Records sichtbar macht oder sich der Datenbestand seit der Vorschau geaendert hat, wird eine neue Vorschau mit erneuter Entscheidung gezeigt. Auch eine inzwischen fehlerfreie Datei wird nach einer veralteten Warnentscheidung nicht automatisch uebernommen. „Trotz Fehler uebernehmen“ behaelt die bewusst bestaetigte Zusammenfuehrung unvollstaendiger Angaben: Eine spaetere Zeile derselben externen `SchuelerID` darf Namen-, Datums- und Klassendaten einer zuvor angelegten Person vervollstaendigen. Bereits lokale Personendaten werden durch eine ID-Kollision nicht ueberschrieben.

Excel-Dateien werden nicht direkt importiert. Es werden CSV- oder TXT-Dateien erwartet.

Bei aelteren oder fremden CSV-Dateien ohne `CSV-Schutz` kann ein fuehrendes
Apostroph sowohl zum echten Namen gehoeren als auch frueher von einer
Tabellenkalkulation oder einem Export ergaenzt worden sein. Diese Mehrdeutigkeit
laesst sich nicht sicher automatisch aufloesen. Die Anwendung behaelt das Zeichen
deshalb unveraendert bei und zeigt einen Hinweis; sie schneidet es nicht pauschal ab.

### Kurs-/Klassenexport

Der Kurs-/Klassenexport erzeugt Dateien fuer Kursuebergaben:

- CSV fuer den Re-Import in diese Anwendung.
- Echte `.xlsx`-Arbeitsmappe fuer Kolleg:innen ohne Anwendung.

Der CSV-Export verwendet das aktuelle 14-spaltige Importformat:

```text
KursID;Kurs;Fach;Klasse;SchuelerID;Nachname;Vorname;Geburtstag;Schema;Kursart;Qualifikationsabschnitt;3. Pruefungsfach schriftlich;Stammklasse;CSV-Schutz
```

Eine Zeile entspricht einer Kurs-Schueler-Zuordnung. `Klasse` enthaelt nur die
Kursbezeichnung; `Stammklasse` wird aus der Einschreibung beziehungsweise der
Person uebertragen. Dadurch erfindet ein gemischter Kurs ohne Kursbezeichnung
beim Rundlauf keine Klasse aus der ersten Person. Kurse ohne eingeschriebene
Schueler:innen werden mit leeren Schuelerfeldern exportiert, damit der Kurs
selbst trotzdem importierbar bleibt.

Der Excel-Export ist nicht fuer den Re-Import gedacht. Er dient als lesbare Uebergabeliste im Stil der Notenuebersicht:

- eine eigene Tabelle pro Kurs.
- Schueler:innen als Zeilen.
- Leistungsnachweise als Spalten, gruppiert nach Kategorien.
- Kategorie- und Gesamtdurchschnitte mit aehnlicher Farblogik wie im Programm.
- keine Schueler-IDs, Geburtstage oder Stammklassen, weil diese Daten fuer Kolleg:innen ohne Re-Import nicht noetig sind.

### JSON-Import

Der JSON-Import kann:

- Klartext-State-Dateien laden.
- verschluesselte `notenverwaltung_enc_v1`-Dateien laden.
- Raw-verschluesselte Backups laden.
- importierte Daten optional mit dem aktuellen Datenbestand zusammenfuehren.

Aktuelle Halbjahreseinstellungen werden beim Import bewusst beibehalten, damit ein Backup diese App-Einstellung nicht ungewuenscht ueberschreibt.

## 8. Debug- und Test-Hooks

Die Anwendung enthaelt Debug- und Autorun-Hooks, die aus Sicherheitsgruenden nur aktiv werden, wenn im `localStorage` der Wert gesetzt ist:

```js
localStorage.setItem("__debugMode", "1")
```

Dann koennen einzelne globale Debug-Funktionen oder Testlaeufe sichtbar bzw. aufrufbar werden, zum Beispiel fuer Halbjahrs- und Oberstufenlogik.

Wichtig: Debug-APIs duerfen nicht als stabile Produktionsschnittstelle betrachtet werden. Sie dienen der lokalen Entwicklung und Fehlersuche.

Fuer die reproduzierbaren Belastungs- und Sicherheitstests kann die Anwendung ausschliesslich ueber einen lokalen HTTP-Server mit `?syntheticRegression=1` geoeffnet werden. Der dann sichtbare Testbereich arbeitet nur mit im Arbeitsspeicher erzeugten synthetischen Daten, veraendert den aktiven Bestand nicht und prueft unter anderem Archivmigration, grosse Datenmengen, wiederholte Schuljahreswechsel sowie verschluesselte und beschaedigte Backups. Bei direktem Dateistart oder auf nichtlokalen Hosts ist dieser Testbereich nicht verfuegbar.

## 9. Wartungshinweise

### Monolithische Struktur

Die Datei `Notenverwaltung.html` enthaelt HTML, CSS und JavaScript. Viele Funktionen sind lokal in Render-Funktionen verschachtelt. Dadurch sind Aenderungen oft schnell moeglich, aber Abhaengigkeiten sind nicht immer sofort sichtbar.

Bei groesseren Aenderungen sollte zuerst gesucht werden nach:

- `DomainModel`
- `Storage`
- `GradingLogic`
- `UiShell`
- `render...Section`
- `computeOverallGrade`
- `ensureStateShape`
- `mergeImportedStateIntoCurrent`
- `recalcAssessmentTermsForCurrentState`

### Besonders vorsichtige Bereiche

#### `DomainModel.ensureStateShape`

Diese Funktion ist die zentrale Migrations- und Reparaturstelle. Neue Datenfelder muessen hier fuer alte Speicherstaende nachgezogen werden.

#### `GradingLogic.computeOverallGrade`

Diese Funktion beeinflusst Notentabelle, Statistik, Schueleransichten und PDF-/Exportlogik. Aenderungen muessen mit Sek I, Sek II, Kategorien, Unterkategorien und Halbjahrsfilterung getestet werden.

#### Halbjahrslogik

Die Kalendergrenzen werden zentral durch `resolveSchoolYearBoundaries` und `resolveAssessmentTermFromDateValue` abgeleitet. UI-Hilfsfunktionen duerfen diese Entscheidung nicht mit eigener Jahres- oder H1-Endlogik duplizieren. Bei Aenderungen zusaetzlich `resolveGradingResultScope`, `formatTermLabel`, `computePrevTerm`, `computeNextTerm` und `recalcAssessmentTermsForCurrentState` pruefen. Neuberechnungen duerfen nur aktive Leistungen mit `termAssignment: "auto"` veraendern.

#### Import und Merge

Importe koennen bestehende Daten ersetzen oder zusammenfuehren. Aenderungen muessen Duplikaterkennung, ID-Mapping, Score-Mapping und Rollback-Verhalten beruecksichtigen.

#### Verschluesselung

Keine Aenderung an Crypto-Parametern, Payload-Format oder `localStorage`-Keys ohne Migrationsplan. Sonst koennen bestehende Daten oder Backups unlesbar werden.

## 10. Hinweise fuer KI-Agenten

Dieser Abschnitt ist dafuer gedacht, dass eine beliebige KI spaeter ohne zusaetzlichen Kontext sinnvoll weiterarbeiten kann.

### Schnellkontext

- Projektwurzel: Ordner mit `Notenverwaltung.html`.
- Ausgelieferte Datei: `Notenverwaltung.html`; Änderungen an den Quellen unter `src/` vornehmen.
- Dokumentation: `DOKUMENTATION.md`.
- Startpunkt: `DOMContentLoaded -> UiShell.init("app")`.
- Build und Tests sind in `package.json` definiert; Quellen liegen unter `src/`.
- Die App ist eine lokale Browser-App, kein Serverprojekt.
- Zustand liegt verschlüsselt in `localStorage`.

### Mentales Modell

Die Anwendung folgt grob diesem Datenfluss:

```text
Browser laedt HTML
  -> UiShell.init("app")
  -> Storage.loadState()
  -> DomainModel.ensureStateShape()
  -> UiShell rendert Navigation und aktuelle Section
  -> Nutzerinteraktion uebergibt IDs und Eingaben an commitStateChange()
  -> Gemeinsame UI-Queue erzeugt Kandidat aus bestaetigtem state
  -> Aenderung im Kandidaten, danach Storage.saveState(kandidat)
  -> Erst bei Erfolg: Kandidat veroeffentlichen und Anzeige aktualisieren
```

Notenberechnung:

```text
Assessment + ScoreEntry
  -> GradingLogic.getNumericScoreForEntry()
  -> GradingLogic.computeCategoryAverage()
  -> GradingLogic.computeOverallGrade()
  -> UI/Statistik/PDF
```

### Regeln fuer Aenderungen

- Keine echten Schueler- oder Leistungsdaten in Tests, Dokumentation oder Beispielstates schreiben.
- Keine bestehende `localStorage`-Struktur brechen.
- Neue State-Felder immer in Factory-Funktion und `ensureStateShape` ergaenzen.
- Bei Import-relevanten Feldern auch `mergeImportedStateIntoCurrent` pruefen.
- Bei UI-Aenderungen die passende `render...Section`-Funktion in `UiShell` suchen.
- Bei Notenlogik immer Sek I und Sek II testen.
- Bei Halbjahrslogik immer aktuelle und vorherige Halbjahre testen.
- Bei Verschluesselung keine Debug-Ausgabe von Passwoertern, Schluesseln, Klartextdaten oder entschluesselten Backups einfuegen.
- Debug-Funktionen nur hinter `localStorage.__debugMode === "1"` aktivieren.

### Typische Aufgabenpfade

#### Neue UI-Funktion

1. Passenden Navigationsbereich in `UiShell` finden.
2. Entsprechende `render...Section`-Funktion erweitern.
3. Zustandsaenderungen ueber `commitStateChange(candidate => ...)` ausfuehren. IDs und Eingaben vorab kopieren, Zielobjekte erst im Kandidaten aufloesen; den bestaetigten `state` nicht vor dem Save veraendern.
4. Erfolg und Savefehler pruefen. Dialoge erst nach erfolgreichem Commit schliessen. Notenzellen verwenden `render: false`, damit andere noch nicht gespeicherte Eingaben und der aktuelle Fokus erhalten bleiben.

#### Neues Datenfeld

1. Factory-Funktion in `DomainModel` erweitern.
2. `ensureStateShape` fuer alte Speicherstaende erweitern.
3. Import-/Merge-Logik pruefen.
4. UI fuer Anzeige und Bearbeitung ergaenzen.
5. Backup/Import mit altem und neuem Datenstand testen.

#### Neue Notenlogik

1. `GradingLogic` erweitern.
2. Validierung in `isValidRawForCourse` beruecksichtigen.
3. Numerische Umwandlung in `getNumericScoreForEntry` pruefen.
4. Auswirkungen auf `computeOverallGrade` und `computeCourseStatistics` testen.
5. Notentabelle und Statistik visuell pruefen.

#### Importaenderung

1. CSV-Vorlage anpassen.
2. Parser in `importCsvText` anpassen.
3. Kurs-/Klassen-CSV-Export synchron zum Importformat halten.
4. Fehlerbehandlung und fatale Fehler pruefen.
5. Rollback-Verhalten pruefen.
6. Zusammenfuehren mit bestehenden Daten testen.

#### Verschluesselung oder Backup

1. Bestehende Speicherformate erfassen.
2. Rueckwaertskompatibilitaet sicherstellen.
3. Export und Import mit neuem und altem Format testen.
4. Keine Klartextdaten in Logs schreiben.

### Pruefcheckliste fuer KI-Agenten

Nach Aenderungen an der App:

- `npm test` fuer alle Testdateien direkt in `tests/` ausfuehren. Der
  plattformunabhaengige Starter `tests/run-tests.js` verhindert, dass lokale
  verschachtelte Projektkopien versehentlich mitgetestet werden.
- `npm run check` als separate JavaScript-Syntaxpruefung ausfuehren.

- `Notenverwaltung.html` direkt im Browser oeffnen.
- Ersteinrichtung der Verschluesselung pruefen.
- Kurs anlegen.
- Schueler:in anlegen und Kurs zuordnen.
- Leistungsnachweis anlegen.
- Sek-I-Note eingeben und Durchschnitt pruefen.
- Sek-II-Kurs mit 0-15 Punkten pruefen.
- Vorheriges Halbjahr ein- und ausschalten.
- Statistikansicht pruefen.
- Backup exportieren und wieder importieren.
- CSV-Vorlage herunterladen.
- CSV-Import mit gueltiger Datei pruefen.
- CSV-Import mit fehlerhafter Datei pruefen.
- Dark Mode umschalten.
- Session-Sperre bzw. manuelles Sperren pruefen, wenn relevant.

### Bekannte Risiken

- Die Datei ist gross und stark gekoppelt.
- Mehrere lokale Hilfsfunktionen berechnen oder formatieren Halbjahre.
- Einige UI-Styles werden direkt per JavaScript gesetzt.
- Debug- und Testcode existiert im Produktivdokument, ist aber durch `__debugMode` geschuetzt.
- Browserdaten sind profilgebunden; ein Browserwechsel bedeutet ohne Backup einen anderen Datenbestand.
- Verschluesselte Backups sind ohne Passwort nicht wiederherstellbar.
- Aenderungen an Crypto-Parametern oder Speicherkeys koennen bestehende Daten unlesbar machen.

## 11. Manuelle Testfaelle

### Grundfunktion

1. App oeffnen.
2. Verschluesselung einrichten.
3. Neuen Kurs anlegen.
4. Schueler:in anlegen.
5. Schueler:in in Kurs einschreiben.
6. Leistungsnachweis anlegen.
7. Note eintragen.
8. Durchschnitt anzeigen lassen.

Erwartung: Der Wert wird gespeichert und nach Neuladen wieder angezeigt.

### Verschluesselung und Passwortwechsel

1. Verschluesselung mit einem mindestens sechs Zeichen langen Passwort einrichten und die Anwendung neu laden.
2. Einen Passwortwechsel auf weniger als sechs Zeichen versuchen.
3. Das Passwort auf ein anderes gueltiges Passwort aendern und erneut laden.

Erwartung: Die Ersteinrichtung bleibt nach dem Neuladen lesbar. Das zu kurze neue Passwort wird abgelehnt. Nach einem erfolgreichen Wechsel funktioniert nur das neue Passwort; der lokale Salt wurde erneuert. Automatisierte Fehler-Injektionstests belegen zusaetzlich, dass Teilschreibfehler bei Einrichtung und Passwortwechsel den vorherigen verschluesselten Bestand nicht beschaedigen.

### Sek-I-Berechnung

1. Kurs mit Schema `grades` anlegen.
2. Leistungen in Kategorien `Muendlich` und `Schriftlich` erfassen.
3. Gewichtungsvorlage Sek I verwenden.
4. Exakte Werte `1+`, `3` und `5-` sowie nacheinander `3abc`, `2,5`, `2.5`, `6+` und `6-` eingeben.

Erwartung: Die exakten Standardlabels werden akzeptiert; Teilstrings, freie Dezimalnoten sowie `6+` und `6-` werden abgelehnt. Das Rechenmittel entspricht der gewichteten Kombination der Kategorie- und gegebenenfalls Unterkategorie-Durchschnitte.

### Sek-II-Berechnung

1. Kurs mit Schema `uppersec` anlegen.
2. Ganze Punktewerte von 0 bis 15 sowie testweise `7.5`, `-1` und `16` eintragen.
3. Statistik oeffnen.

Erwartung: Nur ganze Punkte von 0 bis 15 werden akzeptiert; Dezimalwerte und ausserhalb liegende Werte werden abgelehnt. Statistik und Mediane nutzen Oberstufen-Verteilungsbereiche und sind als rechnerische Zwischenwerte gekennzeichnet.

### Halbjahrestabelle: Eingabe und Status

1. Im aktuellen Halbjahresblock eines Oberstufenkurses `15.3`, danach `15` eingeben.
2. Den Status von `valid` auf `missing` und wieder auf `valid` wechseln.
3. Das Feld leeren, waehrend der Status `valid` ist.
4. Dieselben Schritte in einem Sek-I-Kurs mit `3abc` und `3` wiederholen.

Erwartung: `15.3`, `3abc` und der Leerwert werden rot markiert und nicht gespeichert. `15` und `3` werden gespeichert. `missing` entfernt den numerischen Beitrag sofort aus dem Durchschnitt; der Rueckwechsel auf `valid` berechnet ihn aus dem weiterhin vorhandenen gueltigen Rohwert neu. Bei einem Speicherfehler bleibt der vorherige State erhalten und das Feld zeigt einen Inline-Hinweis. Sehr schnelle Folgeaenderungen in derselben oder in verschiedenen Zellen werden in Aufrufreihenfolge gespeichert; erst danach wird gegebenenfalls per Enter oder Tab navigiert.

### Gewichtungsprofile und Altbestand

1. Einen neuen leeren Zustand und ein altes Backup mit `Standard Sek I (67/33)` laden.
2. Einstellungen und bestehende Kurszuordnungen vergleichen.

Erwartung: Neue Profile ergeben jeweils exakt 100 Prozent. Die alte 67/33-Vorlage behaelt ID, Gewichte und Kursverweise und wird nur als pruefpflichtiger Altbestand gekennzeichnet. Kein bestehender Kurs wechselt automatisch die Vorlage.

### Klausurnotenrechner

1. Im Sek-I-Modus die Stufe `1+` an der eingestellten Grenze pruefen.
2. Eine Grenze auf `101`, `-1`, denselben Wert wie die vorherige Stufe und anschliessend hoeher als die vorherige Stufe setzen.
3. Im Sek-II-Modus das Preset `Abiturpruefung Berlin 2024-2029 (AV Pruefungen)` anwenden und die Grenzen `95` fuer 15 Punkte sowie `20` fuer einen Punkt pruefen.
4. Eine Grenze aendern und ohne Neuberechnung exportieren.

Erwartung: Exakte Grenzwerte werden der jeweiligen Stufe zugeordnet. Werte ausserhalb 0 bis 100 sowie doppelte oder nicht monotone Grenzen verhindern Berechnung und Export. Der Export verlangt nach Aenderungen eine neue Berechnung. Das Abitur-Preset ist deutlich von regulaeren Oberstufenklausuren abgegrenzt.

### Halbjahre

1. Leistungen mit Datum in H1 und H2 anlegen.
2. Option `Vorheriges Halbjahr in Notenberechnung einbeziehen` umschalten.

Erwartung: Die Gesamtberechnung aendert sich entsprechend.

### Backup und Import

1. Backup speichern.
2. Anwendung zuruecksetzen.
3. Backup importieren.

Erwartung: Nach Dateipruefung werden Modus und Umfang angezeigt. Ersetzen verlangt eine zweite Bestaetigung. Daten werden verschluesselt wiederhergestellt; Anwendungspasswort sowie lokale Halbjahresgrenzen und -namen bleiben unveraendert.

### CSV-Import

1. CSV-Vorlage herunterladen.
2. Gueltige Testdaten eintragen.
3. Datei importieren.

Erwartung: Kurse, Schueler:innen und Einschreibungen werden angelegt oder korrekt bestehenden Daten zugeordnet.

### Fehlerhafter CSV-Import

1. CSV mit synthetischen Namen, IDs und Geburtsdatum sowie fehlenden Spalten oder ungueltigem Datum importieren.
2. Fehler im Dialog ansehen, kopieren und als CSV sowie Text herunterladen.

Erwartung: Fehlerdialog erscheint. Alle vier Ausgaben nennen nur Zeilennummer und Fehlerart; die CSV-Rohzeile, synthetische Namen, IDs, Geburtsdaten und der konkret eingegebene Datumswert fehlen. Bei fatalen Fehlern werden keine Teildaten uebernommen.

### Excel-Termbezeichnungen

1. Einen Sek-I-Kurs mit H1-Leistung und einen Oberstufenkurs mit H1-/H2-Leistung als Excel exportieren.
2. Einen archivierten Oberstufenkurs mit abweichenden Halbjahrsnamen im Snapshot exportieren.

Erwartung: Sek I zeigt standardmaessig H1/H2, die Oberstufe Q1/Q2. Der archivierte Kurs verwendet ausschliesslich die im Snapshot gespeicherten Namen.

### Schuelerdetail und Druck mit Archivdaten

1. Einen aktiven und einen archivierten synthetischen Kurs mit abweichendem Mapping, Kategorien, Gewichtung und Halbjahrsnamen im Archiv-Snapshot anlegen.
2. Danach die globalen Einstellungen veraendern und Einzelansicht, Schuelerdetail sowie Sammeldruck vergleichen.
3. Eine Person nur per archivierter Einschreibung und eine weitere nur per Score-Schluessel referenzieren; anschliessend einen aktiven Kursfilter setzen.

Erwartung: Der aktive Kurs folgt den globalen Einstellungen. Archivwerte, Kategorien, Unterkategorien, Durchschnitte und Halbjahrsnamen bleiben snapshotgetreu. Beide historischen Referenzarten erscheinen ohne aktiven Kursfilter im klar bezeichneten Archivbereich; mit aktivem Kursfilter werden keine Archivkurse ausgegeben.

### Kursarchiv

1. Einen synthetischen Kurs mit Leistungen, Aufbewahrungsdatum und Notiz archivieren.
2. Seite neu laden und das Archiv oeffnen.
3. Aufbewahrungsdatum und Notiz bearbeiten und erneut laden.
4. Kurs ansehen, verschluesselt exportieren und wiederherstellen.

Erwartung: Der Kurs fehlt waehrend der Archivierung in aktiven Arbeitsansichten. `Ansehen` oeffnet ohne Browser-Alert eine fokussierbare Nur-Lese-Detailansicht mit Metadaten, Schueler:innen und Leistungen; Schliessen-Schaltflaeche, Escape-Taste und Klick auf den Hintergrund schliessen sie. Archivuebersicht und Detailansicht zaehlen dieselbe vollstaendige Personenmenge aus Einschreibungen, Festsetzungen, Archiv-Snapshots und Score-Schluesseln. Aufbewahrungsdatum und Notiz bleiben verschluesselt gespeichert und koennen separat bearbeitet werden. Einschreibungen, Leistungen, Scores und Bewertungs-Snapshot bleiben unveraendert. Beim Wiederherstellen werden die Archivmetadaten entfernt.

### Schuljahreswechsel

Der Assistent ist oben in `Kurse und Schueler` erreichbar. Er zeigt alte und neue Kursbezeichnungen sowie eine gruppierte Stammklassen-Vorschau. Beim Oeffnen liegt der Fokus auf dem Zieljahr. Tab und Umschalt+Tab bleiben innerhalb des als modal ausgezeichneten Dialogs; Escape, `Abbrechen` und ein Klick auf den abgedunkelten Hintergrund schliessen ihn und geben den Fokus an `Schuljahreswechsel` zurueck. Nur einfache Stammklassen der Stufen 5 bis 9 werden automatisch vorgeschlagen. Da die Halbjahresgrenzen global gelten, werden immer alle aktiven Kurse gemeinsam uebernommen; eine Teilselektion ist nicht zulaessig. Vor der Bestaetigung koennen ein gemeinsames Aufbewahrungsdatum und eine gemeinsame Notiz fuer die alten Kurse erfasst werden. Danach werden die alten Kurse unveraendert archiviert und neue Kurse mit neuen IDs, ohne `importKey` und ohne Leistungsnachweise angelegt. Die neuen Kurse verweisen ueber `carriedForwardFromCourseId` auf ihre Vorgaenger.

Erwartung: Alte Kurse und historische Leistungen bleiben unveraendert im Archiv. Nachfolgekurse enthalten die uebernommenen Einschreibungen, aber keine Assessments.

### Belastungs- und Sicherheitstests

Der synthetische Regressionstest prueft einen Bestand mit 240 Personen, 10 Kursen, 180 Leistungen und 43.200 Score-Eintraegen. Ausserdem werden fuenf aufeinanderfolgende Schuljahreswechsel mit vier Kursen sowie strukturierte und portable verschluesselte Backups getestet.

Erwartung: Der grosse State wird ohne Datenverlust normalisiert. Nach fuenf Wechseln bestehen vier aktive und 20 archivierte Kurse; nur die urspruenglichen historischen Leistungen bleiben erhalten. Korrekte Passwoerter ermoeglichen den Rundlauf, falsche Passwoerter, ungueltiges JSON, manipulierter Ciphertext und unbekannte Formatkennungen werden abgelehnt. Das alte Raw-Format `iv:ciphertext`, das einen bereits vorhandenen lokalen Salt benoetigt, bleibt als manuell zu pruefender Altfall gekennzeichnet.

## 12. Offene Verbesserungsmoeglichkeiten

### Abschluss der Wave-11-Final-Review-Remediation (2026-08-28)

Die vier technischen Remediation-Commits `cec3a78`, `f0de307`, `acd7c08` und
`22072db` sind dokumentiert. Die neun ursprünglichen Final-Review-Befunde sind
geschlossen: (1) Archiv-Snapshot-Einschreibungen werden beim Merge remappt,
(2) Snapshot-Kontext, Q4-Flags und Rollen werden vor Normalisierung strukturell
geprüft, (3) eingefrorene Kategorien-/Vorlagenreferenzen werden validiert,
(4) Gesamtberechnung und Berichte verwenden dieselbe schuljahrbewusste
Termableitung, (5) Q4-Präsentationen machen nur personenspezifische Aussagen,
(6) geänderte Vorlagen werden nicht als sichere Empfehlung angeboten,
(7) LK-Sonderfälle erhalten einen manuellen Warnhinweis ohne Rechenänderung,
(8) Nachfolger übernehmen keine Gewichtungsabweichung oder Q4-Flags still,
(9) inaktive Flags bleiben reversibel und Sek-I→Sek-II verlangt vollständigen
Kontext. Die neuen Randfälle sind direkt durch Node-Consumer-/Domain-Tests
abgedeckt; der unveränderte Browserharness blieb bei 49/49.

Diese Punkte sind keine Fehler, aber naheliegende technische Verbesserungen:

- JavaScript in separate Module auslagern.
- Zentrale Halbjahrslogik deduplizieren.
- Inline-Styles schrittweise in CSS-Klassen ueberfuehren.
- Die vorhandenen Regressionstests fuer `DomainModel` und `Storage` um weitere Import-, Druck- und `GradingLogic`-Faelle erweitern.
- Beispiel-Testdaten von echten Daten strikt trennen.
- Importformate formal versionieren.
- Accessibility der Dialoge verbessern.
- Optional eine kleine Startseite oder README fuer Nicht-Entwickler ergaenzen.

## 13. Sek-II-Festsetzungen (M32)

In Sek-II-Kursen steht neben jedem sichtbaren Halbjahres-`Rechenwert` ein
separates Feld `Festgesetzt`. Die Lehrkraft kann dort bewusst eine ganze
Punktzahl von 0 bis 15 eintragen oder den Wert durch Leeren entfernen. Der Wert
wird nie aus dem Rechenwert gerundet, abgeleitet oder vorbelegt und veraendert
weder Gewichtung noch Rechenwerte oder Statistik. Aktive Kurse speichern
transaktional; archivierte Kurse zeigen bestehende Werte nur lesend.

Jeder Kurs enthaelt eine eingebettete optionale Liste:

```js
termResults: [{ studentId: "stu_...", term: "2025-H1", points: 12 }]
```

`term` ist kanonisch `YYYY-H1` oder `YYYY-H2`; eine fehlende Festsetzung ist
ein fehlender Eintrag, nie `null`. Alte Kurse ohne Feld migrieren zu `[]`. Die
lokale Normalisierung verwirft ungueltige Eintraege und Duplikate nach dem
ersten gueltigen Eintrag. Archive behalten historische Ergebnisreferenzen.
Eine bereits gespeicherte Festsetzung bleibt auch erhalten, wenn die Person
spaeter aus einem aktiven Kurs ausgetragen wird. Neue oder geaenderte
Festsetzungen sind weiterhin nur fuer aktuell eingeschriebene Personen erlaubt.

Rohe Importwerte werden strenger geprueft: Duplikate, unbekannte Personen,
ungueltige Halbjahre, nicht ganzzahlige oder ausserhalb liegende Punkte und
fehlende aktive Einschreibungen werden vor der Normalisierung abgelehnt. Der
Merge erhaelt stabile Personen-IDs; bei gleichem Kurs, Person und Halbjahr bleibt die
lokale Festsetzung erhalten und wird als Konflikt gezaehlt. Bestehende lokale
Archive werden nur ueber stabile Identitaet (ID oder `importKey`) zugeordnet.
Gleich benannte Archive verschiedener Schuljahre bleiben getrennte historische
Einheiten. Eine Kurszuordnung ueber eine externe Kennung unterscheidet zusaetzlich
Sek-I-/Sek-II-Schema, Schuljahr und Archivkontext. Reine Namensgleichheit verbindet
keine verschiedenen IDs. Neue Archive erhalten nur eindeutig zugeordnete Ergebnisse.

Detailansicht, Einzel-/Sammel-PDF und Excel-Kursexport halten `Rechenwert` und
`Festgesetzte Punktzahl` getrennt. Die Festsetzungszeile oder -spalte erscheint
nur bei vorhandenem Eintrag. Im Sammeldruck bleibt eine bewusst ausgewaehlte
Option `Alle Halbjahre` auch beim Neuaufbau der Termliste erhalten. Schlaegt das
Speichern einer Festsetzung fehl, wird ihr Kandidat nicht veroeffentlicht;
der bestaetigte Wert und parallel bestaetigte andere Festsetzungen bleiben erhalten.

### Manueller M32-Check

In einem synthetischen aktiven Sek-II-Kurs ein leeres Festsetzungsfeld neben dem
Rechenwert pruefen, `12` setzen, neu laden sowie leeren und erneut laden. Einen
synthetischen Kurs archivieren und die lesende Anzeige pruefen. Detail und Druck
muessen Rechenwert und Festsetzung getrennt beschriften. Automatisierte
Node-DOM-Tests fuehren den echten Notentabellenrenderer ohne Leistungen und den
echten Archivdialog mit result-only Personen und Halbjahreswerten aus. Die
controllergefuehrte Abschlussabnahme wurde mit ausschliesslich synthetischen
Daten auf einem frischen lokalen Ursprung durchgefuehrt: Setzen und Leeren
ueber verschluesselte Reloads, Detailausgabe und Nur-Lese-Archivansicht waren
korrekt; die finale Konsole blieb ohne Warnungen oder Fehler. Datum-only-
Altleistungen besitzen eine eigene Archivregression. Das separate
`window.open`-Druckfenster konnte die In-App-Browsersteuerung nicht erfassen und
bleibt deshalb auf dem Zielbrowser manuell zu pruefen.

## Nachtrag Welle 11: M31 – Sek-II-Kurskontext (2026-08-28)

Rechtsstand ist die Berliner VO-GO, Fassung vom **31.07.2026**, gültig ab **16.08.2026**: In Q1 bis Q3 sind im GK eine, im LK zwei Klausuren je Halbjahr vorgesehen; in Q4 wird nur in schriftlichen Prüfungsfächern eine Klausur geschrieben. Bei einer beziehungsweise zwei Klausuren ist der Klausurteil in der Regel mit einem Drittel beziehungsweise der Hälfte zu berücksichtigen. Die Lehrkraft setzt die Kursnote oder Punktzahl; die Anwendung liefert keine automatische Festsetzung. Amtliche Grundlage: [VO-GO § 14/§ 15](https://gesetze.berlin.de/bsbe/document/jlr-NNLBE0000483ENN00000000262).

Ein Sek-II-Kurs speichert optional `upperSecContext` mit `courseType` (`basic`, `advanced`, `other`), `qualificationYear` (`q1-q2`, `q3-q4`) und einer optionalen, maximal 1000 Zeichen langen `weightingDeviationReason`. Eine Einschreibung enthält `writtenExamSubjectQ4`. Alte Sek-II-Kurse ohne Kontext bleiben gültig und werden als prüfbedürftig angezeigt; die Anwendung rät weder Kursart noch Q-Abschnitt. Die Felder gehen durch Migration, verschlüsselten Speicher, JSON-Import/Merge und Archiv-Snapshot.

Die Berliner Gewichtung ist eine sichtbare Empfehlung, keine automatische pädagogische Entscheidung: bereits gewählte Gewichtungen bleiben erhalten, Abweichungen sind bewusst zulässig und können freiwillig begründet werden. Im Q3/Q4-GK wird das schriftliche 3. Prüfungsfach je Person gepflegt. In Q4 ist die Klausurzelle für nicht markierte Personen „nicht vorgesehen“: sie ist gesperrt, vorhandene Altwerte bleiben sichtbar, werden aber nicht gewertet.

Die Terminlogik ist schemaabhängig. Sek II trennt Q1, Q2, Q3 und Q4 strikt; die frühere Vorhalbjahres-Option ist dort fachlich wirkungslos. Sek I wertet in H1 nur H1, am Ende von H2 jedoch alle Einzelbewertungen aus H1 und H2 gemeinsam aus; eine H1-Zeugnisnote wird nicht als Einzelbewertung erneut eingerechnet.

Der CSV-Transfer bleibt mit dem alten Acht-Spalten-Format und den bisherigen 9- bis 13-spaltigen Erweiterungen kompatibel. Optional rechts angehängt werden `Schema`, `Kursart`, `Qualifikationsabschnitt`, `3. Prüfungsfach schriftlich` und `Stammklasse`; der aktuelle eigene Export ergaenzt als 14. Spalte `CSV-Schutz`. Unbekannte oder pro Kurs widersprüchliche Sek-II-Angaben sind Importfehler. Beim Schuljahreswechsel wird Q1/Q2 als Q3/Q4 vorgeschlagen (ohne übernommene Q4-Flags oder Abweichungsbegründung); Q3/Q4 endet und wird archiviert.

Grenzen: individuelle/sonstige Kurse erhalten keine automatische Empfehlung; bei unsicherer Kategorienrolle unterbleibt die automatische Umgewichtung; der LK-Sonderfall ausschließlich versäumter oder mit 0 Punkten bewerteter Klausuren bleibt eine fachliche Entscheidung. Schüler:innen-PDF und Kolleg:innen-CSV enthalten keine interne Abweichungsbegründung. Die controllergeführte sichtbare Wave-11-Browserabnahme auf frischem synthetischem Ursprung bestand mit 49/49 Fällen und ohne Konsolenfehler oder -warnungen. Praktische Restgrenzen sind nur das Legacy-Raw-Backup `iv:ciphertext` mit bereits vorhandenem lokalem Salt sowie Zielbrowser-/Druckertreiberlayout.

### Aktualisierung nach den letzten Randfallkorrekturen

Die Folgefixes `b488558` und `42b30b5` ergänzten die M31-Absicherung um fünf
Randfälle (Datumsmigration, gemischter LK-Sonderfall, fehlende Vorlagen-ID,
mehrdeutige Rollen und widersprüchliche CSV-Flags) sowie die Priorität
Archiv-Snapshot vor Kurs und globalen Halbjahresgrenzen. Die historische Prüfung
ergab `npm test` und `npm run test:tap` jeweils **256/256**, `npm run check`
**1/1** und im frischen Browserursprung `localhost:8769` **49/49** ohne
Konsolenfehler oder -warnungen (`largeStateNormalizeMs`: 13). Das unabhängige
Das finale Gesamtreview und die Integrationsentscheidung waren zu diesem
historischen Zeitpunkt noch offen.

Die historischen Task-7-Fixes `c9c6b8f` und `12badee` sind zusätzlich durch
einen Fokuslauf mit 137/137 Fällen sowie die vollständige 256/256-Suite belegt.
Der Browserlauf und das unabhängige finale Gesamtreview standen für diesen
historischen Code-Stand noch aus.


## Aktueller Prüfstand

Historische Wellenberichte und damalige Zwischenstände wurden bei der
Repository-Bereinigung entfernt. Der technische und noch offene
Desktop-Prüfstand steht in [ABNAHME.md](docs/ABNAHME.md). Die
nachvollziehbaren Befunddefinitionen und Prüfverknüpfungen stehen im
[Befundregister](docs/quality/current-findings.json).
Änderungen werden in [CHANGELOG.md](CHANGELOG.md) zusammengefasst.
