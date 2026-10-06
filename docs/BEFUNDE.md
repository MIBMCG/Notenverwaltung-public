# Portable Befundprüfung

Das Register unter `docs/quality/current-findings.json` verwendet
Schema 2. Die Prüfung benötigt keine Git-Historie: Sie vergleicht SHA-256-Werte
von `Notenverwaltung.html` und allen Quellen unter `src/`, überprüft vorhandene
Testdateien sowie Codeanker und Referenzen. Die 78 ursprünglichen Befund-IDs
bleiben erhalten. Das öffentliche Register setzt keine alte Commit-Historie voraus.

Geschlossene Befunde benötigen aktuelle Testnachweise. Fehlende, veränderte oder
neu hinzugefügte, nicht registrierte Quelldateien lassen die Prüfung scheitern.
Text wird vor der Hashbildung als UTF-8 gelesen und CRLF/CR in LF normalisiert;
Windows-Zeilenenden allein ändern den Nachweis dadurch nicht.

## Nach einer beabsichtigten Programmänderung

1. Änderung fachlich prüfen und passende Regressionstests ausführen.
2. Mit `npm run build` die Programmdatei erneuern und mit `npm run verify:artifact` prüfen.
3. Die SHA-256-Werte der bewusst geänderten Dateien nach UTF-8/LF-Normalisierung
   neu berechnen und die entsprechenden Werte in `sourceSnapshot.files` aktualisieren.
4. Bei neuen oder entfernten Quellen zusätzlich die festgelegte Quelldateiliste
   im Validator und die erwartete Liste im Findings-Test gemeinsam anpassen.
5. `npm run check:findings` und `npm test` ausführen; Änderungen an den Nachweisen
   zusammen mit der fachlichen Änderung reviewen.

Hashes nicht automatisch anpassen, nur um eine unerwartete Abweichung zu verdecken.
Die Prüfung ersetzt weder die Verhaltenstests noch die persönliche Geräteabnahme.
