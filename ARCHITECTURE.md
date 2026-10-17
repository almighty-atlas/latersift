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
- `src/adapter/scanner.ts`: pure Scansteuerung mit injizierter DOM-/Zeit-/Scrollumgebung. Sammelt IDs auch dann, wenn alte Zeilen aus dem DOM verschwinden. Vollständigkeit benötigt bekannte Anzahl, gleiche Anzahl eindeutiger IDs, Positionen 1…N, keine unidentifizierten Zeilen und mindestens acht ruhige Durchläufe ohne Continuation.
- `src/adapter/youtube.ts`, `types.ts`: gekapselte Adaptergrenze mit expliziten Fähigkeiten. `write`, `membership` und `playbackCheck` sind `false`.
- `src/content.ts`: ausschließlich Lesen, Scrollen, Abbruch und Kommunikation mit eigener Extension-ID. Ein Scan pro Tab. Keine Klicks, keine Schreibnachrichten.
- `src/bridge.ts`: Port-Verbindung, serialisierte Speicherung vor ACK. Keine nächste Scanrunde vor bestätigtem Speicher-Commit. Disconnect pausiert; letzter bestätigter Checkpoint bleibt.
- `src/storage.ts`: IndexedDB v1, `state` (Library mit Scans, Session, Entscheidungen, Archivziel) und `snapshots` (vollständige Scans). Ein Snapshot und sein Bibliotheksindex werden atomar geschrieben. Keine Speicherung im flüchtigen Background.
- `src/session.ts`: Sitzungen, Filter, Entscheidungen mit UUID, Undo, lokale Bereinigung. `currentVideo` ist aus persistiertem Zustand ableitbar. Zurückstellen bleibt innerhalb derselben Runde übersprungen. Ein erneuter vollständiger Scan ersetzt den aktuellen Bestand, aber nicht Entscheidungen oder alte Snapshots. Teilscans ergänzen den Bestand seit dem letzten vollständigen Scan.
- `src/App.svelte`: UI mit Web Lock als Single-Writer-Sperre; Mutationen erst nach Commit sichtbar. Fehler brechen die konkrete Mutation ab. Deutsche Statuslabels in `i18n.ts`, weitere UI-Texte direkt deutsch (noch keine vollständige Lokalisierung).

## Invarianten

1. Keine YouTube-Schreiboperation ist in 0.1.0 verfügbar. Ein Neustart kann daher keine Löschung auslösen.
2. Ein Button-Klick oder ein gespeichertes Swipe ist kein YouTube-Erfolg. Alle lokalen Absichten sind `pending`; `verified` wird niemals erzeugt.
3. Archiventscheidungen speichern die konkrete Ziel-ID zum Entscheidungszeitpunkt; spätere Zieländerungen schreiben bestehende Entscheidungen nicht um.
4. Keine automatische Entfernung unbekannter, eingeschränkter oder lediglich nicht gelisteter Videos.
5. Speicherung bestätigt Entscheidungen, nicht deren Anwendung auf YouTube. Fehler beim Speichern lassen die Karte aktiv.
6. Undo betrifft nur lokale `pending`-Entscheidungen. Kein vorgetäuschtes Wiederherstellen angewendeter Änderungen.
7. Vorherige Scans bleiben als Provenienz erhalten. Eine aus YouTube verschwundene ID wird niemals automatisch als erfolgreich entfernt markiert.

## Skalierung / Grenzen

5.000 IDs werden in einer Map gesammelt. Der Scanner schreibt vollständige Checkpoints pro Runde, höchstens eine Runde pro Sekunde plus Speicherzeit; bewusst einfach statt komplexem Cursor-Protokoll. Snapshots und Scans verbrauchen mit jeder neuen Bestandsaufnahme zusätzlichen lokalen Platz. `unlimitedStorage` ist keine Garantie gegen volle Datenträger. Es gibt bislang keinen Retention-/Löschdialog; regelmäßiger Export bleibt sinnvoll.

YouTube kann die Liste während des Scans verändern. Die Vollständigkeitsprüfung ist eine DOM-basierte Plausibilitätsprüfung und kein atomarer Server-Snapshot. Geänderte Reihenfolge oder fehlende Angaben führen konservativ zum Teilimport. Der Neuimport startet oben; das Speichern und Weiterverwenden bereits bestätigter Daten ist implementiert, ein exakt an einer Serverposition fortgesetzter Import nicht.

## M3, erst nach echtem M1-Nachweis

Geplante Adapteroperationen: Playlists über sichtbaren Speichern-Dialog auflisten, Zugehörigkeit frisch beobachten, Ziel hinzufügen, Dialog erneut öffnen und Ziel prüfen, erst danach den konkreten Watch-Later-Eintrag entfernen. Für belastbare Verifikation sind zusätzlich ein Reload und erneute Ziel-/Watch-Later-Prüfung nötig; die Abwesenheit in einem Teilimport beweist keine Entfernung. Selektoren und Bestätigungen müssen an einer eigenen angemeldeten Testliste einzeln geprüft werden.

Geplantes Operationsjournal: persistierte UUID, `pending → running → verified | failed | unknown`, sowie Archivschritt/Ziel. Nur explizit genehmigte Session, vollständiger Snapshot vor erster Mutation, ein Executor, begrenzte Retries mit Backoff. `running` nach Unterbrechung wird `unknown`; vor Wiederholung aktuelle Mitgliedschaft überprüfen. Bereits vor Beginn fehlende Watch-Later-Mitgliedschaft wird als externer Zustand gemeldet und nicht als eigener Erfolg gezählt. Fehlendes Hinzufügen verbietet Entfernen.

Diese Schreiblogik ist **ein Implementierungsplan**, kein getesteter oder vorhandener Adapter. Keine öffentlich verfügbare API kann für Watch Later als verlässliche Alternative behauptet werden. Die offizielle Data API scheidet aus, undokumentierte Innertube-Endpunkte wurden nicht verwendet. Keine Architekturabhängigkeit von Chromium-Service-Workern, Ollama oder Cloud.
