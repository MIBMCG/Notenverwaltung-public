# Freigabecheckliste für Notenverwaltung 1.7.2

Stand: 04.11.2026. Veröffentlichung durch den Nutzer beauftragt. Diese Liste
beschreibt die erforderlichen Nachweise; sie nimmt ihr Ergebnis nicht vorweg.
Prüfprotokolle, CI-Läufe und GitHub-Release ordnen Ergebnisse dem Commit zu.

- Produktversion 1.7.2, Datum 04.11.2026 und aktuelle Dokumentation abgleichen.
- Vollständige Testsuite, Syntax, Build-Identität, Befundregister und Dokumentlinks
  prüfen. Keine Dateisystem-Schutzprüfung zur Umgehung lokaler Umgebungsfehler ändern.
- Alle vier GitHub-CI-Kombinationen auf dem endgültigen Quellstand abwarten:
  Windows/Node 22 und 24, Ubuntu/Node 20 und 22.
- Releasepaket doppelt bauen und Bytegleichheit, genau zehn Root-Dateien,
  neun innere SHA-256-Hashes und die äußere ZIP-Prüfsumme prüfen.
- Lizenz, Drittanbieterhinweise, neutrale Assets und ausdrückliche öffentliche
  Dateiauswahl kontrollieren. Keine echten Daten, Geheimnisse oder Supportdateien.
- Wiederherstellung der globalen Zeiträume und Bezeichnungen für Sek I und Sek II
  prüfen: vollständiger Ersatz aus der Sicherung, lokale Angaben beim Merge,
  Ergänzung fehlender Legacy-Gruppen oder -Stufen vor der Migration, V1 mit
  Passwort sowie V2 mit Passwort oder passendem Code. Abbruch und Speicherfehler
  dürfen keinen unbestätigten Zustand veröffentlichen.
- Die 1.513 bestandenen Tests des versionierten Releasequellstands vom
  04.11.2026 den commitbezogenen CI- und Paketnachweisen zuordnen.
  Historische Nutzer- und Browsernachweise nicht als neue Abnahme ausgeben;
  Grenzen stehen in [ABNAHME.md](../ABNAHME.md).
- Änderung über Pull Request in das bestehende öffentliche Repository integrieren;
  geprüften Branch- und Merge-Stand vergleichen. Tag `v1.7.2` erst auf den
  endgültigen geprüften Commit setzen; bestehende Tags einschließlich `v1.7.1`
  nicht verschieben.
- Aktives privates Vulnerability Reporting prüfen. ZIP, Prüfsumme und Hinweise als
  reguläres GitHub-Release veröffentlichen; ältere Downloads unverändert lassen.
- Anonymen Download zurückprüfen, Tag-/Branch-SHAs und öffentlichen Quellstand
  kontrollieren. Lokalen öffentlichen Hauptbranch ohne Überschreiben fremder
  Änderungen auf den veröffentlichten Stand bringen.

Werkzeuge und Befehle: [Veröffentlichung](PUBLICATION.md).
