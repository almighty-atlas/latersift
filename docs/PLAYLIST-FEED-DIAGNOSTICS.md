# Playlist-Feed-Diagnose – 0.2.5

## Evidenz und bewusst begrenzter Umfang

Basis ist 0.2.4. Der Nutzer erlaubt ausdrücklich einen **reinen Diagnoseschritt trotz unzureichender Ursachenevidenz**. Keine neuen Parsing-Selektoren, keine gelockerte Playlist-Identität und keine Behauptung einer reparierten Live-Playlist-Erkennung in 0.2.5.

Die vom Nutzer gelieferte Live-Diagnose aus dem angemeldeten Zen mit **0.2.4** zeigt:

| Beobachtung                             | Wert                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------- |
| Arbeitstab                              | `target-ready`, Origin YouTube, Marker passend, keine Navigationsfehler |
| Akzeptierte Einträge                    | `entries: 0`                                                            |
| Nicht unterstützte Karten               | `unsupportedCards: 4`                                                   |
| Runden                                  | `rounds: 6`                                                             |
| Scrollversuche / beobachtete Bewegungen | `scrollAttempts: 5`, `observedScrolls: 0`                               |
| Dokumenthöhe / Viewport                 | `1258` / `1258`                                                         |
| Sichtbare Continuation                  | `continuation: false`                                                   |
| Endgrund                                | `stable_unverified_end`                                                 |

**Belegt:** Die vorherige Navigation ist für diesen Nutzerlauf behoben; danach lehnt der Parser vier Kandidaten ab. **Nicht belegt:** der genaue Ablehnungsgrund, die aktuelle Live-DOM-Struktur, ein tatsächlich leerer Katalog, ein falscher Scrollcontainer, fehlende Anmeldung, Throttling oder eine notwendige neue Selektorvariante. Gleiche Dokument- und Viewporthöhe sowie null beobachtete Scrollbewegungen sind für sich kein Fehlernachweis.

Keine eigenen angemeldeten Live-Tests oder neuen externen Netzwerk-/Browserproben wurden in diesem Schritt ausgeführt. Die unangemeldeten Proben in [M3.2.1](M3.2.1.md) und unter 0.2.4 in [STATUS.md](STATUS.md) bleiben historische Befunde, keine aktuelle Ursachenevidenz. Die ausgeführten Qualitätsprüfungen für 0.2.5 und das Testpaket sind in [STATUS.md](STATUS.md) dokumentiert: 829 Unit-/Integrationstests, 86 UI-Tests sowie Typ-/Lint-/Build-/Erweiterungsprüfungen und temporäre Firefox-Installationen erfolgreich.

## Typen und Parsergründe

Der Feldvertrag liegt in `src/adapter/playlists.ts`: `PlaylistRejectionReason`, `PlaylistReasonCounts`, `PlaylistLinkType`, `PlaylistDiagnosticTag`, `PlaylistCardSample`, `PlaylistCardCounts`, `PlaylistParserDiagnostics`, `FeedScrollDiagnostic` sowie die optionalen Diagnosefelder in `PlaylistCatalog`.

Die Akzeptanz bleibt unverändert: genau ein sichtbarer kanonischer YouTube-Link `/playlist?list=…` mit genau einem gültigen `list`-Wert und genau ein nutzbarer Titel aus dem bereits unterstützten separaten Titel-DOM derselben Karte. Kein Titel aus Thumbnail-Label, beliebigem Kartentext oder geratenem Namen; keine gelockerte Link-/Titelzuordnung. Sichtbarkeit nur aus expliziten Privacy-Badges, Eigentum immer `unknown`. Feed-Einträge erteilen keine Schreibberechtigung.

`PlaylistRejectionReason` enthält exakt:

| Enum                       | Bedeutung                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `no_playlist_link`         | Kein sichtbarer Link erfüllt den kanonischen Playlist-Link-Vertrag.                                                                                                |
| `conflicting_playlist_ids` | Mehr als ein unterschiedliches gültiges kanonisches Playlist-Ziel in derselben sichtbaren Karte.                                                                   |
| `missing_title_node`       | Kein sichtbarer Titelknoten unter den bereits unterstützten Titelstrukturen. Kein Beweis, dass die Karte überhaupt keinen Titel enthält.                           |
| `conflicting_titles`       | Mehr als ein unterschiedlicher nutzbarer, normalisierter Titel.                                                                                                    |
| `ambiguous_title_link`     | Ein dem Titel zugeordneter Link passt nicht zum ermittelten Playlist-Ziel; dieser Titel wird nicht zur Identität kombiniert.                                       |
| `hidden_card`              | Karte oder Vorfahr ist über `hidden`, `aria-hidden="true"`, `display: none` oder `visibility: hidden` verborgen. Weitere Parserprüfungen dieser Karte entfallen.   |
| `incomplete_rendering`     | Direkt beobachteter leerer sichtbarer Linkwert oder leerer Titeltext bei einer abgelehnten Karte. Kein Beweis für eine bestimmte Ladeursache oder späteren Erfolg. |

Eine abgelehnte Karte kann mehrere Gründe liefern; Gründe sind keine exklusiven Kategorien. Diagnosegründe werden für abgelehnte Karten ausgegeben, nicht als zusätzliche Akzeptanzregeln.

### Letzte Runde, Spitzenwerte und Samples

- `parser.latest`: letzte Runde, jede abgelehnte Karte höchstens einmal je Grund. Mehrere Gründe derselben Karte sind möglich; die Summe muss daher nicht der Kartenzahl entsprechen.
- `parser.peaks`: je Grund höchster gleichzeitig in einer Runde beobachteter Zähler, **keine Summe über Polling/Retry-Runden**, keine Zahl eindeutiger Playlists. Vier unverändert abgelehnte Karten werden durch sechs Runden nicht zu 24 Ablehnungen.
- `unsupportedCards`: historischer Spitzenwert gleichzeitig abgelehnter **nicht verborgener** Karten; verborgene Karten stehen separat in `hidden_card` und den Kartenbeobachtungen.
- `parser.sources`: Kandidatenzahlen je freigegebenem Tag in der letzten Runde, einschließlich verborgener Kandidaten.
- `parser.samples`: die ersten höchstens **zwölf abgelehnten Karten der letzten Runde**, nicht über Runden akkumuliert; `samplesTruncated` zeigt weitere abgelehnte Karten an.
- `index`: nullbasierte Position im letzten Kandidatenscan, keine stabile Identität.
- `tag`, `childTags`: freigegebener Kartentag und Zähler unmittelbarer Kind-Tags, keine DOM-Inhalte.
- `titleNodes`: Zahlen für `playlistTitle`, `videoTitle`, `lockupTitle` anhand der bestehenden Titelstrukturen.
- `links`: Zahlen nach Linktyp; `distinctValidIds`: nur Anzahl verschiedener gültiger Playlist-IDs, niemals deren Werte.

Samples zählen strukturelle Nachfahren auch dann, wenn diese verborgen sind. Titelknoten-/Linkzahlen in einem Sample sind deshalb kein Beleg, dass diese Knoten die sichtbaren Akzeptanzbedingungen erfüllen.

Freigegebene Parser-Tags (`PlaylistDiagnosticTag`): `ytd-playlist-renderer`, `ytd-grid-playlist-renderer`, `ytd-rich-item-renderer`, `yt-lockup-view-model`, `ytd-badge-supported-renderer`, `a`, `span`, `div`, `h3`, `img`, `button`, `other`. Unbekannte Tags werden als `other` dargestellt, nie als beliebiger Originaltag.

Linktypen (`PlaylistLinkType`):

| Enum       | Strukturelle Klassifikation, ohne URL-Wert                                   |
| ---------- | ---------------------------------------------------------------------------- |
| `playlist` | Gültiger kanonischer YouTube-Playlist-Link.                                  |
| `watch`    | YouTube-Pfad `/watch`, kein Playlist-Identitätsersatz.                       |
| `channel`  | YouTube-Kanalpfad (`/channel/`, `/@`, `/c/`, `/user/`).                      |
| `external` | HTTP(S)-Ziel außerhalb des erlaubten YouTube-Origins.                        |
| `other`    | Sonstiger HTTP(S)-Pfad desselben Origins.                                    |
| `invalid`  | Leerer/ungültiger Wert, nicht HTTP(S) oder ungültiger YouTube-Playlist-Link. |
| `missing`  | Anker ohne `href`-Attribut.                                                  |

## Kartenänderungen und Nachladebeobachtungen

`cardCount.initial`, `latest`, `max` zählen Kandidatencontainer, nicht eindeutige Playlist-IDs. `cardCount.changes` enthält die erste Beobachtung und danach Änderungen an `total`, `accepted`, `rejected` oder `hidden`, jeweils mit `round`; es bleiben höchstens zwölf Beobachtungen erhalten, bei Überlauf fallen die ältesten weg. `accepted` ist die Zahl akzeptierter Karten der Runde, nicht zwingend die Zahl eindeutiger Katalogeinträge. `rejected` schließt `hidden` ein.

`loadingEvidence` unterscheidet:

- `cardGrowths`: Runden mit mehr Kandidaten als in der vorherigen Runde.
- `heightGrowths`: Runden mit größerer Höhe des ausgewählten Scrollkontexts als in der vorherigen Runde.
- `continuationRounds`: Runden mit sichtbarem `ytd-continuation-item-renderer`, keine Zahl unterschiedlicher Nodes.
- `continuationAppearances`: Übergänge von nicht sichtbar zu sichtbar, einschließlich einer sichtbaren Continuation in der ersten Runde.

`continuation` beschreibt die letzte Runde; `continuationSeen` merkt, ob jemals eine sichtbare Continuation beobachtet wurde. `pagination.nextAnchors` und `nextButtons` zählen sichtbare explizite `rel="next"`-Tokens an Links bzw. Buttons/Elementen mit Button-Rolle. Keine Auswertung beliebiger Labels oder Buttontexte. **Nur beobachten, niemals Next-/Mehr-/Pagination-Klicks auslösen.** Fehlende Hinweise beweisen weder ein Listenende noch fehlende serverseitige Pagination; wiederholte Hinweise beweisen keinen Ladefortschritt.

## Scrollkontext und Alternativen

`scroll` enthält den tatsächlich ausgewählten Kontext mit `container`, `top`, `height`, `viewport`; `scrollAttempts` zählt Aufrufe zum Scrollen, `observedScrolls` beobachtete Änderungen von `top` zwischen Runden. Versuche garantieren keine Bewegung und Bewegung garantiert keine neuen Karten.

`scrollAvailability` bezieht sich **ausschließlich auf den ausgewählten Kontext**:

- `unavailable`: keine Geometrie dieses Kontexts verfügbar.
- `not_scrollable`: dessen Höhe ist nicht größer als Viewport plus zwei Pixel Toleranz.
- `scrollable`: dessen Höhe überschreitet diese Grenze.

Ein ausgewähltes Dokument darf `not_scrollable` sein, während ein anderer Container scrollbar ist. Ein kurzer Feed muss überhaupt nicht scrollbar sein. Null Scrollbewegungen sind deshalb nicht inhärent ein Fehler und kein Anlass, Identitätsprüfungen zu lockern.

`scrollContainers` ergänzt ausgewählten Kontext, Dokument und beobachtete sichtbare `overflow-y: auto|scroll`-Alternativen mit positiver Viewporthöhe und größerer Inhaltshöhe:

- höchstens **3.000 inspizierte Elemente** im Dokumentlauf und höchstens **zwölf Containerberichte**; ausgewählter Kontext und Dokument werden vorab berücksichtigt;
- `inspectedElements` zählt die Inspektion, `truncated` zeigt ein erreichtes Inspektions-/Berichtslimit an;
- je Bericht nur `tag`, `top`, `height`, `viewport`, `selected`, `scrollable`, keine IDs, Klassen oder Attributwerte;
- zusätzliche freigegebene Scroll-Tags: `document`, `html`, `body`, `main`, `section`, `article`, `ytd-app`, `ytd-page-manager`, `ytd-browse`, `ytd-rich-grid-renderer`, `ytd-section-list-renderer`; andere Tags werden `other`;
- `scrollable` im Containerbericht ist eine Geometriebeobachtung (positive Viewporthöhe und Inhalt höher als Viewport), nicht identisch mit der Zwei-Pixel-Toleranz von `scrollAvailability`.

Diese Alternativen sind **ausschließlich Diagnose**: kein automatischer Wechsel des Scrollziels. Ein abgeschnittener Bericht beweist nicht, dass es keine weiteren Container gibt. Sichere Tagkategorien und begrenzte, nichtnegative Geometriewerte werden an der Anzeige-/Kopiergrenze erneut hergestellt.

## Begrenztes Warten und ehrlicher Status

Der Scanner beendet nicht schon beim ersten fehlenden Titel oder leeren Kandidatenscan. Er wartet weiter innerhalb der bestehenden Grenzen auf Rendering und kann später erscheinende gültige Karten akzeptieren: regulär sechs inaktive Runden am unteren Rand, bei sichtbarer Continuation zwölf; maximal 60 Scrollversuche oder 120 Sekunden gemäß laufender Uhr, Warteintervall eine Sekunde. Neue/aktualisierte Einträge, Bewegung, Höhen- oder Kartenwachstum setzen die Inaktivitätszählung zurück. Browser-Drosselung bleibt möglich; keine garantierte Echtzeitfrist oder Nachladung.

Nach einem **normalen begrenzten Ende**:

| Befund                                                                      | Status / Grund                                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Null akzeptierte Einträge, mindestens einmal Kandidatencontainer beobachtet | `failed` / `unsupported_dom`                                                                           |
| Null akzeptierte Einträge, nie Kandidatencontainer beobachtet               | `failed` / `no_card_containers`                                                                        |
| Mindestens ein akzeptierter Eintrag                                         | `partial` mit normalem Endgrund (`stable_unverified_end`, `continuation_stalled` oder `scroll_budget`) |

`unsupported_dom` benennt den fehlenden sicheren Parsererfolg, nicht dessen konkrete Ursache. `no_card_containers` beweist keinen leeren YouTube-Bestand. Abbruch, Navigation und Scanner-/Speicherfehler behalten ihre eigenen Gründe und werden nicht in DOM-Fehler umklassifiziert. Teilbestände bleiben erhalten. Kein Feedscan belegt `complete`; `expectedCount` bleibt `null`, `completenessVerified` bleibt `false`.

## Datenschutzgrenze, Kopieren und bestehender Katalog

`src/playlist-diagnostics.ts` baut mit `formatPlaylistDiagnostic` das angezeigte und kopierte JSON aus freigegebenen Feldern neu auf, statt persistierte Objekte direkt zu serialisieren. Das gilt auch für alte Katalogdaten:

- keine Playlist-Namen, tatsächlichen Playlist-/Video-/Kanal-IDs, URLs, Query-/Hashwerte, Titeltexte, Roh-DOM oder rohen Fehlermeldungen;
- unbekannte Felder werden verworfen, unbekannte Tags zu `other`, unbekannte Gründe zu `unknown`; keine beliebigen Originalwerte durchreichen;
- Legacy-`checkpointError`-Text wird nur als fester Code `checkpoint_failed` ausgegeben, andere rohe Fehler-/Nachrichtenfelder nicht übernommen;
- Zähler/Geometrie nur endlich, gerundet und auf 0 bis 1.000.000.000 begrenzt; Listen an der Formatgrenze auf zwölf begrenzt, Enums und Tagzählerschlüssel freigegeben.

Diese Zusage betrifft das bereinigte Diagnose-JSON, nicht den privaten Katalog oder den Bibliotheks-Backup-Export. „Technische Playlist-Diagnose“ enthält ein schreibgeschütztes Textfeld und „Playlist-Diagnose kopieren“. Scheitert Clipboard-Zugriff, bleibt das Textfeld zum Markieren und manuellen Kopieren erhalten.

Neue Diagnosefelder sind optional. Bestehender Katalog unter `latersift-playlist-catalog-v1` und vorherige stale Einträge bleiben lesbar/erhalten; kein Speicherreset und keine destruktive Migration. Fehlende Felder in alten Daten sind keine nachträgliche Nullmessung der neuen Diagnostik. Der Katalog bleibt separat im Extension-`localStorage`, nicht Teil des bisherigen Bibliotheks-Backups.

Keine neuen Berechtigungen, YouTube-Writes, Fokuswechsel, Schreibgates oder gelockerten Vollständigkeits-/Identitätsprüfungen. Markierung, Readiness und strenges own-only Cleanup bleiben gemäß [M3.2.1](M3.2.1.md) getrennt.

## Nächster Zen-Test – ausschließlich lesend

1. Bestehendes privates Backup lokal behalten, dieselbe Erweiterungs-ID und dasselbe Profil verwenden. 0.2.5 laden und offene YouTube-Tabs nach dem Update neu laden. Im selben Zen-Profil bei YouTube angemeldet sein.
2. Im Archivbereich **genau einmal „Playlists aktualisieren“** starten. Nicht die erweiterte Save-Dialog-Aktion und keinen Schreibpiloten verwenden. Kein paralleles Navigieren/Bearbeiten im Arbeitstab; begrenztes Rendering und Abschluss abwarten. Kein automatischer Fokuswechsel; Aktivieren bleibt eine ausdrückliche Nutzeraktion.
3. Danach **„Arbeitstab-Diagnose (ohne URL-Parameter)“ und das bereinigte JSON aus „Technische Playlist-Diagnose“ kopieren**. Bei Clipboard-Ablehnung das Textfeld manuell kopieren. **Nicht den privaten Backup-Export, Kataloginhalt oder vollständiges Seiten-DOM teilen.**
4. Readiness und Parser getrennt bewerten: `target-ready` belegt nur den erreichbaren Kontext. `parser.latest`, `peaks`, Samples, Kartenänderungen, ausgewählter Scrollkontext und mögliche Alternativen zeigen, welche Evidenz als Nächstes fehlt. Auch wenige akzeptierte Einträge bleiben ein Teilbestand.
5. Falls etwa `missing_title_node` erscheint: Sample-Tag, Kind-Tags, Titelknotenzahlen und Linktypen nutzen, um die betroffene Struktur **gezielt und bereinigt zu inspizieren**. Ein Sample zeigt nur Form, nicht den tatsächlichen Titelknoten. Erst daraus belastbare minimale DOM-Evidenz gewinnen; keine neuen Selektoren aus Vermutung hinzufügen, keine Identität lockern und keine Klicks erzwingen.

Der WL-Hintergrundimport bleibt eine separate lesende Abnahme nach [M3.2](M3.2.md). Diese Diagnosefreigabe erlaubt keine echten Schreibtests.
