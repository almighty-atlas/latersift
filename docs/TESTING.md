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

Bisherige Testbereiche (keine Aussage über einen abgeschlossenen aktuellen M1.1-Testlauf):

- Import: leer, einzelnes Video, 5.000 Einträge über ausgetauschte DOM-Fenster, Lazy Loading, doppelte IDs, Abbruch, Navigation, geänderte Struktur, unbekannte Zahl, fehlende Positionen, dauerhafte Continuation, Speicherfehler.
- Metadaten: Dauer, korrekte ID, unbekannte Werte, deutsche/englische Anzahl; private/gelöschte/unbekannte/eingeschränkte/nicht gelistete Videos.
- Sitzungen: drei lokale Entscheidungen, fester Archivziel-Snapshot, Undo, Zurückstellen über Rundengrenzen, Pause, Serialisierung/Wiederaufnahme, doppelte Aktionen blockieren, Filter, neue vollständige/partielle Scans ohne Entscheidungsverlust.
- Speicherung: IndexedDB-Transaktion, vollständiger Snapshot bleibt bei Teilimport erhalten, Session/Vormerkungen nach Wiederladen, JSON enthält IDs, URL, Originalplaylist und Metadaten.
- Bridge: ACK erst nach Commit, kein ACK bei Speicherfehler, Disconnect meldet Unterbrechung.
- UI in Chromium/Firefox: ehrlicher leerer Zustand, Tastatur, Swipe, Undo, Pause/Reload, Zusammenfassung, gesonderte Bereinigung mit lokaler Bestätigung, Backup-Download, schmale Ansicht, Dialog-Fokus.

Nicht abgedeckt, weil noch **nicht implementiert**: erfolgreiches Schreiben/Archivieren, fehlgeschlagenes Hinzufügen/Entfernen, Timeout nach einer echten Mutation, Mitgliedschaftsprüfung und Wiederaufnahme unbekannter YouTube-Schreibzustände. Dafür gibt es bewusst keinen Mock-Erfolg, der eine fertige Integration suggeriert. Der M3-Testplan steht unten.

## M1: verpflichtender angemeldeter Zen-Live-Test

Aktueller Stand: Lokale Prüfungen für M1.1 / 0.1.1 sind noch nicht endgültig abgeschlossen. Gemeldete Zwischenergebnisse und ausstehende Wiederholungen stehen in [STATUS.md](STATUS.md#automatisierte-validierung); sie sind kein abschließendes „alles grün“. Die vorhandene CI umfasst alle geforderten Schritte und wird nach Push ausgelöst; ein CI-Erfolg wird nicht behauptet. Der Nutzerbefund aus 0.1.0 (Zen/CachyOS: erwartet 4.926, importiert 4.686, höchste Position 4.686, unidentifizierbare Zeilen 0, `incomplete`) ist **keine bestandene Abnahme**. Fortschritt nach Tabaktivierung bei etwa 1.000 Einträgen macht Throttling zur Hypothese, nicht zur nachgewiesenen Ursache.

Dieser Test muss mit dem eigenen YouTube-Konto durchgeführt werden. Keine Cookies exportieren oder Zugangsdaten weitergeben. Die aktuelle Version liest und scrollt lediglich.

1. `pnpm build`, dann `dist/manifest.json` über `about:debugging#/runtime/this-firefox` temporär laden. Host-Berechtigung für YouTube prüfen. Bereits offene YouTube-Seite neu laden.
2. Watch Later öffnen. Sprache Deutsch oder Englisch verwenden. YouTubes Gesamtzahl und eine Stichprobe aus Anfang/Mitte/Ende selbst notieren. Listenreihenfolge während des Scans nicht ändern.
3. In LaterSift Importdialog öffnen, Tab aktualisieren/auswählen, „Read-only-Import neu starten“. YouTube geöffnet und möglichst aktiv lassen, nicht darin navigieren oder bearbeiten. Prüfen, dass die lokale Zahl über die erste Ladeportion hinaus steigt. „YouTube-Tab aktivieren ↗“ darf Tab/Fenster nur auf Nutzerklick aktivieren; kein automatischer Fokuswechsel. Ein zuverlässiger Hintergrundscan ist nicht garantiert.
4. Nach einigen Schritten „Import pausieren“ und bestätigten Checkpoint abwarten. Status muss unterbrochen/Teilbestand sein, nicht vollständig. Diagnose kopieren; privates Backup nur lokal exportieren und IDs/URL/Titel selbst vergleichen.
5. Erweiterungs-Tab schließen und über das Symbol erneut öffnen. Bestätigte Checkpoints müssen vorhanden sein. Ein zuvor laufender Scan muss als unterbrochen erscheinen und darf nicht automatisch weiterlaufen.
6. „Fortsetzen / erneut versuchen“ prüfen (Resume A/B unten), danach bei Bedarf separat neu scannen. Bei ausgeblendeten privaten/gelöschten Videos ggf. YouTubes Playlist-Menü „Nicht verfügbare Videos anzeigen“ selbst aktivieren. Vollständigkeit benötigt aktuelle eindeutige Anzahl und Positionen 1…N ohne Konflikte/unidentifizierbare Zeilen sowie stabile Evidenz ohne Continuation.
7. Eine Liste mit deutlich mehr als einer Ladeportion testen; wenn vorhanden 5.000 Einträge. Export prüfen: eindeutige Video-IDs, erwartete Anzahl, erste/mittlere/letzte Stichprobe, Kanal/Dauer soweit vorhanden, `null` bei unbekannten Metadaten.
8. Falls „Teilimport“ verbleibt, Ursache festhalten: unbekannte Header-Struktur/Zahl, unidentifizierbare Zeile, fehlende Position, Continuation/Timeout. **Nicht** als bestandenen M1-Nachweis werten. Ohne ID erkennbare Zeilen können nur als Diagnose erfasst werden.
9. Angemeldeten echten leeren Watch-Later-Bestand nur testen, wenn ohnehin vorhanden. Kein Löschen zum Erzeugen einer Testfixture.
10. Browser/Zen-Version, Betriebssystem, YouTube-Sprache, Datum, sichtbare Gesamtzahl, exportierte eindeutige IDs, Status und Stichprobenbefund in einem lokalen Testprotokoll festhalten. Keine persönlichen Playlist-Exporte in öffentliche Issues hochladen.

**M1-Freigabekriterium:** Ein echter vollständiger Scan der angemeldeten Watch-Later-Liste wurde erfolgreich exportiert und anhand der sichtbaren Anzahl sowie Stichproben bestätigt. Erst danach M3 implementieren. Derzeit ist dieses Kriterium hier nicht erfüllt.

## M1.1: manueller 4.926er-Reproduktionsplan und Resume A/B

Die Liste nicht künstlich verändern oder zum Test leeren. Wenn die aktuelle YouTube-Gesamtzahl von 4.926 abweicht, die tatsächliche Zahl als Erwartungswert verwenden. Buildversion, Zen-/Gecko-Version, CachyOS-Version, Sprache, Datum und Sichtbarkeit protokollieren. Kein Erfolg von 0.1.1 wird vorausgesetzt.

1. **Aktiver Basislauf:** 0.1.1 laden, bestehenden YouTube-Tab nach Extension-Update neu laden, Header-Zahl notieren, neuen Import starten und YouTube aktiv lassen. Fortschritt um 1.000, um 4.686 und bis zum tatsächlichen Ende beobachten. Containerbewegung und Nachladen prüfen. Kein achtsekündiger Leerlauf und keine fehlende Continuation dürfen allein Vollständigkeit oder sofortiges Ende begründen.
2. **Anfahrt, Stillstand und Boundary-Recovery:** Diagnose vor und nach Stillstand sichern. Die Anfahrt durch bereits vorhandene Zeilen darf bei vorwärtsgehendem Scrollwert länger als 90 Sekunden dauern; sie ist kein fehlgeschlagener Nachladeversuch. Bleibt der Scrollwert vor der Ladegrenze 90 Sekunden blockiert, `incomplete` mit `scroll_unreachable` erwarten. Erst an der Ladegrenze soll nach 8 Sekunden sichtbarem Stillstand `waiting` erscheinen. Dort höchstens drei Recoveries ohne Fortschritt (20-Sekunden-Abstände): am Ende ein Schritt zurück, danach regulär annähern. Schrittgröße: 85 % Container-Viewport, mindestens 400 px. Nach mindestens 90 Sekunden sichtbarem Stillstand und ausgeschöpfter Boundary-Recovery ist `recovery_exhausted` zulässig. Keinen künstlichen Live-Stillstand erzwingen, wenn YouTube normal lädt.
3. **Hintergrundvergleich:** Separaten Lauf mit bewusst verborgenem YouTube-Tab beobachten. Bei Stillstand Diagnose/Sichtbarkeit/Zeit notieren, dann selbst „YouTube-Tab aktivieren ↗“ klicken. Fortschritt vor/nach Aktivierung protokollieren. Nach 8 Sekunden verborgener Ruhezeit ohne neue bestätigte IDs soll `needs_attention` erscheinen. Verborgene Zeit wird über tatsächliche Sichtbarkeitsereignisse und monotone Uhr erfasst, nicht als sichtbarer Stillstand gezählt. Nach 120 Sekunden Aufmerksamkeit je Episode oder kumuliert 600 Sekunden je Scanner-Aufruf darf `incomplete` mit `attention_timeout` folgen. Aktivierung/Fortschritt setzt die Episode, nicht das kumulierte Budget zurück. Das aktive Budget beträgt 300.000 ms plus 1.000 ms je bestätigter ID, maximal 7.200.000 ms; verborgene Zeit zählt nicht dazu. Mindestens eine Sekunde Pollintervall, kein Acht-Runden-Abbruch. Unterschiedliche Ladeverläufe allein beweisen kein Throttling.
4. **Resume A – gleiches Dokument:** Nach einem bestätigten Teilcheckpoint pausieren, YouTube weder neu laden noch verlassen. „Fortsetzen / erneut versuchen“ wählen. Scan-ID/gesicherte IDs und Scrollposition bleiben erhalten; dasselbe zufällige Generationstoken erlaubt ausschließlich die separat gespeicherte Evidenz aus `confirmedVideoIds` als bisherige Positionsbelege. Neue Einträge müssen hinzukommen, Entscheidungen und frühere vollständige Snapshots erhalten bleiben. Kein Servercursor wird erwartet.
5. **Resume B – Reload:** Wieder pausieren und Checkpoint abwarten, dann YouTube neu laden und denselben Scan fortsetzen. Scrollposition muss auf 0 zurückgesetzt werden. Gesicherte IDs dürfen nicht verschwinden, aber `confirmedVideoIds`, `confirmedCount`, höchste bestätigte Position und Lücken müssen die neue Beobachtung widerspiegeln. Alte IDs allein dürfen nicht sofort `complete` ergeben. Erst nach frischer Bestätigung aller Positionen darf ein vollständiger Snapshot entstehen. Zusätzlich SPA-Navigation prüfen: `yt-navigate-start`, `popstate` und `pagehide` invalidieren das Generationstoken; ein laufender Scanner muss bei Generationwechsel unterbrechen, selbst wenn die URL wieder Watch Later ist. Beim Fortsetzen nach Generationwechsel erneut bei 0 beginnen und Evidenz neu erheben. Ein Reload der LaterSift-Seite muss zuvor aktive Zustände als `interrupted` laden; kein automatischer Scanstart.
6. **Ergebnis:** Bei unveränderter erwarteter Zahl 4.926 müssen 4.926 eindeutige, aktuell bestätigte IDs, Positionen 1…4.926 ohne Konflikt, keine unidentifizierbaren Zeilen und stabile Evidenz ohne Continuation vorliegen. Nur dann `complete`; Backup lokal exportieren und Stichproben prüfen. Bei 4.686 oder anderen Lücken bleibt das Ergebnis Teilimport und M1 offen.

### Diagnosedaten statt privater Exporte

Für jeden relevanten Zeitpunkt „Import-Diagnose (ohne Video-Metadaten)“ öffnen und JSON kopieren: `count`, `expectedCount`, `status` sowie im Objekt `diagnostics` die Felder `lastProgressAt`, `visibility`, `reason`, `highestPosition`, `missingPositions`, `recoveryAttempts`, `recoveryResults` (letzte höchstens 10 Einträge), `positionConflict`, `activeMs`, `attentionMs`, `totalAttentionMs`, `scroll` (Container/Top/Höhe/Viewport), `continuation`, `confirmedCount`. `attentionMs` bezeichnet die aktuelle Episode, `totalAttentionMs` die kumulierte Aufmerksamkeit dieses Scanner-Aufrufs. Die Lückenliste enthält nur die ersten höchstens 100 fehlenden Positionen, keine vollständige Fehlerliste. Sichtbare Header-Zahl und eigene Aktivierungszeit zum Vergleich separat notieren. Die UI-Diagnose enthält weder Generationstoken noch `confirmedVideoIds`; diese separate ID-Evidenz bleibt im gespeicherten Scan bzw. privaten Backup.

Diagnose enthält keine Video-IDs, Titel, Kanalnamen, Thumbnails oder sonstigen Video-Metadaten. Trotzdem vor Veröffentlichung prüfen. Private Backup-Exporte, Cookies, Kontodaten oder Screenshots persönlicher Listen nicht in öffentliche Issues hochladen. Backups dienen ausschließlich der lokalen Stichprobe; keine Zugangsdaten weitergeben.

Zusätzlich lokal zu prüfen: Checkpoint-Drosselung (100 neue IDs oder 5 Sekunden bei geänderter Anzahl, sonst 15 Sekunden, Zustandswechsel/Ende sofort), ACK erst nach Commit, Speicherfehler ohne falsche Fortschrittsanzeige, Migration Library-Schema 1 → 2 bei unveränderter IndexedDB-Strukturversion 1 und Erhalt von Entscheidungen/vollständigen Snapshots. Das sind Prüfaufträge, keine behaupteten Live-Resultate.

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
