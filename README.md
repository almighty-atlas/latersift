# LaterSift

**Swipe through your Watch Later backlog.**

Lokale Firefox-/Zen-Erweiterung, um die YouTube-Playlist „Später ansehen“ Karte für Karte durchzusehen. TypeScript strict, Svelte 5, Firefox Manifest V3, IndexedDB, MIT. Kein Server, keine Telemetrie, keine KI.

> **0.1.1 (M1.1) ist ein Read-only-Teilstand, kein fertiges schreibendes MVP.** Der verpflichtende M1-Nachweis an einer echten angemeldeten Watch-Later-Liste fehlt. Deshalb wurden YouTube-Schreiboperationen gemäß der Meilenstein-Vorgabe noch nicht implementiert. „Entfernen“ und „Archivieren“ speichern ausschließlich lokale Vormerkungen. Es gibt keinen Anwenden-Schalter und keine simulierten YouTube-Erfolge.

## Funktionsumfang

- Eigene responsive Arbeitsoberfläche mit einer zentralen Videokarte, Rundeneinstellungen im Dialog, Dark Mode, Maus-/Touch-Swipe, Pfeiltasten, Fokusmarkierung und reduzierter Bewegung.
- Read-only-DOM-Adapter im ausgewählten YouTube-Tab; Lazy Loading, IDs zusammenführen, Virtualisierung, begrenzte Laufzeit, pausierbarer Scan mit bestätigten IndexedDB-Checkpoints.
- Vollständigkeit wird nur bei passender YouTube-Gesamtzahl, eindeutigen Video-IDs, lückenlosen Positionen und beendetem Nachladen bestätigt. Sonst ausdrücklich Teilimport.
- JSON-Export aller gespeicherten Scans inklusive Metadaten, Originalplaylist, Scan-Zeit und lokalen Entscheidungen. Frühere vollständige Snapshots werden erhalten.
- Persistente Runden (Standard 25, 1–5.000), Entfernen/Archivieren lokal vormerken, Zurückstellen für spätere Runden, Undo, Pause, Wiederaufnahme und Zusammenfassung.
- Archivziel als bestehende PL…-Playlist-URL hinterlegen. Existenz, Schreibbarkeit und Zugehörigkeit werden **nicht** geprüft.
- Separater Bereinigungsmodus: explizit als privat/gelöscht markierte Einträge auswählen und nach einer Bestätigung lokal vormerken. Unbekannte/eingeschränkte Videos werden nicht automatisch ausgewählt.
- Filter auf Listenposition, bekannte Dauer, eindeutige Nichtverfügbarkeit und zurückgestellte Einträge. Listenposition wird nicht als Alter ausgegeben.

Verifizierungsstand und offene Arbeiten: [docs/STATUS.md](docs/STATUS.md). Architektur: [ARCHITECTURE.md](ARCHITECTURE.md).

## Temporär in Zen / Firefox installieren

Voraussetzung: Desktop-Firefox oder ein darauf basierender Zen ab Gecko **142**. Zen auf CachyOS benötigt keine distributionsspezifische Integration.

1. Repository lokal öffnen und mit Node.js 22.12+ oder 24 und pnpm 11 bauen:
   ```sh
   pnpm install --frozen-lockfile
   pnpm check
   pnpm test
   pnpm build
   pnpm package
   ```
2. In Zen/Firefox `about:debugging#/runtime/this-firefox` öffnen (alternativ `about:debugging` → „Dieser Firefox“).
3. **„Temporäres Add-on laden…“** wählen und `dist/manifest.json` auswählen. Alternativ nach erfolgreichem Paketbau die unsignierte `artifacts/latersift-0.1.1-unsigned.xpi` auswählen. Das Paketskript leitet den Dateinamen dynamisch aus der Manifestversion ab und prüft deren Übereinstimmung mit der Paketversion.
4. Falls Firefox nach Website-Berechtigungen fragt, Zugriff auf `https://www.youtube.com` erlauben. Ggf. im Erweiterungsmenü den Zugriff auf YouTube aktivieren. Ein bereits offener YouTube-Tab muss nach dem Laden der Erweiterung neu geladen werden.
5. Erweiterungsmenü → **LaterSift** öffnet die Arbeitsoberfläche. Alternativ ist `Alt+Shift+L` als Kürzel vorgeschlagen (unter „Erweiterungen verwalten → Tastenkombinationen“ anpassbar; tatsächliche Shortcut-Auslösung in Zen manuell prüfen).
6. „Watch Later importieren“ → „YouTube öffnen“. Im eigenen Browser anmelden und `https://www.youtube.com/playlist?list=WL` öffnen. Dann LaterSift → „Tabs aktualisieren“ → richtigen Tab auswählen → „Read-only-Import neu starten“.
7. YouTube-Tab während des Scans geöffnet und möglichst aktiv lassen; nicht darin navigieren oder die Liste bearbeiten. Das ist zuverlässiger als ein Hintergrundscan, der **nicht garantiert** ist. „YouTube-Tab aktivieren ↗“ aktiviert den Tab und fokussiert sein Fenster ausschließlich auf deinen Klick, niemals automatisch. Bei „Aufmerksamkeit erforderlich“ YouTube aktivieren; nach beendetem Teilimport „Fortsetzen / erneut versuchen“ wählen. Bei fehlenden Einträgen ggf. YouTubes „Nicht verfügbare Videos anzeigen“ selbst im Playlist-Menü aktivieren. Der Adapter klickt nicht auf YouTube-Menüs.
8. Scanstatus prüfen, JSON-Backup exportieren und eine Runde starten. Alle Entscheidungen bleiben in dieser Version lokal.

Temporäre Add-ons werden beim Browser-Neustart entfernt. Zum Wiederladen dieselbe Erweiterungs-ID und denselben Build-Ordner verwenden. Daten können bei Entfernen/Neuinstallation oder Profilwechsel verloren gehen; vor Neustart/Entfernen exportieren. Session-Wiederaufnahme funktioniert bei erhaltenem Extension-Speicher (Tab schließen/erneut öffnen, Reload). Die Erhaltung bei temporärem Entfernen/Browser-Neustart ist **nicht garantiert**. Für zuverlässigen Dauerbetrieb benötigt es ein dauerhaft installiertes Add-on.

### Dauerhafte Installation / AMO

Die XPI ist ein echtes ZIP-Add-on-Paket, aber **unsigniert**. Normales Firefox Release/ESR verlangt für dauerhafte Installation eine Mozilla-Signatur; die konkrete Zen-Distribution muss separat geprüft werden. Das temporäre Laden über `about:debugging` ist der Entwicklungsweg. Für Verteilung: Quellcode/Build-Anleitung bereitstellen, mit `web-ext lint` prüfen, auf [AMO Developer Hub](https://addons.mozilla.org/developers/) als gelistetes oder ungelistetes Add-on einreichen und signieren lassen. Review von Host-Berechtigung, generiertem Svelte-Code und Datenschutzerklärung vorbereiten. Keine Signierung oder AMO-Veröffentlichung wurde durchgeführt.

## Entwicklung und Tests

```sh
pnpm install --frozen-lockfile
pnpm dev                 # nur UI; YouTube-Bridge funktioniert nur als Add-on
pnpm check
pnpm lint
pnpm format:check
pnpm test                # DOM-/Sitzungs-/IndexedDB-Tests
pnpm build
pnpm lint:extension
pnpm exec playwright install --with-deps chromium firefox
pnpm test:ui             # lokale Fixtures in Chromium und Firefox
pnpm test:firefox-extension  # temporäre Installation des echten MV3-Add-ons
pnpm package             # artifacts/latersift-0.1.1-unsigned.xpi
```

Für ein vorhandenes Chromium optional `LATERSIFT_CHROMIUM_PATH=/usr/bin/chromium` setzen. Playwright-Browser können mit `PLAYWRIGHT_BROWSERS_PATH` in einen beschreibbaren Ordner gelegt werden. Die Firefox-Extension-Prüfung prüft die temporäre Installation (keine UI-/YouTube-E2E-Prüfung) und nutzt ausschließlich ein frisches Testprofil und Mozillas Remote Debugging Protocol auf einem lokalen zufälligen Port. Kein Zugriff auf das normale Browserprofil.

Ausführliche automatisierte und manuelle Testabläufe: [docs/TESTING.md](docs/TESTING.md).

### Scanstatus, Fortsetzen und Diagnose

- `running`: Import läuft; `waiting`: Warten auf YouTube; `needs_attention`: Hintergrundtab stockt, Nutzeraktivierung erforderlich. `complete` bedeutet vollständig geprüft; `interrupted` bedeutet unterbrochen/pausiert, `incomplete` Teilimport und `failed` fehlgeschlagen. Die UI zeigt nur bestätigte lokale Checkpoints, Anzahl/Prozent und Zeit seit dem letzten Fortschritt.
- „Import pausieren“ sichert einen Teilbestand. „Fortsetzen / erneut versuchen“ verwendet den letzten nicht vollständigen Scan mit vorhandenen IDs. In derselben YouTube-Dokumentgeneration bleiben separat gespeicherte Bestätigungen (`confirmedVideoIds`) und Scrollposition erhalten. Nach Reload/neuer Generation beginnt die Anfahrt bei Scrollposition 0 und Positionen werden frisch geprüft. `yt-navigate-start`, `popstate` und `pagehide` invalidieren die Generation; ein laufender Scan wird bei Generationwechsel unterbrochen. Das ist **kein serverseitiger Cursor**. Ein neuer Import legt einen neuen Scan an.
- „Import-Diagnose (ohne Video-Metadaten)“ → „Diagnose kopieren“ liefert JSON mit Anzahl, erwarteter Gesamtzahl (`expectedCount`), Status, letzter Fortschrittszeit, Sichtbarkeit, Grund, höchster bestätigter Position, den ersten höchstens 100 fehlenden Positionen, Recovery-Anzahl und -Ergebnissen, Positionskonflikt, aktiver Zeit, episodischer und kumulierter Aufmerksamkeitszeit, Scrollgeometrie, Continuation und bestätigter Anzahl. Weder Video-Metadaten noch `confirmedVideoIds` oder das Generationstoken werden in diese Diagnose aufgenommen. Für Fehlerberichte diese Diagnose statt privater Backups verwenden.

## Bekannte Einschränkungen

- Nutzer-Live-Befund für 0.1.0 in Zen/CachyOS: erwartet 4.926, importiert 4.686, höchste Position 4.686, unidentifizierbare Zeilen 0, Status `incomplete`. Nach Aktivierung gab es bei etwa 1.000 Einträgen wieder Fortschritt; Tab-Throttling ist eine unbewiesene Hypothese. Keine erfolgreiche M1-Abnahme und noch keine Live-Abnahme von 0.1.1. DOM-Fixtures garantieren keine Live-Kompatibilität.
- Keine YouTube-Schreibaktionen, Playlist-Auflistung oder Mitgliedschaftsprüfung. Keine Freigabe einer Sitzung zum Anwenden. Vollständiges MVP daher noch offen.
- DOM-Import unterstützt Desktop-`ytd-playlist-video-renderer`, bekannte Header-Anzeigen in Deutsch/Englisch und ganzzahlige, nicht abgekürzte Videozahlen. Nicht unterstützte Strukturen/Sprachen ergeben Teilimport oder erklärten Fehler.
- Bei unbekannter Gesamtzahl, fehlenden Positionen, verborgenem Inhalt, kaputten Links oder Videos ohne ID wird keine Vollständigkeit behauptet. Solche nicht identifizierbaren Zeilen sind nur als Diagnose-Anzahl dokumentiert; ihre Metadaten können nicht vollständig gesichert werden.
- Reguläre Titel/Thumbnails bestätigen keine Abspielbarkeit. Deshalb bleibt der Status meist **unbekannt**. Nur explizite Hinweise erlauben privat/gelöscht/eingeschränkt. Kein Player-Probezugriff, keine Alters-/Regionsumgehung. Nicht gelistet bedeutet nicht unverfügbar.
- Ein Snapshot spiegelt Beobachtungen während des Scans, keine transaktional eingefrorene YouTube-Liste. Nicht gleichzeitig manuell umsortieren oder bearbeiten.
- Scrollen erfolgt schrittweise im ermittelten Playlist-Scrollcontainer: 85 % seiner sichtbaren Höhe, mindestens 400 px. Die Anfahrt durch vorhandene Zeilen darf bei tatsächlichem Scrollfortschritt länger als 90 Sekunden dauern; blockiertes Scrollen vor der Ladegrenze endet nach 90 Sekunden mit `scroll_unreachable`. Davon getrennte, begrenzte Boundary-Recovery geht am Ende einen solchen Schritt zurück und nähert sich anschließend regulär wieder an. Fehlende Continuation allein beweist kein Listenende. Fortschrittsabhängige Laufzeit-, Stillstands- und Aufmerksamkeitsbudgets begrenzen den Scan; genaue Defaults stehen in [ARCHITECTURE.md](ARCHITECTURE.md).
- Kein Wiedereinlesen von JSON-Backups und keine automatische Wiederherstellung. Der Export garantiert keine Wiederherstellbarkeit entfernter oder privater YouTube-Inhalte.
- Ein aktiver Editor pro Extension-Origin mittels Web Lock; weitere Tabs verweigern Bearbeitung. Speicherung erfolgt erst nach erfolgreicher IndexedDB-Transaktion. Nicht gespeicherte Entscheidungen werden nicht als gespeichert angezeigt.

## Sicherheit und Datenschutz

Playlist-Daten, Entscheidungen und Sessions verbleiben in IndexedDB im Browserprofil. `unlimitedStorage` verhindert die übliche kleine Origin-Quote bei großen Snapshots; Festplatten-/Speicherfehler bleiben möglich und stoppen den Fortschritt. Ausschließlich `https://www.youtube.com/*` als Host-Berechtigung. Kein `cookies`, kein `tabs`-Vollzugriff, keine externen OAuth-Zugangsdaten, Tokens, internen YouTube-APIs oder Drittanbieter-Datenbanken. Host-Berechtigung erlaubt das Finden der passenden YouTube-Tabs und das Content Script. Die Event Page öffnet nur die App.

Thumbnails können vom YouTube-Bildhost geladen werden (ohne Referrer). Dadurch entstehen gewöhnliche Anfragen an YouTube, aber keine Übertragung deiner Playlist an einen zusätzlichen Dienst. Die Extension-CSP verbietet eigene Netzwerkverbindungen (`connect-src 'none'`), erlaubt lokale Skripte und die beiden YouTube-Bildhosts. Exporte enthalten persönliche Playlist-Metadaten und sollten entsprechend aufbewahrt werden.

## Technische Quellen

Geprüft am 17.10.2026:

- [MDN: Firefox MV3 nutzt Background-Scripts / Event Pages](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background) – keine Chromium-Service-Worker-Abhängigkeit.
- [Google: Watch Later ist über playlistItems.list nicht abrufbar](https://developers.google.com/youtube/v3/docs/playlistItems/list).
- [Zen: Firefox-Erweiterungen und Add-on-Installation](https://docs.zen-browser.app/user-manual/extensions).
- [Mozilla: Temporäre Installation](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/).
- [Mozilla: Signieren und Verteilen](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

Öffentliches Repository: [almighty-atlas/latersift](https://github.com/almighty-atlas/latersift). Die GitHub-CLI-Authentifizierung ist nach aktuellem Stand gültig; die frühere Aussage über ungültige Authentifizierung ist überholt. Daraus folgt keine Aussage über einen CI-Lauf oder eine Veröffentlichung von 0.1.1.

## Lizenz und nächste Schritte

[MIT](LICENSE). Nächster verbindlicher Schritt: M1 im angemeldeten Zen Browser nach [Testanleitung](docs/TESTING.md) bestätigen. Erst anschließend: einzeln überprüfte Playlist-Schreibadapter, sequenzielles Operationsjournal mit Sitzungsgenehmigung, Archiv-Mitgliedschaft prüfen vor Entfernung, Wiederaufnahme unbekannter Zustände. Optionale lokale Empfehlungen können später die kleine `VideoRecommendationProvider`-Schnittstelle nutzen; keine KI im MVP.
