# Veröffentlichung und prüfbarer Quellstand 1.6.0

**Stand 06.10.2026: lokaler Veröffentlichungskandidat, noch nicht öffentlich.**
Der neue Quellbaum enthält nur einzeln ausgewählte Programm-, Test-, Werkzeug-,
Lizenz- und Dokumentdateien. Seine Git-Historie beginnt mit einem neuen
Rootcommit. Die frühere private Entwicklungshistorie und interne Berichte sind
kein Bestandteil dieses Quellstands.

## Technische Prüfung

Der Quellstand lässt sich mit Node.js ab Version 20 ohne Git-Historie prüfen:

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

Das [Befundregister](current-findings.json) hält 78 stabile Kennungen,
Quellhashes, Testdateien und Codeanker fest. Die [R23-Zuordnung](release-readiness-2026-09-23.json)
ordnet fünf Datenintegritätskorrekturen den mitgelieferten Regressionstests zu.
Die technische Schließung ist von der [Desktopabnahme](../ABNAHME.md) getrennt.
Synthetische Tests und frühere Teilbeobachtungen ergeben keine frische
vollständige Browserabnahme.

Das zehnteilige Anwendungspaket wird mit `npm run build:release -- --version 1.6.0 --out <absoluter-Ordner>`
gebaut und mit `npm run verify:release -- --zip <absoluter-ZIP-Pfad> --version 1.6.0`
geprüft. `SHA256SUMS.txt` im Paket listet die neun Inhaltsdateien. Die äußere
ZIP-Prüfsumme steht in der gleichnamigen `.sha256`-Datei. Eine erneute
Quellarchivprüfung und der bytegleiche Doppelbuild gehören zum externen
Freigabedossier; dieses Dokument enthält weder lokale Pfade noch seine eigene
Commit-ID oder Selbstprüfsumme.

## Inhalt und Rechte

Der eigene Quellcode steht unter [MIT](../../LICENSE). Die beiden historischen
Bewertungsoracles unter `tests/fixtures/` sind reine Code-Testfixtures und
bleiben in den Hash- und Paritätstests eingebunden. Die Anwendung verwendet
ein neutrales [Platzhalterlogo](../../ASSET_NOTICES.md); alte Schul-Assets
gehören nicht zum Quellstand. Die Hinweise zu gebündelten Bibliotheken stehen
in [THIRD_PARTY_NOTICES.txt](../releases/THIRD_PARTY_NOTICES.txt); die
Konzeptvorschau enthält ihre eigene [Lucide-Lizenz](../ui/concepts/vendor/lucide-LICENSE).

## Veröffentlichungsgates

Das Ziel ist [MIBMCG/Notenverwaltung-public](https://github.com/MIBMCG/Notenverwaltung-public).
Repository, Tag, Release und Download sind noch nicht angelegt. Vor einer
öffentlichen Bereitstellung sind eine konkrete Freigabe und diese Reihenfolge
nötig: neues zunächst privates Repository mit geprüftem Quellstand und CI;
Tag und Releaseentwurf nur vorbereiten; genehmigte öffentliche Sichtbarkeit;
GitHubs privates Vulnerability Reporting aktivieren und von außen prüfen;
danach eine getrennt geprüfte Änderung ausschließlich an
[SECURITY.md](../../SECURITY.md) auf dem Standardbranch; anschließend das
vorbereitete Release regulär veröffentlichen und Download/Hashes anonym
rückkontrollieren. GitHubs Reportingfunktion lässt sich erst für ein
öffentliches Repository aktivieren. **Vor seiner externen Prüfung wird kein
Release veröffentlicht.**

Der veröffentlichte Release-Tag zeigt auf den eingefrorenen, geprüften
Quell-Root mit dem geprüften Anwendungspaket. Die spätere SECURITY-Änderung
ist ein eigener Nachfolgecommit außerhalb von Version 1.6.0; sie verschiebt
den Tag nicht und ersetzt weder ZIP noch Prüfsummen. Vor ihrem Commit sind
ein vollständiger diff und ein enger Nachreview erforderlich: genau
`SECURITY.md` darf sich ändern; das HTML und der zehnteilige Paketbaum bleiben
bytegleich. Vom späteren Standardbranch-HEAD darf nicht versehentlich ein
anderes Paket als Version 1.6.0 gebaut werden. Bis zur bestätigten Einrichtung
bleibt SECURITY.md beim ehrlichen Voraktivierungstext. Veröffentlichungsdatum
und Paket sind neu zu bauen und zu prüfen, falls die Veröffentlichung nach dem
06.10.2026 erfolgt.

Die Grenzen der vorhandenen manuellen Beobachtungen stehen in
[ABNAHME.md](../ABNAHME.md). Weitere manuelle Wiederholungen wurden am
05.10.2026 durch Nutzerentscheid beendet; aus diesem lokalen Paket folgt
keine neue Browserunterstützungszusage.
