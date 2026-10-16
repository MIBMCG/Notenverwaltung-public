# Lokale Wiederherstellung mit separat gesichertem Code

Stand 16.10.2026. Der Nutzer hat den schriftlichen Vorschlag vom selben Tag
angenommen und ausdrücklich die Umsetzung beauftragt. Dieses Dokument präzisiert
den angenommenen Entwurf für die Implementierung; es führt keine andere Option ein.
Basis ist die öffentliche 1.6.0 mit geprüfter Speicherhärtung, Commit `289e7ae`.
Die Entwicklung bleibt lokal auf `codex/password-recovery`; Veröffentlichung und
native Geräteabnahme gehören nicht zu diesem Auftrag.

## Zweck und Bedienung

Nach Verlust des normalen Passworts soll ein zuvor gesicherter Code den lokalen
Bestand oder eine neue, damit ausgestattete Sicherung öffnen. Es gibt keinen
Server, kein Masterpasswort, keine Sicherheitsfragen und keinen Support-Zugang.
Alte Sicherungen ohne Codezugang behalten ihr bisheriges Passwort.

- Bei neuer Einrichtung werden Passwort und Code vor dem ersten verbindlichen
  Speichern geprüft. Der Code wird einmal angezeigt, kann ohne Schülerdaten
  gedruckt werden und muss vollständig erneut eingegeben werden. Abbruch erhält
  den Ausgangszustand. Kein Fortfahren ohne bestätigten Code bei neuer Einrichtung.
- Bestehende V1-Bestände funktionieren weiter. Die Sicherheitsseite bietet eine
  deutliche Nachrüstung ohne Arbeitssperre an. Ein aktuelles Passwort bestätigt
  den Zugriff vor der Migration; diese erhält eine verschlüsselte Alt-Kopie.
- Im Alltag ändern sich Entsperren und Backup-Knopf nicht. Die Anwendung zeigt
  nur Status, Datum und nicht geheime Bestands-/Generationskennung an. Der Code
  wird nach Abschluss weder wieder angezeigt noch im Browserspeicher behalten.
- Auf dem Sperrbildschirm bzw. im Start-Passwortdialog gibt es "Zugang
  wiederherstellen". Lokal oder aus ausgewähltem V2-Backup: Code prüfen, gesamten
  Datenbestand authentifizieren und validieren, neues Passwort zweimal eingeben,
  neuen Code sichern und zurückprüfen, erst dann speichern. Eine Wiederherstellung
  aus Datei ersetzt erst nach ausdrücklicher Bestätigung vorhandene Daten.
- Bei Codeersatz darf das Passwort beibehalten werden. Bei Passwortwechsel,
  Wiederherstellung und Codeersatz entstehen immer ein neuer Datenschlüssel,
  eine neue Generation und ein neuer Code. Bestehende Dateien ändern sich nicht.
- Eine Code-Prüfung entschlüsselt den ausgewählten Bestand vollständig, ohne ihn
  zu importieren oder zu ersetzen. Ein Backup-Import bietet Passwort oder Code,
  übernimmt jedoch stets den vorhandenen lokalen Schutz für den importierten Inhalt.

Der Code bedeutet einen zweiten gleichwertigen geheimen Zugang. Wer Code und
Datei hat, kann lesen. Sind beide Geheimnisse verloren, gibt es keinen Reset.
Eine neue Funktion entschlüsselt den aktuellen gesperrten Supportfall nicht.

## Kryptografisches V2-Format

Eigenes Modul `src/infrastructure/recovery-envelope.js`, ohne Abhängigkeiten.
Die alten Funktionen in `encryption.js` bleiben unverändert (PBKDF2-SHA256,
200000 Iterationen, historische Passwortverarbeitung und Vektoren).

V2 enthält exakt folgende Schlüssel; zusätzliche Felder werden abgewiesen:

```text
{ format:"notenverwaltung_envelope", version:2,
  datasetId:<32 lowercase hex>, generationId:<32 lowercase hex>,
  createdAt:<UTC ISO YYYY-MM-DDTHH:mm:ss.sssZ>, algorithm:"AES-256-GCM",
  password:{kdf:"PBKDF2-SHA256",iterations:600000,salt,iv,wrappedKey},
  recovery:{encoding:"base32-sha256-20-v1",iv,wrappedKey},
  data:{savedAt:<UTC ISO>,iv,ciphertext} }
```

Salt: 16 Bytes. Alle IVs: 12 Bytes. AES-Schlüssel: 32 Bytes. GCM-Tag: 128 Bit,
explizit gesetzt. Jeder WrappedKey: genau 48 Bytes. Base64 ist kanonisch.
Datenschlüssel und Recovery-Schlüssel entstehen unabhängig aus Web Crypto.
Ein nicht exportierbarer Datenschlüssel wird nur in einer privaten Session gehalten.
Exportierbare Schlüssel bzw. rohe Bytes existieren kurz zum Verpacken/Codeerzeugen;
temporäre Arrays werden bestmöglich überschrieben, keine Zusage vollständiger
JavaScript-Speicherlöschung. Passwort wird unverändert als UTF-8 verarbeitet.

AAD wird aus festen positionsgebundenen Arrays mit JSON.stringify/UTF-8 gebildet.
Gemeinsamer Kontext: Format, Version, Algorithmus, datasetId, generationId,
createdAt. Zwecke: `password-wrap`, `recovery-wrap`, `state`. Passwort-AAD bindet
KDF, Iterationen, Salt; Recovery-AAD bindet Encoding. Daten-AAD bindet sämtliche
öffentlichen Felder beider Hüllen, einschließlich IV und WrappedKey. So scheitert
auch das Öffnen per Passwort bei Manipulation der nicht verwendeten Recoveryhülle.
Der KDF-Salt ist intern mit einem festen V2-Passwortzweck-Präfix getrennt; dieser
Präfix `notenverwaltung:password-wrap:v2\0` ist im Modul konstant und wird durch
einen unabhängigen Testvektor fixiert.
Neue Datenverschlüsselung verwendet jedes Mal einen frischen zufälligen IV,
einschließlich Backup-Erstellung. Keine kopierten Offline-Zähler.
`createdAt` bezeichnet die Schlüsselgeneration; `data.savedAt` den Zeitpunkt der
konkreten Nutzlast. `savedAt` wird in Daten-AAD gebunden und bei Save/Export erneuert;
es ändert nicht die Schlüsselhüllen. Erst nach Authentifizierung ist das angezeigte
Sicherungsdatum vertrauenswürdig.

Recoverycode: RFC4648-Base32 ohne Padding aus 32 zufälligen Bytes (52 Zeichen),
plus 20 Prüfbits aus SHA256 von UTF8(`notenverwaltung:recovery-code:v2\0`) und
den Schlüsselbytes (4 Zeichen). Druckformat `NV2-` gefolgt von Vierergruppen.
Nur ASCII-Groß-/Kleinschreibung, ASCII-Leerraum und Bindestriche normalisieren;
Länge, Alphabet, abschließende Paddingbits und Prüfsumme strikt prüfen.
Keine Verwechslungen automatisch ersetzen. Die Prüfsumme ist kein Geheimnis.

Vor kostenintensiver Arbeit prüfen: exakte Schemas, Typen, bekannte Version,
feste KDF-Kosten, kanonische Kodierungen und Grenzen. Maximal 20 MiB Envelope-Text
und 10 MiB unverschlüsselte UTF-8-Nutzlast. Ablehnung lässt Originale unverändert.
Ungepaarte UTF-16-Surrogate im zu verschlüsselnden Text ablehnen. Fehler sind feste
Codes/Texte (Format, Codeformat, AUTH, Technik, verworfene Session); keine Secrets
oder Providerdetails in Logs. Keine neuen Debug-Schlüsselzugriffe.

## Speicher- und Lebenszyklusanforderungen

V2 verwendet einen vollständigen, selbstenthaltenden Datensatz; kein DEK hängt
von einem separat aktualisierten Salt ab. Bestehende FIFO-, Snapshot-, Besitzer-
und Generation-Sperren bleiben erhalten. Auch jede neue asynchrone Grenze vor
Session-Übernahme und Speichern prüft diese Sperren. Lock/Timeout/Ownerverlust
verwerfen Sessions, vorbereitete Übergänge und sichtbare Code-/Passwortfelder.

Vorbereiten schreibt nichts. Erst vollständige Code-Rückprüfung autorisiert den
Commit eines zuvor vorbereiteten und unveränderten Kandidaten. Opaque Tokens
halten interne Schlüssel vom UI fern. Veraltete/gefälschte/wiederverwendete Tokens
werden abgelehnt. Vorher-/Nachher-Prüfung des gespeicherten Datensatzes muss dieselben
validierten Daten über Passwort und Code liefern. Rollback überschreibt niemals
zwischenzeitliche fremde Änderungen. Jeder relevante Persistenzpräfix muss nach
Neustart einen vollständigen alten oder neuen lesbaren Kandidaten erhalten.

Eine Migration erhält zuerst eine verschlüsselte Kopie des bisherigen Standes;
Legacy-Klartext wird nicht zusätzlich kopiert. Altdateien lassen sich weiterhin
mit ihrer bisherigen Verarbeitung importieren. V2 darf bei Fehlern niemals in
V1- oder Klartextverarbeitung zurückfallen. Ältere HTML-Versionen können V2 nicht
lesen. Dies wird vor Nachrüstung und in der Anleitung erklärt.

Fachliche Validierung erfolgt vor reparierender Normalisierung: gültiges Rootobjekt,
Rohprüfungen für Halbjahresergebnisse und Sek-II-Kontexte, reguläre Importvalidierung,
danach Domain-Normalisierung und nochmalige Prüfung. Ein authentifiziertes `null`
oder `{}` darf nicht als leerer geretteter Bestand übernommen werden.

## Abnahme

Nur synthetische Daten. Neue Tests zuerst sinnvoll rot, dann grün. Kryptomodul:
beide Zugänge, feste unabhängige Vektoren, Manipulation aller Header/Hüllen,
Unicode, Grenzen, Lock während Crypto, zufällige IVs und alte/neue Generationen.
Storage: Erstsetup, V1-Migration, V2-Save/Export/Import, Passwortwechsel, Codeersatz,
gesperrte lokale und Datei-Recovery, falscher Code, Abbruch, Quota, fremde Writes,
Neustart aus jedem Übergangspräfix, kein Klartextgeheimnis im Browserzustand.
HTML-Harness: vollständige Benutzerwege einschließlich Start-Recovery,
Codeanzeige/-Rückprüfung, Druckbereinigung, Austauschbestätigung, alte Formate.
Gesamtsuite und Artefakt-/Syntax-/Findings-/Dokumentprüfungen abschließend.
Die 13 bereits belegten Windows-Dateisystemfehler separat behandeln, keine
Produktumgehung. Echte Safari/macOS-Abnahme und physische Crash-Durabilität bleiben
ohne entsprechende Umgebung ausdrücklich ungeprüft.

## Quellen zum angenommenen Verfahren

- [W3C Web Crypto](https://www.w3.org/TR/webcrypto/)
- [NIST SP 800-38D](https://csrc.nist.gov/pubs/sp/800/38/d/final)
- [RFC 4648](https://www.rfc-editor.org/rfc/rfc4648.html)
- [OWASP Cryptographic Storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
- [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)

600000 PBKDF2-Iterationen sind die bewusste neue V2-Vorgabe; die OWASP-Empfehlung
stammt aus Passwortspeicherung. Zielgeräte-Leistung ist vor Veröffentlichung zu
prüfen. Die vorhandenen V1-Parameter werden nicht still geändert.
