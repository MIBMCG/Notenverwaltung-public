# Weiterarbeit am Desktop

**20. November 2026.** Der lokale Branch `codex/review-korrekturen` enthält die weitere Bearbeitung von A3 bis D3. Der [Maßnahmenplan](superpowers/plans/2026-11-18-review-korrekturen.md) enthält die Abnahme. Die folgenden Angaben dokumentieren die frühere Übergabe auf dem Stand von A2.

Stand vom 19. November 2026. Arbeitsrepository ist `MIBMCG/Notenverwaltung-public`.
Der Branch `codex/a2-halbjahreszuordnung` enthält beide abgeschlossenen Korrekturen
und diese Übergabe. Im bestehenden öffentlichen Checkout am Desktop weiterarbeiten.

## Erreichter Stand

- A1 ist in Commit `6923301` behoben. Escape stellt den bestätigten Zellwert und
  Status wieder her. Laufende Speichervorgänge, neue Entwürfe und verspätete
  Fokuswechsel sind durch acht Regressionstests abgedeckt.
- A2 ist in Commit `3399b48` behoben. Undatierte Leistungen behalten das
  gespeicherte Halbjahr. Eine neue Leistung erhält beim Anlegen das aktuelle
  Halbjahr. Ein später eingetragenes Datum führt zur Zuordnung anhand der
  wirksamen Stichtage. Vier neue Regressionstests prüfen auch die Migration.
- Der letzte vollständige Lauf auf diesem Quellstand bestand mit
  **1.525/1.525 Tests** unter Windows und Node 26.12.1.
  Aufruf war `npm.cmd test -- --test-concurrency=1`.
  Der vorangegangene Lauf mit drei parallelen Testdateien hatte einen
  PowerShell-Timeout in `tests/public-snapshot.test.js`. Der serielle Lauf
  bestand mit null Fehlern und null übersprungenen Tests.
- Syntax, bytegenauer HTML-Vergleich, Befundregister mit 78 Einträgen und
  44 Quellhashes, Dokumentlinks sowie 21 Release-/Dokumenttests bestanden.
- Beide Bedienfolgen wurden mit synthetischen Daten in Chrome 157 unter
  Windows einschließlich vollständigem Browserneustart und Entsperren geprüft.
  A2 verwendete ein isoliertes Headless-Profil und eine nur in der Testseite
  simulierte Uhr. Die Übernahme auf dem tatsächlichen Desktop ist noch offen.

Der [Umsetzungsplan](superpowers/plans/2026-11-18-review-korrekturen.md)
führt A1 und A2 als erledigt. Das
[korrigierte Review](quality/2026-11-18-code-review.md) enthält die ursprünglichen
Reproduktionen. Der letzte veröffentlichte Stand ist
[Version 1.7.2](https://github.com/MIBMCG/Notenverwaltung-public/releases/tag/v1.7.2).

## Checkout am Desktop übernehmen

Im vorhandenen Ordner `Notenverwaltung-public` zuerst prüfen und abrufen.

```powershell
git status --short --branch
git remote -v
git fetch --all --prune
```

Vorhandene Desktop-Änderungen und weiter fortgeschrittene Branches erhalten.
Bei sauberem Checkout auf den Übergabebranch wechseln und per Fast-Forward
aktualisieren.

```powershell
git switch codex/a2-halbjahreszuordnung
git pull --ff-only origin codex/a2-halbjahreszuordnung
git log -4 --oneline
git status --short --branch
npm.cmd ci
npm.cmd run verify:artifact
```

Existiert der Branch noch nicht lokal, legt `git switch` ihn bei eindeutigem
Remote-Namen als Tracking-Branch an. Für einen neuen Checkout kann ein freier
Zielordner verwendet werden.

```powershell
git clone --branch codex/a2-halbjahreszuordnung https://github.com/MIBMCG/Notenverwaltung-public.git Notenverwaltung-Desktop
cd Notenverwaltung-Desktop
npm.cmd ci
```

Der tatsächliche Desktoppfad wird erst dort ermittelt.
Programmdateien und Entwicklungsdokumente werden über Git übertragen.
Ein benötigter Browserbestand wird über ein verschlüsseltes Anwendungsbackup
übernommen.

## Auftrag bei der Übergabe vom 19. November

Als Nächstes folgt **A3, Festsetzungen beim Schemawechsel schützen**, entsprechend
Reviewbefund 6. Der erste Regressionstest prüft den Kurseditor mit festgesetzten
12 Punkten und anschließend mit 0 Punkten. Der Wechsel von Sek II zu Sek I muss
vor der Mutation abgefangen werden. Die Punkte müssen nach Speichern, Sperren
und erneutem Öffnen erhalten sein. Beide Speicherformate V1 und V2 prüfen.
Bereits erfasste Einzelbewertungen und leere umstellbare Kurse sind Gegenproben.

Danach folgen A4 und die weiteren offenen Pakete im Plan.
Die fachliche Entscheidung zu Befund 3 gilt weiterhin. Der Bericht zeigt den
gewichteten Leistungsstand. Gleich gewichtete 15 und 1 Punkte ergeben 8,00,
auch wenn eine Einzelzeile ausgeblendet ist.

## Historischer Startprompt vom 19. November

> Lies START-HIER.md, docs/DESKTOP-START.md und den verlinkten Umsetzungsplan.
> Prüfe den tatsächlichen Checkout, Branch, HEAD, Remote und vorhandene
> Desktop-Änderungen. Übernimm den aktuellen GitHub-Branch
> codex/a2-halbjahreszuordnung, soweit dies die vorhandene Arbeit erhält.
> A1 und A2 sind abgeschlossen. Bearbeite als Nächstes ausschließlich A3.
> Nutze Superpowers und je Aufgabe passende Modelle und Denktiefen.
> Beginne mit einem reproduzierbar fehlschlagenden Regressionstest für den
> Schemawechsel bei vorhandenen Sek-II-Festsetzungen einschließlich 0 Punkten.
> Prüfe V1 und V2 über den normalen Bedienpfad, lasse die Korrektur unabhängig
> reviewen und aktualisiere den Plan mit den tatsächlich ausgeführten Prüfungen.
> Nenne am Ende für jede Aufgabe das eingesetzte Modell und seine Denktiefe.
