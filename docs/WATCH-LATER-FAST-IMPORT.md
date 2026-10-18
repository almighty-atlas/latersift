# Watch Later: adaptiver Schnellimport 0.2.10

## Evidenz und Umfang

Der Nutzer berichtet für 0.2.9 selbstständiges Nachladen im inaktiven Zen-Tab,
aber etwa 1–2 Minuten pro 100 Videos bei rund 4.927 Einträgen. Er beobachtet
anscheinend erhaltene frühere DOM-Zeilen. Das sind Nutzerbeobachtungen;
DOM-Verhalten und Zeitanteile sind im angemeldeten Profil noch nicht technisch
verifiziert. Automatische Fixtures beweisen keine aktuelle YouTube-Kompatibilität.

## Ablauf und Sicherheitsgrenze

Die sichtbare Option „Schnellimport: direkt ans Listenende springen
(experimentell)“ ist standardmäßig aus. Die Freigabe wird explizit über den
Read-only-Port bis zum Scanner transportiert, niemals aus einem Checkpoint
abgeleitet. Die separate Hintergrundscroll-Freigabe bleibt erforderlich.

Der Scanner liest sämtliche unterstützten gerenderten Zeilen und prüft eindeutige
IDs, bekannte Positionen und eine lückenlose Folge ab 1. Erst nach dem
persistierten Checkpoint-ACK springt er über natives `scrollTo` mit sofortiger
Geometrieänderung auf `scrollHeight - clientHeight` des erkannten Containers.
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
- `fallbackCount`, `fallbackReasons`: feste Gründe, keine Rohfehlertexte.
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
0.2.10 aktualisieren. Den Import mit ausdrücklich aktiviertem Schnellimport und
Hintergrundscrollen starten. Den YouTube-Arbeitstab weder aktivieren noch manuell
scrollen; keine Menüs oder Schreibaktionen bedienen. Die bestätigten Zähler
und Zeiten bei 100/200/300 und möglichst 500 beobachten, danach kontrolliert
pausieren und das bereinigte Import-Diagnose-JSON kopieren.

Vergleichsbasis ist die Nutzerbeobachtung aus 0.2.9, keine kontrollierte Messreihe.
`milestones`, Anfahrtszeit, Wartezeit am Ende, Sprung-bis-ID-Intervalle und
Fallback-Gründe zusammen auswerten. Erfolg bedeutet sichere automatische
Nachladung mit messbar kürzerer Anfahrt, keine garantierte Gesamtimportzeit.
Wenn die beobachteten Warteintervalle am Ende überwiegen, diesen Befund als
Nachlade-/Beobachtungswartezeit dokumentieren. Browserdrosselung, lokale Arbeit
und YouTubes Hintergrund-Nachladen lassen sich damit nicht kausal trennen;
keine vermeintliche Beschleunigung durch häufigere/aggressivere Versuche.

Aktuell keine eigene angemeldete Zen-Abnahme: Die verfügbare Browsersteuerung
meldet keine verbundenen Browser oder Apps. Messwerte des Nutzers stehen aus.
