# Wiederverwendbare Prüfbeispiele

Diese Rezepte verwenden ausschließlich synthetische Daten. Sie dienen gezielten
Wiederholungen nach Änderungen und erweitern nicht die in [ABNAHME.md](ABNAHME.md)
festgehaltene persönliche Abnahme. Für Versuche einen separaten Testbestand nutzen.

## CSV-Import


Alle Angaben sind fiktiv, ein Passwort ist für CSV nicht erforderlich. In einem
gesonderten Testbestand beginnen; zu Beginn darf der Kurs `CSV-Test` noch nicht
vorhanden sein. Die Dateien werden auch von den neuen automatischen Tests gelesen.

| Datei | Handlung und erwartetes Ergebnis |
| --- | --- |
| [Warnung](../tests/fixtures/acceptance-csv-warning.csv) | Zuerst importieren und im Warnungsdialog „Schließen“ wählen: kein neuer Kurs, keine neuen Personen. Danach dieselbe Datei erneut wählen und „Fehlerhafte Zeilen überspringen“: ein Kurs `CSV-Test`, nur Ada Müller, eine Zuordnung. |
| [Konflikt](../tests/fixtures/acceptance-csv-conflict.csv) | Widersprüchliche Namen für dieselbe ID: Import wird vollständig abgebrochen. Der zuvor vorhandene Testbestand bleibt unverändert. |
| [Gültige Daten](../tests/fixtures/acceptance-csv-valid.csv) | Für die Erfolgsprobe in einem frischen Testbestand: ein Kurs `CSV-Test` mit Ada Müller; Umlaut lesbar. |

Die erfolgreichen Warnungs-/Normalimporte legen die üblichen Initialleistungen
für neue Kurse an. CSV überträgt Kurs-/Personenzuordnungen und keine vollständige
Notensicherung. Für vollständige Wiederherstellung bleibt das verschlüsselte
Backup vorgesehen.


## Fachliche Rechenbeispiele

| Nr. | Eingaben und Konfiguration | Erwartung und bestätigter Rechenwert |
| --- | --- | --- |
| 1 | Sek I, Schriftlich/Mündlich jeweils 50 %. H1: schriftlich 2 mit Gewicht 1 und 4 mit Gewicht 3; mündlich 1 mit Gewicht 1. H2: schriftlich 1 mit Gewicht 2; mündlich 5 mit Gewicht 1 und 3 mit Gewicht 3. | H1: (3,5 + 1)/2 = **2,25**. H2 allein: (1 + 3,5)/2 = **2,25**. Jahr: schriftlich 16/6, mündlich 15/5; Gesamt **17/6 = 2,83**. Zwei fremde Schuljahre mit hohen Leistungsgewichten bleiben ausgeschlossen. |
| 2 | Sek I, Schriftlich/Mündlich/Sonstiges 50/40/10 %. Schriftlich leer, mündlich 3, sonstiges 5. | (3×40 + 5×10)/50 = **3,40**. Die leere Kategorie zählt auch im Nenner nicht mit. Eine vollständig leere zweite Person hat keinen Rechenwert. |
| 3 | Q4-Grundkurs, Vorlage 33,33/56,67/10 % für Klausur/Mündlich/Sonstiges. Zwei Personen haben jeweils 15/9/3 Punkte. Nur die erste Person ist für die Q4-Klausur markiert. Q3 enthält jeweils 1/1/1 Punkte. | Mit Klausur: (15×33,33 + 9×56,67 + 3×10)/100 = **10,3998 → 10,40**. Ohne Klausur: (9×56,67 + 3×10)/66,67 = **8,100044997… → 8,10**. Q3 bleibt bei beiden **1,00**. Der ausgeschlossene Klausurwert 15 bleibt gespeichert. |
| 4 | Q4-Leistungskurs, ebenfalls 15/9/3 Punkte. Zunächst bleibt die Vorlage mit 50/40/10 % gewählt. Danach wird ausdrücklich auf 33,33/56,67/10 % gewechselt. | Zunächst **11,40**, obwohl der Kontext eine Klausur und ein Drittel Klausuranteil empfiehlt. Nach ausdrücklichem Vorlagenwechsel **10,3998 → 10,40**. Die Empfehlung allein überschreibt die Auswahl nicht. |
| 5 | Q3-Leistungskurs, 50/40/10 %. Mündlich und Sonstiges jeweils 10 Punkte. Zwei Klausuren: bei Person A jeweils gültige 0 Punkte, bei Person B jeweils „fehlend“. | A: (0×50 + 10×40 + 10×10)/100 = **5,00**. B: (10×40 + 10×10)/50 = **10,00**. Beide erhalten den Hinweis auf die erforderliche manuelle fachliche Entscheidung; bei beiden bleibt die Festsetzung leer. |
| 6 | Q4-Leistungskurs mit Rechenwert 10,3998. Festsetzung für eine Person ausdrücklich auf 0; anschließend JSON-Normalisierung des Bestands. | Rechenwert bleibt **10,3998**, Festsetzung bleibt **0**. Das andere Halbjahr und die zweite Person bleiben ohne Festsetzung. Dies prüft Datenmodell/Normalisierung, nicht den vollständigen Browser-Backupimport. |

## Bedeutung für die Bedienung

- Der Jahreswert in Sek I entsteht aus den Einzelbewertungen des ganzen
  Schuljahres, jeweils innerhalb ihrer Kategorien und mit den Leistungsgewichten.
  Deshalb kann er vom einfachen Mittel der beiden Halbjahreswerte abweichen.
- Die Standardvorlage für eine Oberstufenklausur speichert **33,33 %**. Das ist
  eine dezimale Näherung an ein Drittel. Beispielsweise ist der ungerundete Wert
  in Beispiel 3 genau 10,3998; Zwischenwerte werden hier nicht vorab gerundet.
- Bei Q4 ohne Klausur bleibt das Verhältnis der übrigen Kategoriegewichte
  erhalten. Die Klausurnote wird dabei nicht gelöscht.
- Fehlende Leistungen sind keine Nullpunktbewertungen. Ein Rechenwert oder ein
  Hinweis entscheidet nicht automatisch über die festgesetzte Halbjahresnote.


Die sechs Rechenbeispiele werden mit `node --test tests/grading-acceptance-examples.test.js`
ausgeführt. Die Tests verwenden die echten Domain-/Grading-Module und synthetische
Fixtures. Sie ersetzen keine vollständige Browser- oder Importprüfung.
