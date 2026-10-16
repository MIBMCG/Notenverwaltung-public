# Einstieg in die Notenverwaltung

## Anwendung nutzen

Version **1.7.0 vom 16.10.2026** bietet einen separaten Offline-Code zur
Wiederherstellung lokaler Daten und neuer Backups. Das Anwendungspaket findest
du auf der [Release-Seite für 1.7.0](https://github.com/MIBMCG/Notenverwaltung-public/releases/tag/v1.7.0).
Die [Release-Hinweise](docs/releases/1.7.0.md) erklären den Umstieg;
der technische Prüfstand und die Grenzen stehen in der [Abnahme](docs/ABNAHME.md).

Das vollständige Anwendungspaket in einen festen Ordner entpacken und
`Notenverwaltung.html` im vorgesehenen Dateibrowser öffnen. Für die Nutzung
sind kein Node.js, Server oder Benutzerkonto nötig. Beim ersten Start ein
Passwort einrichten, den Wiederherstellungscode getrennt sichern und ihn
vollständig zur Bestätigung erneut eingeben. Browserdaten liegen im jeweiligen Profil und werden durch
das Kopieren der HTML-Datei nicht übertragen.

Vor einem Update ein verschlüsseltes Backup des bestätigten Bestands anlegen
und alle alten Anwendungsfenster schließen. Nur ein Fenster darf denselben
Browserbestand bearbeiten. Für einen Geräte- oder Browserwechsel beschreibt
die [Kurzanleitung](docs/KURZANLEITUNG.md) den Backup-Import.

Bestehende Bestände lassen sich mit dem bisherigen Passwort weiter öffnen; der
Code kann unter **Einstellungen → Sicherheit** freiwillig nachgerüstet werden.
Neue Bestände und Backups mit Codezugang brauchen Version 1.7.0 oder neuer.
Alte Sicherungen bleiben mit ihrem damaligen Passwort lesbar und erhalten
keinen Codezugang nachträglich. Nach Nachrüstung, Passwortwechsel oder
Wiederherstellung ein neues Backup erstellen und den neuen Code sicher verwahren.

Schulname und Logo sind unter „Einstellungen → Schule und Logo“ anpassbar.
Neue Logos dürfen höchstens 256 KiB groß sein; vorhandene gültige Logos bis
zur früheren Grenze von 2 MiB bleiben erhalten. Neben der HTML-Datei kann
ein eigenes `Logo.png` liegen; sonst wird das neutrale `placeholder-logo.svg`
verwendet.

## Entwickeln und Fehler melden

Quellen stehen unter `src/`; `Notenverwaltung.html` entsteht aus `npm run build`.
Die [Beitragsanleitung](docs/CONTRIBUTING.md) beschreibt Prüfungen und
datensparsame Fehlerberichte. Öffentliche
Issues findest du unter [Notenverwaltung-public/issues](https://github.com/MIBMCG/Notenverwaltung-public/issues).
Sicherheitsprobleme bitte über den privaten Meldeweg in
[SECURITY.md](SECURITY.md) berichten.

Die [Tests](tests/README.md) und das [Befundregister](docs/BEFUNDE.md)
enthalten reproduzierbare technische Nachweise. Echte Schülerdaten,
Passwörter, Wiederherstellungscodes, Backups und private Screenshots gehören
nicht in Tests oder Issues.
