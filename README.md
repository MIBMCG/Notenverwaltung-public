<div align="center">

# Notenverwaltung

**Noten, Kurse und Schuljahre verwalten – lokal in deinem Browser.**

[Version 1.7.0 vom 16.10.2026](docs/releases/1.7.0.md) · [Kurzanleitung](docs/KURZANLEITUNG.md) · [Prüfstand](docs/ABNAHME.md)

</div>

Notenverwaltung ist eine lokale Anwendung für Lehrkräfte. Sie unterstützt die
Notenerfassung in der Sekundarstufe I und II, Auswertungen, Berichte und den
Schuljahreswechsel. Du benötigst weder ein Benutzerkonto bei einem Dienst noch
einen Server. Die Anwendung lässt sich nach dem Herunterladen offline nutzen.

## Was die Anwendung bietet

| Bereich | Funktionen |
| --- | --- |
| **Kurse und Personen** | Kurse organisieren, Schüler:innen zuordnen und Kurssymbole auswählen |
| **Noteneingabe** | Leistungen und Gewichtungen verwalten, Noten beziehungsweise Punkte erfassen |
| **Auswertung** | Halbjahres- und Jahresansichten, Kursstatistik und Berichte |
| **Schuljahreswechsel** | Kurse archivieren und Nachfolgekurse anlegen |
| **Datenaustausch** | Verschlüsselte Backups, CSV-Import/-Export und echte Excel-Arbeitsmappen |
| **Zugang wiederherstellen** | Separater Offline-Code für lokale Daten und neue Backups |
| **Darstellung** | Klassisch, Modern ruhig oder Aurora; Hell-/Dunkelmodus, Farben und Bewegung |
| **Eigene Schule** | Schulname und PNG-Logo in den Einstellungen anpassen |

Die Anwendung richtet sich vor allem an Desktop-PCs und Laptops. Die Nachrüstung
eines Codes und eine Wiederherstellung wurden vom Nutzer erfolgreich ausprobiert;
Browser, Betriebssystem und genaue Wiederherstellungsvariante sind dabei nicht
benannt. Eine vollständige Browser- oder Geräteabnahme wird daraus nicht abgeleitet.
Die [Abnahmeübersicht](docs/ABNAHME.md) nennt die Prüfgrenzen.

## In wenigen Schritten starten

Lade das Anwendungspaket von der [Release-Seite für 1.7.0](https://github.com/MIBMCG/Notenverwaltung-public/releases/tag/v1.7.0)
herunter und entpacke es vollständig in einen festen Ordner. Öffne
`Notenverwaltung.html` im Browser. Beim ersten Start richtest du ein Passwort
ein, sicherst den separaten Wiederherstellungscode und gibst ihn zur Bestätigung
vollständig erneut ein. `placeholder-logo.svg` kann im selben Ordner bleiben.

Für die Nutzung sind keine Installation, kein Node.js und kein Build nötig.
Das Anwendungspaket enthält eine Startanleitung und die Kurzanleitung.

Ab Version 1.4.0 gibt es unter **Einstellungen → Schule und Logo**
eine eigene Schulbezeichnung und eine PNG-Auswahl mit beliebigem Dateinamen.
Beides wird lokal verschlüsselt gespeichert und im Backup mitgenommen. Alternativ
werden ein eigenes `Logo.png` und anschließend das neutrale `placeholder-logo.svg`
neben der HTML-Datei gesucht.
Ab Version 1.5.0 darf eine neu ausgewählte PNG-Datei höchstens 256 KiB und
4096 × 4096 Pixel groß sein. Bereits gespeicherte gültige Logos bis zur früheren
Grenze von 2 MiB bleiben im Bestand und in vollständigen Backups erhalten.
Öffentliche Downloads liegen unter
[MIBMCG/Notenverwaltung-public](https://github.com/MIBMCG/Notenverwaltung-public/releases).
Die frühere private Projektablage ist davon getrennt.

## Deine Daten bleiben bei dir

Die Anwendung speichert ihre Daten verschlüsselt im lokalen Browserprofil.
Sie überträgt die eingegebenen Noten nicht automatisch an einen Server und
benötigt keinen Cloud-Dienst.

- **Ein Fenster bearbeiten lassen:** Für denselben Browserbestand erhält nur
  ein Fenster die Bearbeitungsberechtigung. Das erste Fenster geordnet sperren
  oder schließen, dann im zweiten „Erneut versuchen“ wählen und neu anmelden.
- **Regelmäßig sichern:** „Backup“ schließt offene gültige Eingaben zunächst
  ab und wartet auf die Speicherung. Ungültige Eingaben oder Speicherfehler
  verhindern den Download. Prüfe die Datei und ihre Wiederherstellbarkeit.
- **Vor Updates:** Im alten Fenster ein verschlüsseltes Backup erstellen und
  alle Fenster der alten Fassung schließen. Erst dann die neue Datei öffnen.
- **Code getrennt sichern:** Der Code ist ein gleichwertiger geheimer Zugang.
  Bestehende Bestände können ihn freiwillig unter „Einstellungen → Sicherheit“
  nachrüsten. Neue Daten und Backups mit Codezugang benötigen Version 1.7.0
  oder neuer. Alte Backups behalten ihr damaliges Passwort; ein gesperrter
  Altbestand ohne Code lässt sich nicht nachträglich damit öffnen.
- **Browserdaten sind keine Programmdateien:** Das Kopieren der HTML-Datei oder
  des Git-Repositories überträgt keine Schüler:innen oder Noten.
- **Gerätewechsel bewusst durchführen:** Ein anderer Browser, ein anderes Profil
  oder ein anderer Öffnungspfad kann einen eigenen Datenbestand verwenden.
  Die [Kurzanleitung](docs/KURZANLEITUNG.md#auf-ein-anderes-gerät-umziehen)
  beschreibt Sicherung und Wiederherstellung.
- **Exporte sorgfältig behandeln:** CSV und Excel enthalten unverschlüsselte
  Daten. Für eine vollständige Wiederherstellung ist das verschlüsselte Backup vorgesehen.

## Dokumentation

- [Kurzanleitung für den Alltag](docs/KURZANLEITUNG.md)
- [Funktionen und technische Dokumentation](DOKUMENTATION.md)
- [Änderungsübersicht](CHANGELOG.md)
- [Abnahme und bekannte Prüfgrenzen](docs/ABNAHME.md)

Die technischen Nachweise für den Wiederherstellungszugang und die Speicherhärtung
sind dokumentiert. Welche Bedien- und Browserfälle noch ausstehen, steht in der
[Abnahmeübersicht](docs/ABNAHME.md).
Ältere Prüfergebnisse gelten nur für die jeweils genannte Fassung.

## Mitentwickeln

Voraussetzung ist **Node.js ab Version 20**. Im geklonten Repository:

```sh
npm ci
npm test
npm run check
npm run build
npm run verify:artifact
npm run check:findings
```

Die Quellen liegen unter `src/`. Der Build erzeugt daraus die eigenständige
`Notenverwaltung.html`; sie sollte nicht direkt bearbeitet werden. Für die
Nutzung der HTML-Datei werden die Entwicklungswerkzeuge nicht benötigt.

Für Beiträge und datensparsame Fehlerberichte gilt die
[Beitragsanleitung](docs/CONTRIBUTING.md). Sicherheitsprobleme bitte über den
in [SECURITY.md](SECURITY.md) verlinkten privaten Meldeweg berichten.

## Lizenz

Der eigene Projektcode steht unter der **[MIT-Lizenz](LICENSE)**. Sie erlaubt
auch kommerzielle Nutzung, Änderung und Weitergabe, sofern Copyright- und
Lizenzhinweis erhalten bleiben. Die Software wird ohne Gewährleistung
bereitgestellt.
Mitgeliefert wird ausschließlich ein neutrales [Platzhalterlogo](ASSET_NOTICES.md).
Fremde Bestandteile behalten ihre jeweiligen Lizenzen:
[gebündelte Bibliotheken](docs/releases/THIRD_PARTY_NOTICES.txt) und
[Lucide in der Konzeptvorschau](docs/ui/concepts/vendor/lucide-LICENSE).

Das öffentliche Anwendungspaket enthält die erforderlichen Lizenz- und
Drittanbieterhinweise.

## Das Projekt unterstützen

Wenn dir Notenverwaltung im Alltag hilft und du das Projekt magst, freue ich
mich über eine freiwillige Spende. Sie ist keine Voraussetzung für die Nutzung.
Auch ein hilfreicher Fehlerbericht oder eine Verbesserung unterstützt das Projekt.

---

Ein Projekt von **Marco Civico** · [MIBMCG auf GitHub](https://github.com/MIBMCG)
