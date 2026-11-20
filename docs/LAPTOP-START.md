# Auf dem Laptop mit Etappe A beginnen

**Fortsetzung vom 19. November 2026.** A1 und A2 sind abgeschlossen.
Die [Desktop-Übergabe](DESKTOP-START.md) führt zum aktuellen Arbeitsbranch
`codex/a2-halbjahreszuordnung` und zur nächsten Aufgabe A3.
Die folgenden Angaben dokumentieren die ursprüngliche Laptop-Übergabe.

Der Branch `codex/laptop-uebergabe` enthält das [korrigierte Review](quality/2026-11-18-code-review.md) und den [Umsetzungsplan](superpowers/plans/2026-11-18-review-korrekturen.md) für die Notenverwaltung 1.7.2. Die Korrekturen A bis D stehen aus. Basis ist der Release-Commit `c988942cabb4b2ed73c2656eb7ef6a92bb791e9a`.

## Startprompt für Codex

> Lies `docs/LAPTOP-START.md`, das verlinkte Review und den Umsetzungsplan. Prüfe den lokalen Git-Stand und erhalte vorhandene Laptop-Arbeit. Lege für die Umsetzung einen Arbeitsbranch auf Basis dieser Übergabe an. Bearbeite Etappe A, Aufgaben A1 bis A4 einschließlich der Prüfung alter V1-Sicherungen. Beginne mit dem Regressionstest für A1 und prüfe jede Korrektur über den normalen Bedienpfad mit synthetischen Daten. Halte den erreichten Stand im Plan fest.

## GitHub-Arbeitskopie öffnen

Für eine frische Arbeitskopie in einem eigenen Verzeichnis:

```powershell
git clone --branch codex/laptop-uebergabe https://github.com/MIBMCG/Notenverwaltung-public.git Notenverwaltung-Laptop
cd Notenverwaltung-Laptop
npm.cmd ci
```

In einer vorhandenen Arbeitskopie zunächst mit `git status --short --branch` den Stand prüfen. Mit `git fetch origin` lässt sich die Übergabe abrufen. Auf dem Desktop lief die Prüfung des Ausgangsstands mit Node 22.23.5 und 1.513 bestandenen Tests.

**Erster Test:** In der Sek-I-Notentabelle die Note 5 auf 1 korrigieren und speichern, anschließend 3 tippen, Escape drücken und die Ansicht verlassen. Beim erneuten Öffnen muss die bestätigte 1 erhalten sein. Der Reviewlauf von Version 1.7.2 ergab wieder 5.

**Fachliche Entscheidung zu Befund 3:** Der Schülerbericht zeigt den tatsächlichen gewichteten Leistungsstand. Gleich gewichtete 15 und 1 Punkte ergeben 8,00, auch wenn nur die 15 als Einzelzeile sichtbar ist. Diese Entscheidung gilt für Sek I und Sek II sowie für Einzel- und Sammelberichte.
