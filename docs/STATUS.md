# Lieferstatus / Evidenz

Stand: 17.10.2026. **Read-only-Vorabversion 0.1.0; vollständiges MVP nicht abgeschlossen.**

| Meilenstein | Implementiert                                                                                                                                        | Noch offen                                                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1          | MV3-Event-Page, Build, Content-Script-DOM-Adapter, Lazy-Loading-/Virtualisierungs-Scan, bestätigte Checkpoints, Vollständigkeitsprüfung, JSON-Export | Tatsächlichen angemeldeten YouTube-Bestand vollständig scannen und lokal exportieren; Zen/CachyOS-Live-Abnahme                                                        |
| M2          | Swipe-Karten, drei lokale Entscheidungen, persistente UUIDs, Undo, Runden, Pause/Resume, Tastatur und Pointer, Fortschritt                           | Tatsächliche Archivierung ist keine M2-Funktion; echte Touch-Hardware manuell prüfen                                                                                  |
| M3          | Explizite Schreibsperre und Fähigkeitenmodell; Archivziel lokal hinterlegen                                                                          | Playlist-Auflistung, Zugehörigkeit, Hinzufügen, Entfernen, Verifikation, genehmigter Executor, Retry/Backoff und sichere Wiederaufnahme von Schreiboperationen fehlen |
| M4          | Konservative Statusauswertung, separate bestätigte lokale Bereinigung, grundlegende Filter, Dokumentation, Tests, unsigniertes XPI                   | Echte Bereinigungsmutationen sind Teil von M3; Signierung/AMO-Veröffentlichung fehlen                                                                                 |

## Was wurde versucht?

- Offizielle Quellen zu Firefox-MV3, Zen-Erweiterungen und YouTube-Data-API geprüft. Google dokumentiert `watchLaterNotAccessible`; daher keine OAuth-/Data-API-Integration.
- Sichtbare DOM-Struktur als isolierten Adapter implementiert. Keine Innertube-/internen Endpunkte, keine extrahierten Tokens, keine Cookie-Exporte.
- Vollständigkeit mit Header-Zahl, IDs und Positionen statt bloßem Scrollende prüfen. Synthetic DOM-Fixtures decken geänderte Struktur, Leerzustand und 5.000 virtualisierte Einträge ab.
- Build in echtem Firefox-Testbrowser temporär installieren und separat UI in Firefox/Chromium testen. Die zusätzliche Playwright-Navigation auf `moz-extension://…/index.html` blieb im Testbrowser bei `about:blank` hängen (Timeout); auch der Versuch über ein synthetisches Tastenkürzel öffnete keinen automatisierbaren Tab. Daher ist das kein bestandener Extension-UI-/Import-E2E-Test. Der separate Installations-Smoke-Test und die lokalen Browser-UI-Tests sind davon getrennt. Öffnen über das echte Erweiterungssymbol und der Content-Script-zu-UI-Datenfluss müssen im Zen Browser geprüft werden.
- `gh auth status` geprüft: bereitgestellte GitHub-CLI-Authentifizierung ungültig. Auf ausdrücklichen Wunsch wird der lokale Stand über die verbundene GitHub-App in das vorhandene leere öffentliche Repository `almighty-atlas/latersift` übertragen. Bestehende Repository-Inhalte werden nicht überschrieben.

## Was ist live verifiziert?

**Keine Funktion an einer echten angemeldeten YouTube-Sitzung.** Es wurden keine echten Playlists gelesen, archiviert, gelöscht oder verändert. Eine echte YouTube-Anmeldung steht dieser Ausführungsumgebung nicht zur Verfügung. Synthetische Testdaten sind keine Live-Evidenz.

Die verpflichtende Reihenfolge „M1 tatsächlich auslesen/sichern, erst danach Schreiboperationen implementieren“ begrenzt die Lieferung. M3 wurde deshalb nicht durch einen scheinbar erfolgreichen Mock oder durch einen ungetesteten produktiven DOM-Klickadapter ersetzt. Die Benutzeroberfläche benennt diese Grenze ständig.

## Automatisierte Validierung

Lokale Ergebnisse: **33/33 Vitest-Tests**, **10/10 Playwright-UI-Tests** (5 je Browser), TypeScript/Svelte ohne Fehler/Warnungen, ESLint und Formatprüfung erfolgreich. Produktionsbuild und XPI erstellt. Mozilla `web-ext lint`: **0 Fehler, 0 Warnungen, 0 Hinweise**. Temporäre Installation in Playwright-Firefox **157.0** bestätigt, ohne Manifestwarnungen; Background nicht persistent. CI-Datei erstellt, aber kein GitHub-CI-Lauf ausgeführt.

- TypeScript/Svelte-Prüfung und ESLint.
- Vitest: Import, 5.000-Video-Fixture, Verfügbarkeit, Sessions, Undo, IndexedDB und persistiertes ACK-Protokoll.
- Playwright: fünf UI-Szenarien jeweils in Chromium und Firefox.
- Firefox-Extension-Smoke-Test: echtes temporäres Add-on, isoliertes Testprofil, ohne YouTube-Navigation.
- Produktionsbuild, Mozilla `web-ext lint`, unsigniertes XPI-Paket.

Diese Prüfungen ersetzen **nicht** den angemeldeten M1-Live-Nachweis. Der konkrete nächste Schritt steht in [TESTING.md](TESTING.md#m1-verpflichtender-angemeldeter-zen-live-test).

## Fehlende technische Schritte für das vollständige MVP

1. M1 anhand einer echten langen Watch-Later-Liste in Zen erfolgreich abnehmen. Falls der aktuelle DOM-Adapter abweicht, Selektoren und Header-Erkennung anhand eigener Live-Beobachtung korrigieren und Fixtures ergänzen.
2. Verlässliche Playlist-Auswahl und Mitgliedschaftsprüfung über YouTubes Speichern-Dialog implementieren und isoliert live testen.
3. Erst dann Hinzufügen und Entfernen mit persistiertem Unterzustand, serieller Ausführung und frischer Verifikation implementieren. Lokales vollständiges Snapshot und ausdrückliche Sitzungsgenehmigung erzwingen.
4. Fehler, Rate Limits, Timeout nach Mutation und Browser-Unterbrechung mit frischer Zustandsprüfung vor begrenzten Wiederholungen testen.
5. Signed Add-on für dauerhafte Installation und Wiederaufnahme über echte Browser-Neustarts prüfen; anschließend optional AMO.

Keine derzeitige Aussage garantiert eine automatische Wiederherstellung aus dem JSON-Export. Kein Feature implementiert KI/Ollama oder externe Datenübertragung.
