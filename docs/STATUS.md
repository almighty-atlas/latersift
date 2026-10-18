# Lieferstatus / Evidenz

## Aktuell: 0.2.3 / M3.2 – lesender Hintergrundbetrieb

Basis: **0.2.2**, Stand: 18.10.2026. Dokumentierter Implementierungsvertrag, **keine Live-Abnahme**. Keine Live-DOM-Aufnahme des Playlist-Feeds und kein angemeldeter Zen-Test verfügbar. [M3.2: Vertrag, Grenzen und getrennte manuelle Checklisten](M3.2.md).

1. **Schritt 1 – Playlist-Feed:** „Playlists aktualisieren“ liest `/feed/playlists` im eigenen inaktiven Arbeitstab. `src/adapter/playlists.ts` verwendet nur unbestätigte Kandidatenstrukturen, echte `/playlist?list=…`-Links und separates Titel-DOM derselben Karte. Sichtbarkeit ausschließlich aus expliziten Privacy-Badges, Eigentum immer `unknown`. Kein `complete`, auch nicht bei stabilem Ende. Katalog und vorherige stale Einträge liegen separat im `localStorage`, nicht im bisherigen JSON-Backup. Keine Schreibberechtigung aus Feedtreffern.
2. **Schritt 2 – experimenteller WL-Import:** sichtbare Hintergrundcheckbox standardmäßig ausgewählt; ausdrücklicher Start übergibt die Erlaubnis für echtes Hidden-Scrollen. Originale Vollständigkeitsprüfung unverändert. Historische 4.926 sind kein erwarteter aktueller Zähler. Pause/Fortsetzen und Neustart müssen gesicherte Teilbestände erhalten und im neuen Dokument erneut bestätigen.

Eigene Arbeitstabs: `active: false`, URL mit UUID-Fragment, separates `localStorage`-Journal, Web Locks pro Quelle. Own-only Cleanup bei Ende/Pause/Fehler und beim Wiederöffnen von LaterSift; exakte Tab-/URL-/Markerprüfung, niemals Originaltabs schließen. Bei Markerverlust Tab behalten. Crash zwischen Tab-Erstellung und Journalpersistenz kann einen nicht sicher aufräumbaren Tab hinterlassen. Kein automatischer Fokus, ausdrücklicher Aktivieren-Button während der Arbeit als Fallback. Bisheriger Save-Dialog bleibt unter „Erweitert“ als Vordergrunddiagnose erhalten; dessen aktiver Arbeitstab ist nicht mit dem neuen Feedscan zu verwechseln.

Timerverzögerung bleibt Heuristik; der Bridge-Watchdog für 60 Sekunden ohne Checkpoint wirkt nur bei tatsächlich ausgeführten Extension-Timern und nach ausstehenden Speicherbestätigungen. Keine garantierte Frist, Hintergrundnachladung oder Vollständigkeit. **A** ist ein inaktiver sichtbarer Tab, **B** (`tabs.hide`) nur konzeptionell und nicht implementiert. Page Visibility API: beide im Hintergrund `hidden`; Scroll-/IntersectionObserver-/Timerverhalten plattformabhängig, live ungeprüft. B benötigte zusätzlich `tabHide`, vorherigen Nutzerhinweis und Firefox-Benachrichtigung beim ersten Verstecken. Keine `tabHide`-Berechtigung, keine Stealth-Garantie, keine Konsolen-Berechtigungsumgehung.

Keine neuen YouTube-Writes oder Gates, keine gelockerten Identitäts-/Schreibprüfungen, keine zusätzlichen Berechtigungen. Abnahme ausschließlich lesend: Anmeldung, viele Playlists, tatsächliche DOM-Struktur, Lazy Loading/Pagination, gleiche Namen mit verschiedenen IDs, inaktiver Scan während anderer Tabnutzung, Pause/Fortsetzen/Neustart, Tabverlust, Markerverlust, Cleanup und ehrliche Unvollständigkeit; A manuell prüfen, B nicht als getestet ausgeben.

### Qualitätsergebnisse 0.2.3

- `pnpm install --frozen-lockfile`, `pnpm check` (0 Fehler/Warnungen), `pnpm lint`, `pnpm format:check` und `git diff --check`: erfolgreich.
- `pnpm test`: **653/653 in 18 Dateien**. Getrennt prüfbar: `tests/playlists.test.ts` (38 Feed-/Identitätsfälle), `tests/work-tabs.test.ts` (27 Lifecycle-Fälle), `tests/bridge.test.ts` (31 Transport-/Watchdog-Fälle) und `tests/scanner.test.ts` (53 Scanner-Fälle). DOM-Geometrie, Save-Sheet-Titel und bestehende Sicherheitskette zusätzlich geprüft.
- `pnpm test:ui`: **66/66 in Chromium und Firefox**. Mock-Transport mit `active: false`, Persistenz-vor-ACK, Tab-Bereinigung, Katalog über mehrere Teilaktualisierungen/Reload, bestätigte versus erhaltene IDs sowie Bibliotheks-/Backupzugriff trotz defektem Cleanup-Journal. Kein echter YouTube-Tab bei diesen Fixtures.
- `pnpm package`: Produktionsbuild und `artifacts/latersift-0.2.3-unsigned.xpi` erfolgreich. `pnpm lint:extension`: **0 Fehler, 0 Warnungen, 0 Hinweise**.
- `pnpm test:firefox-extension` sowie `LATERSIFT_ADDON_PATH=artifacts/latersift-0.2.3-unsigned.xpi node scripts/test-firefox.mjs`: echte temporäre MV3-Installation aus `dist` und finaler XPI in **Firefox 157.0**, keine Manifestwarnungen.
- SHA-256 der lokal getesteten XPI: `768bc0f40620b36c9a4c71428c8e1acb53a6be07c8a4d2f4707d8d0c4fb6e429`.

Kein angemeldeter YouTube-/Zen-Live-Test, keine echte Messung von Hintergrund-IntersectionObserver oder Browser-Drosselung, kein `tabs.hide`-Versuch. Throttling, Tabverlust und Unterbrechungen sind synthetisch simuliert; Installationsprüfungen belegen keine Live-DOM-Kompatibilität. Keine Signierung/AMO-Veröffentlichung. Die folgenden historischen Ergebnisse gelten nicht als Nachweis für 0.2.3.

## Historischer Stand: 0.2.2 – Versionsanzeige und Dialogdiagnose

Stand: 18.10.2026. Header-Version aus dem installierten WebExtension-Manifest, auch mobil sichtbar. Aufklappbarer, kopierbarer Diagnosebericht nach der vorhandenen Playlist-Abfrage, auch nach Fehlern; UI-Zustand und Identitätsbeleg getrennt. Nur Zähler, Zeilennummern, freigegebene Attributnamen und feste Gründe; keine Namen, tatsächlichen IDs, Attributwerte, DOM-Inhalte oder rohen Fehlertexte. Details und lesende Zen-Abnahme: [DIALOG-DIAGNOSTICS.md](DIALOG-DIAGNOSTICS.md).

Keine neuen Schreibfunktionen, Berechtigungen, API-/Netzwerkanfragen oder Identitätsheuristiken. Sicherheitskette unverändert wirksam, keine echten Schreibtests, kein Backup-Restore. Diagnose bleibt flüchtig.

Lokale Prüfungen für 0.2.2:

- `pnpm install --frozen-lockfile`, `pnpm check` (0 Fehler/Warnungen), `pnpm lint`, `pnpm format:check`: erfolgreich.
- `pnpm test`: **534/534 in 16 Dateien**, einschließlich **15 Diagnose-/Datenschutzfällen** und **10 vollständigen synthetischen Integrationen**. Bestehende Schreib-Sicherheitskette weiterhin geprüft.
- `pnpm test:ui`: **58/58 in Chromium und Firefox**, einschließlich Manifestversion, Datenschutz bei Erfolg/Fehler und Clipboard-Erfolg/-Ablehnung.
- Produktionsbuild und `pnpm lint:extension`: erfolgreich, **0 Fehler, 0 Warnungen, 0 Hinweise**.
- Firefox **157.0**: echtes MV3-Add-on aus `dist` und der finalen XPI temporär installiert, keine Manifestwarnungen.
- `pnpm package`: `artifacts/latersift-0.2.2-unsigned.xpi` erstellt; unsigniert, keine AMO-Veröffentlichung.

Frühere CI-Ergebnisse unten gelten nicht als Nachweis für diesen Änderungsschritt. Keine eigenen angemeldeten YouTube-Live- oder Playlist-Schreibtests.

## Historischer Stand: 0.2.1 / M3.1 – 18.10.2026

Neue Sheet-Erkennung und rein lesende Playlist-Diagnose implementiert, basierend auf den vom Nutzer gemeldeten Strukturmerkmalen. Keine eigene angemeldete Live-Validierung. **Sheets sind keine Schreibziele**, selbst mit explizitem Link; ohne Link keine belegte ID. `aria-pressed` bleibt UI-Zustand, Mitgliedschaft `unknown`. Legacy-Sicherheitskette, Journal, Zustimmung und Pilotlimit bleiben wirksam.

Details: [M3.1-Vertrag, Identitätsbewertung, rein lesende Konsolendiagnose und Zen-Abnahme](M3.1.md). Der nächste manuelle Schritt ist ausschließlich „Playlists aus YouTube laden“ und Vergleich der Namen/Auswahlzustände. Keine echten Schreibtests ohne gesonderte Freigabe.

Lokale Prüfungen für 0.2.1:

- `pnpm install --frozen-lockfile`, `pnpm check` (0 Fehler/Warnungen), `pnpm lint`, `pnpm format:check`: erfolgreich.
- `pnpm test`: **514/514 in 15 Dateien**, darunter **44 neue Sheet-Adapterfälle** und **9 vollständige synthetische Integrationen**. Keine Live-YouTube-Mutation.
- `pnpm test:ui`: **50/50 in Chromium und Firefox**, ausschließlich lokale Fixtures.
- `pnpm build`, `pnpm lint:extension`: erfolgreich; **0 Fehler, 0 Warnungen, 0 Hinweise**.
- Firefox **157.0**: temporäre Installation des echten MV3-Add-ons aus `dist` und der finalen XPI erfolgreich; keine Manifestwarnungen. Installation belegt keine YouTube-Live-Kompatibilität.
- `pnpm package`: `artifacts/latersift-0.2.1-unsigned.xpi` erstellt, keine Signierung/AMO-Veröffentlichung.

Historische CI-Ergebnisse unten gelten nicht als CI-Nachweis für M3.1. Das neue Artefakt wird durch den vorhandenen Workflow beim Push erneut gebaut.

## Historischer Stand: 0.2.0

Stand: 17.10.2026 · **0.2.0**. M1 ist **nutzerbestätigt abgeschlossen**; M3 ist implementiert, aber **experimentell, vorläufig und noch nicht live abgenommen**. Keine Behauptung eines robust fertigen schreibenden MVP oder tatsächlicher allgemeiner YouTube-Kompatibilität.

## Evidenz klar trennen

| Bereich                     | Beleg / Einordnung                                                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 live                     | **Nutzerbestätigt:** 4.926/4.926, `complete`, vollständiges JSON lokal gespeichert. YouTubes „Nicht verfügbare Videos anzeigen“ machte die fehlenden 240 sichtbar.                        |
| Eigener Agenten-Live-Test   | Kein eigener automatisierter angemeldeter Live-Nachweis; die M1-Aussage stammt ausdrücklich vom Nutzer.                                                                                   |
| M3 live                     | **Noch kein bestätigter Schreibpilot.** Es wurden keine eigenen Live-Schreibaktionen ausgeführt.                                                                                          |
| Aktuelle 0.2.0-Verifikation | Vollständige lokale Prüffolge erfolgreich: **466/466 Vitest, 48/48 UI**; Push- und PR-CI für `b35391d` ebenfalls erfolgreich, Links unten.                                                |
| Fixtures / Smoke-Test       | Synthetische DOM-/UI-/Executor-Tests bzw. Add-on-Installation sind keine Live-M3-Abnahme.                                                                                                 |
| Distribution                | `artifacts/latersift-0.2.0-unsigned.xpi` erstellt; echtes MV3-Add-on aus `dist` und finaler XPI erfolgreich in Firefox 157 installiert. Weiterhin unsigniert, keine AMO-Veröffentlichung. |

Der frühere Teilimport in Zen/CachyOS hatte 4.686 statt 4.926 IDs, höchste Position 4.686, unidentifizierbare Zeilen 0 und `incomplete`. Dieser Befund ist durch den späteren nutzerbestätigten vollständigen Scan **als aktueller M1-Abnahmestand überholt**. Die Null bezeichnete nicht die Verfügbarkeit aller Videos. Fortschritt nach Tabaktivierung war eine Beobachtung, kein isolierter Throttling-Nachweis; die 240 später eingeblendeten Einträge dürfen nicht nachträglich als bewiesener Throttlingfehler dargestellt werden.

## Implementierter Stand

| Meilenstein  | Vorhanden                                                                                                                                                                 | Grenze / offene Abnahme                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 / M1.1    | DOM-Import, Lazy Loading/Virtualisierung, Vollständigkeitsprüfung, bestätigte Checkpoints, Recovery, Pause/Resume, Diagnose und JSON-Export                               | Vollständiger Live-Scan/Export nutzerbestätigt; keine Garantie für jede DOM-Variante oder einen atomaren Serverbestand                                              |
| M2           | Karten, lokale Entscheidungen, UUIDs, Undo, Runden, Pause/Resume, Tastatur/Pointer, Zusammenfassung                                                                       | Echte Touch-Hardware separat prüfen; Vormerken ist noch keine YouTube-Mutation                                                                                      |
| M3           | Nativer Save-DOM-Adapter, Playlist-Abfrage, Mitgliedschaft, Add/Remove, frische Prüfung, Freigaben, persistentes Journal, sequenzieller Executor, Stoppen und Pilotstufen | Experimentelle fail-closed Grundlage; alle Mutationen können im aktuellen Live-DOM unsupported sein. Erster 1er-Live-Pilot offen; manuelle Wiederfreigabe vorhanden |
| M4 / Betrieb | Konservative Verfügbarkeit, bestätigte lokale Bereinigung, Filter und Testinfrastruktur                                                                                   | Bereinigungs-Writes unterliegen M3-Gates; kein Backup-Import/Restore, keine Signierung/AMO-Abnahme                                                                  |

### M3: unterstützter Vertrag, nicht universeller YouTube-Adapter

- Nativer Save-/Speichern-Dialog mit semantischen Controls und isolierten unterstützten Renderern. Die Watch-URL allein genügt nicht: genau ein sichtbarer `ytd-watch-flexy` muss die angeforderte `video-id` tragen, der Save-Button muss darin liegen. Keine internen Properties oder APIs.
- **Auch WL verlangt einen expliziten Link `/playlist?list=WL` innerhalb derselben Checkbox-Option**, Archiv entsprechend `list=PL…`. Niemals Label allein: eine eigene Playlist namens „Watch later“ darf keinen WL-False-Match auslösen. Ohne WL-Link kein Remove; fehlende Identität ist `unknown`, nicht `absent`.
- Viele aktuelle YouTube-Varianten exponieren diese Links nicht: **Alle Mutationen können unsupported sein**, nicht nur Archivieren. Ehrliche fail-closed Grundlage, aktuelle Live-Kompatibilität unbekannt. Manuelle URL/ID und Titelzuordnung sind kein Bypass. Ab M3.1 gibt `getAvailablePlaylists` nicht identifizierte Zeilen nur zur Diagnose zurück; sie bleiben nicht schreibbar.
- `getPlaylistMembership` öffnet einen frischen Dialog; die Bridge erzwingt vor **jeder** Mitgliedschaftsbeobachtung zusätzlich `reload(..., { bypassCache: true })`, **auch nach Videowechsel**. Navigation allein oder optimistisches Checkbox-Feedback reicht nicht; diese DOM-Evidenz ersetzt keinen Live-Test.
- Die erweiterte Legacy-Discovery über den Save-Dialog und der Schreib-Ausführungsbutton öffnen ausdrücklich einen eigenen aktiven YouTube-Arbeitstab. Aktiv/fokussiert halten; keine wiederholte automatische Aktivierung. Original-WL-Tab und dieser Legacy-Arbeitstab bleiben zur unabhängigen Prüfung erhalten. Nicht mit dem neuen inaktiven Feedscan/WL-Arbeitstab aus M3.2 verwechseln.

### Sicherheitsgates und Wiederaufnahme

1. Neuester Scan muss `complete` sein; ein alter vollständiger Snapshot neben einem neueren Teilimport genügt nicht. Export lokal sichern und ausdrücklich bestätigen. **Verpflichtend im Executor:** `storage.claimExecution` prüft atomar den tatsächlichen vollständigen Snapshot-Datensatz, den kanonischen aktuellen Library-Stand (CAS) und die Freigabe, reserviert den Durchlauf und verbraucht die Freigabe im separaten `state`-Schlüssel `execution-ledger`. Veraltete Klone/Replay werden vor jedem Adapteraufruf abgewiesen; UI-Gates allein genügen nicht.
2. Zusammenfassung ohne Vorauswahl, anfänglich Limit **1**, konkrete Video-IDs/Aktionen/Ziel-URLs und gesonderte Zustimmung. Freigabe maximal 15 Minuten, an exakte Aktionen und Snapshot gebunden, nicht wiederverwendbar. Kein Schreiben beim Start/Scan/Swipe.
3. Persistentes Write-ahead-Journal mit stabilen Entscheidungs- und getrennten Add-/Remove-Schritt-UUIDs. `running` und Versuch vor Klick speichern; danach frisch beobachten und Ergebnis speichern. Speicherfehler stoppen weitere Mutationen. Zusätzlich Content → Background vor **jeder Mutation**: eigene Extension, YouTube-Sender und exakte Video-ID prüfen; Storage autorisiert atomar nur die exakt aktive beanspruchte Freigabe mit persistiertem laufendem WAL-Versuch und passendem Snapshot/Export. Einmaliges Permit pro Versuch im Ledger; rohes Bridge-Grant ohne beanspruchten WAL erlaubt keinen Klick. Background führt keine Jobs/Klicks aus.
4. Archivziel schon vorhanden: kein Add, aber erneut **frisches `present` vor WL-Remove** erforderlich. Fehlgeschlagenes/unbekanntes Add oder fehlende Zielbestätigung verbietet Remove. Teil-Erfolg bleibt separat erhalten.
5. WL vorab extern abwesend: `already_absent`, keine eigene erfolgreiche Änderung und kein blinder Add. `verified` allein belegt nicht, dass LaterSift etwas geändert hat. Mutationen liefern `{ changed: boolean }`; No-op (`false`) ist kein tatsächlicher Pilot-Änderungsnachweis.
6. Unterbrechung/unklarer Klickausgang: `unknown`, keine automatische Wiederholung. Beim Laden werden laufende Operationen von `running` zu `unknown`, laufende Scans zu `interrupted`. Wiederholung nur mit **neuer ausdrücklicher Freigabe und sämtlichen frischen Preflights**; alte Add-Evidenz reicht nicht. Die UI bietet `failed`/`unknown` ausdrücklich zur Wiederwahl an: erst manuell in YouTube prüfen, neu auswählen und neu zustimmen. `verified` bleibt deaktiviert. Widerspricht frischer Zustand einem bereits verifizierten Schritt, stoppt die Entscheidung als `unknown` zur manuellen Klärung; dieser Schritt wird nicht erneut ausgeführt, auch neue Zustimmung überschreibt das nicht.
7. Stoppen **nach der aktuellen Entscheidung**, bei Archivieren einschließlich Add/Remove/Verifikation; kein Rollback. Während Busy sind Schließen/Escape blockiert; Unmount trennt den Port und verhindert späte Panel-Commits. Fortschritt zeigt aktuelle Entscheidung und Ergebniszahlen für `verified`/`failed`/`unknown`.
8. Erst tatsächlich geänderte, verifizierte und direkt in YouTube vom Nutzer bestätigte Pilotentscheidung erlaubt ausdrücklich **1 → 5**. Nach vollständiger 5er-Stufe mit neuem Änderungsnachweis erneut ausdrücklich **5 → 25**. Keine automatische Mock-/Executor-Promotion, kein Hochstufen allein wegen `already_absent`.

### Speicherung / Upgrade / Rechte

Library-Schema **1/2 → 3**, dieselbe IndexedDB `latersift` mit Strukturversion **1**, Stores `state` und `snapshots`; separates Ledger unter `state` → `execution-ledger`, kein DB-Versionswechsel. Vorhandene Entscheidungen und vollständige Snapshots bleiben erhalten; kein destruktiver Store-Neubau. Vor Upgrade trotzdem JSON lokal exportieren und Erweiterungs-ID `latersift@almighty-atlas.github.io` sowie Browserprofil beibehalten. Temporäres Entfernen/Neuinstallation/Profilverlust kann Daten vernichten; der Export ist kein implementierter Restore.

**Keine neuen Privilegien:** weiterhin `unlimitedStorage` und Host `https://www.youtube.com/*`; kein `cookies`, kein `tabs`-Vollzugriff. Die bestehende Host-Berechtigung wird nun zusätzlich für ausdrücklich freigegebene native DOM-Aktionen verwendet. Keine Tokens, internen APIs, Telemetrie oder Serverjobs. Event Page öffnet die App und prüft atomare Permits, führt keine Jobs/Klicks aus.

## Verifikation und nächster Abnahmeschritt

Vollständige lokale Prüffolge für 0.2.0 am 17.10.2026:

- `pnpm check`: **0 Fehler, 0 Warnungen**; Lint und Formatprüfung erfolgreich.
- Vitest: **466/466 in 14 Dateien**, darunter **sechs vollständige Integrationstests** mit realem Executor, IndexedDB, Background-Autorität, Transport und nativem Adapter gegen synthetisches DOM. **Keine echte YouTube-Mutation.**
- UI: **48/48 in Chromium und Firefox**.
- Produktionsbuild erfolgreich; Web-ext: **0 Fehler, 0 Warnungen, 0 Hinweise**.
- Firefox **157**: echtes MV3-Add-on sowohl aus `dist` als auch aus der **finalen XPI** erfolgreich installiert; Installations-, kein Live-YouTube-Nachweis.
- `pnpm package`: `artifacts/latersift-0.2.0-unsigned.xpi` erstellt.

Die vorhandene geprüfte CI enthält bereits die Prüfbefehle und Artefaktbereitstellung; keine Workflow-Änderung nötig. Für Implementierungscommit `b35391d` waren sowohl die [Push-CI](https://github.com/almighty-atlas/latersift/actions/runs/39068907126) als auch die [PR-CI](https://github.com/almighty-atlas/latersift/actions/runs/39068910728) erfolgreich. [PR #2](https://github.com/almighty-atlas/latersift/pull/2) bleibt für Review und die ausdrücklich freigegebene manuelle Pilot-Abnahme offen; Folgeänderungen werden erneut geprüft. Testpaket: `artifacts/latersift-0.2.0-unsigned.xpi` sowie CI-Artefakt `latersift-unsigned`. Reproduktion und manuelle Kriterien: [TESTING.md](TESTING.md).

Der historische M3-Schreibpilot (nicht Teil der aktuellen Freigabe) wäre **genau ein bewusst ausgewähltes entbehrliches Video**, vorzugsweise **gewöhnliches Entfernen zuerst**, mit lokalem vollständigem Backup und unverändert geöffnetem Original-WL-Tab. Ergebnis zusätzlich direkt in YouTube prüfen. Bei nicht unterstütztem DOM oder `unknown` stoppen: keine Gates lockern, Klicks erzwingen, Limits erhöhen oder Speicherzustände umschreiben. Technischen Fehler mit minimalem bereinigtem DOM-Kontext melden, nicht mit vollständigem privatem Seiten-DOM. [Detaillierter erster Pilot](TESTING.md#erster-m3-live-pilot-genau-eine-entscheidung).

Keine Live-M3-Abnahme, garantierte Wiederherstellung oder fertige allgemeine YouTube-Schreibkompatibilität behauptet. Signierung und dauerhafte Installation bleiben separate Betriebsprüfungen, keine Voraussetzung für eine erfundene Erfolgsmeldung.
