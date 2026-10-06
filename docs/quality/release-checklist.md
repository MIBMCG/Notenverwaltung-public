# Freigabecheckliste für Notenverwaltung 1.6.0

Stand: lokal am 06.10.2026 gebaut, unveröffentlicht. Diese Liste ist kein PASS-Nachweis.
Für jeden Punkt Commit, Datum, Prüfer, Soll/Ist und Beleg festhalten; offene
Punkte mit `NOT RUN`, konkrete Hürden mit `BLOCKED` kennzeichnen.

- [ ] Bestehende Task-9-Nachweise und den ausdrücklichen Nutzerentscheid
      vom 05.10.2026 gemäß [Abnahme und Prüfgrenzen](../ABNAHME.md) übernehmen
      und prüfen. Der manuelle Wiederholungsauftrag ist beendet; fehlende
      frische Nachweise bleiben NOT RUN, Teilbeobachtungen begrenzt.
- [ ] Technische Gesamtsuite, Syntax, Build-Identität, Befundregister,
      Dokumentlinks sowie Releasepaket am endgültigen Commit prüfen.
- [ ] Nur die zehn zugelassenen Root-Dateien in das Anwendungspaket aufnehmen;
      neun innere und die äußere SHA-256-Prüfsumme prüfen.
- [ ] Lizenz, Drittanbieterhinweise, neutrale Assets und ausdrückliche
      Dateiauswahl im frischen öffentlichen Snapshot prüfen.
- [ ] Falls die Veröffentlichung nach dem 06.10.2026 erfolgt, Datum in Programm,
      Dokumenten und Releasehinweisen aktualisieren, neu bauen und den neuen
      Hash sowie die Versions-/Datumsansichten gezielt prüfen.
- [ ] Zielrepository, Tag, Paket, Hashes, Releasebeschreibung und
      Gesamtprüfbericht zur konkreten Veröffentlichungsentscheidung vorlegen.
- [ ] Nach Zustimmung das neue Repository zunächst privat anlegen,
      geprüften Quellstand pushen und CI prüfen; Tag und Releaseentwurf nur
      vorbereiten, noch nicht veröffentlichen.
- [ ] Erst nach genehmigter öffentlicher Sichtbarkeit GitHubs privates
      Vulnerability Reporting aktivieren und extern verifizieren.
- [ ] Danach ausschließlich SECURITY.md auf dem Standardbranch ändern und
      den separaten Diff eng reviewen: Release-Root/Tag/ZIP/Hashes unverändert,
      HTML und Paketbaum bytegleich. Kein neues 1.6.0-Paket vom Folgecommit.
- [ ] Erst nach diesem Reportinggate das vorbereitete Release veröffentlichen.
      Danach anonymen Download, Prüfsummen, Quellarchiv und frischen Quellklon
      technisch kontrollieren. Für Start und Wiederherstellung ausschließlich
      vorhandene nutzerberichtete Praxis und begrenzte Teilbeobachtungen mit
      ihren ursprünglichen Versions-/Hashgrenzen dokumentieren; keine neue
      manuelle Wiederholung und keinen neuen Desktop-PASS ableiten.
