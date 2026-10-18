# Watch Later: sicherer Schnellimport-Start 0.2.11

## Bestätigter Befund und Root Cause

Der Nutzerlauf in Zen mit 0.2.10 bestätigt 500/4.927 Videos nach rund 188 Sekunden,
`mode: stepwise`, `endJumps: 0`, einen Fallback `position-gap-or-conflict`,
160.195 ms Anfahrt und 27.504 ms am Ende ohne neue IDs. Zuletzt: wachsendes DOM,
500 eindeutige Zeilen mit Positionen 1–500, keine verbleibenden Lücken/Konflikte,
keine Containerwechsel; teilweise verzögerte Timer. **Der Schnellmodus wurde
vor dem ersten Endsprung deaktiviert.** Ein fehlgeschlagener Endsprung ist damit
nicht die Ursache dieses Laufs. Der späte gültige Bestand widerlegt keine frühe
unvollständige DOM-Beobachtung.

**Im Code reproduziert:** 0.2.10 prüft die erste DOM-Beobachtung sofort gegen den
endgültigen Schnellmodusvertrag. Keine Zeilen, eine unidentifizierbare Ladezeile,
eine noch fehlende Positionsnummer oder eine anfängliche Lücke lösen denselben
irreversiblen Sammelfallback aus. Zusätzlich wurde `null → beobachtete Nummer`
als bleibender Positionskonflikt gespeichert. `unidentifiableRows = max(...)`
blockierte nach verschwundenen Platzhaltern dauerhaft die Vollständigkeit.

**Grenze der Live-Ursachenanalyse:** Der alte Bericht speichert keinen Snapshot
des Fallback-Zeitpunkts. Welcher einzelne Auslöser zuerst auftrat, lässt sich
rückwirkend nicht belegen. DOM-Hydration ist durch neue Fixtures als Fehlerpfad
nachgewiesen, nicht als bereits isolierte Ursache im angemeldeten Zen-Profil.
Timerverzögerungen sind beobachtet; ihr Anteil ist nicht kausal gemessen.

## Initialisierung in 0.2.11

Vor dem ersten Sprung wird nicht gescrollt. Zwei aufeinanderfolgende Beobachtungen
müssen denselben vollständig identifizierten Anfangsbestand mit eindeutigen IDs,
gültigen Positionen 1…N ohne Lücken und verfügbarer Geometrie zeigen. Ein leeres
DOM ohne explizite Leerlisten-Evidenz erfüllt diese Bedingung nicht. Die bestehende
`waitingMs`-Grenze (8 Sekunden Arbeitszeit, je Aufruf) begrenzt die Initialisierung;
sie ist **keine zusätzliche feste Wartezeit**. Ein stabiler Bestand kann schon
beim zweiten regulären Poll starten. Hintergrundtimer werden nicht nachgeholt;
ein später zweiter Poll darf einen weiterhin stabilen Bestand bestätigen.

Fehlende Zeilen, Positionsnummern, Geometrie oder Ladeplatzhalter werden während
dieser Phase erneut beobachtet. Numerische Widersprüche, doppelte IDs/Positionen,
verschwundene zuvor identifizierte Zeilen und Containerwechsel bleiben sofortige
Fallback-Auslöser. Nach der Initialisierung gilt wieder die unmittelbare strenge
Zeilenprüfung; es gibt keine dauerhafte Toleranz oder automatische Rückkehr aus
`stepwise`. Pause/Fortsetzen verlangt erneutes Opt-in und frische Stabilisierung.

Eine zunächst unbekannte Positionsnummer darf durch direkte DOM-Evidenz bekannt
werden; Verlust oder Änderung einer bereits bekannten Nummer bleibt ein Konflikt.
Historische unidentifizierbare Zeilen werden nur ausgeräumt, wenn die **gesamte
aktuell gerenderte Liste** mit exakter Sollzahl, eindeutigen IDs und Positionen
1…Sollzahl frisch geprüft ist. Ein verschwundener Platzhalter oder ein gültiger
Teilbestand reicht nicht. Auch danach sind stabile vollständige Evidenz und
fehlende Continuation erforderlich; das Beruhigungsfenster beginnt erst mit
dem vollständigen Beleg. Kein Erraten von IDs oder Positionen.

## Ablauf und Sicherheitsgrenze

Die sichtbare Option „Schnellimport: direkt ans Listenende springen
(experimentell)“ ist standardmäßig aus. Die Freigabe wird explizit über den
Read-only-Port bis zum Scanner transportiert, niemals aus einem Checkpoint
abgeleitet. Die separate Hintergrundscroll-Freigabe bleibt erforderlich.

Der Scanner liest sämtliche unterstützten gerenderten Zeilen und prüft eindeutige
IDs, bekannte Positionen und eine lückenlose Folge ab 1. Erst nach dem
persistierten Checkpoint-ACK springt er über natives `scrollTo` mit sofortiger
Geometrieänderung auf `scrollHeight - clientHeight` des erkannten Containers.
Nach dem asynchronen ACK werden Navigation, Sichtbarkeit, Container sowie die
identischen Zeilen/IDs/Positionen und die Sollzahl nochmals geprüft. Ändert sich
das DOM während des Speicherns, folgt ein regulärer Poll statt eines Sprungs.
Soll-/Ist-Position stehen in der bestehenden begrenzten Scrollhistorie.
Nach einem Sprung wartet er auf neue bestätigte IDs; nur echter Fortschritt
führt zu einem weiteren Endsprung. Kein wiederholtes Springen während des
Wartens, keine künstlichen Scroll-Events, internen APIs oder Fokuswechsel.

Verschwundene frühere IDs sind ein Virtualisierungshinweis, kein sicherer
Nachweis des Mechanismus: Auch ein Umbau oder eine Änderung der Liste kann die
Ursache sein. Reines Zeilen-/Höhenwachstum ersetzt keine ID-/Positionsevidenz.
Fehlende/unbekannte/mehrfache Positionen, doppelte IDs, Positionskonflikte,
Containerwechsel, fehlende Geometrie, ein fehlgeschlagener Sprung oder ein
begrenzter Stillstand (bestehendes Wartefenster: 8 Sekunden beobachtete Zeit)
führen einmalig zum schrittweisen Modus. Keine automatische Rückkehr in den
Schnellmodus während desselben Laufs.

Beim Fallback bleiben gesammelte Videos erhalten, aber die Positionsbestätigung
wird vollständig zurückgesetzt und gespeichert. Der Scrollcontainer wird zum
Anfang zurückgeführt; danach sammelt der bisherige Scanner die Belege erneut.
Eine bei Pause noch ausstehende Rückkehr bleibt als `rewindRequired` im Checkpoint gespeichert. Übersprungene Positionen werden nicht ergänzt oder angenommen. Nicht erreichter
Anfang oder ausbleibendes Nachladen dürfen deshalb weiterhin nur einen
Teilimport liefern. Eine unterbrochene Wiederholung im selben Dokument bewahrt
nur die tatsächlich bestätigte Teilmenge; nach Reload gilt die vorhandene
vollständige Neuverifikation. Frühere vollständige Snapshots und Entscheidungen
bleiben nach den bestehenden Speicherregeln erhalten.

Vollständigkeit verlangt unverändert passende Gesamtzahl, eindeutige IDs,
lückenlose konsistente Positionen, keine unbekannten Zeilen und stabile
Terminierung ohne Continuation. Keine Änderungen am Playlist-Feed,
Namenskandidaten, Berechtigungen, Schreibjournal oder Schreibfreigaben.

## Bereinigte Performance-Diagnose

`diagnostics.performance` beschreibt den aktuellen Aufruf; Pausezeiten und
historische Laufzeiten werden nicht als aktuelle Messung übernommen:

- `mode`: aktueller `stepwise` oder `fast-jump`.
- `endJumps`: tatsächlich versuchte Endsprünge, nicht erfolgreiche Downloads.
- `loadEvents`: Beobachtungen neuer bestätigter IDs nach dem ersten Bestand;
  erneute Verifikation bereits bekannter IDs zählt nicht als Nachladen.
- `progressIntervals`, `progressIntervalTotalMs`, `averageProgressIntervalMs`:
  beobachtete Abstände echter neuer ID-Ereignisse; ohne Intervall `null`.
- `scrollApproachMs`: beobachtete Zeit in Runden vor dem geometrischen Ende
  plus gemessene synchrone Dauer des Endsprungaufrufs.
- `endWithoutNewIdsMs`: beobachtete Rundenzeit am geometrischen Ende ohne neue
  Positionsbestätigungen. Das ist keine geschätzte Netzwerkzeit.
- `jumpToNewIdsMs`, `jumpToNewIdsSamples`: Summe und Anzahl beobachteter
  Sprung-bis-neue-ID-Intervalle, inklusive Browser-/Timer-/lokaler Wartezeit.
- `initializationState`, `initializationElapsedMs`, `initializationObservations`:
  `waiting`/`ready`/`fallback`, beobachtete Arbeitszeit und Anzahl Startprüfungen.
- `fallbackCount`, `fallbackReasons`: getrennte feste Gründe: `no-rows`,
  `unidentifiable-rows`, `invalid-positions`, `duplicate-ids`,
  `duplicate-positions`, `changed-positions`, `rendered-position-gaps`,
  `confirmed-position-gaps`, `initialization-unstable` sowie die bestehenden
  Virtualisierungs-/Container-/Geometrie-/Sprung-/Stillstandsgründe.
  `position-gap-or-conflict` bleibt nur zum Lesen historischer Berichte erhalten.
- `fallbackSnapshots`: ein Snapshot je Fallback dieses Aufrufs, Kopiergrenze
  höchstens drei. Konkreter Grund, Phase `initializing`/`scanning`, Zeit,
  Zeilen-/ID-Zähler, unbekannte Zeilen, gültige/ungültige Positionszähler,
  Positionsextrema, Lückenzahl innerhalb der gerenderten Min–Max-Spanne und
  innerhalb der bestätigten 1–Maximum-Spanne, Duplikat-/Konfliktflags.
  Ungültige Positionen zählen identifizierte Zeilen ohne sichere positive ganze
  Position bis 100.000; unidentifizierbare Zeilen werden separat gezählt.
  Keine individuellen IDs, Titel, URLs oder DOM-Inhalte.
- `renderedRows`, `uniqueRenderedIds`, `minRenderedPosition`,
  `maxRenderedPosition`, `renderedRowsDelta`, `scrollHeightDelta`,
  `missingWithinConfirmedRange`, `positionConflicts`, `domBehavior`:
  letzte DOM-Messung bzw. bleibender Konflikt-/Virtualisierungshinweis.
- `minVisiblePosition`, `maxVisiblePosition`: Positionsextrema CSS-sichtbarer
  DOM-Zeilen, keine Behauptung über Schnittpunkte mit dem Viewport.
- `milestones`: erstmaliges Erreichen von 100/200/300/500 bestätigten Videos
  und beobachtete Millisekunden seit Start dieses Aufrufs.

Die bestehende History hält höchstens 24 Runden mit Zeilenzahl, Geometrie und
Fortschritt fest. Timerverzögerungen bleiben separat sichtbar; es gibt keine
nachholenden Scrollschleifen. Zeitfelder beruhen auf Clock-Beobachtungen,
nicht auf der logischen Mindestzeit der synthetischen Scanner-Fixtures.
Messfenster enthalten lokale Verarbeitung und Persistenz. Die Messungen sind
weder reine Netzwerkzeiten noch ein kausaler Beweis für YouTube-Verhalten.

Der Kopierformatter rekonstruiert ausschließlich feste Enums, Zahlen und
begrenzte Listen. Keine Titel, Kanäle, tatsächlichen Video-/Playlist-IDs, URLs,
Dokument-UUIDs, DOM-Inhalte oder Rohfehler, auch bei manipuliertem Speicher.

## Zen-Abnahme

Im bisherigen angemeldeten Profil den lokalen Backup-Export sichern und auf
0.2.11 aktualisieren. Den Import mit ausdrücklich aktiviertem Schnellimport und
Hintergrundscrollen starten. Den YouTube-Arbeitstab weder aktivieren noch manuell
scrollen; keine Menüs oder Schreibaktionen bedienen. Die bestätigten Zähler
und Zeiten bei 100/200/300 und über 500 hinaus beobachten, danach kontrolliert
pausieren und das bereinigte Import-Diagnose-JSON kopieren.

Erfolgskriterium: Bei stabilem Anfangsbestand mindestens ein nachweislich
versuchter nativer Endsprung (`endJumps > 0`, Soll-/Ist-Geometrie in der History)
und selbstständiger Hintergrundfortschritt über 300–500 Videos ohne manuelles
Scrollen. `initializationState`, Fallback-Snapshot, Meilensteine, Anfahrtszeit,
Endwartezeit und Sprung-bis-ID-Intervalle zusammen auswerten. Ein Sprungversuch
allein beweist weder Bewegung noch Nachladen; diese Evidenzen bleiben getrennt.

Überwiegt die Endwartezeit oder meldet der neue Snapshot dauerhaft unsichere
DOM-Daten, bleibt der sichere schrittweise Scanner maßgeblich. Keine garantierte
Gesamtimportdauer und keine aggressive Wiederholung. Fixtures in Chromium und
Firefox beweisen Geometrie, Ablauf und konservative Fehlerbehandlung, jedoch
keine aktuelle YouTube-Kompatibilität im angemeldeten Zen-Profil. Die Abnahme
von 0.2.11 und neue Live-Zeiten stehen aus.
