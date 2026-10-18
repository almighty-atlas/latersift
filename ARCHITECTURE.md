# Architektur

**0.2.2 / M3.1:** Neue Save-Sheets sind rein lesend unterstützt; Identitäten ohne Zeilenlink bleiben unbestätigt, alle Sheet-Mutationen gesperrt. [Vertrag und Identitätsbewertung](docs/M3.1.md).

Die Header-Version stammt aus dem installierten WebExtension-Manifest. Die rein lesende Playlist-Abfrage ergänzt ihre bestehende Port-Antwort um einen bereinigten, flüchtigen Diagnosebericht, auch bei Adapterfehlern. Ein optionaler Adapter-Callback liefert ihn vor dem Legacy-Dialogschluss; die Bridge reicht ihn an die App weiter. `src/dialog-diagnostics.ts` beschränkt Felder, Attributnamen und Fehler-/Sperrgründe auf ein festes Schema, ohne Namen, IDs, Attributwerte, DOM oder rohe Fehlertexte. Keine zusätzlichen Nachrichten, Netzwerke, Berechtigungen oder Datenbankschemata. [Vertrag und Zen-Test](docs/DIALOG-DIAGNOSTICS.md).

**Bisheriger Stand:** M1 ist nutzerbestätigt (Live-Import 4.926/4.926, `complete`, vollständiges JSON lokal gespeichert, nachdem „Nicht verfügbare Videos anzeigen“ die fehlenden 240 sichtbar machte). Kein eigener automatisierter Live-Nachweis des Agenten. M3 ist implementiert, aber **experimentell, vorläufig und noch nicht live abgenommen**; tatsächliche YouTube-Kompatibilität bleibt offen.

Eine Extension-Seite statt Overlay: Svelte muss keine YouTube-Komponenten verändern. Ein ausgewählter YouTube-Tab bleibt für den Read-only-Import geöffnet. Ein separater aktiver Arbeitstab dient der ausdrücklich angeforderten nativen Dialogbedienung. Firefox MV3 Event Page (`background.scripts`, gemäß MV3 standardmäßig nicht persistent) öffnet die App und autorisiert auf Anfrage einzelne Mutationsversuche; sie führt keine Jobs oder DOM-Klicks aus.

```text
YouTube-DOM → YouTubeAdapter → Content Script
                                  ↕ Runtime.Port (Checkpoint / ACK)
                            Extension-Seite (Svelte)
                                  ↕
                             IndexedDB / JSON

OperationsPanel → Freigabe → Executor ↔ IndexedDB (Write-ahead-Journal)
                               ↕
                         Write-Bridge → eigener YouTube-Arbeitstab
                               ↕
                         Write-Content → nativer Save-Dialog
```

## Module

- `src/adapter/dom.ts`: ID-/Metadatenparser, konservative Verfügbarkeit, Header-Anzahl. Keine privaten Seitenobjekte oder internen HTTP-Endpunkte.
- `src/adapter/scanner.ts`: pure Scansteuerung mit injizierter DOM-/Zeit-/Scrollumgebung. Sammelt IDs auch dann, wenn alte Zeilen aus dem DOM verschwinden. Vollständigkeit benötigt bekannte Anzahl, gleiche Anzahl frisch bestätigter eindeutiger IDs, Positionen 1…N ohne Konflikte, keine unidentifizierten Zeilen, keine Continuation und mindestens 3 Sekunden stabile Evidenz. Fehlende Continuation allein beendet den Scan nicht.
- `src/adapter/youtube.ts`, `types.ts`: gekapselte **Scanadapter**-Grenze. Dort bleiben `write`, `membership` und `playbackCheck` ausdrücklich `false`; Schreiben ist eine separate `WriteAdapter`-Schnittstelle in `operations.ts`, keine Erweiterung dieses Fähigkeitsversprechens.
- `src/adapter/scroll.ts`: sucht vom Playlist-Renderer aus den nächsten tatsächlich scrollbaren Vorfahren (`overflow-y: auto|scroll`, Inhalt größer als Viewport); Fallback ist `document.scrollingElement`. Kein Scrollen eines beliebigen Kindes oder blind des Fensters. Schritt: `max(400, round(clientHeight × 0.85))` px, begrenzt auf das Ende, ohne Animation. Recovery geht nur am Ende (2 px Toleranz) einen Schritt zurück; die nächste reguläre Bewegung nähert sich dem Ladebereich erneut. Abseits des Endes geht sie regulär vorwärts.
- `src/content.ts`: Lesen, Scrollen, Abbruch und Kommunikation mit eigener Extension-ID; installiert zusätzlich den getrennten Schreibkanal aus `write-content.ts`. Scan und Schreibauftrag teilen eine Busy-/Abbruch-Sperre. Ein Scan pro Tab. Zufälliges Dokument-Generationstoken per `crypto.randomUUID()`, invalidiert bei `yt-navigate-start`, `popstate` und `pagehide`. Ein Generationwechsel unterbricht den Scanner auch dann, wenn die URL weiterhin Watch Later bezeichnet. Der Scanpfad klickt nicht; native Dialogaktionen laufen ausschließlich über den separaten Schreibkanal.
- `src/bridge.ts`: Port-Verbindung, serialisierte Speicherung vor ACK. Bei einem Checkpoint keine nächste Scanrunde vor bestätigtem Speicher-Commit; ACK-Timeout im Content Script: 15 Sekunden. Tab-/Fensteraktivierung nur nach explizitem Nutzerklick, nicht durch den Scanner. Disconnect pausiert; letzter bestätigter Checkpoint bleibt.
- `src/storage.ts`: IndexedDB-Struktur bleibt **Version 1**, mit `state` (Schlüssel `library`: Library mit Scans, Session, Entscheidungen, Archivziel) und `snapshots` (vollständige Scans, Schlüssel `id`). Das Library-Dokument wird von `schemaVersion: 1` oder `2` auf **3** migriert, ohne Store-Upgrade; Operationszustand und Journal ergänzen das Dokument. Entscheidungen und vollständige Snapshots bleiben erhalten. Beim Laden werden Scan-Zustände `running`, `waiting`, `needs_attention` zu `interrupted`; laufende Operationsschritte, Entscheidungen und Durchläufe werden von `running` zu `unknown`. Kein automatischer Neustart oder Retry. Ein vollständiger Snapshot und sein Bibliotheksindex werden atomar geschrieben; Teilcheckpoints ersetzen keinen vollständigen Snapshot. Zusätzlich liegt das separate Replay-Ledger unter `state` → `execution-ledger`, ohne neuen Store oder DB-Versionswechsel. Keine Speicherung im flüchtigen Background.
- `src/session.ts`: Sitzungen, Filter, Entscheidungen mit UUID, Undo, lokale Bereinigung. `currentVideo` ist aus persistiertem Zustand ableitbar. Zurückstellen bleibt innerhalb derselben Runde übersprungen. Ein erneuter vollständiger Scan ersetzt den aktuellen Bestand, aber nicht Entscheidungen oder alte Snapshots. Teilscans ergänzen den Bestand seit dem letzten vollständigen Scan.
- `src/App.svelte`: UI mit Web Lock als Single-Writer-Sperre; Mutationen erst nach Commit sichtbar. Fehler brechen die konkrete Mutation ab. Native Playlist-Abfrage nur auf ausdrücklichen Button-Klick; manuelles Archivziel bleibt eine unbestätigte lokale ID. Deutsche Statuslabels in `i18n.ts`, weitere UI-Texte direkt deutsch.
- `src/OperationsPanel.svelte`: Zusammenfassung mit leerer Vorauswahl, Pilotlimit 1, exakten Aktionen/Video-IDs/Ziel-URLs und separaten Add-/Remove-Status. `persistedSnapshot` prüft den tatsächlich gespeicherten vollständigen Snapshot; Exportbestätigung ist an dessen ID gebunden. Erst konkrete Zustimmung und Ausführungsbutton erzeugen eine Freigabe. `failed`/`unknown` können nach manueller Prüfung neu ausgewählt und neu freigegeben werden, `verified` nicht. Fortschritt zählt Ergebnisse nach Status und zeigt die aktuelle Entscheidung. Während Busy sind Schließen/Escape gesperrt; Unmount schließt den Port und verhindert späte Panel-Commits. Stoppen gilt nach der aktuellen vollständigen Entscheidung, nicht zwischen Add und Remove.
- `src/operations.ts`: `WriteAdapter`, Mitgliedschaftsevidenz, stabile Schritt-UUIDs, Freigaben und sequenzieller Executor. Journal vor Mutation persistieren, danach frische Evidenz separat speichern. Keine automatische Wiederholung; begrenzte Dialog-/Bridge-Wartezeiten und mindestens 1 Sekunde Mutationsabstand.
- `src/write-protocol.ts`, `write-content.ts`: getrennte, Extension-authentifizierte Port-Nachrichten; Video-/Ziel-ID, genaue freigegebene Aktion und Ablaufzeit werden auch an der Content-Grenze geprüft. Navigation/Disconnect bricht den Auftrag ab. Vor jeder Mutation Runtime-Anfrage an die Background-Autorität; ein Bridge-Freigabeobjekt allein ist keine Klickerlaubnis.
- `src/write-authority.ts` / `background.ts`: prüft eigene Extension-ID, YouTube-Content-Sender mit Tab und exakt passender Watch-Video-ID. `storage.authorizeMutation` verlangt atomar die exakt aktive beanspruchte Freigabe, aktiven Durchlauf, persistierten `running`-WAL-Schritt samt Versuch sowie unveränderten Snapshot/Export. Ein Ledger-Permit ist nur einmal pro Schritt/Versuch/Mutation ausstellbar. Ohne beanspruchten WAL keine Mutation, auch bei gültig aussehendem Bridge-Grant. Background prüft/autorisiert nur, keine Jobs oder Klicks.
- `src/write-bridge.ts`: separater Writer-Web-Lock, eigener aktiver YouTube-Arbeitstab nach Discovery-/Ausführungsbutton. Kein wiederkehrender Autofokus. Vor **jeder** Mitgliedschaftsabfrage `tabs.reload(..., { bypassCache: true })`, auch nach Navigation zur exakten Watch-URL eines anderen Videos. Der Tab bleibt zur unabhängigen Kontrolle offen.
- `src/adapter/write.ts`: isolierter nativer Save-Dialog-Vertrag, keine internen Properties oder APIs. Details und Kompatibilitätsgrenzen unten.

## Invarianten

1. Kein Schreiben beim Start, Scan oder Swipe. Vor Ausführung: neuester Scan vollständig, vollständiger Snapshot tatsächlich persistiert, lokal gespeicherter Export ausdrücklich bestätigt und genaue Auswahl neu freigegeben.
2. Klick-/Checkbox-Feedback ist kein Erfolg. `pending → running → verified | failed | unknown`; nur frische Mitgliedschaftsevidenz erlaubt `verified`. `already_present`/`already_absent` sind keine eigene Änderung.
3. Archiventscheidungen speichern die konkrete Ziel-ID zum Entscheidungszeitpunkt; spätere Zieländerungen schreiben bestehende Entscheidungen nicht um.
4. Keine automatische Entfernung unbekannter, eingeschränkter oder lediglich nicht gelisteter Videos.
5. Speicherung bestätigt Entscheidungen, nicht deren Anwendung auf YouTube. Fehler beim Speichern lassen die Karte aktiv.
6. Undo betrifft nur unberührte lokale Vormerkungen, nicht angewendete/unklare Operationen. Kein vorgetäuschtes Wiederherstellen auf YouTube.
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

## M3: nativer Save-DOM-Vertrag und Grenzen

Der Adapter verlangt neben der exakten Watch-URL genau einen sichtbaren `ytd-watch-flexy` mit passender `video-id`; der eindeutig benannte Save-/Speichern-Button muss dessen Nachfahre sein. URL allein genügt wegen möglicher veralteter SPA-Inhalte nicht. Der Legacy-Pfad erwartet genau einen sichtbaren unterstützten Dialog mit `ytd-add-to-playlist-renderer` und `ytd-playlist-add-to-option-renderer`. Innerhalb jeder Zeile muss genau eine native `input[type="checkbox"]` oder `[role="checkbox"]` vorhanden sein. Semantische Namen kommen aus `aria-label`, `aria-labelledby`, zugeordneten Input-Labels bzw. Text; Checkboxzustand aus `checked`/`aria-checked`. Mixed, widersprüchlich, versteckt, deaktiviert oder mehrdeutig bedeutet nicht schreibbar/unklar. Diese Renderer-Verträge sind bewusst isoliert, keine Behauptung universeller YouTube-Unterstützung.

**Jede Playlist-Identität verlangt einen sichtbaren expliziten YouTube-Link innerhalb derselben Checkbox-Option: `/playlist?list=WL` für Watch Later, `list=PL…` für das Archiv.** Keine Zuordnung anhand von Titeln, manuellen IDs, internen Seitenobjekten/Properties oder APIs. Mehrere widersprüchliche IDs oder doppelte Ziele brechen ab. Nicht identifizierte Optionen werden bei der Read-only-Abfrage mit leerer ID und Diagnose zurückgegeben, niemals als Schreibziele. Das neue Sheet wird über Save-Header, Popup-Vorfahren und Toggle-Zeilen unterschieden; seine `aria-pressed`-Werte bleiben UI-Beobachtungen, seine Mitgliedschaft stets `unknown` und seine Zeilen stets nicht schreibbar. Discovery lässt ein Sheet zur Kontrolle geöffnet. Viele aktuelle YouTube-Varianten exponieren solche Links nicht: Nicht nur der Archiv-Picker, sondern **sämtliche Mutationen können nicht unterstützt sein, fail closed**. Dies ist eine konservative Grundlage; aktuelle Live-Kompatibilität ist unbekannt. Manuelle URL-Eingabe speichert nur eine Absicht und ist **kein Bypass**.

**Keine WL-Ausnahme anhand von Labels:** „Watch later“ / „Später ansehen“ kann auch eine eigene Playlist heißen und darf niemals allein WL identifizieren. Ohne expliziten WL-Link innerhalb der Checkbox-Option bleibt die Mitgliedschaft `unknown`, nicht `absent`; kein Remove. Semantische Labels dienen der Bedienung, nicht der Playlist-Identität.

### Frische Evidenz und Ausführung

`getPlaylistMembership` öffnet/schließt selbst einen frischen nativen Dialog; das allein beweist keinen vom SPA-Cache unabhängigen Zustand. Die Bridge erzwingt deshalb vor **jeder** Mitgliedschaftsbeobachtung einen vollständigen neuen Seitenladevorgang, **immer mit Cache-Bypass-Reload**, auch nach einem Videowechsel: Navigation ersetzt `reload(..., { bypassCache: true })` nicht. Ein optimistischer Checkboxwechsel nach Klick bleibt nur Feedback; erst eine spätere frische Beobachtung ist Evidenz (`source: native-dialog`). Auch das ist DOM-Evidenz, kein unabhängiger Serverbeleg oder abgeschlossener Live-Test.

Der ausdrücklich geöffnete Arbeitstab muss aktiv und sein Fenster fokussiert bleiben; andernfalls Abbruch statt automatischer Reaktivierung. Dialog-Polling höchstens 10 Sekunden, Laden ungefähr 30 Sekunden, Port-Antwort höchstens 35 Sekunden. Kein Blindklick auf Text oder beliebige Menüs, keine automatische Bereinigung unbekannter Dialoge.

Für jede freigegebene Entscheidung werden WL-Mitgliedschaft und ggf. schreibbares Archivziel frisch geprüft. Ziel bereits vorhanden: Add als `already_present` verifizieren, nicht erneut hinzufügen. Nach Add bzw. vorhandenem Ziel **erneut frisches `present` verlangen**, dann WL nochmals prüfen und erst danach entfernen. Der Content-Pfad prüft bei Archiv-Remove das Ziel zusätzlich unmittelbar vor Entfernung. Fehlende/unklare Zielbestätigung verhindert Remove. Nach Mutation erneut frisch beobachten und persistieren; Teil-Erfolge bleiben im Journal erhalten.

Ist WL vorher bereits abwesend, wird `already_absent` dokumentiert, nicht eine eigene erfolgreiche Entfernung. Es wird dann auch nicht blind ins Archiv hinzugefügt. Eine Entscheidung kann einen verifizierten bereits erreichten Zustand beschreiben, ohne eine eigene Änderung zu belegen. Mutationen liefern `{ changed: boolean }`: `changed: false` ergibt bei passendem frischem Zustand `already_present`/`already_absent`, keinen eigenen Änderungsnachweis. Nur tatsächlicher Klick (`changed: true`), Versuch und passende frische Evidenz erlauben `outcome: changed` für den Piloten.

### Journal, Freigabe und Wiederaufnahme

Entscheidungs-UUID und getrennte stabile Add-/Remove-Schritt-UUIDs bleiben bei ausdrücklicher Wiederholung erhalten. Vor dem Klick werden Versuchszahl und `running` dauerhaft gespeichert (Write-ahead); Speicherfehler entweichen sofort und verbieten weitere Mutationen. Disconnect/Timeout nach möglichem Klick ergibt `unknown`, auch bei scheinbar passender Checkbox. Beim Laden wird persistiertes `running` zu `unknown`; kein Startup-Executor, kein automatischer Retry.

Freigaben sind auf Snapshot-ID, exakte Entscheidungs-/Video-IDs, Aktion und Ziel festgelegt und maximal 15 Minuten gültig. **Verpflichtend an der Executor-Grenze, vor erstem WAL-Commit und jedem Adapteraufruf:** `storage.claimExecution` prüft in einer atomaren Readwrite-Transaktion den tatsächlichen vollständigen Snapshot-Datensatz gegen den aktuellen letzten Scan sowie den kanonischen aktuellen Library-Inhalt gegen den Aufruferstand (CAS). Freigabe/Exportgates werden erneut geprüft; Library-Durchlauf und verbrauchte Freigabe werden gemeinsam reserviert. Ein separates `execution-ledger` im bestehenden `state`-Store schützt gegen Replay auch unabhängig vom Library-Klon. Veralteter Klon, Datensatzabweichung oder Replay: Abbruch vor Adapterzugriff, kein Vertrauen allein in UI-Checks.

`pending`, `failed` und `unknown` sind in der UI auswählbar, `verified` bleibt deaktiviert. Vor Wiederholung fehlgeschlagener/unklarer Vorgänge **manuell in YouTube prüfen, erneut auswählen und neu ausdrücklich zustimmen**. Jede Ausführung braucht eine neue Freigabe und sämtliche frischen Preflights; alte Add-Evidenz wird nicht vertraut. Kein automatischer Retry und keine Speicher-Manipulation als Recovery. **Widerspruch zu bereits verifiziertem Schritt:** frische Evidenz passt nicht mehr zum verifizierten Ergebnis → Entscheidung `unknown`, Stapel stoppen, manuell abgleichen. Der verifizierte Schritt bleibt als Historie und dauerhafte Nicht-erneut-klicken-Sperre erhalten; erneute UI-Freigabe ist kein Override. Eine fachlich neue Entscheidung nach Klärung ist nicht die blinde Wiederholung dieses Schritts.

Ein Executor; bei `failed`/`unknown` stoppt der Stapel. „Nach aktueller Aktion stoppen“ lässt die laufende Entscheidung einschließlich ihrer Archivschritte und Verifikation auslaufen, beginnt aber keine nächste. Kein behaupteter Rollback, keine automatische Wiederherstellung.

### Pilotgrenzen und Berechtigungen

Anfangslimit **1**, keine Vorauswahl. Nur eine tatsächlich geänderte und verifizierte Entscheidung der vollständig abgeschlossenen aktuellen Stufe plus **ausdrückliche unabhängige Nutzerbestätigung in YouTube** erlaubt die Erhöhung auf **5**; erst eine abgeschlossene 5er-Stufe mit neuem Änderungsnachweis und erneuter Bestätigung erlaubt **25**. Kein automatisches Hochstufen durch Executor/Mock, kein Hochstufen allein bei `already_absent`.

Berechtigungen bleiben unverändert: `unlimitedStorage` und `https://www.youtube.com/*`, kein `cookies`, kein `tabs`-Vollzugriff, keine neuen Privilegien. Die bestehende Host-Berechtigung trägt Scan und ausdrücklich freigegebene native DOM-Aktionen. Die offizielle Watch-Later-Data-API scheidet aus; keine undokumentierten Innertube-Endpunkte. Keine Abhängigkeit von Chromium-Service-Workern, Ollama oder Cloud.

Die vollständige lokale Prüffolge war erfolgreich: **466/466 Vitest-Tests in 14 Dateien**, davon sechs vollständige Integrationen mit realem Executor, IndexedDB, Autorität, Transport und nativem Adapter gegen synthetisches DOM; **48/48 UI-Tests in beiden Browsern**, Check/Lint/Format, Produktionsbuild, Web-ext, Firefox-157-Installation von `dist` und finaler XPI sowie Paketbau. Keine echten YouTube-Mutationen; Live-M3-Abnahme steht aus. CI-Nachweise werden im [Lieferstatus](docs/STATUS.md) verlinkt. Der nächste manuelle Schritt ist der [genau eine bewusst ausgewählte Entscheidung umfassende Pilot](docs/TESTING.md#erster-m3-live-pilot-genau-eine-entscheidung). Es wurden keine eigenen Live-Schreibaktionen ausgeführt.

## Experimental Watch Later end jumps

An explicit per-invocation `fast-jump` opt-in uses the existing content-script
scanner and committed checkpoint ACK boundary. End jumps use only the detected
container's native scroll geometry. DOM retention and contiguous positional
evidence are checked before each jump. Uncertain retention, gaps, conflicts,
geometry failures or bounded stalls switch to stepwise scanning and rebuild
position evidence from the beginning while retaining collected videos. Snapshot
and completeness contracts remain unchanged. Sanitized performance counters
report observed intervals, never estimated network latency. See
[the fast-import contract](docs/WATCH-LATER-FAST-IMPORT.md).
