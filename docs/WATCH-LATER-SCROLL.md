# Watch-Later-Hintergrundscrollen – 0.2.9

## Live-Evidenz und Erkenntnisgrenze

Nutzerbestätigter Zen-Test mit **0.2.8**: YouTube meldet **4.927 Videos**. Die ersten 100 wurden automatisch im Hintergrund erfasst, weitere 100 erst nach manuellem Scrollen. Ein Checkpoint nach ungefähr 25 Sekunden enthält 200 Videos, `visibility: hidden`, `backgroundMode: experimental`, Container `document`, Top **15053**, Höhe **26004**, Viewport **1258**, sichtbare Continuation und null Recoveries. Acht verzögerte Timer, maximale Wartezeit **3165 ms**. Anschließend vom Nutzer unterbrochen.

**Dieser Checkpoint entstand nach manuellem Eingreifen.** Er belegt weder, dass der automatische Scanner den Ladebereich erreicht hatte, noch dass dort ein automatischer Nachladeversuch erfolglos blieb. Zum gemessenen Zeitpunkt lag das geometrische Ende bei 24746 und der Abstand dazu bei 9693 Pixeln; daraus lässt sich der vorherige automatische Verlauf nicht rekonstruieren. Es gibt keinen eigenen angemeldeten Live-Test mit 0.2.9.

## Root-Cause-Analyse

| Befund                                                                                                                                                                               | Einordnung                                                                                                       | Maßnahme / Grenze                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `scrollTo` wurde aufgerufen, aber Sollposition und unmittelbar erreichte Position wurden nicht gemeinsam gemessen.                                                                   | Belegte Diagnoselücke.                                                                                           | Instrumentierte Vorher-/Nachher-Geometrie, Ziel und Aktionssequenz.                                                                       |
| Der erste Overflow-Vorfahr wurde auch mit `clientHeight: 0` oder verstecktem Inhalt akzeptiert.                                                                                      | Belegter Auswahlfehler; synthetisch reproduziert. **Nicht als Ursache des Zen-Laufs belegt.**                    | Im Watch-Later-Pfad nur sichtbare Kandidaten mit positiver Viewport-Höhe auswählen.                                                       |
| Der Scanner verglich aufeinanderfolgende Top-Werte ohne Elementidentität. Nach DOM-Austausch konnte eine andere Position als Vorwärtsfahrt den Stillstand zurücksetzen.              | Belegter Steuerungsfehler; synthetisch auch bei gleichem Tag reproduziert. **Nicht im Nutzerlauf nachgewiesen.** | Laufzeitlokale Element-Epoch und Vergleich nur innerhalb desselben Containers.                                                            |
| Der Scanner fährt mit 85 % Viewport, mindestens 400 px, pro Runde. Verzögerte Timer verlangsamen die Anfahrt.                                                                        | Belegtes Verhalten, keine belegte Fehlerursache.                                                                 | Schritt und Intervall unverändert; kein Aufholen durch Scrollsalven.                                                                      |
| Recovery ist bei experimentell erlaubtem Hidden-Scanning aktiv, aber erst nach Stillstand am geometrischen Ende. Während beobachteter Vorwärtsfahrt wird kein Ladefehler angenommen. | Belegtes Verhalten. Null Recoveries nach 25 Sekunden beweisen hier keinen Recovery-Defekt.                       | Weiterhin drei Versuche bei 20/40/60 Sekunden Stillstand; reguläres Ende nach 90 Sekunden, Timerdrosselung kann die Ausführung verzögern. |
| YouTube könnte im inaktiven Tab Lade-Observer, Layout oder Anfragen anders behandeln. Ein anderer geometrisch plausibler Scrollcontainer könnte nötig sein.                          | **Hypothesen**, nicht durch den Checkpoint bewiesen.                                                             | Continuation-Lage und Geometrie messen; kein blindes Umschalten oder behaupteter Browser-/YouTube-Root-Cause.                             |

Die Containerwahl bleibt eine an der Playlist ausgerichtete Heuristik. Sie beweist nicht, welcher Container YouTubes internen Ladeauslöser steuert. Auch das geometrische Seitenende ist kein Beweis für dessen Auslösung.

## Gezielte Änderung, keine aggressivere Scrollstrategie

`src/adapter/scroll.ts` bietet für Watch Later einen instrumentierten Pfad. `src/content.ts` verdrahtet ihn mit dem Scanner. Der Playlist-Feed verwendet unverändert seine bisherigen Methoden; dessen Erkennung und Namenskandidaten bleiben unangetastet.

- Reguläre `scrollTo({ top, behavior: instant })`-Aufrufe; keine Events erzwingen, keine internen APIs, keine Video-/Playback-Klicks.
- Positive Viewport-Höhe und sichtbare Playlist-Anbindung bei der Containerwahl.
- Soll und Ist werden direkt um denselben Aufruf herum gelesen. Fehler und ausbleibende Bewegung werden als solche protokolliert, nicht als erfolgreiche Fahrt.
- Ein laufzeitlokaler DOM-Objektwechsel wird über eine numerische Epoch erkannt, auch bei gleichem Tag. Die Epoch ist **keine DOM-ID** und wird nicht über neue Scans hinweg verglichen.
- Die begrenzte Recovery fährt am Ende wie bisher einen Schritt zurück; die nächste normale Aktion nähert sich dem Ende erneut. Drei Versuche, keine erhöhten Limits und kein kürzeres Intervall.
- Bei Stillstand mit Continuation am geometrischen Ende entsteht `background_loading_stalled` bzw. sichtbar `loading_stalled`. Vor dem Ende bleibt `scroll_unreachable`; ohne ausreichende Geometrie bleibt der konservative bisherige Grund. Diese Statuscodes behaupten **keine** Sperre durch YouTube oder den Browser.
- Eine Recovery ohne nachfolgende Beobachtungsrunde endet als `unresolved`, nicht als erwiesen erfolglos. Dies ist insbesondere bei stark verzögerten Timern und direkt anschließendem Budget-/Stall-Abbruch wichtig.

Keine automatische Aktivierung, keine Manipulation der Dokument-Sichtbarkeit, kein unbeschränktes Retry, keine Änderung an Vollständigkeitsbelegen oder Schreibgates. Checkpoints bleiben vor ihrer Bestätigung lokal gespeichert. Pause, Navigation und Browserunterbrechung behalten den gesicherten Teilbestand.

## Bereinigtes Import-Diagnose-JSON

Der neue Formatter `src/import-diagnostics.ts` rekonstruiert explizit erlaubte Felder – auch bei manipulierten gespeicherten Daten. Keine Video-Titel, Video-IDs, URLs, DOM-Inhalte, Attributwerte, Dokument-UUIDs oder rohen Fehlertexte. Container sind feste erlaubte Tags bzw. `other`; Zahlen sind endlich und begrenzt. Bestehende Diagnosefelder bleiben erhalten, einschließlich validierter Legacy-Zeitstempel und bekannter Recovery-Ergebnisse.

`diagnostics.scrollTrace` enthält:

| Feld                                              | Bedeutung                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `history`                                         | Höchstens die letzten **24** Beobachtungsrunden.                                                                                                                                                                                                                                                   |
| `history[].scroll`                                | Top, Höhe, Viewport, freigegebener Containertyp und laufzeitlokale Epoch.                                                                                                                                                                                                                          |
| `distanceToEnd`, `atGeometryEnd`                  | Geometrischer Abstand und Zwei-Pixel-Endtoleranz; bei unbrauchbarer Geometrie kein behaupteter Endnachweis.                                                                                                                                                                                        |
| `renderedRows`, `visibleRows`                     | DOM-Zeilen insgesamt bzw. nach CSS/Hidden-Prüfung sichtbar. **Nicht** Anzahl innerhalb des Viewports; keine Änderung an der bestehenden ID-/Positionsbestätigung.                                                                                                                                  |
| `confirmedCount`, `newConfirmed`, `progressAgeMs` | Frisch im aktuellen Dokument bestätigte IDs, neue Bestätigungen dieser Runde und Zeit seit echtem ID-Fortschritt.                                                                                                                                                                                  |
| `continuation`                                    | Bestehende strukturelle Continuation-Sichtbarkeit.                                                                                                                                                                                                                                                 |
| `loadingArea`                                     | Anzahl CSS-sichtbarer Continuations; für höchstens 16 davon Lage relativ zum gewählten Scrollviewport. `inViewport`/Abstand sind `null`, wenn keine messbare Rechteckgeometrie vorhanden ist. Kein Beweis, dass ein Observer ausgelöst oder ein Serverrequest gesendet wurde.                      |
| `action`                                          | Aktionsart (`reset`, `advance`, `recovery`), Sequenznummer, Vorher-/Nachher-Position, Sollposition sowie berechnete Soll-/Ist-Bewegung. Ergebnis: `target-observed`, `no-movement`, `partial-or-divergent`, `unavailable` oder `error`.                                                            |
| `action.attribution`                              | Immer `during-call-only`: Messung unmittelbar innerhalb des Aufrufs, **kein** Beweis der Abwesenheit paralleler Browser-/Nutzereingaben.                                                                                                                                                           |
| `afterAction`, `laterDelta`, `laterAttribution`   | Nachbeobachtung nach der referenzierten Aktion. Änderungen nach Rückkehr des Aufrufs haben immer Zuordnung **`unknown`**: manuelles Scrollen, Browser-Layout/Verankerung und verzögerte automatische Bewegung lassen sich nicht eindeutig trennen. Bei Containerwechsel kein vergleichbares Delta. |
| `containerChanged`, `containerChanges`            | Wechsel in dieser Runde bzw. Gesamtzahl im aktuellen Scannerlauf.                                                                                                                                                                                                                                  |
| `actionCount`, `lastAction`                       | Anzahl angeforderter Operationen inklusive Reset und letzte Aktion; Sollwert ist kein Erfolgsnachweis.                                                                                                                                                                                             |
| `totalRecoveryAttempts`, `recoveryHistory`        | Gesamtzahl angeforderter Recoveries und letzte **3** Einzelergebnisse samt unmittelbarer Scrollmessung und Bestätigungszählern. `new-ids-later-observed` bedeutet zeitlich danach, **keine Kausalitätsbestätigung**.                                                                               |
| `progressEvents`                                  | Letzte **8** echte Bestätigungszuwächse mit Zeit und Anzahl, unabhängig von der rollierenden Rundengeschichte.                                                                                                                                                                                     |
| `endObservations`                                 | Anzahl Runden am geometrischen Ende; weder Ladeversuchszahl noch Vollständigkeitsbeleg.                                                                                                                                                                                                            |

Die bestehenden `timerThrottling`-Zähler messen nur die tatsächliche Dauer des angeforderten Wartens, nicht DOM-Arbeit oder Checkpoints. Verzögerung ist beobachtbar; deren Ursache wird nicht als bewiesen ausgegeben. Ein sichtbarer Tab ohne Hintergrundfreigabe bleibt ein anderer Modus als der hier zu prüfende experimentelle Hidden-Lauf.

## Automatisches und manuelles Scrollen

Der automatische Pfad setzt eine Sollposition mit einer regulären DOM-Scrolloperation. Manuelle Eingabe wird vom Browser verarbeitet. Beide können Scrollposition und Layout verändern; spätere Scrollereignisse oder Positionsänderungen liefern keinen eindeutigen Herkunftsbeleg. LaterSift erzeugt keine künstlichen Nutzer-/Scrollereignisse und behauptet keine Gleichwertigkeit hinsichtlich YouTubes Nachladeverhalten.

Deshalb unmittelbare Messung und spätere Beobachtung getrennt betrachten. Der nächste Test muss ohne manuellen Eingriff stattfinden, damit er die automatische Anfahrt beurteilen kann. Selbst dann belegt die Diagnose nur beobachtete Geometrie und IDs, nicht die Interna des YouTube-Laders.

## Regressionen und Qualitätsgrenze

`tests/scroll-trace.test.ts` verbindet echten Scroller und Scanner mit synthetischem DOM und deterministischer Zeit: 100 → 200 → 300 ausschließlich am Ende, sichtbare Continuation ohne IDs, Hidden-Timerdrosselung, wirkungslose Bewegung, untaugliche/gewechselte Container, Pause/Resume, fehlende Gesamtzahl/Positionen, begrenzte Historie und nicht automatisch attribuierte spätere Bewegung. Formatter- und Browser-Tests prüfen Datenschutz, Listenlimits, Reload und Kopieren. Bestehende Playlist- und Schreibsicherheitstests bleiben Teil des Gesamtlaufs.

Diese Tests beweisen keine aktuelle Live-Kompatibilität. Vollständigkeit benötigt weiterhin belegte Gesamtzahl, eindeutige bestätigte IDs und lückenlose Positionen, stabile Evidenz ohne Continuation und keine widersprüchlichen/unidentifizierbaren Zeilen.

## Zen-Abnahme – ausschließlich Hintergrund, ohne manuelles Scrollen

1. Vorhandenes JSON-Backup sicher aufbewahren. Im bisherigen Profil auf **0.2.9** aktualisieren, offene YouTube-Tabs neu laden; installierte Version prüfen.
2. Experimentelles Hintergrund-Scrollen aktivieren und den Watch-Later-Import starten.
3. Den YouTube-Arbeitstab **nicht aktivieren und nicht manuell scrollen**. Keine parallelen Eingriffe, keine Schreibtests.
4. Mindestens **zwei Minuten** beobachten oder bis ein begründeter Endstatus erreicht ist. Bei länger laufendem Import anschließend kontrolliert pausieren.
5. Version, automatisch bestätigte Videoanzahl, Status und bereinigtes **Import-Diagnose-JSON** erfassen. Keine privaten Exporte, Titel, IDs, URLs oder Screenshots teilen.
6. Prüfen: eigene Anfahrt/Continuation-Lage, Soll-/Ist-Bewegung, Containerwechsel, Fortschrittsereignisse, Stillstandszeit, Recoveries samt Ergebnis und Timerverzögerungen getrennt nachvollziehbar; Checkpoint nach Pause weiter vorhanden.

**Erfolg:** ohne manuelle Eingriffe mehr als 100 bestätigte Videos und nachvollziehbare weitere Ladebereiche. Ein vollständiger Import aller **4.927** Videos ist für diesen Schritt nicht erforderlich. Wenn kein Nachladen erfolgt, muss die Diagnose den beobachteten Stillstand eingrenzen und der Import ehrlich unvollständig mit erhaltenem Teilbestand enden. Weder Hintergrundladen noch eine bestimmte Live-Ursache werden vor diesem Test garantiert.
