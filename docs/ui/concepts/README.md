# Gestaltungsvorschau

Die ausführbare Vorschau bleibt als Referenz für die weitere UI-Verbesserung
erhalten. Sie ist keine Produktivfassung: Sie verwendet ausschließlich fiktive
Beispiele, Änderungen gehen beim Neuladen verloren, Speicher-/Importaktionen
sind Simulationen. Die produktive Anwendung liegt im Repository-Hauptordner.

[Vorschau öffnen](notenverwaltung-ansichten.html). Lokal ist dafür kein Server
oder Internet erforderlich; GitHub zeigt HTML als Quelltext.

## Erhaltene Bestandteile

- `notenverwaltung-ansichten.fragment.html`: bearbeitbare Gestaltungsquelle.
- `notenverwaltung-ansichten.html`: erzeugte eigenständige Offline-Vorschau.
- `standalone-controls.js`: lokale Entwurfssteuerung.
- `vendor/`: eingebettete Symbole samt Lucide-/Feather-Lizenzhinweisen.
- `checks/`: Prüfungen für Offline-Isolation und simulierte Abläufe.

Die alten Vergleichsscreenshots wurden entfernt. Sie sind keine Laufzeitressourcen.
Frühere Übergaben und abgeschlossene Arbeitsprotokolle gehören nicht zum Paket.

## Erzeugen und prüfen

Python 3 und Node.js werden nur für Entwicklung und Prüfung benötigt:

```sh
python docs/ui/concepts/build-preview.py
python docs/ui/concepts/build-preview.py --check
node docs/ui/concepts/checks/verify-package.cjs
python docs/ui/concepts/checks/verify-doc-links.py
```

Zusätzlich alle `check-*.cjs` unter `checks/` mit Node ausführen. Die Vorschau
prüft unter anderem Kursaktionen, Schuljahreswechsel, Importkonflikte,
Speicherstatus, Sperren, Berichtsumfang und Bewegungseinstellungen.

Die separate [Kurskarten-Demo](../course-cards-demo.html) wird aus den echten
Kurskarten-Komponenten gebaut und in der regulären Testsuite mitgeprüft.
