# Playlist-Identität und Namensevidenz – 0.2.6

## Evidenz: was der Nutzerlauf belegt

Basis: **0.2.5**, Stand: 18.10.2026. Der Nutzer meldet aus einem angemeldeten Zen-Lauf mit 0.2.5:

- **18 sichtbare `yt-lockup-view-model`-Karten**, alle mit `missing_title_node`; `no_playlist_link: 0`, `conflicting_playlist_ids: 0`.
- **Zwölf Struktursamples**, darin jeweils **ein Playlist-Link und zwei Watch-Links**. Das ist eine begrenzte Stichprobe, keine vollständige DOM-Aufnahme aller Karten.
- Kartenwachstum **0 → 4 → 18** und tatsächlich beobachtetes Scrollen.

Damit ist der bisherige Titel-Selektor als Akzeptanzblocker belegt: Der alte Parser verwarf Karten trotz vorhandener eindeutiger URL-Identität, weil kein von ihm unterstützter Titelknoten erkannt wurde. Der Lauf zeigt Nachladen und echtes Scrollen; er ist kein Beleg für grundsätzlich blockiertes Hintergrundscrollen. **Nicht bekannt ist die tatsächliche Heading-/`aria-labelledby`-Beziehung des aktuellen Live-DOM.** Insbesondere beweist `missing_title_node` weder einen fehlenden sichtbaren Namen in YouTube noch eine bestimmte alternative Titelstruktur. Die semantischen Namenskandidaten unten sind nur synthetisch geprüft, nicht am angemeldeten Live-DOM abgenommen.

Die [0.2.5-Feed-Diagnose](PLAYLIST-FEED-DIAGNOSTICS.md) und [M3.2](M3.2.md) bleiben historische Beschreibungen ihrer Versionen. Aussagen dort, nach denen ein Name für die Aufnahme erforderlich war oder Titelgründe ausschließlich Ablehnungen bezeichneten, gelten **nicht mehr für 0.2.6**. Ihre damaligen Prüfergebnisse bleiben historische Evidenz, keine aktuelle Abnahme.

## Identität unabhängig vom Namen

Der aktuelle Vertrag in `src/adapter/playlists.ts` akzeptiert eine sichtbare Kandidatenkarte, sobald ihre sichtbaren tatsächlichen Links **genau eine eindeutige gültige Playlist-URL** ergeben. Mehrere Links auf dieselbe kanonische URL sind erlaubt; verschiedene Playlist-IDs in derselben Karte bleiben ein Identitätskonflikt.

Die URL-Prüfung bleibt unverändert streng: Origin `https://www.youtube.com`, exakt `/playlist`, genau ein nicht leerer `list`-Parameter aus `[A-Za-z0-9_-]+`; Ausgabe kanonisch als `https://www.youtube.com/playlist?list=…`. Ein Watch-Link, auch mit `list`, ist kein Identitätsbeleg. Versteckte Links/Karten werden nicht als sichtbare Identität verwendet. Keine ID aus Namen, Thumbnail-URLs, Kartenprosa, internen Properties oder geratenen Zuordnungen.

`PlaylistEntry.name` ist jetzt `string | null`. Metadaten sind für gespeicherte Legacy-Einträge optional; **jeder neu gescannte Eintrag setzt sie explizit**:

| Feld               | Vertrag für neue Einträge                                                           |
| ------------------ | ----------------------------------------------------------------------------------- |
| `identityEvidence` | `playlist-url`                                                                      |
| `nameStatus`       | `confirmed` oder `unknown`                                                          |
| `nameSource`       | `playlist-heading`, `aria-labelledby`, `legacy-title`, `unknown` oder `conflicting` |
| `writability`      | immer `unknown`                                                                     |
| `name`             | eindeutig belegter Name oder `null`                                                 |

Ein unbekannter, leerer oder widersprüchlicher Name löscht die nachgewiesene Identität nicht. Ein identifizierter Eintrag ohne Namen ist **kein unsupported Eintrag**. Sichtbarkeit stammt weiterhin nur aus expliziten strukturierten Privacy-Badges; Eigentum bleibt `unknown`. Weder Name noch Feed-Mitgliedschaft, private Sichtbarkeit oder vorhandene ID bestätigen Schreibbarkeit.

## Semantische Namenskandidaten, keine Live-Strukturbehauptung

Ein Name braucht eine sichtbare, eindeutige Beziehung innerhalb derselben Karte zur nachgewiesenen kanonischen Playlist-URL:

- **`playlist-heading`:** sichtbare HTML-Überschrift oder `[role="heading"]`, die im Playlist-Link liegt oder deren enthaltene Links ausschließlich auf diese kanonische Playlist zeigen. Eine beliebige benachbarte Metadata-Überschrift genügt nicht; Watch-verknüpfte Überschriften sind kein Playlist-Titelbeleg.
- **`aria-labelledby`:** der kanonische Playlist-Link referenziert genau **eine** ID. Diese muss dokumentweit eindeutig sein und auf eine sichtbare lokale Überschrift oder einen dedizierten Titelknoten derselben Karte zeigen, nicht auf einen Knoten einer anderen/verschachtelten Karte. Andere sichtbare Links derselben Karte dürfen die Referenz nicht mitbenutzen. Mehrfachreferenzen, fehlende/versteckte/externe Ziele und widersprüchliche Linkbeziehungen bestätigen keinen Namen.
- **`legacy-title`:** sichtbarer dedizierter `playlist-title`-/`video-title`-Knoten mit eindeutiger Beziehung zur kanonischen Playlist-URL. Der Selektor allein genügt nicht.

Die dynamische Lockup-Titelklasse allein bestätigt keinen Namen. Beliebige `aria-label`-Werte, Thumbnail-Beschriftungen oder gesamter Kartentext sind keine Namensquellen. Nur sichtbarer Text innerhalb derselben nächsten Karte wird ausgewertet; versteckte Unterelemente und verschachtelte Karteninhalte sind ausgeschlossen. Ein Link außerhalb der jeweiligen Karte wird nicht als Namensbeziehung geerbt. Text belegter Kandidaten wird durch Whitespace-Normalisierung verglichen; mehrere unterschiedliche belegte Namen ergeben `name: null`, `nameStatus: unknown`, `nameSource: conflicting`.

Diese Regeln sind ein konservativer Kandidatenvertrag mit synthetischen Fixtures. Die tatsächliche Live-Namensbeziehung bleibt **UNKNOWN**. Künftige unbekannte Titelstrukturen dürfen namenlos bleiben; sie werden nicht durch immer breitere Text-/Selektor-Fallbacks erzwungen.

## Deduplizierung und historische Namen

Innerhalb **eines aktuellen Scans** werden Einträge über die kanonische URL dedupliziert, auch über virtualisierte frühere Runden hinweg:

- Ein bereits bestätigter Name bleibt erhalten, wenn eine spätere Beobachtung derselben Identität keinen Namen mehr liefert.
- Unterschiedliche bestätigte Namen oder ein bestätigter Namenskonflikt setzen den Namen auf `null`. Dieser Konflikt bleibt für die Identität **bis zum Ende dieses Scans** bestehen, selbst wenn später nur noch ein Name oder eine namenlose Karte sichtbar ist.
- `identifiedUnnamed` beschreibt den Befund vor dieser Namenserhaltung, nicht den finalen Namensbestand des Katalogs.

Davon getrennt bewahrt `mergePlaylistHistory` in `src/playlist-catalog.ts` historische Namensdaten im vorherigen, veralteten Katalog. Ein frischer namenloser Eintrag überschreibt dort nicht unnötig einen historischen Namen. **Historische Daten werden niemals in frische unbekannte Namensevidenz hochgestuft.** Die aktuelle Liste zeigt den frischen Scanbefund; ein historischer Eintrag mit derselben ID wird nicht zusätzlich als aktueller Treffer ausgegeben. Nicht erneut gefundene historische IDs bleiben im Bereich „Vorheriger Katalog (veraltet, vor dieser Aktualisierung)“ erhalten.

Gespeicherte Legacy-Strings ohne `nameStatus` bleiben anzeigbar als **„Name: gespeichert (älterer Katalog)“**, nicht als neu bestätigter Name. Kein Speicherreset und keine destruktive Katalogmigration.

## Diagnose: Identitätsfehler und Namenswarnungen

Die bestehenden Feldnamen und Gründe bleiben kompatibel. Der Typname `PlaylistRejectionReason` ist historisch: **Nicht jeder dort gezählte Grund bedeutet eine abgelehnte Identität.**

- `no_playlist_link`, `conflicting_playlist_ids` und `hidden_card` verhindern eine akzeptierte Identität.
- `missing_title_node`, `ambiguous_title_link`, `conflicting_titles` und titelbezogenes `incomplete_rendering` können **Namenswarnungen an akzeptierten Einträgen** sein.
- `parser.latest` zählt Kartenbefunde der letzten Runde, `parser.peaks` deren jeweilige Maxima, keine aufsummierten Pollingversuche. Eine Karte kann mehrere Gründe haben; deren Summe ist kein Ablehnungszähler.
- `cardCount.changes[].accepted`/`rejected` zählen Karten nach Identitätsakzeptanz, nicht eindeutige deduplizierte Katalogeinträge. `unsupportedCards` zählt nicht namenlose akzeptierte Karten, sondern den Spitzenwert nicht versteckter abgelehnter Kandidaten.
- `parser.identifiedUnnamed.latest`/`peak` zählen identifizierte Karten ohne karteneigenen Namen einschließlich Konflikten, **vor Namenserhaltung**. Das sind letzte Runde und Maximum, weder Pollingsummen noch eindeutige namenlose Katalog-IDs.
- `parser.samples` enthält höchstens **zwölf** abgelehnte oder mit Namenswarnungen versehene Karten der letzten Runde; `samplesTruncated` meldet weitere solche Karten. Akzeptierte namenlose Identitäten sind ausdrücklich samplefähig.

`titleStructure` ergänzt ausschließlich feste Strukturzähler:

| Feld                           | Bedeutung                                                       |
| ------------------------------ | --------------------------------------------------------------- |
| `canonicalLinkCount`           | Sichtbare Links auf die ausgewählte kanonische Playlist-URL     |
| `linkHeadings`                 | Überschriften mit ausschließlicher kanonischer Linkbeziehung    |
| `metadataHeadings`             | Sichtbare Überschriften ohne diese ausschließliche Beziehung    |
| `ariaLabelledbyLinks`          | Kanonische Links mit `aria-labelledby`                          |
| `localHeadingReferences`       | Gültige einzelne lokale Überschrift-/Titelreferenzen            |
| `missingOrAmbiguousReferences` | Fehlende oder mehrdeutige Referenzen                            |
| `watchLinkedHeadings`          | Überschriften mit Watch-Linkbeziehung                           |
| `canonicalLinkHasAriaLabel`    | Kanonische Links mit vorhandenem `aria-label`, ohne dessen Wert |

Diese Zahlen beschreiben Struktur, nicht Namen, DOM-IDs oder Referenzwerte. Insbesondere ist ein vorhandenes `aria-label` kein bestätigter Titel. Der Diagnoseformatter baut das JSON aus freigegebenen Feldern, festen Enums und Zählern neu auf; unbekannte Felder und rohe Texte werden nicht übernommen. „Playlist-Diagnose kopieren“ und das schreibgeschützte Textfeld als manueller Fallback bleiben erhalten. **Keine URLs, Playlist-Namen, tatsächlichen IDs, Attributwerte, DOM-Texte oder persönlichen Screenshots für die Rückmeldung.** Der normale Katalog enthält persönliche Daten; nicht den Katalog, das private Backup oder vollständiges Seiten-DOM teilen.

## UI, Status und unveränderte Grenzen

Die Anzeige trennt neutral **ID aus URL: nachgewiesen**, **Name: bestätigt / unbekannt** und **Schreibbarkeit: nicht bestätigt**. Ohne bestätigten Namen erscheint „Playlist ohne bestätigten Namen“ statt einer geratenen Bezeichnung. Legacy-Namen werden als älterer gespeicherter Katalogbestand gekennzeichnet. Lokale Archivzielwahl ist keine Schreibfreigabe.

Akzeptierte Identitäten bleiben Teilbestand, auch ohne Namen. Bei normalem begrenztem Ende mit Einträgen bleibt das Ergebnis `partial`; stabile Karten-/Scrollwerte belegen niemals `complete`. Null akzeptierte Identitäten führen weiterhin nach begrenztem Warten zu `failed` / `unsupported_dom` bei beobachteten Kandidaten bzw. `no_card_containers` ohne Kandidaten. Namenswarnungen allein begründen diesen Identitätsfehler nicht.

Keine Änderungen an Berechtigungen, Fokus-/Arbeitstabverhalten, YouTube-Writes, Schreibgates oder WL-Scanner und dessen Vollständigkeitsprüfung. Keine Next-/Mehr-Klicks, keine internen APIs, keine garantierte Hintergrundnachladung. **Kein eigener aktueller angemeldeter Live-Lauf oder bestätigter Live-Namensnachweis für 0.2.6.** Aktuelle Prüfergebnisse: **890/890 Unit-/Integrationstests**, **92/92 UI-Tests**, Typ-/Lint-/Format-/Build-/Erweiterungsprüfung und temporäre Firefox-Installationen erfolgreich; Details und lokale XPI-Prüfsumme in [STATUS.md](STATUS.md). Historische Testzahlen sind kein aktuelles Ergebnis.

## Nächster Zen-Test – genau eine Hintergrundaktualisierung

1. Bestehendes vollständiges Backup lokal sichern, im selben Profil auf **0.2.6** aktualisieren und offene YouTube-Tabs neu laden. Versionsanzeige prüfen; bei YouTube angemeldet bleiben.
2. Genau einmal **„Playlists aktualisieren“** starten. Den eigenen Arbeitstab standardmäßig inaktiv lassen; keine Schreibaktion, keine parallele Bearbeitung im Scan-Tab. Eine notwendige ausdrückliche Aktivierung als solche notieren, nicht als erfolgreichen reinen Hintergrundlauf ausgeben.
3. Bei **derselben DOM-/Kartenlage mit 18 eindeutigen gültigen sichtbaren Playlist-URLs** sind **18 akzeptierte Einträge** zu erwarten, auch wenn alle Namen unbekannt bleiben. Die 18 sind ein bedingter Vergleichswert des Nutzerlaufs, kein fest eingebauter Sollbestand für heutige Scans und keine Vollständigkeitsgarantie. Es gibt **keine Garantie bekannter Namen**.
4. Prüfen, dass nachgewiesene IDs trotz unbekanntem Namen erhalten bleiben und die UI keine bestätigte Schreibbarkeit behauptet. Neue Namensbestätigungen wären ein zusätzlicher Live-Befund, nicht Voraussetzung für erfolgreiche Identitätserkennung.
5. Arbeitstab-Diagnose und **bereinigte Playlist-Diagnose** kopieren; Version, Status und Zähler zurückmelden. Keine URLs, Namen, persönlichen Screenshots oder privaten Exporte teilen. `identifiedUnnamed` und `titleStructure` erlauben die nächste gezielte Diagnose ohne persönliche Werte. Bei weiterhin unklarer Namensbeziehung unbekannt belassen, keine Selektoren oder Schreibprüfungen erzwingen.
6. WL-Hintergrundimport bleibt ein **separater** Abnahmeschritt nach [M3.2](M3.2.md), nicht Teil dieses Feedtests. Keine Freigabe für echte Schreibtests.
