# Veröffentlichung und prüfbarer Quellstand 1.7.0

Ziel ist das bestehende öffentliche Repository
[MIBMCG/Notenverwaltung-public](https://github.com/MIBMCG/Notenverwaltung-public).
Version 1.7.0 vom 16.10.2026 ergänzt die Offline-Passwortwiederherstellung.
Die Veröffentlichung wurde am 16.10.2026 ausdrücklich beauftragt. Private
Entwicklungshistorie, Supportdateien und echte Notenbestände gehören nicht zum
öffentlichen Quellstand.

## Technische Prüfung

Mit Node.js ab Version 20 lässt sich der Quellstand ohne Git-Historie prüfen:

```sh
npm ci
npm test
npm run check
npm run build
npm run verify:artifact
npm run check:findings
npm run check:doc-links
npm run test:release
```

Die GitHub-CI prüft Windows mit Node 22 und 24 sowie Ubuntu mit Node 20 und 22.
Für eine Veröffentlichung müssen die Prüfungen am einzubindenden Commit grün
sein. Die Dateisystemtests benötigen einen normalen temporären Ordner und
passende Rechte für symbolische Links. OneDrive-Reparsepunkte werden vom
Snapshot-Werkzeug absichtlich abgewiesen; die Schutztests dürfen dafür nicht
abgeschwächt werden.

Das [Befundregister](current-findings.json) hält 78 historische Kennungen sowie
42 aktuelle Quellhashes, Testdateien und Codeanker fest. Der
[Implementierungsnachweis](password-recovery-verification.md) dokumentiert
die Entwicklungstests und ihre Grenzen. Technische Tests und
[praktische Abnahme](../ABNAHME.md) sind getrennt zu lesen.

## Anwendungspaket

```sh
npm run build:release -- --version 1.7.0 --out <absoluter-Ordner>
npm run verify:release -- --zip <absoluter-ZIP-Pfad> --version 1.7.0
```

Das Paket enthält genau zehn Dateien im ZIP-Wurzelverzeichnis. Seine
`SHA256SUMS.txt` prüft die neun Inhaltsdateien, die äußere `.zip.sha256`-Datei
prüft das ZIP. Vor Veröffentlichung werden ein bytegleicher Doppelbuild, die
Übereinstimmung von HTML und Quellen sowie die Paketlinks geprüft.

## Integration und Veröffentlichung

1. Versionsnummer, Datum, Anleitung und Releasehinweise konsistent aktualisieren;
   vollständigen Diff und ausdrückliche Dateiauswahl prüfen.
2. Branch ohne Force-Push veröffentlichen, Pull Request auf `main` anlegen und
   alle vier CI-Jobs abwarten. Nur den unverändert geprüften Stand integrieren.
3. Den integrierten Quellstand mit dem geprüften Branch vergleichen, erneut
   erforderliche Prüfungen abwarten und `v1.7.0` auf diesen Commit setzen.
   Bestehende Tags und alte Downloads bleiben unverändert.
4. Release mit ZIP, äußerer Prüfsumme und Releasehinweisen veröffentlichen.
   GitHubs privates Vulnerability Reporting muss weiterhin aktiviert sein.
5. Öffentlichen Download ohne Anmeldung zurückladen, ZIP und Inhaltsprüfsummen
   kontrollieren sowie Tag, Standardbranch und Quellstand abgleichen.

Diese Beschreibung ist der Ablauf, kein vorweggenommener Erfolgsnachweis.
GitHub-Prüfläufe und Release-Metadaten belegen den tatsächlich veröffentlichten
Commit. Die [Checkliste](release-checklist.md) beschreibt die Prüfpunkte.

## Inhalt und Rechte

Der eigene Code steht unter [MIT](../../LICENSE). Historische Bewertungsoracles
unter `tests/fixtures/` sind Code-Testfixtures. Die Anwendung verwendet ein
neutrales [Platzhalterlogo](../../ASSET_NOTICES.md). Die Hinweise zu gebündelten
Bibliotheken stehen in [THIRD_PARTY_NOTICES.txt](../releases/THIRD_PARTY_NOTICES.txt);
die Konzeptvorschau enthält ihre [Lucide-Lizenz](../ui/concepts/vendor/lucide-LICENSE).
Sicherheitsmeldungen erfolgen gemäß [SECURITY.md](../../SECURITY.md) vertraulich.
