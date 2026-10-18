# LaterSift

**Swipe through your Watch Later backlog.**

Lokale Firefox-/Zen-Erweiterung zum Durchsehen der YouTube-Playlist „Später ansehen“. TypeScript strict, Svelte 5, Firefox Manifest V3, IndexedDB, MIT. Kein Server, keine Telemetrie, keine KI.

> **0.2.4 / M3.2.1 (Basis 0.2.3): Arbeitstab-Readiness von striktem Cleanup-Eigentum getrennt, bereinigte Diagnose für beide Importwege.** Der Nutzer bestätigte in Zen 0.2.3 „Work tab navigated away from its marked source.“; der konkrete Live-Auslöser ist noch nicht diagnostisch bestätigt. Initiale Ladezustände werden bis zu 30 Sekunden gepollt; fremde fertige Ziele bleiben abgewiesen, unsicher zuordenbare Tabs bleiben offen. [M3.2.1: Ursache, Grenzen, Netzwerkbefunde und nächster Zen-Test](docs/M3.2.1.md). Lesender Playlist-Feed und experimenteller WL-Hintergrundimport bleiben vorläufig. [M3.2: getrennte Prüfschritte, Grenzen und Zen-Checkliste](docs/M3.2.md). Keine Live-DOM-Aufnahme und kein angemeldeter Zen-Test verfügbar; Feed-Selektoren sind unbestätigte Kandidaten, der Katalog ist niemals als vollständig belegt. Keine neuen Writes, Schreibgates oder Berechtigungen. Die bisherige [bereinigte Dialogdiagnose](docs/DIALOG-DIAGNOSTICS.md) bleibt als erweiterte Vordergrundoption erhalten; neue Save-Sheets bleiben rein lesend ([M3.1](docs/M3.1.md)).

> **M1/M3-Einordnung:** M1 nutzerbestätigt, M3 experimentell und vorläufig. Der Nutzer hat den vollständigen Live-Import **4.926/4.926, `complete`**, einschließlich lokal gespeichertem vollständigem JSON bestätigt. YouTubes „Nicht verfügbare Videos anzeigen“ machte die zuvor fehlenden 240 Einträge sichtbar. Das ist **Nutzerbestätigung, kein eigener automatisierter Live-Nachweis des Agenten**. Der vorhandene M3-Schreibpilot ist noch nicht live abgenommen; reale YouTube-Kompatibilität und ein robust fertiges schreibendes MVP werden nicht behauptet.

## Funktionsumfang

- Read-only-DOM-Import mit Lazy Loading, Virtualisierung, bestätigten IndexedDB-Checkpoints, Pause/Fortsetzen und Diagnose. Vollständigkeit benötigt passende Gesamtzahl, eindeutige frisch bestätigte IDs, lückenlose Positionen und stabile Evidenz ohne weiteres Nachladen; sonst Teilimport.
- JSON-Export der gespeicherten Scans mit Metadaten, Originalplaylist, Zeiten, Entscheidungen und Operationsjournal. Frühere vollständige Snapshots bleiben erhalten; kein Backup-Import/Restore.
- Responsive Kartenoberfläche mit Dark Mode, Maus-/Touch-Swipe, Tastatur, Undo, Zurückstellen, Pause, Wiederaufnahme und Zusammenfassung. Rundengröße standardmäßig 25 (1–5.000); **das ist nicht das Schreiblimit**.
- Entfernen und Archivieren zunächst **lokal vormerken**. Die Zusammenfassung enthält einen separaten Schreibpiloten: standardmäßig **nichts ausgewählt**, anfänglich höchstens **eine Entscheidung pro Freigabe**, konkrete Video-IDs, Aktionen und Ziel-URLs, separate Add-/Remove-Status.
- Vor Ausführung: neuester Scan vollständig, tatsächlich persistierter vollständiger Snapshot, ausdrücklich bestätigter lokal gespeicherter Export dieses Snapshots und genaue Nutzerfreigabe. Keine Ausführung beim Start, Swipe oder Import.
- Sequenzieller Executor mit persistentem Write-ahead-Journal, frischer Mitgliedschaftsprüfung, Stoppen nach der aktuellen Aktion und konservativem `unknown` bei unklarem Ausgang. Keine automatischen Wiederholungen.
- Archivziel per nativer YouTube-Auswahl, **nur bei unterstütztem DOM mit expliziter Playlist-Link-ID in der Checkbox-Zeile**. Manuelle PL…-URL/ID bleibt lokal speicherbar, umgeht aber keine Identitäts-/Schreibprüfung.
- Bereinigung nur für ausdrücklich privat/gelöscht erkannte Einträge, mit Auswahl und lokaler Bestätigung. Unbekannte/eingeschränkte Videos werden nicht automatisch ausgewählt; die tatsächliche Entfernung unterliegt denselben Schreibgates.

Details: [Status / Evidenz](docs/STATUS.md), [Architektur](ARCHITECTURE.md), [Testanleitung und erster Live-Pilot](docs/TESTING.md).

## Installation / Upgrade auf 0.2.4

Desktop-Firefox oder Zen ab Gecko **142**, Node.js 22.12+ oder 24, pnpm 11:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
pnpm package
```

1. **Vor dem Upgrade den bestehenden JSON-Export lokal sichern.** Dieselbe Erweiterungs-ID `latersift@almighty-atlas.github.io` und dasselbe Browserprofil beibehalten. Library-Dokumente werden auf Schema 3 migriert; die IndexedDB-Struktur bleibt Version 1, bestehende Entscheidungen und vollständige Snapshots bleiben erhalten. Das ersetzt keine Sicherung gegen Entfernen/Profilverlust.
2. `about:debugging#/runtime/this-firefox` → „Temporäres Add-on laden…“ → `dist/manifest.json` oder nach erfolgreichem Paketbau `artifacts/latersift-0.2.4-unsigned.xpi` wählen. Paketname folgt der Manifestversion; Paket-/Manifestabweichungen stoppen die Paketierung. Historisch wurden `dist` und die finale 0.2.2-XPI erfolgreich in Firefox 157 als echtes MV3-Add-on temporär installiert; das ist kein Installations- oder Paketnachweis für 0.2.4. Aktuelle Qualitätsergebnisse ergänzt der Hauptagent in [STATUS.md](docs/STATUS.md).
3. Zugriff auf `https://www.youtube.com` erlauben; bereits offene YouTube-Tabs nach dem Update neu laden. **Keine neuen Berechtigungen:** weiterhin nur `unlimitedStorage` und die bestehende YouTube-Host-Berechtigung.
4. Erweiterungssymbol → LaterSift. Vorgeschlagenes Kürzel: `Alt+Shift+L` (in Zen manuell prüfen/anpassen).
5. Im selben Profil bei YouTube anmelden. Der ausdrückliche Importstart öffnet standardmäßig einen eigenen WL-Arbeitstab mit `active: false`, ohne Fokuswechsel. Die sichtbare Checkbox **„Experimentelles Hintergrund-Scrollen erlauben“ ist vorausgewählt**; Start übernimmt diese Erlaubnis auch für echtes Scrollen bei `hidden`. Andere Tabs können verwendet werden; zuverlässiges Hintergrund-Nachladen ist nicht garantiert. Bei Bedarf während der Arbeit den Aktivieren-Button ausdrücklich klicken. Unter „Erweitert“ bleibt die Auswahl eines vorhandenen eigenen YouTube-Tabs erhalten; dieser wird niemals automatisch geschlossen. Nicht parallel im Scan-Tab navigieren, umsortieren oder bearbeiten. Fehlende Einträge ggf. selbst mit YouTubes „Nicht verfügbare Videos anzeigen“ einblenden; der Scanner bedient dieses Menü nicht.
6. Status prüfen und vollständiges JSON lokal speichern. **Schritt 1 separat:** Im Archivbereich „Playlists aktualisieren“ liest `/feed/playlists` im inaktiven Arbeitstab; Katalog bleibt Teilbestand, Eigentum unbekannt. **Schritt 2 separat:** WL-Hintergrundimport mit unveränderter Vollständigkeitsprüfung testen. Zuerst den [M3.2.1-Diagnosetest](docs/M3.2.1.md#nächster-zen-test--ausschließlich-lesend), danach die [M3.2-Checkliste](docs/M3.2.md#manueller-zen-test--ausschließlich-lesend) durchführen. Die alte Aktion „Playlists aus YouTube laden (Save-Dialog, Vordergrund)“ liegt unter „Erweitert“ und ist nicht der neue Feedscan. Echte Schreibtests benötigen eine gesonderte Nutzerfreigabe.

Temporäre Add-ons verschwinden nach Browser-Neustart. Speicherung kann bei Entfernen/Neuinstallation oder Profilwechsel verloren gehen; vor Upgrade, Entfernen oder Neustart exportieren. Wiederaufnahme setzt erhaltenen Extension-Speicher voraus. Eine JSON-Sicherung ist kein implementierter Restoremechanismus.

### Dauerhafte Installation / AMO

Die XPI ist ein ZIP-Add-on-Paket, aber **unsigniert**. Firefox Release/ESR verlangt für dauerhafte Installation eine Mozilla-Signatur; Zen separat prüfen. Temporäres Laden ist der Entwicklungsweg. Keine Signierung oder AMO-Veröffentlichung wird behauptet. Für Verteilung sind Mozilla-Signierung, Review und Prüfung über echte Browser-Neustarts erforderlich.

## M3.2: Hintergrundbetrieb und offene Abnahme

- Feed-Identität nur aus echtem `/playlist?list=…`-Link und separatem Titel-DOM derselben Karte; Sichtbarkeit nur aus expliziten Privacy-Badges, Eigentum immer `unknown`. Keine Behauptung über tatsächliche Live-Strukturen; der Katalogscan meldet nie `complete`.
- Eigene Arbeitstabs tragen UUID-Fragmente und werden per `localStorage`-Journal und Web Locks pro Quelle verwaltet. Cleanup bei Ende/Pause/Fehler und beim Wiederöffnen von LaterSift nur bei exakter eigener Tab-/URL-/Markerzuordnung. Readiness akzeptiert nur den exakten Feed ohne Query (optional abschließender Slash) bzw. exakt `/playlist?list=WL`, jeweils mit optionalem Fragment. Cleanup verlangt zusätzlich `complete`, die exakte ursprüngliche URL mit UUID und keine abweichende `pendingUrl`. Beobachteter Markerverlust widerruft das Cleanup-Eigentum dauerhaft; der Quellen-Lock bleibt für den lesbaren markerlosen Tab bis `close()` gehalten. Ladezustand oder unverifizierbarer Tab: nicht schließen, ein Tab darf offen bleiben. Crash zwischen Erstellen und Journalpersistenz kann einen Tab zurücklassen; kein unsicheres nachträgliches Adoptieren.
- Timerverzögerungen sind nur eine Heuristik. Der Read-only-Bridge-Watchdog unterbricht nach 60 Sekunden ohne Checkpoint **nur bei tatsächlich laufenden Extension-Timern**; keine garantierte Laufzeit, Nachladung oder Vollständigkeit.
- Implementiert ist **A: inaktiver, in der Tab-Leiste sichtbarer Tab**, nicht **B: `tabs.hide`**. Beide Dokumente sind gemäß Page Visibility API im Hintergrund `hidden`; Scroll-/IntersectionObserver-/Timerverhalten ist plattformabhängig und live ungeprüft. B bräuchte zusätzlich `tabHide` und vorherigen Nutzerhinweis; Firefox benachrichtigt beim ersten Verstecken. Keine solche Berechtigung oder Implementierung, keine Stealth-Garantie und keine Konsolen-Berechtigungsumgehung.
- Historische **4.926/4.926** sind ein Nutzervergleich, kein erwarteter Zähler für heutige Scans. Die originale WL-Vollständigkeitsprüfung und sämtliche Schreibgates bleiben unverändert.

Vertrag, getrennte Abnahmekriterien und Grenzen: [M3.2](docs/M3.2.md). Keine Live-DOM-Aufnahme oder angemeldeter Zen-Test verfügbar.

## M3: Grenzen des nativen Schreibpiloten

Der Adapter bedient ausschließlich YouTubes nativen **Save/Speichern-Dialog** mit isolierten unterstützten Renderern. Zusätzlich zur URL muss genau ein sichtbarer `ytd-watch-flexy` die angeforderte `video-id` tragen; der Save-Button muss darin liegen. **Die URL allein reicht nicht.** Keine internen Properties, Tokens oder APIs.

**Alle Playlist-Identitäten, auch WL, verlangen einen expliziten Playlist-Link innerhalb derselben Checkbox-Option.** Für Entfernen ist `/playlist?list=WL` erforderlich; „Watch later“ / „Später ansehen“ als Label allein ist niemals Identitätsbeleg (eine eigene Playlist könnte genauso heißen). Ohne WL-Link kein Remove. `getAvailablePlaylists` zeigt nicht identifizierbare Zeilen jetzt ausdrücklich als Diagnose mit `id: null`, `identity: unverified` und `writable: false`. Das neue Save-Sheet liefert Namen und `aria-pressed`, aber keine belastbare ID-Zuordnung im gemeldeten DOM; Schreiben bleibt gesperrt. Viele aktuelle YouTube-Varianten enthalten diese Links nicht: Dann können **sämtliche Mutationen nicht unterstützt** sein, nicht nur der Archiv-Picker. Das ist eine konservative technische Grundlage mit **fail closed**, keine bestätigte Live-Kompatibilität. Titelzuordnung und manuelle Archiv-URL sind kein Bypass.

`getPlaylistMembership` öffnet auf Adapterebene einen frischen Dialog. Erst die Extension-Bridge erzwingt vor **jeder** Mitgliedschaftsbeobachtung einen neuen vollständigen Seitenladevorgang (**immer** Hard-Reload mit `bypassCache: true`, auch nach Navigation zu einem anderen Video), damit nicht nur eine optimistisch gesetzte Checkbox desselben SPA-Zustands bestätigt wird. Das ist kein unabhängiger serverseitiger Nachweis und noch keine Live-Kompatibilitätsgarantie.

Nur die **erweiterte Legacy-Aktion „Playlists aus YouTube laden (Save-Dialog, Vordergrund)“** und der Schreib-Ausführungsbutton öffnen ausdrücklich einen **eigenen aktiven YouTube-Arbeitstab**. Diesen während des Vorgangs aktiv und das Fenster fokussiert lassen; kein wiederkehrender Autofokus, keine automatische Reaktivierung. Der ursprüngliche Watch-Later-Tab bleibt zur unabhängigen Kontrolle erhalten. Dieser Legacy-Arbeitstab bleibt nach Abschluss ebenfalls offen. Davon getrennt sind der neue Feedscan „Playlists aktualisieren“ und der WL-Import: inaktive markierte Arbeitstabs mit own-only Cleanup, siehe M3.2.

Archivieren prüft das schreibbare Ziel frisch, fügt nur bei Bedarf hinzu und verlangt **erneut frisches `present` vor der WL-Entfernung**, auch wenn das Ziel schon vorhanden war. Bereits extern aus WL verschwundene Videos sind `already_absent`, keine eigene erfolgreiche Änderung. `verified` ist daher nicht automatisch „LaterSift hat etwas geändert“. Mutationen liefern `{ changed: boolean }`; ein No-op zählt auch nach erfolgreicher Zustandsprüfung nicht als tatsächliche Pilotänderung.

Unterbrechung: persistiertes `running` wird beim Laden zu `unknown`. Keine automatische Wiederholung oder Startausführung; eine erneute Ausführung benötigt neue ausdrückliche Freigabe und alle Preflights. `failed`/`unknown` sind ausdrücklich erneut auswählbar: zuerst manuell in YouTube prüfen, dann neu auswählen und **neue Zustimmung** geben; `verified` bleibt gesperrt. Widerspricht frische Evidenz einem bereits verifizierten Schritt, stoppt die Entscheidung als `unknown` zur manuellen Klärung: diesen Schritt nicht erneut ausführen; auch neue Zustimmung überschreibt diese Sperre nicht. Nicht durch Bearbeiten des Speichers umgehen. Lokales Undo stellt YouTube nicht wieder her.

`storage.claimExecution` ist an der Executor-Grenze verpflichtend: atomarer Abgleich des vollständigen Snapshot-Datensatzes und des aktuellen kanonischen Library-Stands (CAS), Reservierung und separater Replay-Schutz unter `state` → `execution-ledger`, ohne DB-Versionswechsel. Veraltete Klone und wiederverwendete Freigaben werden vor jedem Adapteraufruf abgewiesen; UI-Gates allein genügen nicht. Zusätzlich fragt das Content Script **vor jeder Mutation** per Runtime-Nachricht den Background um Erlaubnis. Dieser prüft eigene Extension, YouTube-Sender und exakte Video-ID; Storage verlangt die exakt aktive beanspruchte Freigabe, persistierten laufenden WAL-Versuch, Snapshot/Export und ein atomar einmaliges Permit pro Versuch. Ein bloßes Bridge-Freigabeobjekt ohne beanspruchten WAL-Zustand erlaubt keinen Klick. Der Background autorisiert nur, führt keine Jobs oder Klicks aus.

Während eines Vorgangs sind Schließen/Escape gesperrt. Unmount trennt den Port und unterbindet späte Panel-Commits; Fortschritt zeigt aktuelle Entscheidung und `verified`/`failed`/`unknown`-Zahlen, nicht nur eine Erfolgszahl.

Das Limit steigt **nicht automatisch**: erst nach tatsächlich geänderter, verifizierter und vom Nutzer direkt in YouTube geprüfter Entscheidung ausdrücklich von **1 auf 5**, nach vollständig verifizierter 5er-Stufe mit neuem Änderungsnachweis ausdrücklich auf **25**. Mocks oder ein bloßes `already_absent` sind kein Live-Nachweis.

## Entwicklung und Prüfung

```sh
pnpm dev                    # nur UI; echte Bridge nur als Add-on
pnpm check
pnpm lint
pnpm format:check
pnpm test                   # synthetische DOM-/Executor-/Speichertests
pnpm build
pnpm lint:extension
pnpm exec playwright install --with-deps chromium firefox
pnpm test:ui                # lokale Fixtures, keine Live-Mutationen
pnpm test:firefox-extension # frisches Profil, Installations-Smoke-Test
pnpm package                # artifacts/latersift-0.2.4-unsigned.xpi
```

Historische lokale Prüffolge für 0.2.0 (aktuelle M3.1-Ergebnisse: [STATUS.md](docs/STATUS.md)): Check (0 Fehler/Warnungen), Lint/Format, **466/466 Vitest-Tests in 14 Dateien**, **48/48 UI-Tests in Chromium/Firefox**, Produktionsbuild, Web-ext (0 Fehler/Warnungen/Hinweise), echte MV3-Installation von `dist` und finaler XPI in Firefox 157 sowie Paketbau. Darunter sechs vollständige Integrationstests mit realem Executor, IndexedDB, Autorisierung, Transport und nativem Adapter gegen **synthetisches DOM, ohne YouTube-Mutation**. Der CI-Nachweis wird nach Veröffentlichung im [Lieferstatus](docs/STATUS.md) verlinkt. DOM-/UI-Fixtures sind keine Live-M3-Abnahme. Für Chromium optional `LATERSIFT_CHROMIUM_PATH=/usr/bin/chromium`; Browserdateien optional über `PLAYWRIGHT_BROWSERS_PATH`. Der Firefox-Smoke-Test nutzt Mozillas RDP auf einem lokalen zufälligen Port und ein frisches Profil, nicht das normale Browserprofil.

### Scanstatus / Diagnose

`running`, `waiting`, `needs_attention` zeigen laufenden Import bzw. Warte-/Aufmerksamkeitsbedarf; `complete` geprüfte Vollständigkeit, `interrupted` Unterbrechung, `incomplete` Teilimport, `failed` Fehler. UI-Fortschritt folgt bestätigten Checkpoints. Fortsetzen bewahrt im selben Dokument bestätigte IDs/Scrollposition; nach Reload/Generationwechsel beginnt die Anfahrt bei 0 mit frischen Positionsbelegen, ohne Servercursor. Kein automatischer Scanstart beim Laden.

„Arbeitstab-Diagnose (ohne URL-Parameter)“ steht für Feed und WL bereits vor Katalog bzw. erstem Checkpoint zur Verfügung: nur feste Enums und freigegebene Pfadkategorien, keine IDs, Hashwerte oder vollständigen URLs. `unknown`/Timeout belegt keine Anmeldung oder Consent-Seite; auf fremden Hosts kann die URL wegen fehlender Host-Berechtigung unsichtbar sein. `pendingUrl` ist kein erforderlicher oder positiver Readiness-Beleg. Details: [M3.2.1](docs/M3.2.1.md).

„Import-Diagnose (ohne Video-Metadaten)“ liefert Anzahl, erwartete Zahl, Status, Zeiten, Lücken und Recovery-/Scrollbefunde, nicht Video-Metadaten, `confirmedVideoIds` oder Generationstoken. Für Fehlerberichte Diagnose statt privatem Backup verwenden. Hintergrundscan ist nicht garantiert; „YouTube-Tab aktivieren ↗“ aktiviert nur auf Klick.

## Sicherheit und verbleibende Grenzen

Library-Daten, Entscheidungen und Schreibjournal liegen lokal in IndexedDB. Der neue Playlist-Katalog (einschließlich vorheriger stale Einträge) und das separate Arbeitstab-Journal liegen dagegen im Extension-`localStorage`; sie sind nicht Teil des bisherigen JSON-Backups. `unlimitedStorage` erweitert die übliche Origin-Quote, schützt nicht vor voller Platte. Ein Editor pro Extension-Origin per Web Lock und ein separater Writer-Lock schützen vor paralleler Bearbeitung. Speicherung muss bestätigt sein; Fehler stoppen den Fortschritt. Die Event Page öffnet die App und prüft atomare Mutationserlaubnisse; sie führt keine Schreibjobs oder Klicks aus.

Unveränderte Rechte: nur `unlimitedStorage`, Host `https://www.youtube.com/*`; kein `cookies`, kein `tabs`-Vollzugriff, keine zusätzlichen Privilegien. Die Host-Berechtigung trägt Import und ausdrücklich freigegebene native DOM-Bedienung. Keine OAuth-Schlüssel oder internen YouTube-APIs. Extension-CSP: eigene Netzwerkverbindungen verboten (`connect-src 'none'`). Thumbnails können gewöhnliche Anfragen an YouTube-Bildhosts auslösen (ohne Referrer); keine Übertragung an zusätzliche Dienste.

DOM-Unterstützung ist begrenzt und kann durch YouTube-Änderungen ausfallen. Der Scan ist keine transaktional eingefrorene Serverliste. Reguläre Titel/Thumbnails belegen keine Abspielbarkeit; unbekannt bleibt unbekannt. Keine Alters-/Regionsumgehung. Export enthält persönliche Metadaten, garantiert aber keine Wiederherstellung entfernter/privater Inhalte. Kein Retention-Dialog, kein Backup-Import, keine KI/Ollama.

## Quellen / Lizenz

- [Firefox MV3 Event Pages](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background)
- [YouTube: Watch Later nicht über playlistItems.list abrufbar](https://developers.google.com/youtube/v3/docs/playlistItems/list)
- [Zen: Erweiterungen](https://docs.zen-browser.app/user-manual/extensions)
- [Temporäre Installation](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/)
- [Signierung und Verteilung](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)

[Repository](https://github.com/almighty-atlas/latersift) · [MIT](LICENSE). Nächste Abnahmeschritte: **rein lesender Feedscan und separat experimenteller WL-Hintergrundimport in Zen** ([M3.2.1-Diagnose zuerst](docs/M3.2.1.md), dann [M3.2](docs/M3.2.md)); die erweiterte Sheet-Diagnose bleibt erhalten. Keine Freigabe für echte Schreibtests in M3.2. Bei nicht unterstützter Struktur stoppen, keine Prüfungen lockern oder Klicks erzwingen; technischen Fehler mit sparsamem, bereinigtem DOM-Kontext melden, nicht mit vollständigem privatem Seiten-DOM. Es wurden keine eigenen Live-Schreibaktionen ausgeführt.
