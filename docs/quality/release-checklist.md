# Freigabecheckliste für Notenverwaltung 1.7.0

Stand: 16.10.2026. Veröffentlichung durch den Nutzer beauftragt. Diese Liste
beschreibt die erforderlichen Nachweise; sie nimmt ihr Ergebnis nicht vorweg.
Prüfprotokolle, CI-Läufe und GitHub-Release ordnen Ergebnisse dem Commit zu.

- Produktversion 1.7.0, Datum 16.10.2026 und aktuelle Dokumentation abgleichen.
- Vollständige Testsuite, Syntax, Build-Identität, Befundregister und Dokumentlinks
  prüfen. Keine Dateisystem-Schutzprüfung zur Umgehung lokaler Umgebungsfehler ändern.
- Alle vier GitHub-CI-Kombinationen auf dem endgültigen Quellstand abwarten:
  Windows/Node 22 und 24, Ubuntu/Node 20 und 22.
- Releasepaket doppelt bauen und Bytegleichheit, genau zehn Root-Dateien,
  neun innere SHA-256-Hashes und die äußere ZIP-Prüfsumme prüfen.
- Lizenz, Drittanbieterhinweise, neutrale Assets und ausdrückliche öffentliche
  Dateiauswahl kontrollieren. Keine echten Daten, Geheimnisse oder Supportdateien.
- Erfolgreiche Nutzertests für Code-Nachrüstung und Wiederherstellung festhalten.
  Nicht genannte Plattformen und Wiederherstellungsvarianten bleiben unbestätigt;
  weitere Grenzen stehen in [ABNAHME.md](../ABNAHME.md).
- Änderung über Pull Request in das bestehende öffentliche Repository integrieren;
  geprüften Branch- und Merge-Stand vergleichen. Tag `v1.7.0` nicht nachträglich verschieben.
- Aktives privates Vulnerability Reporting prüfen. ZIP, Prüfsumme und Hinweise als
  reguläres GitHub-Release veröffentlichen; ältere Downloads unverändert lassen.
- Anonymen Download zurückprüfen, Tag-/Branch-SHAs und öffentlichen Quellstand
  kontrollieren. Lokalen öffentlichen Hauptbranch ohne Überschreiben fremder
  Änderungen auf den veröffentlichten Stand bringen.

Werkzeuge und Befehle: [Veröffentlichung](PUBLICATION.md).
