# Sicherheitsprobleme melden

Für das öffentliche Repository Notenverwaltung-public ist GitHubs privates
Vulnerability Reporting aktiviert und von außen geprüft. Bitte melde
Sicherheitsprobleme vertraulich über
[einen privaten Sicherheitsbericht](https://github.com/MIBMCG/Notenverwaltung-public/security/advisories/new).
Veröffentliche keine Schwachstellendetails in einem Issue oder einer Diskussion.

Ein Bericht sollte Programmversion, Browser und Version, Startart,
nachvollziehbare Schritte mit ausschließlich erfundenen Daten und die
mögliche Auswirkung nennen. Bitte übermittle keine echten Notenbestände,
Passwörter, Backups, Browserprofildaten oder Screenshots mit privaten Angaben.
Falls sich ein Problem nur mit echten Daten zeigt, beschreibe zunächst den
Ablauf ohne diese Daten über den privaten Meldeweg.

Die Software wird gemäß LICENSE ohne Gewährleistung bereitgestellt; das ist
keine Zusage einer bestimmten Reaktionszeit oder vollständiger Fehlerfreiheit.

## Lokaler Passwort- und Wiederherstellungsschutz

Neue Einrichtungen verwenden ein Passwort und einen separat aufzubewahrenden
Wiederherstellungscode. Beide sind gleichwertige geheime Zugänge zum passenden
Bestand bzw. Backup. Es gibt keinen Server, kein Masterpasswort und keinen
Support-Zugang. Sind beide Zugänge verloren, kann die Anwendung die Daten nicht
zurücksetzen oder entschlüsseln. Ein Bestand ohne zuvor eingerichteten Code wird
durch diese Funktion nicht nachträglich zugänglich.

Das V2-Format verschlüsselt die Daten mit einem zufälligen AES-256-GCM-Schlüssel,
der getrennt über Passwort und einen aus 256 Zufallsbits erzeugten Code verpackt
wird. Die Passwortableitung verwendet PBKDF2-SHA256 mit 600000 Iterationen.
Header, beide Schlüsselhüllen und der Sicherungszeitpunkt werden authentifiziert.
Die vollständige Code-Rückprüfung ist vor der Übernahme eines neuen Schutzes
verpflichtend. Passwortwechsel, Codeersatz und Wiederherstellung erzeugen einen
neuen Datenschlüssel und Code. Ein normaler Import behält den lokalen Schutz.

Bisherige Formate bleiben mit ihrer bisherigen Passwortverarbeitung importierbar.
Alte Dateien ändern sich durch eine Nachrüstung nicht. Ältere HTML-Versionen
können das neue V2-Format nicht lesen. Eine verschlüsselte Alt-Kopie der Migration
kann separat gesichert werden und benötigt weiterhin ihr bisheriges Passwort.

Schließen, Sperren, Besitzerverlust und Abbruch verwerfen offene Codeansichten
und Vorbereitungen. JavaScript kann keine vollständige Löschung aller zuvor im
Arbeitsspeicher befindlichen Bytes garantieren. Verschlüsselte lokale Speicherung
ersetzt weder einen geschützten Rechner und Browser noch getrennte Backups.
Native Safari-/macOS-Abnahme und physische Crash-Durabilität sind für Version
1.7.0 nicht nachgewiesen. Bitte melde Supportfälle ohne echte
Passwörter, Wiederherstellungscodes oder Datenbestände.
