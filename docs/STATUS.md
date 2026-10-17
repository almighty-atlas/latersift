# Lieferstatus / Evidenz

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
- Viele aktuelle YouTube-Varianten exponieren diese Links nicht: **Alle Mutationen können unsupported sein**, nicht nur Archivieren. Ehrliche fail-closed Grundlage, aktuelle Live-Kompatibilität unbekannt. Manuelle URL/ID und Titelzuordnung sind kein Bypass. `getAvailablePlaylists` scheitert bei **jeder** nicht identifizierbaren Zeile.
- `getPlaylistMembership` öffnet einen frischen Dialog; die Bridge erzwingt vor **jeder** Mitgliedschaftsbeobachtung zusätzlich `reload(..., { bypassCache: true })`, **auch nach Videowechsel**. Navigation allein oder optimistisches Checkbox-Feedback reicht nicht; diese DOM-Evidenz ersetzt keinen Live-Test.
- Discovery- und Ausführungsbutton öffnen ausdrücklich einen eigenen aktiven YouTube-Arbeitstab. Aktiv/fokussiert halten; keine wiederholte automatische Aktivierung. Original-WL-Tab und Arbeitstab bleiben zur unabhängigen Prüfung erhalten.

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

Der nächste Live-Schritt ist **genau ein bewusst ausgewähltes entbehrliches Video**, vorzugsweise **gewöhnliches Entfernen zuerst**, mit lokalem vollständigem Backup und unverändert geöffnetem Original-WL-Tab. Ergebnis zusätzlich direkt in YouTube prüfen. Bei nicht unterstütztem DOM oder `unknown` stoppen: keine Gates lockern, Klicks erzwingen, Limits erhöhen oder Speicherzustände umschreiben. Technischen Fehler mit minimalem bereinigtem DOM-Kontext melden, nicht mit vollständigem privatem Seiten-DOM. [Detaillierter erster Pilot](TESTING.md#erster-m3-live-pilot-genau-eine-entscheidung).

Keine Live-M3-Abnahme, garantierte Wiederherstellung oder fertige allgemeine YouTube-Schreibkompatibilität behauptet. Signierung und dauerhafte Installation bleiben separate Betriebsprüfungen, keine Voraussetzung für eine erfundene Erfolgsmeldung.
