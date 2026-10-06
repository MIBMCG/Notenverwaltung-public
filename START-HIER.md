# Einstieg in die Notenverwaltung

## Anwendung nutzen

Version **1.6.0** wurde am **06.10.2026** lokal gebaut und geprüft. Der
öffentliche Download wird erst nach der Veröffentlichungsfreigabe unter
[MIBMCG/Notenverwaltung-public](https://github.com/MIBMCG/Notenverwaltung-public/releases)
bereitgestellt. Derzeit ist das Repository noch nicht veröffentlicht. Der
technische Prüfstand und die Grenzen stehen in der [Abnahme](docs/ABNAHME.md)
und in der [Veröffentlichungsprüfung](docs/quality/PUBLICATION.md).

Das vollständige Anwendungspaket in einen festen Ordner entpacken und
`Notenverwaltung.html` im vorgesehenen Dateibrowser öffnen. Für die Nutzung
sind kein Node.js, Server oder Benutzerkonto nötig. Beim ersten Start ein
Passwort einrichten. Browserdaten liegen im jeweiligen Profil und werden durch
das Kopieren der HTML-Datei nicht übertragen.

Vor einem Update ein verschlüsseltes Backup des bestätigten Bestands anlegen
und alle alten Anwendungsfenster schließen. Nur ein Fenster darf denselben
Browserbestand bearbeiten. Für einen Geräte- oder Browserwechsel beschreibt
die [Kurzanleitung](docs/KURZANLEITUNG.md) den Backup-Import.

Schulname und Logo sind unter „Einstellungen → Schule und Logo“ anpassbar.
Neue Logos dürfen höchstens 256 KiB groß sein; vorhandene gültige Logos bis
zur früheren Grenze von 2 MiB bleiben erhalten. Neben der HTML-Datei kann
ein eigenes `Logo.png` liegen; sonst wird das neutrale `placeholder-logo.svg`
verwendet.

## Entwickeln und Fehler melden

Quellen stehen unter `src/`; `Notenverwaltung.html` entsteht aus `npm run build`.
Die [Beitragsanleitung](docs/CONTRIBUTING.md) beschreibt Prüfungen und
datensparsame Fehlerberichte. Nach der Veröffentlichung liegen öffentliche
Issues unter [Notenverwaltung-public/issues](https://github.com/MIBMCG/Notenverwaltung-public/issues).
Für Sicherheitsprobleme gilt [SECURITY.md](SECURITY.md): Der private Meldeweg
muss bei der Veröffentlichung eingerichtet und geprüft werden; bis dahin
keine Sicherheitsdetails in öffentlichen Issues posten.

Die [Tests](tests/README.md) und das [Befundregister](docs/BEFUNDE.md)
enthalten reproduzierbare technische Nachweise. Echte Schülerdaten,
Passwörter, Backups und private Screenshots gehören nicht in Tests oder Issues.
