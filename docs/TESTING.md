# Tests / Abnahme

**Aktuell: 0.2.1 / M3.1.** Zuerst ausschließlich den [rein lesenden Zen-Test](M3.1.md#manueller-zen-test--ausschließlich-lesend) durchführen. Keine Freigabe für echte Schreibtests. Aktuelle Prüfergebnisse: [STATUS.md](STATUS.md). Die folgenden 0.2.0-Ergebnisse sind historisch; die beschriebenen Schreibpiloten benötigen eine gesonderte Nutzerfreigabe.

## Evidenz und aktueller Prüfstand

**M1 ist nutzerbestätigt:** echter angemeldeter Live-Import **4.926/4.926**, `complete`, vollständiges JSON lokal gespeichert. „Nicht verfügbare Videos anzeigen“ in YouTubes Playlist-Menü machte die zuvor fehlenden 240 sichtbar. Das ist ausdrücklich **Nutzerbestätigung, kein eigener automatisierter Live-Nachweis des Agenten**.

**M3 bleibt experimentell und vorläufig, Live-Abnahme ausstehend.** Es wurden keine eigenen Live-Schreibaktionen ausgeführt. Die vollständige lokale Prüffolge war erfolgreich (Details unten); CI-Nachweise werden im [Lieferstatus](STATUS.md) verlinkt. Keine allgemeine reale DOM-Kompatibilität behauptet. Historische 0.1.1-Ergebnisse werden nicht auf 0.2.0 übertragen.

## Automatisiert (keine echten Playlist-Änderungen)

Vollständiger lokaler Lauf für 0.2.0:

| Prüfung                      | Ergebnis                                                                 |
| ---------------------------- | ------------------------------------------------------------------------ |
| `pnpm check`, Lint, Format   | Erfolgreich; Check 0 Fehler / 0 Warnungen                                |
| Vitest                       | **466/466 in 14 Dateien**, darunter sechs vollständige Integrationstests |
| UI                           | **48/48**, Chromium und Firefox                                          |
| Produktionsbuild / Web-ext   | Erfolgreich; Web-ext 0 Fehler / 0 Warnungen / 0 Hinweise                 |
| Firefox 157 MV3-Installation | `dist` **und finale XPI** erfolgreich, frisches Testprofil               |
| `pnpm package`               | `artifacts/latersift-0.2.0-unsigned.xpi` erstellt                        |

Die sechs vollständigen Integrationstests verbinden **realen Executor + IndexedDB + Background-Autorität + Transport + nativen Adapter** gegen **synthetisches DOM**. Sie prüfen die gesamte technische Kette, führen aber **keine YouTube-Mutationen** aus und belegen keine aktuelle Live-Kompatibilität. Die vorhandene geprüfte CI enthält Prüfbefehle und Artefakte bereits; kein Workflow-Eingriff nötig. Änderungen werden vor Veröffentlichung erneut geprüft.

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

Gezielt für den Schreibpiloten:

```sh
pnpm exec vitest run tests/model.test.ts tests/operations.test.ts tests/write-adapter.test.ts tests/write-bridge.test.ts tests/write-content.test.ts tests/write-protocol.test.ts tests/write-authority.test.ts tests/write-flow.test.ts tests/storage.test.ts tests/session.test.ts
pnpm exec playwright test tests/ui/operations.spec.ts
```

Die Befehle dienen der Reproduktion des oben validierten Stands. Für jeden Lauf Version/Commit, Befehl, Zeitpunkt und tatsächliches Ergebnis protokollieren; fehlende oder noch laufende Prüfungen als solche kennzeichnen. Ein erfolgreicher lokaler Lauf sagt nichts über den aktuellen GitHub-CI-Status aus.

Die Tests verwenden synthetische DOM-/Browser-Fixtures und frische IndexedDB ohne Zugangsdaten. Browser-UI-Daten sind als Fixture gekennzeichnet. Der Firefox-Smoke-Test installiert das echte MV3-Add-on über Mozillas RDP in einem frischen Profil und prüft Manifest/Background, nicht den angemeldeten YouTube-Datenfluss. Er greift nicht auf das normale Browserprofil zu und navigiert nicht auf YouTube. **Fixture-Erfolge sind keine Live-M3-Evidenz und dürfen kein Pilotlimit automatisch erhöhen.**

### Vorhandene Testbereiche / Prüfkriterien

- Import: leer, einzelne und große virtualisierte Listen, Lazy Loading, doppelte IDs, Navigation/Abbruch, unbekannte Zahl, Positionslücken/-konflikte, Continuation, geänderte Struktur und Speicherfehler.
- Resume: separat bestätigte IDs in derselben Generation; nach Reload neue Positionsbelege und Anfahrt bei 0. Keine Vollständigkeit aus lediglich aufbewahrten IDs.
- Metadaten: ID, Dauer, unbekannte Werte, deutsche/englische Gesamtzahl und konservative Verfügbarkeit.
- Sitzung: lokale Entscheidungen, fester Archivziel-Snapshot, Undo, Zurückstellen, Pause/Serialisierung, Filter, Doppelklickschutz und Erhalt von Entscheidungen bei neuen Scans.
- Speicherung: atomare Checkpoints, vollständige Snapshots durch Teilimport nicht überschreiben, Schema 1/2 → 3 ohne Strukturupgrade, Erhalt alter Entscheidungen/Snapshots, laufende Operationen → `unknown`, laufende Scans → `interrupted`.
- Executor-/Speichergrenze: verpflichtendes `storage.claimExecution` vor erstem WAL-Commit und jedem Adapteraufruf; atomare Prüfung des tatsächlichen vollständigen Snapshot-Datensatzes, kanonischer aktueller Library-CAS und separates Replay-Ledger unter `state` → `execution-ledger`. Fehlende/abweichende Snapshots, veraltete Klone, parallele Ansprüche und wiederverwendete Freigaben vor Adapterzugriff ablehnen, ohne DB-Versionswechsel.
- Executor: Export-/Auswahl-/TTL-Gates, Cleanup-Evidenz, Journal vor Klick, stabile Add-/Remove-UUIDs, Add vor Remove, frische Zielprüfung auch bei bereits vorhandenem Ziel, extern abwesendes WL, Fehler/Disconnect, Speicherfehler und Stoppen nach aktueller Aktion. `{ changed: false }` darf keinen tatsächlichen Pilot-Änderungsnachweis erzeugen.
- Autorität vor jeder Mutation: Content fragt Background per Runtime-Nachricht; eigene Extension, YouTube-Sender und exakte Video-ID prüfen. Storage muss exakt aktive beanspruchte Freigabe, persistierten laufenden WAL-Versuch, Snapshot/Export und einmaliges Permit pro Versuch atomar prüfen. Rohes Bridge-Grant ohne Claim/WAL, Wiederholung desselben Permits und unpassende Sender dürfen keinen Klick erlauben. Background führt keine Jobs/Klicks aus.
- Wiederholung: `failed`/`unknown` nach manueller YouTube-Prüfung explizit erneut auswählbar, `verified` gesperrt. Neue Zustimmung und Freigabe mit frischen Preflights; kein automatischer Retry. **Widerspricht frischer Zustand einem bereits verifizierten Schritt, `unknown` und manueller Abgleich, niemals diesen Schritt erneut ausführen**; neue UI-Zustimmung darf die Sperre nicht überschreiben.
- Native Dialog-Fixtures: sichtbarer `ytd-watch-flexy` mit passender `video-id` und Save-Button als Nachfahre; richtige URL mit falschem/veraltetem Renderer ablehnen. Explizite Link-ID in derselben Checkbox-Option **auch für WL**; eine eigene Playlist namens „Watch later“ niemals als WL erkennen. Fehlender WL-Link verbietet Remove. `getAvailablePlaylists` gibt nicht identifizierte Zeilen zur Diagnose zurück; `id: null`, nicht schreibbar. Keine Titel-/manuelle-ID-Zuordnung; ARIA/native Inputs, Mehrdeutigkeit, Optimismus, Dialogwechsel, Fehler und Timeouts konservativ behandeln.
- Bridge: **jede** Mitgliedschaftsabfrage erzwingt Cache-Bypass-Reload, auch nach Videowechsel; Navigation allein genügt nicht.
- Pilotstufen: tatsächliche verifizierte Änderung plus ausdrückliche Nutzerbestätigung, zuerst 1 → 5, dann neue vollständig verifizierte 5er-Stufe mit Änderungsnachweis → 25. `already_absent` und automatische Mock-Erfolge genügen nicht.
- UI: keine Vorauswahl, Limit 1, genaue Aktionen/IDs/Ziel-URLs, aktueller persistierter Snapshot/Exportgate, neuerer Teilimport blockiert, fehlende Extension verhindert Ausführung. Wiederwahl von `failed`/`unknown` braucht neue Zustimmung; `verified` deaktiviert. Während Busy Schließen/Escape blockieren; Unmount trennt den Port und unterbindet späte Panel-Commits. Fortschritt zeigt aktuelle Entscheidung und getrennte Ergebniszahlen.

Die Hard-Reload-/Cache-Umgehung der realen Bridge und der angemeldete native Dialog müssen zusätzlich im echten Add-on geprüft werden. Ein isolierter Adapter-/Executor-Mock testet nicht die tatsächliche YouTube-Persistenz oder den vollständigen Extension-Datenfluss.

## Installation und Upgrade prüfen

1. **Vor Upgrade bestehenden vollständigen JSON-Export lokal sichern**, nicht öffentlich hochladen. Profil und ID `latersift@almighty-atlas.github.io` beibehalten.
2. Aktuell 0.2.1 bauen und `dist/manifest.json` oder nach erfolgreichem Paketbau `artifacts/latersift-0.2.1-unsigned.xpi` temporär über `about:debugging#/runtime/this-firefox` laden. Paket und Manifest müssen beide 0.2.1 tragen. Keine Signierung voraussetzen.
3. Bestehende YouTube-Tabs neu laden. Rechte vergleichen: weiterhin nur `unlimitedStorage` und `https://www.youtube.com/*`, keine neuen Privilegien, kein `cookies`/`tabs`-Vollzugriff.
4. Mit erhaltenem Extension-Speicher prüfen: Library-Schema 3, IndexedDB `latersift` weiterhin Strukturversion 1 und dieselben Stores `state`/`snapshots`; alte Entscheidungen und vollständige Snapshots unverändert vorhanden. Kein destruktives Zurücksetzen zum Beheben einer Migration.
5. Start darf weder Scan noch Schreibjob auslösen. Vorher laufende Scans müssen `interrupted`, laufende Operationsschritte/Entscheidungen/Durchläufe `unknown` sein.
6. Bei Speicherfehlern stoppen. Keine Gates durch DevTools-Manipulation umgehen; zuerst Diagnose und lokale Sicherung.

Temporäre Add-ons verschwinden nach Browser-Neustart; Entfernung/Neuinstallation kann Daten verlieren. Das ist kein verlässlicher Dauerinstallations-/Resume-Nachweis. Firefox Release/ESR braucht für dauerhafte Installation eine Mozilla-Signatur, Zen separat prüfen. Der JSON-Export ist kein implementierter Import-/Restoremechanismus.

## Erster M3-Live-Pilot: genau eine Entscheidung

**Nur selbst im eigenen angemeldeten Browser und nur nach bewusster Freigabe durchführen. Diese Anleitung führt keine Aktionen aus.** Keine Cookies/Zugangsdaten teilen. Der erste Pilot ist kein Massen-Cleanup und kein Test mit der gesamten Warteschlange.

### Vorbereitung und bewusste Auswahl

1. Buildversion, Datum, Browser/Gecko, Betriebssystem und YouTube-Sprache lokal notieren. **Ein gewöhnliches Entfernen zuerst ist empfohlen**, weil es die zusätzliche unsichere Archiv-ID-Erkennung vermeidet. Auch dieser Pfad verlangt einen **expliziten `/playlist?list=WL`-Link innerhalb der Checkbox-Option** und ist nicht live bestätigt. Viele aktuelle Varianten zeigen keinen solchen Link: Dann sind möglicherweise alle Mutationen unsupported; korrekt abbrechen, nicht auf Labels ausweichen.
2. Den **ursprünglichen WL-Tab geöffnet lassen**, nicht während der Ausführung darin bearbeiten. Er ist die unabhängige Referenz, kein automatisches Rollback. Bei abweichendem Bestand neu vollständig importieren. Der neueste Scan muss vollständig sein, nicht nur ein alter Snapshot neben einem aktuellen Teilimport.
3. Das vollständige aktuelle JSON herunterladen, lokal speichern und anhand Anzahl/IDs/Stichproben prüfen. Im Schreibpilot „Ich habe den Export dieses vollständigen Snapshots lokal gespeichert“ anhaken und **„Exportbestätigung speichern“**. Die UI muss den tatsächlich persistierten vollständigen Snapshot finden. Zusätzlich prüft `storage.claimExecution` verpflichtend im Executor dessen gesamten Datensatz gegen den aktuellen Scan und den aktuellen Library-Stand per kanonischem CAS; separates Ledger verhindert Replay. Ablehnung muss vor jedem Adapteraufruf erfolgen. Ein Download-Klick allein bestätigt keine erfolgreiche lokale Sicherung.
4. **Genau ein bewusst ausgewähltes entbehrliches Video** verwenden, das noch in WL vorhanden ist und dessen Verlust aus dieser Liste akzeptabel ist. ID und URL selbst notieren. Keine private/gelöschte/problematische Zeile als ersten Kompatibilitätstest und keine automatische Auswahl aller Vormerkungen. Bei Bedarf eine einzelne lokale Entfernen-Vormerkung erzeugen; das verändert YouTube noch nicht.
5. Zusammenfassung/„Vorgemerkt“ öffnen. Anfangszustand: **0 ausgewählt**, Pilotlimit **1**. Nur diese eine Vormerkung auswählen. Titel **und Video-ID**, Aktion **„Aus Watch Later entfernen“** und Ziel `https://www.youtube.com/playlist?list=WL` kontrollieren. Keine Archivaktion versehentlich mitfreigeben. Rundengröße und Schreiblimit sind unabhängig.
6. Zustimmung **nur für genau diese eine angezeigte Entscheidung** geben. Ohne diese Zustimmung, Snapshot und Exportbestätigung muss der Ausführungsbutton gesperrt bleiben. Alte Freigaben nicht wiederverwenden.

### Ausführung und unabhängige Kontrolle

7. Erst jetzt **„YouTube-Arbeitstab öffnen und Auswahl ausführen“** klicken. Das öffnet ausdrücklich einen eigenen aktiven YouTube-Tab zur exakten Video-ID. Diesen Tab aktiv und sein Fenster fokussiert lassen, nicht nebenher navigieren oder die Checkbox selbst bedienen. Es gibt **keinen wiederkehrenden Autofokus**. Bei Fokusverlust muss der Pfad konservativ abbrechen, statt den Tab automatisch zurückzuholen.
8. Erwarteter Ablauf für Entfernen: frische WL-Mitgliedschaft `present`, erneuter Preflight, persistierter Remove-Schritt `running` vor Klick, Background-Permit für exakt diesen beanspruchten WAL-Versuch, einzelner Checkbox-Klick und anschließend frische WL-Prüfung `absent`. Vor **jeder** Mitgliedschaftsabfrage muss die Bridge einen Hard-Reload mit `bypassCache: true` ausführen, **auch nach Videowechsel**. Zusätzlich muss ein sichtbarer `ytd-watch-flexy` mit passender `video-id` den Save-Button enthalten; URL allein reicht nicht. Ohne expliziten WL-Link in der Checkbox-Option kein Remove. Nur Dialog erneut öffnen bzw. ein sofort geändertes Häkchen im selben SPA-Zustand ist keine ausreichende Bestätigung.
9. Falls erforderlich „Nach aktueller Aktion stoppen“ wählen. Der Stopp greift nach der aktuellen Entscheidung samt Verifikation; er garantiert keinen Sofortabbruch/Rollback. Für Zugriff auf den Stoppbutton ist ein manueller Tabwechsel nötig und kann zugleich die Aktiv-/Fokusprüfung des Arbeitstabs unterbrechen; entsprechend kann der Ausgang `unknown` bleiben. Nachforderung von Stopp darf keine weitere Entscheidung starten.
10. Ergebnis in LaterSift **und zusätzlich unabhängig direkt in YouTube** prüfen: den erhaltenen Original-WL-Tab selbst neu laden und die exakte Video-ID kontrollieren; gegebenenfalls den nativen Save-Dialog manuell frisch öffnen. Nur Abwesenheit in einem gerade sichtbaren Teil der virtualisierten Liste genügt nicht. Der Arbeitstab bleibt offen. Journalstatus, Versuche, Evidenz und Meldungen lokal festhalten; danach JSON erneut sichern.
11. **Erfolgreicher Änderungsnachweis:** Video war zuvor tatsächlich in WL, LaterSift führte den Remove-Versuch aus, die Mutation meldet `changed: true`, der Schritt ist `verified` mit `outcome: changed` und frischer `absent`-Evidenz, und der Nutzer bestätigt den tatsächlichen Zustand direkt in YouTube. Bereits extern abwesendes WL (`already_absent`) ist **kein eigener Entfernungserfolg**; `verified` allein genügt nicht.
12. Bei `failed`, `unknown`, nicht unterstütztem DOM oder Widerspruch **stoppen, nicht das Limit erhöhen**. Kein wiederholtes Blindklicken, kein Speicher-Reset. Laufende Zustände werden nach Reload zu `unknown`. Für Wiederholung zuerst das tatsächliche Ergebnis manuell in YouTube prüfen; `failed`/`unknown` danach bewusst erneut auswählen und **neu zustimmen**. Jede neue Freigabe durchläuft Claim und sämtliche frischen Preflights; `verified` bleibt nicht auswählbar. **Widerspruch zu einem bereits verifizierten Schritt verlangt manuellen Abgleich: `unknown`, keine Wiederholung dieses Schritts und kein Override durch neue Zustimmung.** Bei nicht unterstützter Struktur keine Gates lockern oder Klicks erzwingen; technischen Fehler und höchstens minimalen bereinigten DOM-Kontext melden, niemals vollständiges privates Seiten-DOM. Lokales Undo ist keine Wiederherstellung auf YouTube.
13. **Nicht automatisch auf 5 gehen.** Nur wenn der eine tatsächliche Änderungsnachweis verifiziert und vom Nutzer direkt geprüft wurde, kann die separate ausdrückliche Pilotbestätigung das Limit von 1 auf 5 erhöhen. Für 25 braucht es eine neue vollständig verifizierte 5er-Stufe mit tatsächlicher Änderung und erneuter Nutzerbestätigung. Fixture-/Mock-Läufe oder bereits erreichte Zustände gelten nicht als Live-Abnahme.

### Archivieren erst separat prüfen

- Erst nach dem gewöhnlichen Entfernen-Piloten erwägen; keine Archiv-Live-Kompatibilität aus dem WL-Erfolg ableiten.
- „Playlists aus YouTube laden“ öffnet auf ausdrücklichen Klick einen eigenen aktiven Arbeitstab und bedient nur den nativen Save-Dialog, ohne eine Playlist-Mitgliedschaft zu ändern. Aktiv/fokussiert lassen.
- Unterstützter Vertrag: semantische Buttons/Checkboxen innerhalb isolierter `ytd-add-to-playlist-renderer` / `ytd-playlist-add-to-option-renderer`. **Die konkrete Archiv-ID muss als expliziter Playlist-Link in derselben Checkbox-Zeile stehen.** Keine Titelzuordnung, internen Properties oder API-Nachfragen.
- **Viele aktuelle YouTube-Varianten exponieren dort keine Links/IDs.** Nicht nur Archiv-Picker, sondern sämtliche Mutationen können unsupported sein: erklärender Fehler und **fail closed** sind korrekt. Manuelle URL/ID ist kein Bypass; `getAvailablePlaylists` gibt nicht identifizierte Zeilen jetzt nur zur Diagnose zurück; jede entsprechende Mutation bleibt gesperrt.
- **Auch WL erfordert `/playlist?list=WL` innerhalb derselben Checkbox-Option.** Niemals Label allein: eine eigene Playlist kann „Watch later“ heißen. Ohne diesen Link `unknown` und kein Remove; aktuelle Live-Kompatibilität unbekannt.
- Für einen bewusst freigegebenen Archivversuch muss das Ziel frisch identifiziert und schreibbar sein. Ziel bereits `present`: **kein Add**, trotzdem erneut frisches `present` vor WL-Remove. Nach neuem Add: Erfolg frisch nach Reload beobachten und persistieren, danach **erneut** Ziel `present` und WL prüfen, erst dann entfernen und WL-Abwesenheit frisch bestätigen.
- Unbekanntes/fehlgeschlagenes Add oder fehlende Zielbestätigung: **kein Remove**. Add erfolgreich, Remove fehlgeschlagen: Teil-Erfolg separat erhalten, kein Gesamterfolg. WL schon vorab extern abwesend: kein blinder Add und kein eigener Entfernungserfolg.

## M1-Regression / Resume A und B

Die M1-Abnahme ist nutzerbestätigt; die folgenden Schritte sind Regressionen, keine erneute Behauptung eines selbst durchgeführten Live-Tests. Liste nicht künstlich verändern oder leeren. Weicht die aktuelle Zahl von 4.926 ab, tatsächliche Header-Zahl verwenden.

1. Aktiver Basislauf: aktuelle Extension laden, YouTube nach Update neu laden, Header-Zahl notieren, neuen Read-only-Import starten. Ggf. „Nicht verfügbare Videos anzeigen“ selbst aktivieren. Liste während des Scans nicht bearbeiten. Fortschritt über mehrere Ladeportionen und Stichproben Anfang/Mitte/Ende prüfen.
2. Anfahrt/Boundary: tatsächlicher Scrollfortschritt durch vorhandene Zeilen darf länger als 90 Sekunden dauern; blockierte Anfahrt vor der Ladegrenze endet nach 90 Sekunden mit `scroll_unreachable`. An der Ladegrenze nach 8 Sekunden sichtbarem Stillstand `waiting`; höchstens drei Recoveries im 20-Sekunden-Abstand. Am Ende einen Schritt zurück, dann wieder vorwärts (85 % Container-Viewport, mindestens 400 px). Nach mindestens 90 Sekunden und ausgeschöpfter Recovery ist `recovery_exhausted` zulässig. Keine fehlende Continuation allein als Vollständigkeitsbeweis.
3. Hintergrundvergleich nur als Beobachtung: nach 8 Sekunden verborgener Ruhe ohne neue bestätigte IDs `needs_attention`. Aktivierung nur selbst per „YouTube-Tab aktivieren ↗“, kein automatischer Fokus. Aufmerksamkeit maximal 120 Sekunden je Episode und kumuliert 600 Sekunden je Scanner-Aufruf; aktives Budget `min(7.200.000, 300.000 + bestätigte IDs × 1.000)` ms. Verborgene Zeit zählt nicht als aktive/sichtbare Stillstandszeit. Unterschiedliche Verläufe beweisen kein Throttling.
4. **Resume A, gleiches Dokument:** nach bestätigtem Teilcheckpoint pausieren, YouTube nicht verlassen/neu laden. Fortsetzen bewahrt Scan-ID, Scrollposition und nur die separat bestätigten `confirmedVideoIds` derselben Generation als Evidenz. Vorherige Entscheidungen/Snapshots bleiben erhalten.
5. **Resume B, Reload:** nach Checkpoint pausieren, YouTube neu laden, denselben Scan fortsetzen. Gesicherte IDs bleiben, Anfahrt beginnt bei 0, Positionen werden neu bestätigt; alte IDs allein dürfen kein sofortiges `complete` ergeben. `yt-navigate-start`, `popstate`, `pagehide` invalidieren die Generation und unterbrechen einen laufenden Scan. Auch bei Rückkehr zu WL neue Evidenz erheben. LaterSift-Reload darf keinen Scan automatisch starten.
6. Vollständigkeit nur bei aktueller erwarteter Zahl, ebenso vielen frisch bestätigten eindeutigen IDs, Positionen 1…N ohne Konflikt, keinen unidentifizierbaren Zeilen und stabiler Evidenz ohne Continuation. Dann JSON lokal exportieren, IDs/Anzahl/Stichproben prüfen. Sonst Teilimport, nicht als bestanden umdeuten. Ein echter leerer Bestand nur testen, wenn ohnehin vorhanden; keine Löschaktion zum Erzeugen einer Fixture.

### Diagnose statt privater Exporte

„Import-Diagnose (ohne Video-Metadaten)“ kopieren: `count`, `expectedCount`, `status`, `diagnostics.lastProgressAt`, `visibility`, `reason`, `highestPosition`, `missingPositions` (erste höchstens 100), `recoveryAttempts`, `recoveryResults` (letzte höchstens 10), `positionConflict`, `activeMs`, `attentionMs`, `totalAttentionMs`, `scroll`, `continuation`, `confirmedCount`. Sichtbare Gesamtzahl und Aktivierungszeit separat notieren. Diagnose enthält keine Video-Metadaten, bestätigten ID-Listen oder Generationstoken; trotzdem vor Veröffentlichung prüfen.

Checkpoints: bei geänderter Anzahl nach 100 neuen IDs oder 5 Sekunden, sonst spätestens 15 Sekunden, Zustandswechsel/Ende unmittelbar. ACK erst nach Commit. Speicherfehler dürfen keinen falschen bestätigten Fortschritt anzeigen. Private Backups, Cookies, Kontodaten oder Screenshots persönlicher Listen nicht öffentlich teilen.

## Lokale Swipe-/UI-Abnahme

- Runde mit Größe 3: Entfernen lokal vormerken, Archivieren mit hinterlegtem Ziel lokal vormerken, Zurückstellen. Das allein darf YouTube nicht ändern.
- Undo nur für unberührte lokale Vormerkungen; angewendete/unklare Vorgänge nicht als wiederhergestellt ausgeben. Archivziel bleibt an die Entscheidung gebunden.
- Pfeiltasten nicht in Eingabefeldern/Dialogen auswerten; gehaltene Taste darf keine Mehrfachentscheidung erzeugen. Leertaste pausiert außerhalb Buttons/Inputs.
- Maus und echten Touchscreen prüfen: horizontal mindestens 85 px, nach unten zurückstellen; Antippen/Aufwärtszug nicht vormerken. Echter Touch bleibt separat manuell zu prüfen.
- Zurückgestellte Karten erst in neuer Runde; Reload erhält lokale Daten bei erhaltenem Extension-Speicher. Zweite LaterSift-Instanz verweigert Bearbeitung.
- Bereinigung: nur eindeutig privat/gelöscht auswählen und lokal bestätigen, unbekannt/eingeschränkt nicht automatisch auswählen. Für tatsächliche Entfernung dieselben Snapshot-/Export-/Freigabe-/Pilotgates, kein direkter Massen-Write.
- Zusammenfassung: nichts vorausgewählt, Limit 1 unabhängig von Rundengröße, konkrete IDs/Aktionen/Ziel-URLs, separate Add-/Remove-Status und kein Erfolg aus bloßem Vormerken. Ohne gültige Auswahl/Zustimmung/persistierten aktuellen vollständigen Snapshot/Exportbestätigung keine Ausführung.

Alle manuellen Resultate mit tatsächlichem Befund dokumentieren. **Kein Live-M3-Erfolg ist durch diese Anleitung vorweggenommen.**
