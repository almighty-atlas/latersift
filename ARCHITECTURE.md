# Architektur

Eine Extension-Seite statt Overlay: Svelte muss keine YouTube-Komponenten verändern. Ein ausgewählter normaler YouTube-Tab bleibt für den Read-only-Adapter geöffnet. Firefox MV3 Event Page (`background.scripts`, gemäß MV3 standardmäßig nicht persistent) startet ausschließlich die App; sie führt keine Jobs oder Schreibaktionen aus.

```text
YouTube-DOM → YouTubeAdapter → Content Script
                                  ↕ Runtime.Port (Checkpoint / ACK)
                            Extension-Seite (Svelte)
                                  ↕
                             IndexedDB / JSON
```

## Module

- `src/adapter/dom.ts`: ID-/Metadatenparser, konservative Verfügbarkeit, Header-Anzahl. Keine privaten Seitenobjekte oder internen HTTP-Endpunkte.
- `src/adapter/scanner.ts`: pure Scansteuerung mit injizierter DOM-/Zeit-/Scrollumgebung. Sammelt IDs auch dann, wenn alte Zeilen aus dem DOM verschwinden. Vollständigkeit benötigt bekannte Anzahl, gleiche Anzahl frisch bestätigter eindeutiger IDs, Positionen 1…N ohne Konflikte, keine unidentifizierten Zeilen, keine Continuation und mindestens 3 Sekunden stabile Evidenz. Fehlende Continuation allein beendet den Scan nicht.
- `src/adapter/youtube.ts`, `types.ts`: gekapselte Adaptergrenze mit expliziten Fähigkeiten. `write`, `membership` und `playbackCheck` sind `false`.
- `src/adapter/scroll.ts`: sucht vom Playlist-Renderer aus den nächsten tatsächlich scrollbaren Vorfahren (`overflow-y: auto|scroll`, Inhalt größer als Viewport); Fallback ist `document.scrollingElement`. Kein Scrollen eines beliebigen Kindes oder blind des Fensters. Schritt: `max(400, round(clientHeight × 0.85))` px, begrenzt auf das Ende, ohne Animation. Recovery geht nur am Ende (2 px Toleranz) einen Schritt zurück; die nächste reguläre Bewegung nähert sich dem Ladebereich erneut. Abseits des Endes geht sie regulär vorwärts.
- `src/content.ts`: ausschließlich Lesen, Scrollen, Abbruch und Kommunikation mit eigener Extension-ID. Ein Scan pro Tab. Zufälliges Dokument-Generationstoken per `crypto.randomUUID()`, invalidiert bei `yt-navigate-start`, `popstate` und `pagehide`. Ein Generationwechsel unterbricht den Scanner auch dann, wenn die URL weiterhin Watch Later bezeichnet. Keine Klicks, keine Schreibnachrichten.
- `src/bridge.ts`: Port-Verbindung, serialisierte Speicherung vor ACK. Bei einem Checkpoint keine nächste Scanrunde vor bestätigtem Speicher-Commit; ACK-Timeout im Content Script: 15 Sekunden. Tab-/Fensteraktivierung nur nach explizitem Nutzerklick, nicht durch den Scanner. Disconnect pausiert; letzter bestätigter Checkpoint bleibt.
- `src/storage.ts`: IndexedDB-Struktur bleibt **Version 1**, mit `state` (Schlüssel `library`: Library mit Scans, Session, Entscheidungen, Archivziel) und `snapshots` (vollständige Scans, Schlüssel `id`). Das Library-Dokument wird von `schemaVersion: 1` auf **2** migriert, ohne Store-Upgrade. Entscheidungen und vollständige Snapshots bleiben erhalten. Beim Laden werden `running`, `waiting`, `needs_attention` zu `interrupted`, ohne automatischen Neustart. Ein vollständiger Snapshot und sein Bibliotheksindex werden atomar geschrieben; Teilcheckpoints ersetzen keinen vollständigen Snapshot. Keine Speicherung im flüchtigen Background.
- `src/session.ts`: Sitzungen, Filter, Entscheidungen mit UUID, Undo, lokale Bereinigung. `currentVideo` ist aus persistiertem Zustand ableitbar. Zurückstellen bleibt innerhalb derselben Runde übersprungen. Ein erneuter vollständiger Scan ersetzt den aktuellen Bestand, aber nicht Entscheidungen oder alte Snapshots. Teilscans ergänzen den Bestand seit dem letzten vollständigen Scan.
- `src/App.svelte`: UI mit Web Lock als Single-Writer-Sperre; Mutationen erst nach Commit sichtbar. Fehler brechen die konkrete Mutation ab. Deutsche Statuslabels in `i18n.ts`, weitere UI-Texte direkt deutsch (noch keine vollständige Lokalisierung).

## Invarianten

1. Keine YouTube-Schreiboperation ist in 0.1.1 (M1.1) verfügbar. Ein Neustart kann daher keine Löschung auslösen.
2. Ein Button-Klick oder ein gespeichertes Swipe ist kein YouTube-Erfolg. Alle lokalen Absichten sind `pending`; `verified` wird niemals erzeugt.
3. Archiventscheidungen speichern die konkrete Ziel-ID zum Entscheidungszeitpunkt; spätere Zieländerungen schreiben bestehende Entscheidungen nicht um.
4. Keine automatische Entfernung unbekannter, eingeschränkter oder lediglich nicht gelisteter Videos.
5. Speicherung bestätigt Entscheidungen, nicht deren Anwendung auf YouTube. Fehler beim Speichern lassen die Karte aktiv.
6. Undo betrifft nur lokale `pending`-Entscheidungen. Kein vorgetäuschtes Wiederherstellen angewendeter Änderungen.
7. Vorherige Scans bleiben als Provenienz erhalten. Eine aus YouTube verschwundene ID wird niemals automatisch als erfolgreich entfernt markiert.

## Skalierung / Grenzen

### M1.1: Zustände und Defaults

`running → waiting` nach 8 Sekunden sichtbarem Stillstand an der Ladegrenze; bei verborgenem Dokument nach 8 Sekunden ohne neue bestätigte IDs stattdessen `needs_attention`. Sichtbarer Stillstand (`stallMs`) und verborgene Ruhezeit (`hiddenQuietMs`) werden getrennt geführt. Neuer ID-Fortschritt setzt Stillstand, Aufmerksamkeitsepisode und Recovery-Zähler zurück. Aktivierung setzt diese Episodenzähler ebenfalls zurück, nicht aber die kumulierte Aufmerksamkeitszeit. Terminale Zustände: `complete`, `interrupted`, `incomplete`, `failed`. Navigation weg von Watch Later oder ein Generationwechsel unterbricht. Fehlende unterstützte Struktur ohne gesammelte Videos kann nach ausgeschöpfter Recovery `failed` ergeben; ein nicht belegbar vollständiger Bestand bleibt `incomplete`.

| Parameter                  | Default / Verhalten                                                                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pollintervall              | 1.000 ms plus ggf. Speicher-/ACK-Zeit                                                                                                                                                                |
| Warten                     | 8.000 ms sichtbarer Stillstand an der Ladegrenze bzw. verborgene Ruhezeit ohne neue bestätigte IDs                                                                                                   |
| Recovery                   | Bei sichtbarem Dokument an der Ladegrenze alle 20.000 ms Stillstand, höchstens 3 Versuche ohne Fortschritt                                                                                           |
| Stillstandsende            | Sichtbar, mindestens 90.000 ms Stillstand: an der Ladegrenze nach 3 Recoveries `recovery_exhausted`, bei blockierter Anfahrt `scroll_unreachable`                                                    |
| Aufmerksamkeit             | 120.000 ms je Aufmerksamkeitsepisode oder kumuliert 600.000 ms pro Scanner-Aufruf, danach `incomplete` mit `attention_timeout`; gezählt wird verborgene Ruhezeit oberhalb der 8.000-ms-Warteschwelle |
| Aktives Budget             | `min(7.200.000, 300.000 + bestätigte IDs × 1.000)` ms; wächst mit beobachteten IDs, nicht mit Polls                                                                                                  |
| Vollständigkeitsberuhigung | 3.000 ms stabile vollständige Evidenz ohne Continuation                                                                                                                                              |
| Sicherheitsgrenze          | 100.000 Durchläufe, kein normales Vollständigkeitskriterium                                                                                                                                          |
| Checkpoints                | Anfang/Zustandswechsel/Ende; bei geänderter ID-Anzahl nach mindestens 100 zusätzlichen IDs **oder** 5.000 ms seit Speicherung; sonst spätestens nach 15.000 ms                                       |

Zeitmessung nutzt eine monotone Uhr (`performance.timeOrigin + performance.now()`) und tatsächliche `visibilitychange`-Ereignisse, auch zwischen gedrosselten Timer-Aufrufen. Verborgene Zeit zählt nicht als aktive Zeit oder sichtbarer Stillstand. Aktive Zeit umfasst sichtbare Speicher-/Wartezeiten, nicht nur CPU-Arbeit. Das Pollintervall beträgt mindestens eine Sekunde; es gibt kein Acht-Runden-Abbruchkriterium.

Die tatsächliche Anfahrt durch bereits vorhandene Zeilen ist von Boundary-Recovery getrennt: Solange der Scrollwert vor der Ladegrenze vorwärtskommt, wird sichtbarer Stillstand zurückgesetzt. Diese Anfahrt darf länger als 90 Sekunden dauern (innerhalb des aktiven Budgets). Bleibt das Scrollen vor der Grenze 90 Sekunden blockiert, endet der Teilimport mit `scroll_unreachable`, ohne drei Boundary-Recoveries vorauszusetzen. Ein frischer Scan oder Fortsetzen nach Reload/Generationwechsel setzt den Scrollcontainer auf 0; Fortsetzen in derselben Generation bewahrt die Scrollposition.

Alle Zeitbudgets starten je Scanner-Aufruf neu, auch beim Fortsetzen. UI-Zahlen folgen bestätigten Checkpoints, nicht jedem DOM-Poll. Checkpoints bleiben vollständige Datenstände mit serieller Persistierung und ACK; M1.1 reduziert ihre Häufigkeit, führt kein Delta-Protokoll ein.

### Ursachen des bisherigen Teilimports und Grenzen

0.1.0 konnte nach acht ruhigen Durchläufen ohne Continuation vorzeitig `incomplete` beenden: Ein zeitweise fehlender Ladeindikator beweist nicht, dass YouTube fertig ist. Scrollen des falschen Kindes bzw. Fensters statt des tatsächlichen Containers konnte den Ladebereich verfehlen. Vollständige Checkpoints in jeder Sekundenrunde samt serialisierter Speicherung/ACK bildeten zudem einen mit dem Bestand wachsenden Flaschenhals. Diese Codepfade motivieren M1.1; ihr jeweiliger Anteil am Nutzerbefund ist nicht live isoliert nachgewiesen. Hintergrund-Throttling bleibt eine Hypothese, keine bewiesene Ursache.

IDs werden in einer Map gesammelt. Snapshots und Scans verbrauchen mit jeder neuen Bestandsaufnahme zusätzlichen lokalen Platz. `unlimitedStorage` ist keine Garantie gegen volle Datenträger. Es gibt bislang keinen Retention-/Löschdialog; regelmäßiger Export bleibt sinnvoll.

YouTube kann die Liste während des Scans verändern. Die Vollständigkeitsprüfung ist eine DOM-basierte Plausibilitätsprüfung und kein atomarer Server-Snapshot. Geänderte Reihenfolge oder fehlende Angaben führen konservativ zum Teilimport. Fortsetzen übernimmt Scan-ID und gesicherte Videos. `confirmedVideoIds` speichert die bestätigten IDs separat von allen aufbewahrten `videos`. Nur bei gleichem zufälligem Generationstoken werden ausschließlich diese gespeicherten Belege übernommen; aufbewahrte IDs ohne Bestätigung zählen nicht als frische Evidenz. Diese ID-Liste ist Bestandteil des gespeicherten Scans/Backups, nicht der metadatenfreien UI-Diagnose. Nach Reload/neuem Dokument bleiben IDs erhalten, aber Anzahl und Positionen müssen erneut im aktuellen DOM bestätigt werden; ein vollständiger Snapshot enthält ausschließlich diese frische Evidenz. Ändert sich die Header-Zahl, werden Positionsbelege verworfen. Ein neuer Import legt einen neuen Scan an; es gibt weder Servercursor noch eine Garantie, exakt an einer Serverposition weiterzumachen.

## M3, erst nach echtem M1-Nachweis

Geplante Adapteroperationen: Playlists über sichtbaren Speichern-Dialog auflisten, Zugehörigkeit frisch beobachten, Ziel hinzufügen, Dialog erneut öffnen und Ziel prüfen, erst danach den konkreten Watch-Later-Eintrag entfernen. Für belastbare Verifikation sind zusätzlich ein Reload und erneute Ziel-/Watch-Later-Prüfung nötig; die Abwesenheit in einem Teilimport beweist keine Entfernung. Selektoren und Bestätigungen müssen an einer eigenen angemeldeten Testliste einzeln geprüft werden.

Geplantes Operationsjournal: persistierte UUID, `pending → running → verified | failed | unknown`, sowie Archivschritt/Ziel. Nur explizit genehmigte Session, vollständiger Snapshot vor erster Mutation, ein Executor, begrenzte Retries mit Backoff. `running` nach Unterbrechung wird `unknown`; vor Wiederholung aktuelle Mitgliedschaft überprüfen. Bereits vor Beginn fehlende Watch-Later-Mitgliedschaft wird als externer Zustand gemeldet und nicht als eigener Erfolg gezählt. Fehlendes Hinzufügen verbietet Entfernen.

Diese Schreiblogik ist **ein Implementierungsplan**, kein getesteter oder vorhandener Adapter. Keine öffentlich verfügbare API kann für Watch Later als verlässliche Alternative behauptet werden. Die offizielle Data API scheidet aus, undokumentierte Innertube-Endpunkte wurden nicht verwendet. Keine Architekturabhängigkeit von Chromium-Service-Workern, Ollama oder Cloud.
