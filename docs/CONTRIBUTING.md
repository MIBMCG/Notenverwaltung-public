# Mitwirken und Fehler melden

Version 1.6.0 ist noch ein unveröffentlichter Prüfkandidat. Beiträge und
Fehlerberichte sollen die betroffene Programmversion, Browser samt Version,
Betriebssystem, Startart (`file:` oder andere Adresse), Schritte zum
Nachstellen sowie erwartetes und beobachtetes Ergebnis nennen.

Verwende ausschließlich erfundene Personen, Kurse und Noten in einem
getrennten Testbestand. Lade keine echten Schülerdaten, Passwörter, Backups,
Browserprofildaten oder unveränderten Screenshots mit privaten Angaben hoch.
Falls ein Problem nur mit echten Daten auftritt, beschreibe zunächst den
Ablauf ohne diese Daten. Sicherheitsprobleme gehören nicht in öffentliche
Issues; der private Meldeweg muss vor Veröffentlichung eingerichtet und
verifiziert werden (siehe SECURITY.md).

Für die Entwicklung ist Node.js ab Version 20 vorgesehen. Nach `npm ci`
die zur Änderung passenden Prüfbefehle aus `package.json` ausführen.
Produktcode unter `src/` ändern und `Notenverwaltung.html` durch den Build
erzeugen. Im Beitrag Anlass, Änderung und tatsächliche Prüfungen nennen.

Der eigene Projektcode steht unter MIT. Mitgelieferte Fremdbestandteile und
Assets behalten ihre jeweiligen Hinweise und Lizenzen; siehe LICENSE,
ASSET_NOTICES.md und docs/releases/THIRD_PARTY_NOTICES.txt.
