# Lieferstatus / Evidenz

Stand: 17.10.2026. **M1.1 / 0.1.1: Read-only-Korrekturstand lokal erfolgreich geprüft; vollständiges MVP nicht abgeschlossen.**

| Meilenstein | Implementierter Umfang                                                                                                                        | Noch offen                                                                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| M1          | DOM-Import, Lazy Loading/Virtualisierung, bestätigte Checkpoints, Vollständigkeitsprüfung, Backup                                             | Erfolgreichen vollständigen angemeldeten Scan und Export live bestätigen                                                                     |
| M1.1        | Fortschritts-/Aufmerksamkeitszustände, begrenzte Recovery, Scrollcontainer-Erkennung, reduzierte Checkpoint-Frequenz, Fortsetzen und Diagnose | Erneute Zen/CachyOS-Live-Prüfung mit 4.926 Einträgen                                                                                         |
| M2          | Swipe-Karten, lokale Entscheidungen, UUIDs, Undo, Runden, Pause/Resume, Tastatur/Pointer                                                      | Echte Touch-Hardware manuell prüfen; Archivierung ist keine lokale M2-Funktion                                                               |
| M3          | Schreibsperre und Fähigkeitenmodell; Archivziel lokal hinterlegen                                                                             | Playlist-Auswahl, Mitgliedschaft, Hinzufügen, Entfernen, Verifikation, genehmigter Executor, Retry/Backoff und sichere Wiederaufnahme fehlen |
| M4          | Konservative Verfügbarkeit, bestätigte lokale Bereinigung, Filter, Dokumentation, Testinfrastruktur                                           | Echte Bereinigungsmutationen benötigen M3; Signierung/AMO fehlen                                                                             |

## Nutzer-Live-Befund: 0.1.0, Zen auf CachyOS

Der Nutzer hat einen echten angemeldeten Import versucht und folgenden Teilimport gemeldet:

| Messwert                                        | Befund       |
| ----------------------------------------------- | ------------ |
| Erwartete YouTube-Gesamtzahl                    | 4.926        |
| Importierte eindeutige IDs                      | 4.686        |
| Höchste beobachtete Position                    | 4.686        |
| Unidentifizierbare Zeilen (`unknown` im Befund) | 0            |
| Endstatus                                       | `incomplete` |

Es fehlen damit 240 Einträge gegenüber der erwarteten Zahl. Die Null bezieht sich auf nicht identifizierbare Zeilen, **nicht** auf die Verfügbarkeit aller Videos. Bei etwa 1.000 Einträgen wurde nach Aktivierung des YouTube-Tabs wieder Fortschritt beobachtet. Das ist ein Zusammenhang, kein isolierter Nachweis von Browser-/Tab-Throttling.

Dies ersetzt die frühere Aussage „keine echte Playlist gelesen“: Es gibt Nutzer-Live-Evidenz für einen fehlgeschlagenen Vollständigkeitsnachweis. Es gibt **keine erfolgreiche M1-Abnahme** und **keine Live-Abnahme von 0.1.1**. Der Agent hat keine eigene angemeldete YouTube-Sitzung geprüft. Es wurden keine YouTube-Schreiboperationen implementiert oder als erfolgreich ausgegeben.

## Ursachenanalyse und M1.1

- Die alte Regel „acht ruhige Durchläufe und keine Continuation“ konnte einen Teilimport vorzeitig beenden. Ein fehlender Ladeindikator ist kein Nachweis eines fertigen Bestands.
- Scrollen des falschen Kindes bzw. Fensters konnte den tatsächlichen Playlist-Scrollcontainer und damit das Nachladen verfehlen. M1.1 ermittelt den scrollbaren Vorfahren und bewegt ihn um 85 % seines Viewports, mindestens 400 px. Recovery geht am Ende einen Schritt zurück, danach regulär wieder vorwärts.
- Vollständige Checkpoints pro Sekundenrunde mit serieller Speicherung vor ACK waren ein wachsender Flaschenhals. M1.1 behält sichere vollständige Checkpoints, reduziert aber deren Frequenz nach Fortschritt/Zeit und speichert Zustandswechsel/Ende.
- `waiting` und `needs_attention` unterscheiden sichtbaren Stillstand und stockenden Hintergrundtab. Nutzeraktivierung erfolgt ausschließlich per Klick; zuverlässiger Hintergrundscan wird nicht versprochen. Genaue Budgets: [Architektur](../ARCHITECTURE.md#m11-zustände-und-defaults).
- Fortsetzen nutzt separat gespeicherte Evidenz (`confirmedVideoIds`), keinen Servercursor. Gleiche Dokumentgeneration: nur diese Belege und die Scrollposition bleiben erhalten. Reload/neue Generation: IDs bleiben aufbewahrt, Scrollposition wird auf 0 gesetzt und Positionsbelege werden frisch erhoben. `yt-navigate-start`, `popstate` und `pagehide` invalidieren die Generation; der Scanner unterbricht bei Generationwechsel.
- Anfahrt durch vorhandene Zeilen und Boundary-Recovery sind getrennt. Tatsächlicher Scrollfortschritt darf länger als 90 Sekunden dauern; blockierte Anfahrt endet nach 90 Sekunden mit `scroll_unreachable`. Sichtbarer Stillstand und verborgene Ruhezeit werden mit monotoner Uhr und tatsächlichen Sichtbarkeitsereignissen getrennt gemessen.
- Aufmerksamkeit ist auf 120 Sekunden je Episode und kumuliert 600 Sekunden je Scanner-Aufruf begrenzt. Das aktive Budget beträgt `min(7.200.000, 300.000 + bestätigte IDs × 1.000)` ms. Mindestens eine Sekunde Pollintervall, kein Acht-Runden-Abbruch. Diagnose enthält auch erwartete Zahl, Recovery-Ergebnisse, Positionskonflikt und aktive/episodische/kumulierte Aufmerksamkeitszeiten, aber keine Video-Metadaten oder bestätigten ID-Listen.
- Library-Schema 1 wird auf 2 migriert, IndexedDB-Struktur bleibt Version 1. Lokale Entscheidungen und vollständige Snapshots bleiben erhalten; laufende Zustände werden beim Laden unterbrochen.

Die Codepfade erklären Risiken der bisherigen Implementierung. Ihr individueller Anteil am Live-Befund ist nicht nachgewiesen; insbesondere bleibt Throttling eine Hypothese.

## Automatisierte Validierung

Lokale vollständige Prüffolge für M1.1 / 0.1.1 am 17.10.2026 erfolgreich ausgeführt:

- `pnpm check`: 0 Fehler, 0 Warnungen; `pnpm lint` und `pnpm format:check` erfolgreich.
- `pnpm test`: **95/95 Tests** in sechs Dateien, einschließlich 4.686 → 4.926, 5.000 virtualisierten Einträgen, Resume und Sichtbarkeits-Grenzfällen.
- `pnpm test:ui`: **32/32 Tests**, je 16 in Chromium und Firefox.
- `pnpm test:firefox-extension`: echtes MV3-Add-on in Firefox **157.0** temporär installiert, ohne Manifestwarnungen; kein angemeldeter YouTube-E2E-Test.
- `pnpm build` und `pnpm lint:extension`: Produktionsbuild erfolgreich; Mozilla-Lint **0 Fehler, 0 Warnungen, 0 Hinweise**.
- `pnpm package`: `artifacts/latersift-0.1.1-unsigned.xpi` erstellt. Der Dateiname folgt der Manifestversion; Abweichungen von `package.json` stoppen die Paketierung.
- Zusätzlich die fertige **0.1.1-XPI** mit `LATERSIFT_ADDON_PATH=artifacts/latersift-0.1.1-unsigned.xpi node scripts/test-firefox.mjs` erfolgreich in Firefox installiert.
- `git diff --check` erfolgreich.

Die vorhandene CI prüft bereits alle geforderten Schritte: Installation, TypeScript/Svelte, ESLint, Format, Vitest, Build, `web-ext lint`, Browserinstallation, UI-Tests, Firefox-Add-on-Smoke-Test und Paketbau samt Artefakt-Upload. Sie wird bei Push/Pull Request ausgelöst; der Lauf nach dem Push steht aus. **Kein CI-Erfolg ist hier behauptet.** Ergebnisse sind nach tatsächlicher Ausführung für den endgültigen Stand zu protokollieren. Reproduktionsplan und Resume-A/B-Prüfung: [TESTING.md](TESTING.md).

Synthetische DOM- und Browser-Fixtures sind keine Live-Evidenz. Der Firefox-Smoke-Test prüft Installation/Manifest/Background, nicht den angemeldeten Import. Historische Versuche, die Extension-UI über automatisierte `moz-extension://`-Navigation bzw. synthetisches Kürzel zu öffnen, lieferten keinen bestandenen Extension-UI-/Import-E2E-Test.

## Weitere Einordnung

- Offizielle Quellen zu Firefox-MV3, Zen und YouTube-Data-API wurden geprüft; `watchLaterNotAccessible` schließt den offiziellen Watch-Later-API-Abruf aus. Keine internen Endpunkte, Cookie-Exporte oder extrahierten YouTube-Tokens.
- **Korrektur zur Historie:** Die frühere Aussage über ungültige `gh`-Authentifizierung ist überholt; die GitHub-CLI-Authentifizierung ist heute gültig. Das beweist weder Veröffentlichung noch CI-Erfolg. Öffentliches Repository: [almighty-atlas/latersift](https://github.com/almighty-atlas/latersift).
- Die Reihenfolge bleibt: M1 tatsächlich vollständig auslesen/sichern, erst danach M3-Schreiboperationen implementieren. Kein Mock-Erfolg ersetzt diese Grenze.

## Nächste Schritte

1. GitHub-CI des Feature-Branches/PR prüfen und nur nach grünen Prüfungen mergen.
2. Den 4.926er-Befund mit aktivem YouTube-Tab reproduzieren, Hintergrund-/Aktivierungsbeobachtung und Resume A/B prüfen. Diagnose-JSON statt privater Exporte teilen.
3. Erst nach vollständigem Live-Scan und lokal überprüftem Export: Playlist-Auswahl/Mitgliedschaft und anschließend genehmigte, einzeln verifizierte Schreiboperationen entwickeln.
4. Signiertes dauerhaftes Add-on und Wiederaufnahme über echte Browser-Neustarts prüfen; danach optional AMO.

Kein Backup-Import/Restore, keine garantierte Wiederherstellung, keine KI/Ollama. Alle Entfernen-/Archivieren-Entscheidungen bleiben lokal; keine YouTube-Writes.
