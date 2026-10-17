# Tests

## Automatisiert (keine echten Playlist-Änderungen)

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm lint:extension
pnpm exec playwright install --with-deps chromium firefox
pnpm test:ui
pnpm test:firefox-extension
pnpm package
```

Die Tests verwenden synthetische, reproduzierbare Desktop-YouTube-DOM-Fixtures und eine frische IndexedDB. Sie verwenden keine Zugangsdaten. DOM-Fixtures sind **keine** Aufzeichnung oder Garantie des heutigen angemeldeten YouTube-DOMs. Die Browser-UI-Tests kennzeichnen ihre Daten als Fixture. Der Add-on-Smoke-Test installiert das echte gebaute MV3-Add-on über Mozillas RDP in ein neues Firefox-Profil und prüft Manifestwarnungen sowie nicht persistentes Background-Verhalten. Er navigiert nicht auf YouTube. Der Datenfluss zwischen echter Extension-Seite und YouTube-Content-Script bleibt manuell zu prüfen.

Abgedeckt:

- Import: leer, einzelnes Video, 5.000 Einträge über ausgetauschte DOM-Fenster, Lazy Loading, doppelte IDs, Abbruch, Navigation, geänderte Struktur, unbekannte Zahl, fehlende Positionen, dauerhafte Continuation, Speicherfehler.
- Metadaten: Dauer, korrekte ID, unbekannte Werte, deutsche/englische Anzahl; private/gelöschte/unbekannte/eingeschränkte/nicht gelistete Videos.
- Sitzungen: drei lokale Entscheidungen, fester Archivziel-Snapshot, Undo, Zurückstellen über Rundengrenzen, Pause, Serialisierung/Wiederaufnahme, doppelte Aktionen blockieren, Filter, neue vollständige/partielle Scans ohne Entscheidungsverlust.
- Speicherung: IndexedDB-Transaktion, vollständiger Snapshot bleibt bei Teilimport erhalten, Session/Vormerkungen nach Wiederladen, JSON enthält IDs, URL, Originalplaylist und Metadaten.
- Bridge: ACK erst nach Commit, kein ACK bei Speicherfehler, Disconnect meldet Unterbrechung.
- UI in Chromium/Firefox: ehrlicher leerer Zustand, Tastatur, Swipe, Undo, Pause/Reload, Zusammenfassung, gesonderte Bereinigung mit lokaler Bestätigung, Backup-Download, schmale Ansicht, Dialog-Fokus.

Nicht abgedeckt, weil noch **nicht implementiert**: erfolgreiches Schreiben/Archivieren, fehlgeschlagenes Hinzufügen/Entfernen, Timeout nach einer echten Mutation, Mitgliedschaftsprüfung und Wiederaufnahme unbekannter YouTube-Schreibzustände. Dafür gibt es bewusst keinen Mock-Erfolg, der eine fertige Integration suggeriert. Der M3-Testplan steht unten.

## M1: verpflichtender angemeldeter Zen-Live-Test

Dieser Test muss mit dem eigenen YouTube-Konto durchgeführt werden. Keine Cookies exportieren oder Zugangsdaten weitergeben. Die aktuelle Version liest und scrollt lediglich.

1. `pnpm build`, dann `dist/manifest.json` über `about:debugging#/runtime/this-firefox` temporär laden. Host-Berechtigung für YouTube prüfen. Bereits offene YouTube-Seite neu laden.
2. Watch Later öffnen. Sprache Deutsch oder Englisch verwenden. YouTubes Gesamtzahl und eine Stichprobe aus Anfang/Mitte/Ende selbst notieren. Listenreihenfolge während des Scans nicht ändern.
3. In LaterSift Importdialog öffnen, Tab aktualisieren/auswählen, Scan starten. Prüfen, dass YouTube tatsächlich weiterlädt und die lokale Zahl steigt. Nicht nur die anfänglich sichtbaren Zeilen sollen erscheinen.
4. Nach einigen Schritten pausieren. JSON exportieren; Status muss Teilbestand/unterbrochen sein, nicht vollständig. IDs/URL/Titel mit YouTube vergleichen.
5. Erweiterungs-Tab schließen und über das Symbol erneut öffnen. Bestätigte Checkpoints müssen vorhanden sein. Ein zuvor laufender Scan muss als unterbrochen erscheinen und darf nicht automatisch weiterlaufen.
6. Neu scannen. Bei ausgeblendeten privaten/gelöschten Videos ggf. YouTubes Playlist-Menü „Nicht verfügbare Videos anzeigen“ selbst aktivieren. Der Scan darf Vollständigkeit nur bei eindeutiger Anzahl und Positionen 1…N melden.
7. Eine Liste mit deutlich mehr als einer Ladeportion testen; wenn vorhanden 5.000 Einträge. Export prüfen: eindeutige Video-IDs, erwartete Anzahl, erste/mittlere/letzte Stichprobe, Kanal/Dauer soweit vorhanden, `null` bei unbekannten Metadaten.
8. Falls „Teilimport“ verbleibt, Ursache festhalten: unbekannte Header-Struktur/Zahl, unidentifizierbare Zeile, fehlende Position, Continuation/Timeout. **Nicht** als bestandenen M1-Nachweis werten. Ohne ID erkennbare Zeilen können nur als Diagnose erfasst werden.
9. Angemeldeten echten leeren Watch-Later-Bestand nur testen, wenn ohnehin vorhanden. Kein Löschen zum Erzeugen einer Testfixture.
10. Browser/Zen-Version, Betriebssystem, YouTube-Sprache, Datum, sichtbare Gesamtzahl, exportierte eindeutige IDs, Status und Stichprobenbefund in einem lokalen Testprotokoll festhalten. Keine persönlichen Playlist-Exporte in öffentliche Issues hochladen.

**M1-Freigabekriterium:** Ein echter vollständiger Scan der angemeldeten Watch-Later-Liste wurde erfolgreich exportiert und anhand der sichtbaren Anzahl sowie Stichproben bestätigt. Erst danach M3 implementieren. Derzeit ist dieses Kriterium hier nicht erfüllt.

## Lokale Swipe-Abnahme

- Sitzung mit Größe 3 starten. Links vormerken, rechts mit hinterlegtem PL…-Ziel vormerken, unten zurückstellen. Sofortiges visuelles Feedback und nächste Karte prüfen.
- `Z` nimmt nur die letzte lokale Entscheidung der aktiven Runde zurück. In „Vorgemerkt“ einzelne ausstehende Absichten zurücknehmen.
- Pfeiltasten dürfen beim Tippen in Eingabefeldern oder in einem Dialog keine Karte bewerten. Gehaltene Taste darf nicht mehrere Karten bewerten.
- Leertaste pausiert bei Fokus außerhalb eines Buttons/Inputs. Schließen/Öffnen erhält Session und Pause bei erhaltenem Extension-Speicher.
- Desktop-Maus und echten Touchscreen testen: horizontal mindestens 85 px für Entfernen/Archivieren, nach unten für Zurückstellen. Kurzes Antippen oder vertikaler Aufwärtszug darf nichts vormerken. Touch wird automatisiert nur teilweise über Pointer-/Viewport-Tests abgedeckt; echter Touch bleibt manuell offen.
- Zurückgestellte Karte erscheint erst in einer neuen Runde wieder. Entfernen/Archivieren verändern YouTube **nicht**. Die Warteschlange muss „0 YouTube-Änderungen ausgeführt“ und die Schreibsperre anzeigen.
- Bereinigungsmodus: Nur eindeutig private/gelöschte Einträge auswählbar. Unbekannte/eingeschränkte Einträge bleiben außen vor. Vor dem lokalen Vormerken kommt eine Bestätigung.
- Tab neu laden: Entscheidungen bleiben. Zweite LaterSift-Instanz muss Bearbeitung ablehnen. JSON exportieren, bevor das temporäre Add-on entfernt oder der Browser neu gestartet wird.

## Späterer M3-Abnahmeplan (noch offen)

Nach M1 nur mit vom Nutzer ausdrücklich genehmigter kleiner Testsession:

1. Bestehendes, schreibbares Archivziel über YouTubes Oberfläche auswählen und vorhandene Mitgliedschaft frisch prüfen.
2. Vollständigen Snapshot vor erster Mutation sicherstellen; eine gemeinsame Bestätigung mit konkreten Videos und Ziel anzeigen. Keine Ausführung beim Start.
3. Hinzufügen einzeln ausführen; Dialog erneut öffnen und Ziel-Mitgliedschaft prüfen; zusätzlich Reload/erneute Beobachtung. Erst danach Watch-Later-Entfernung zulassen.
4. Entfernung frisch über vollständig geladene Watch-Later-Liste und vorherige vorhandene Mitgliedschaft prüfen. Vorher extern verschwundene Videos nie als eigener Erfolg zählen.
5. Hinzufügen absichtlich fehlschlagen lassen: keine Entfernung. Entfernung fehlschlagen lassen: Archivierung separat dokumentiert, kein Gesamt-Erfolg.
6. Tab nach Klick vor Antwort schließen: persistierten Zustand `unknown` erwarten. Vor Wiederholung Mitgliedschaft prüfen, keine zweite blinde Mutation.
7. Browser-Neustart darf keine nicht genehmigten Sessions anwenden. Einen Executor, begrenzte Retries mit Backoff, Stop/Pause bei Fehlern prüfen.
8. Undo nach angewandter Änderung nur nach bestätigter Wiederherstellung melden. Sonst unklar/gesperrt.

## Signatur und Neustart

Ein temporäres Add-on wird nach Browser-Neustart nicht automatisch wieder geladen. Das ist kein regulärer Installations-/Resume-Test. Für verlässliche Prüfung über Browser-Neustart ein von Mozilla signiertes, dauerhaft installiertes Build verwenden. Temporär gespeicherte Daten können durch Entfernen/Neuinstallation verschwinden; die JSON-Sicherung ist kein implementierter Import-/Restoremechanismus.
