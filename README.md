# LaterSift

**Swipe through your Watch Later backlog.**

Lokale Firefox-/Zen-Erweiterung, um die YouTube-Playlist „Später ansehen“ Karte für Karte durchzusehen. TypeScript strict, Svelte 5, Firefox Manifest V3, IndexedDB, MIT. Kein Server, keine Telemetrie, keine KI.

> **0.1.0 ist ein installierbarer Read-only-Teilstand, kein fertiges schreibendes MVP.** Der verpflichtende M1-Nachweis an einer echten angemeldeten Watch-Later-Liste fehlt. Deshalb wurden YouTube-Schreiboperationen gemäß der Meilenstein-Vorgabe noch nicht implementiert. „Entfernen“ und „Archivieren“ speichern ausschließlich lokale Vormerkungen. Es gibt keinen Anwenden-Schalter und keine simulierten YouTube-Erfolge.

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
3. **„Temporäres Add-on laden…“** wählen und `dist/manifest.json` auswählen. Alternativ die unsignierte `artifacts/latersift-0.1.0-unsigned.xpi` auswählen.
4. Falls Firefox nach Website-Berechtigungen fragt, Zugriff auf `https://www.youtube.com` erlauben. Ggf. im Erweiterungsmenü den Zugriff auf YouTube aktivieren. Ein bereits offener YouTube-Tab muss nach dem Laden der Erweiterung neu geladen werden.
5. Erweiterungsmenü → **LaterSift** öffnet die Arbeitsoberfläche. Alternativ ist `Alt+Shift+L` als Kürzel vorgeschlagen (unter „Erweiterungen verwalten → Tastenkombinationen“ anpassbar; tatsächliche Shortcut-Auslösung in Zen manuell prüfen).
6. „Watch Later importieren“ → „YouTube öffnen“. Im eigenen Browser anmelden und `https://www.youtube.com/playlist?list=WL` öffnen. Dann LaterSift → „Tabs aktualisieren“ → richtigen Tab auswählen → „Read-only-Import starten“.
7. YouTube-Tab während des Scans geöffnet lassen und nicht darin navigieren. Bei fehlenden Einträgen ggf. YouTubes „Nicht verfügbare Videos anzeigen“ im Playlist-Menü aktivieren und neu scannen. Der Adapter klickt nicht selbst auf YouTube-Menüs.
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
pnpm package             # artifacts/latersift-0.1.0-unsigned.xpi
```

Für ein vorhandenes Chromium optional `LATERSIFT_CHROMIUM_PATH=/usr/bin/chromium` setzen. Playwright-Browser können mit `PLAYWRIGHT_BROWSERS_PATH` in einen beschreibbaren Ordner gelegt werden. Die Firefox-Extension-Prüfung prüft die temporäre Installation (keine UI-/YouTube-E2E-Prüfung) und nutzt ausschließlich ein frisches Testprofil und Mozillas Remote Debugging Protocol auf einem lokalen zufälligen Port. Kein Zugriff auf das normale Browserprofil.

Ausführliche automatisierte und manuelle Testabläufe: [docs/TESTING.md](docs/TESTING.md).

## Bekannte Einschränkungen

- Kein angemeldeter YouTube-/Zen-Live-Test. DOM-Fixtures belegen keine Kompatibilität mit allen aktuellen YouTube-Varianten. Zukünftige UI-Änderungen benötigen Adapteranpassungen.
- Keine YouTube-Schreibaktionen, Playlist-Auflistung oder Mitgliedschaftsprüfung. Keine Freigabe einer Sitzung zum Anwenden. Vollständiges MVP daher noch offen.
- DOM-Import unterstützt Desktop-`ytd-playlist-video-renderer`, bekannte Header-Anzeigen in Deutsch/Englisch und ganzzahlige, nicht abgekürzte Videozahlen. Nicht unterstützte Strukturen/Sprachen ergeben Teilimport oder erklärten Fehler.
- Bei unbekannter Gesamtzahl, fehlenden Positionen, verborgenem Inhalt, kaputten Links oder Videos ohne ID wird keine Vollständigkeit behauptet. Solche nicht identifizierbaren Zeilen sind nur als Diagnose-Anzahl dokumentiert; ihre Metadaten können nicht vollständig gesichert werden.
- Reguläre Titel/Thumbnails bestätigen keine Abspielbarkeit. Deshalb bleibt der Status meist **unbekannt**. Nur explizite Hinweise erlauben privat/gelöscht/eingeschränkt. Kein Player-Probezugriff, keine Alters-/Regionsumgehung. Nicht gelistet bedeutet nicht unverfügbar.
- Ein Snapshot spiegelt Beobachtungen während des Scans, keine transaktional eingefrorene YouTube-Liste. Nicht gleichzeitig manuell umsortieren oder bearbeiten.
- Ein Neustart des Imports beginnt oben; bereits gesicherte Scans und Entscheidungen bleiben erhalten. Kein serverseitiger Fortsetzungscursor. Nach maximal 1.200 Durchläufen (mindestens etwa 20 Minuten plus Speicherzeiten) wird pausiert/als unvollständig beendet.
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

Öffentliches Repository: [almighty-atlas/latersift](https://github.com/almighty-atlas/latersift). Der Quellcode wird über die verbundene GitHub-App veröffentlicht; die GitHub-CLI-Authentifizierung dieser Entwicklungsumgebung ist weiterhin ungültig.

## Lizenz und nächste Schritte

[MIT](LICENSE). Nächster verbindlicher Schritt: M1 im angemeldeten Zen Browser nach [Testanleitung](docs/TESTING.md) bestätigen. Erst anschließend: einzeln überprüfte Playlist-Schreibadapter, sequenzielles Operationsjournal mit Sitzungsgenehmigung, Archiv-Mitgliedschaft prüfen vor Entfernung, Wiederaufnahme unbekannter Zustände. Optionale lokale Empfehlungen können später die kleine `VideoRecommendationProvider`-Schnittstelle nutzen; keine KI im MVP.
