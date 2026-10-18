# Lieferstatus / Evidenz

## Aktuell: 0.2.12 – Ladezeiten im Schnellimport trennen

- **Nutzerbestätigter 0.2.11-Befund:** 500/4.927 in 232 s, Schnellimport aktiviert, `endJumps: 0`, `initializationState: fallback`, `fallbackReasons: ["no-rows"]`. Abbruch nach 8.037 ms bei null Zeilen; erste 100 nach 12.272 ms. Danach lückenloses Wachstum bis 500, keine bestätigten Positionskonflikte oder Containerwechsel; `scrollApproachMs: 181896`, Timer teilweise verzögert. Die zu frühe Initialisierungsgrenze ist damit bestätigt.
- **Implementiert:** eigene Defaultbudgets von 30 s für erste identifizierbare Zeilen, anschließend maximal 8 s Stabilisierung und 30 s Nachladen je Endsprung. Zwei passende Beobachtungen geben sofort frei. Fortschritt wird vor Timeout geprüft; kein Nachholen verzögerter Timer. Während des Nachladefensters keine Recovery-Bewegungen. `waitingMs` steuert weiterhin Status/Stepwise-Verhalten, nicht mehr die Schnellmodus-Abbrüche.
- **Sicherheit:** Checkpoint und persistierter ACK vor Sprung, erneute DOM-/Kontextprüfung, unmittelbarer Fallback bei echten Konflikten/Virtualisierung, begrenzter Fallback bei fehlendem Nachladen, sichere Neuverifikation ab Anfang. Bestehende Recovery-/Gesamtbudgets, Vollständigkeit, Snapshots, Entscheidungen, Rechte und Schreibgates bleiben erhalten. Keine YouTube-Schreibaktionen.
- **Zen-Abnahme offen:** 30 s liegen mit Reserve über der beobachteten Startladezeit; die Eignung der Nachladegrenze ist mangels Live-Endsprung noch nicht belegt. Ziel: `ready`, erreichte Sprungziele, neue IDs nach Sprüngen, mindestens 500 Videos ohne manuellen Scroll, kein unbegründeter Fallback und deutlich weniger Anfahrtszeit. [Zeitbudgets und genau ein sicherer Abnahmelauf](WATCH-LATER-FAST-IMPORT.md).

### Qualitätsergebnisse 0.2.12

- `pnpm install --frozen-lockfile`, `pnpm check` (0 Fehler/Warnungen), `pnpm lint`, `git diff --check`: erfolgreich. pnpm 11.25.0; lokal Node 26.11.1, CI nutzt Node 24.
- `pnpm exec vitest run tests/scanner-fast-loading.test.ts tests/scanner-fast.test.ts`: **50/50**. `pnpm test`: **1.080/1.080 in 25 Dateien**, einschließlich aller bisherigen Playlist-/Schreibsicherheitsfälle. 12 zusätzliche Ladebudget-Regressionen mit echten Scanner-/Scrolladapter-Aufrufen und synthetischem DOM/Zeitverlauf.
- `pnpm test:ui`: **108/108 in Chromium und Firefox**, einschließlich realer nativer Scrollgeometrie und Virtualisierungsfallback gegen Fixtures.
- `pnpm package` (einschließlich `pnpm build`), `pnpm lint:extension`: erfolgreich, **0 Fehler/Warnungen/Hinweise**. `pnpm test:firefox-extension` sowie `LATERSIFT_ADDON_PATH=artifacts/latersift-0.2.12-unsigned.xpi node scripts/test-firefox.mjs`: `dist` und finale XPI in **Firefox 157.0** temporär installiert, ohne Manifestwarnungen.
- `pnpm format:check` beanstandet ausschließlich die vor Arbeitsbeginn unversionierte `AGENTS.md`; diese bleibt unverändert und uncommitted. Alle versionierten Dateien bestehen `git ls-files -z | xargs -0 node_modules/.bin/prettier --check --ignore-unknown`; neue Testdatei separat formatiert. CI prüft den sauberen Checkout regulär.
- Umgebungsgrenzen: pnpm-Storezugriff nach Versionsänderung und lokale Sockets für Vorschau/Firefox-Smoke benötigten Sandbox-Freigabe; danach erfolgreich. Keine Abhängigkeitsänderung. Der erste Zwischenlauf beanstandete erwartungsgemäß die alte 8-s-Assertion für einen leeren Start; nach Anpassung an 30 s sind die obigen Läufe grün.
- XPI: `artifacts/latersift-0.2.12-unsigned.xpi`; SHA-256: `9acd55033f62d5ec7e44a9fa735feb20eebab6e35833bed5daa6d7e0d0d97630`.
- Keine verbundenen Browser/Apps laut Computer-Use-Inventar; keine angemeldete Zen-Abnahme oder Live-Geschwindigkeitsmessung. Keine Signierung, Veröffentlichung oder reale Playlist-Mutation. PR #2 bleibt offen; GitHub-CI wird nach Push separat verifiziert.

## Historischer Stand: 0.2.11 – vorzeitigen Schnellimport-Fallback beheben

- **Nutzerbestätigter 0.2.10-Befund:** 500/4.927 nach rund 188 s, `stepwise`, `endJumps: 0`, ein `position-gap-or-conflict`-Fallback, 160.195 ms Anfahrt und 27.504 ms Endwartezeit ohne neue IDs. Zuletzt wachsendes DOM, 500 eindeutige Zeilen/Positionen 1–500, keine verbleibenden Lücken/Konflikte oder Containerwechsel; Timer teilweise verzögert. Der Fallback erfolgte vor dem ersten Sprung. Welcher alte Sammelauslöser zuerst zutraf, ist ohne damaligen Snapshot nicht rückwirkend belegbar.
- **Reproduzierte Codeursache:** sofortiger permanenter Fallback bereits bei der ersten unvollständigen DOM-Beobachtung. Fehlende Positionsnummern/Zeilen und Ladeplatzhalter wurden wie endgültige Widersprüche behandelt. Zusätzlich blieben `null → Nummer` als Positionskonflikt und historische unidentifizierbare Zeilen als Höchstwert gespeichert.
- **Gezielter Fix:** zwei übereinstimmende vollständig identifizierte Anfangsbestände mit lückenlosen Positionen und Geometrie, begrenzt durch das bestehende 8-s-Arbeitszeitfenster. Während der Initialisierung kein Scrollen; keine pauschale längere Wartezeit. Echte Konflikte, doppelte IDs/Positionen, verschwundene identifizierte Zeilen und Containerwechsel bleiben sofortige Fallback-Auslöser. Checkpoint-ACK und danach erneute Zeilen-/Kontextprüfung vor jedem Sprung. Weiterer Sprung erst nach neuem ID-Fortschritt.
- **Platzhalter und Vollständigkeit:** unbekannte Positionen dürfen durch direkte Evidenz bekannt werden. Historische unbekannte Zeilen werden nur nach frisch verifiziertem gesamten gerenderten Bestand mit exakter Sollzahl/IDs/Positionen ausgeräumt. Ein gültiger Teilbestand reicht nicht. Das Beruhigungsfenster beginnt erst mit vollständigem Beleg; aktuelle Duplikate verhindern weiterhin `complete`.
- **Diagnose:** Startzustand/-zeit/-beobachtungen; getrennte feste Fallback-Gründe und Snapshot mit Phase, Zeilenzahl, gültigen/ungültigen Positionen, unbekannten Zeilen, Lücken und Konfliktflags. Kopiergrenze rekonstruiert nur feste Enums und begrenzte Zahlen/Listen, auch bei manipuliertem Speicher. Keine IDs, Titel, URLs oder DOM-Inhalte.
- **Unverändert:** Playlist-Erkennung und Namenskandidaten, Rechte, Hintergrundfreigabe, Checkpoint-/Snapshot-Schutz, Schreibjournal und Freigaben. Keine künstlichen Scroll-Events, internen APIs, Fokuswechsel, Wiedergabe oder YouTube-Schreibtests.
- **Zen-Abnahme offen:** synthetisch belegter Start und Endsprünge sind kein angemeldeter YouTube-Nachweis. Live-Ziel bleibt mindestens ein tatsächlicher Sprung bei stabilem Anfang und selbstständiger Hintergrundfortschritt über 300–500 Videos; eine feste Gesamtzeit wird nicht versprochen. [Root Cause, Feldvertrag und genau ein sicherer Abnahmelauf](WATCH-LATER-FAST-IMPORT.md).

### Qualitätsergebnisse 0.2.11

- `pnpm install --frozen-lockfile`, `pnpm check` (0 Fehler/Warnungen), `pnpm lint`, `pnpm build`, `git diff --check`: erfolgreich.
- `pnpm test`: **1.068/1.068 in 24 Dateien**. Einschließlich unveränderter Playlist-/Namenskandidaten- und Schreibsicherheitssuites; Regressionen für anfänglich unvollständige Positionen, Ladeplatzhalter, fehlende Zeilen/Geometrie, instabilen Anfang, eindeutige Fallback-Snapshots, Checkpoint vor Sprung, 100 → 200 → 300, entfernte Zeilen, echte Konflikte, Pause/Resume vor/nach Sprung, ACK-Zeitfenster, Speicherfehler und strikte Vollständigkeit.
- `pnpm test:ui`: **108/108 in Chromium und Firefox**. Echte native Scrollbenachrichtigungen/Containergeometrie gegen synthetisches DOM, initiale Hydration mit Positionen/Platzhaltern, 100 → 200 → 300 ohne schrittweise Anfahrt sowie Virtualisierungsfallback; bestehende UI-, Playlist- und Schreibsicherheitsfälle erfolgreich.
- `pnpm package`, `pnpm lint:extension`: erfolgreich; **0 Fehler/Warnungen/Hinweise**. `pnpm test:firefox-extension` und `LATERSIFT_ADDON_PATH=artifacts/latersift-0.2.11-unsigned.xpi node scripts/test-firefox.mjs`: `dist` und finale XPI als echtes MV3-Add-on in **Firefox 157.0** temporär installiert, ohne Manifestwarnungen.
- Lokale Umgebung: Vorschau-/Firefox-Smoke-Test benötigten Freigabe für lokale Sockets; anschließend erfolgreich. pnpm benötigte nach Versionsänderung Schreibzugriff auf seinen bestehenden Store; keine Abhängigkeitsänderung. `pnpm format:check` beanstandet ausschließlich die vor Arbeitsbeginn unversionierte `AGENTS.md`; diese bleibt unverändert und uncommitted. Alle versionierten Dateien bestehen `git ls-files -z | xargs -0 node_modules/.bin/prettier --check --ignore-unknown`. CI prüft den sauberen Checkout mit dem regulären Befehl.
- XPI: `artifacts/latersift-0.2.11-unsigned.xpi`; SHA-256: `0524d490288d0688ecbe912eb7731071a5f9309f5c24ba045bce9fe470e958c8`.
- Erster GitHub-Push-Lauf für `d272f05`: zwei 5-s-Testtimeouts in Stillstand-/Unknown-Count-Fixtures; der parallele PR-Lauf bestand seine Unit-Tests. Die drei reinen Stillstand-/Fehlerszenarien verwenden anschließend zehn statt hundert Anfangszeilen bei gleicher Scannerzeit-/Recovery-Grenze. Die 100 → 200 → 300- und Hydrationsprüfungen bleiben erhalten; keine Produktionsänderung oder Timeout-Erhöhung zur CI-Korrektur.
- Folgeläufe für `ecb0ebc`: sämtliche 1.068 Assertions erfolgreich, aber Vitest-RPC `onTaskUpdate` überschritt bei rund 62 s synchroner Fixture-Arbeit die interne Grenze. Schnellimport-Suite anschließend unverändert nach `tests/scanner-fast.test.ts` getrennt, gemeinsame DOM-/Zeitfixture in `tests/fixtures/scanner.ts`. Keine Timeout-/RPC-Erhöhung und keine Produktionsänderung.
- Keine Signierung, Veröffentlichung, reale Playlist-Mutation oder Zen-Live-Abnahme. PR #2 bleibt offen; GitHub-CI wird nach Push separat verifiziert.

## Historischer Stand: 0.2.10 – adaptiver experimenteller Schnellimport

- **Implementiert:** standardmäßig ausgeschaltete Schnellimport-Checkbox, expliziter UI-/Port-/Content-Transport, nativer Endsprung auf dem erkannten Scrollcontainer erst nach bestätigtem Checkpoint. Keine wiederholten Sprünge während des Wartens auf IDs.
- **Konservativer Fallback:** verschwundene Zeilen, Positionslücken/-konflikte, unklare Geometrie, Containerwechsel, fehlgeschlagene Sprünge und begrenzter Stillstand wechseln zum bisherigen Scanner. Positionsbelege werden gelöscht und nach gespeicherter Rückkehr zum Anfang erneut gesammelt; IDs bleiben erhalten. Bei Pause ausstehende Rückkehr wird dauerhaft markiert, bei nicht erreichbarem Anfang bleibt der Scan unvollständig.
- **Diagnose:** aktueller Modus, Sprung-/Nachladezähler, beobachtete Fortschrittsintervalle, Anfahrt, Warten am Ende, Sprung-bis-ID-Zeiten, Fallback-Gründe, DOM-/Positionsmessungen und Meilensteine bei 100/200/300/500. Kopierformatter rekonstruiert nur feste Enums, begrenzte Zahlen/Listen. Keine privaten Inhalte oder geschätzten Netzwerkzeiten.
- **Unverändert:** Playlist-Erkennung und Namenskandidaten, Vollständigkeits-/Snapshot-Regeln, Hintergrundfreigabe, Rechte und Schreibgates. Keine Wiedergabe, automatischen Fokuswechsel oder YouTube-Schreibaktionen.
- **Live-Evidenz:** Nutzer berichtet für 0.2.9 selbstständiges Hintergrund-Nachladen mit 1–2 Minuten pro 100 bei rund 4.927 Videos. Erhaltene frühere DOM-Zeilen sind eine Nutzerbeobachtung, kein eigener technischer Nachweis.
- **Zen-Abnahme offen:** Browsersteuerung meldet keine verbundenen Browser/Apps; bestehendes angemeldetes Zen-Profil nicht erreichbar. Keine eigenen 100/200/300/500-Live-Zeiten, keine Behauptung einer beschleunigten Gesamtimportzeit. [Ablauf, Messgrenzen und genau ein Read-only-Abnahmelauf](WATCH-LATER-FAST-IMPORT.md).

### Qualitätsergebnisse 0.2.10

- `pnpm install --frozen-lockfile`, `pnpm check` (0 Fehler/Warnungen), `pnpm lint`, `git diff --check`: erfolgreich.
- `pnpm test`: **1.043/1.043 in 23 Dateien**. Bestehende Playlist-/Namenskandidaten- und Schreibsicherheitsprüfungen erfolgreich. Zusätzliche Regressionen für Native-Endsprünge mit Checkpoint-ACK, 100 → 200 → 300, Stepwise-Vergleich, entfernte Zeilen, Positionslücken/-konflikte, Stillstand, Timerdrosselung, fehlgeschlagene Sprünge, fehlende Gesamtzahl, Pause/Resume und ausstehende/fehlgeschlagene Rückkehr zum Anfang. Navigation und Sichtbarkeit nach asynchronem Checkpoint erneut geprüft.
- `pnpm test:ui`: **100/100 in Chromium und Firefox**. Echte Browsergeometrie/native Scrollbenachrichtigungen gegen synthetisches DOM, Wachstum und Virtualisierungsfallback; ausgeschalteter Schnellimportstandard sowie persistierte, bereinigte Performance-Diagnose und Kopierpfad.
- `pnpm package`, `pnpm lint:extension`: erfolgreich; **0 Fehler/Warnungen/Hinweise**. `pnpm test:firefox-extension` und `LATERSIFT_ADDON_PATH=artifacts/latersift-0.2.10-unsigned.xpi node scripts/test-firefox.mjs`: `dist` und finale XPI in **Firefox 157.0** temporär installiert, ohne Manifestwarnungen.
- Formatierung: `pnpm format:check` beanstandet lokal ausschließlich die bereits vor Arbeitsbeginn ungetrackte `AGENTS.md`; diese bleibt unverändert und wird nicht mitgeliefert. `git ls-files -z | xargs -0 node_modules/.bin/prettier --check --ignore-unknown` sowie Prettier für die beiden neuen Dokument-/Testdateien erfolgreich. Die CI prüft den sauberen Checkout mit dem regulären Befehl.
- XPI: `artifacts/latersift-0.2.10-unsigned.xpi`; SHA-256: `ba7aaee4c236314d9f040231f1df3fe749629c4f062018d19d5141450bc51d27`.
- Prüfprobleme vor finalem Lauf: Fortschrittszählung nach Revalidierung und unnötiger Stillstands-Fallback bei vollständig belegtem Bestand korrigiert; ein zu großes neues Unknown-Count-Fixture überschritt das Testzeitlimit und wurde auf den relevanten Bestand verkleinert. Keine Vollständigkeitsprüfung gelockert.
- Keine Signierung, AMO-Veröffentlichung, angemeldete Zen-Abnahme oder YouTube-Schreibtests. PR #2 wird aktualisiert und nicht gemergt; GitHub-CI ist separat zu prüfen.

## Historischer Stand: 0.2.9 – Watch-Later-Scrollsteuerung und Nachladebeobachtung

- **Nutzerbestätigter 0.2.8-Befund:** YouTube-Anzahl 4.927; 100 Videos automatisch im Hintergrund, weitere 100 erst nach manuellem Scrollen. Der Checkpoint mit 200 nach etwa 25 Sekunden (`hidden`, experimentell, Dokument 15053/26004 bei Viewport 1258, Continuation sichtbar, null Recoveries, acht verzögerte Timer bis 3165 ms) entstand nach Eingriff. **Kein Beleg, dass der automatische Scanner am tatsächlichen Ladebereich erfolglos wartete.**
- **Belegte Codefehler, nicht als Live-Ursache behauptet:** unbrauchbare Overflow-Vorfahren mit Viewport null/verstecktem Inhalt konnten gewählt werden; Containerwechsel konnte fälschlich als Vorwärtsfahrt gelten. Watch-Later-Pfad prüft Sichtbarkeit/Viewport und vergleicht laufzeitlokale Element-Epochen.
- **Diagnose:** höchstens 24 Beobachtungen mit Soll-/Ist-Position und -Bewegung, Ladebereichlage, Zeilen-/Bestätigungszählern, Fortschrittsalter, Containerwechsel und Timern. Letzte drei Recovery-Ergebnisse und acht Fortschrittsereignisse separat erhalten. Unmittelbare Messung nur `during-call-only`, spätere Bewegung immer `unknown`; kein falscher automatischer Erfolgsnachweis nach manuellem Eingriff. Recovery ohne Nachbeobachtung bleibt `unresolved`.
- **Kopiergrenze:** neuer Importformatter rekonstruiert erlaubte Enums und begrenzte Zahlen/Listen auch aus manipuliertem Speicher. Keine Titel, IDs, URLs, DOM-Inhalte, Dokument-UUIDs oder Rohfehler. Bisherige Diagnosefelder kompatibel erhalten.
- **Unverändert:** Playlist-Feed und Namenskandidaten aus 0.2.8, Schreibgates, Rechte, Schrittweite, Intervalle, Retry-Limits und Vollständigkeitsbedingungen. Keine automatische Aktivierung, Wiedergabe, Sichtbarkeitsmanipulation oder YouTube-Schreibaktionen.
- **Live-Ursache offen:** Timerverzögerung ist beobachtet, eine YouTube-/Browser-Sperre oder falscher Live-Container nicht bewiesen. Keine eigene angemeldete Abnahme. [Analyse, Feldvertrag und Hintergrundtest](WATCH-LATER-SCROLL.md). Mehr als 100 automatisch bestätigte Videos wären ein Erfolg; vollständige 4.927 sind nicht erforderlich.

### Qualitätsergebnisse 0.2.9

- `pnpm install --frozen-lockfile`, `pnpm check` (0 Fehler/Warnungen), `pnpm lint`, `pnpm format:check` und `git diff --check`: erfolgreich.
- `pnpm test`: **1018/1018 in 23 Dateien**. Neu: **15 Scroll-/Scanner-Integrationstests** und **59 Formatter-/Datenschutztests**. Automatisch 100 → 200 → 300 ausschließlich am Ende, sichtbare Continuation ohne Nachladen, verzögerte Hidden-Timer, fehlgeschlagene Bewegung, untaugliche und wechselnde Container (auch gleicher Tag), Pause/Resume, fehlende Vollständigkeitsbelege, unbekannte spätere Bewegung und begrenzte Historien geprüft. Bestehende Playlist-/Namenskandidaten- und Schreibsicherheitstests weiterhin erfolgreich.
- `pnpm test:ui`: **96/96 in Chromium und Firefox**. Neue Prüfung für persistente Scrollhistorie, begrenzten und textfreien JSON-Export sowie tatsächlichen Kopierpfad; bestehende Playlist- und Operationsprüfungen erfolgreich.
- `pnpm package`, `pnpm lint:extension`: erfolgreich, **0 Fehler/Warnungen/Hinweise**. `pnpm test:firefox-extension` und finale XPI temporär in **Firefox 157.0** installiert, ohne Manifestwarnungen.
- XPI: `artifacts/latersift-0.2.9-unsigned.xpi`; SHA-256: `b5a8c877777cbd01212707cdffd1c6ed9b8fb9e8078b54c76ae873362ea07e0a`.
- Gegenprüfung fand einen Diagnose-Grenzfall: stark verzögerte Timer konnten unmittelbar vor dem Endstatus eine Recovery ohne Nachbeobachtung auslösen. Ihr Ergebnis bleibt jetzt `unresolved`, durch Regression abgesichert. Keine falsche Aussage über erfolgloses Nachladen.
- Keine angemeldete Live-Abnahme, Signierung oder AMO-Veröffentlichung; keine echten YouTube-Schreibaktionen. Bestehender PR #2 wird aktualisiert und nicht gemergt.

## Historischer Stand: 0.2.8 – sichtbare, unbestätigte Namenskandidaten

- Nutzerbefund aus 0.2.7: 18 erkannte Identitäten ohne bestätigte Namen; zwölf Samples mit eindeutiger gemeinsamer Lockup-Metadatenstruktur und exakt passenden Watch-Playlist-IDs. Struktur belegt, Titelsemantik nicht unabhängig bestätigt.
- Kandidaten separat als `candidateName` / `candidateSource: lockup-watch-heading`; niemals neue `confirmed`-Quelle. Eindeutige sichtbare lokale Struktur, keine widersprüchlichen IDs, versteckten/nestenden Titelinhalte oder konkurrierenden Kandidaten. Konflikte bleiben scanweit bestehen, auch bei Virtualisierung.
- Namen primär in LaterSift, explizite unbestätigte Herkunft; IDs eingeklappt. Identität, Eigentum und Schreibbarkeit bleiben getrennt. Bestehende Bestände, strenge Namensquellen und sämtliche Schreibgates erhalten; keine neuen Berechtigungen, Fokus-/Playback-/YouTube-Schreibaktionen.
- Unabhängige Seitenprüfung untersucht und mangels belegtem robustem Titelparser bewusst zurückgestellt. Kein spekulativer Bestätigungsbutton; [Begründung und Zen-Abnahme](PLAYLIST-IDENTITY.md).
- Keine eigene angemeldete Live-Abnahme. Synthetische Tests ersetzen nicht die nächste Nutzerprüfung.

### Qualitätsergebnisse 0.2.8

- `pnpm install --frozen-lockfile`, `pnpm check` (0 Fehler/Warnungen), `pnpm lint`, `pnpm format:check` und `git diff --check`: erfolgreich.
- `pnpm test`: **944/944 in 21 Dateien**. **34 neue Kandidatenfälle**: passende/abweichende/mehrfache IDs, echte Videotitel nur als unbestätigter Hinweis, leere/doppelte Überschriften, CSS-/ARIA-versteckte Inhalte, verschachtelte Karten/Metadaten, widersprüchliche Kandidaten/strenge Namen und Virtualisierung inklusive **0 → 4 → 18**.
- `pnpm test:ui`: **94/94 in Chromium und Firefox**. 18 Kandidaten sichtbar, IDs standardmäßig eingeklappt, Herkunft und offene Sicherheitsstatus sichtbar, Persistenz/Reload, lokale Zielwahl ohne zusätzliche Transportaktion und textfreier Diagnoseexport geprüft. Neue Reload-Testnavigation korrigiert; ein einmaliger Fehler eines unveränderten Operations-Tests war im vollständigen Wiederholungslauf nicht reproduzierbar. Zwei zusätzliche CSS-Fixtures benötigten wie bestehende DOMParser-Tests eine CSS-View; danach Gesamtlauf erfolgreich.
- `pnpm package`, `pnpm lint:extension`: Produktionspaket erfolgreich, **0 Fehler/Warnungen/Hinweise**. `pnpm test:firefox-extension` sowie finale XPI temporär in **Firefox 157.0** installiert, ohne Manifestwarnungen.
- XPI: `artifacts/latersift-0.2.8-unsigned.xpi`; SHA-256: `15e70889e2e1c3d2ff1cba56d3cc396d9adc1692ecbb76796245b3bb2bbbccdc`.
- Keine Signierung oder AMO-Veröffentlichung, keine YouTube-Schreibtests. Bestehender PR #2 wird aktualisiert, nicht gemergt.

## Historischer Stand: 0.2.7 – gezielte Lockup-Strukturdiagnose

- **Nutzergemeldeter Live-Befund mit 0.2.6:** 18 akzeptierte `yt-lockup-view-model`-Karten ohne Namen. Die Aufnahme namenloser Identitäten ist für diesen Lauf belegt; Namensauflösung und Feed-Vollständigkeit sind damit nicht bestätigt. **Watch list bleibt unbewiesen**, daher kein neuer `playlist-watch-heading`-Parser und keine neue Namensquelle.
- **Implementierte `titleStructure`-Felder:** `watchLinksMatchingPlaylist`, `watchLinksMissingPlaylist`, `watchLinksConflictingPlaylist`, `watchLinksUnresolvedPlaylist`, `headingsWithMatchingWatchPlaylist`, `ambiguousHeadings`, `watchHeadingContainsLink`, `watchLinkContainsHeading`, `watchHeadingsInLockupMetadata`, `watchHeadingsWithCanonicalLinkInMetadata`, `watchHeadingsWithCanonicalLinkOutsideMetadata`. [Feldbedeutung und Diagnosegrenzen](PLAYLIST-FEED-DIAGNOSTICS.md#titlestructure-diagnosefelder).
- **Sichtbar / same-card:** nur sichtbare Elemente derselben nächsten Karte, keine verborgenen Nachfahren oder verschachtelten Karteninhalte. Metadata ausschließlich über das feste Element `yt-lockup-metadata-view-model`, niemals über dynamische Klassen. Mehrere Linkziele, mehrere Watch-Links, fehlender exakter Playlist-Match oder mehrere Watch-Überschriften gelten als Ambiguität. Ein positiver Match-Zähler hebt diese nicht auf.
- **Keine Namensbestätigung durch Zähler:** Enthaltensein, Metadatenlage und passende Playlist-Bezüge sind Strukturbeobachtungen, keine Freigabe für `nameStatus: confirmed`. Berichte enthalten keine Namen, tatsächlichen IDs, URLs, Attributwerte, HTML oder Roh-DOM.
- **Umfang dieses Schritts:** Diagnose in Adapter und bereinigtem Formatter, synthetische Regressionstests, Versionierung auf 0.2.7 und Test-XPI. Identitäts-/Namensvertrag, UI-Namenskennzeichnung, Rechte, Schreibgates, Fokusverhalten und Vollständigkeitsprüfung bleiben unverändert. Kein optionaler lokaler Anzeigename implementiert.
- **Validierungsgrenze:** keine eigene angemeldete Live-Validierung und keine Live-Abnahme von 0.2.7. Historische Qualitätsergebnisse unten gelten nur für die jeweilige Version. Nach lokaler Prüfung folgt ein gesonderter rein lesender Nutzerlauf mit bereinigter Diagnose; keine echten Schreibtests.

### Qualitätsergebnisse 0.2.7

- `pnpm install --frozen-lockfile`, `pnpm check` (0 Fehler/Warnungen), `pnpm lint`, `pnpm format:check` und `git diff --check`: erfolgreich.
- `pnpm test`: **910/910 in 20 Dateien**, darunter **129 Playlist-Parser-/Scannerfälle** und **89 Diagnose-/Datenschutzfälle**. 20 neue Regressionen prüfen exakte, fehlende, leere, abweichende und mehrfach vorhandene Watch-`list`-Parameter, einzelne Videotitel, mehrere Links/Überschriften, versteckte und verschachtelte Karten sowie gleiche Texte verschiedener Identitäten. Auch ein exakter Watch-Match bestätigt keinen Namen.
- `pnpm test:ui`: **92/92 in Chromium und Firefox**. Neue Strukturzähler passieren Anzeige und Kopie; private Werte in neuen Feldern werden bereinigt. Bestehende bestätigte/unbekannte Namensanzeige, Persistenz und lokale Zielwahl bleiben geprüft.
- `pnpm package`: Produktionsbuild und `artifacts/latersift-0.2.7-unsigned.xpi` erfolgreich; `pnpm lint:extension`: **0 Fehler, 0 Warnungen, 0 Hinweise**.
- `node scripts/test-firefox.mjs` für `dist` und mit `LATERSIFT_ADDON_PATH=artifacts/latersift-0.2.7-unsigned.xpi`: echtes MV3-Add-on in **Firefox 157.0** temporär installiert, ohne Manifestwarnungen.
- SHA-256 der lokal getesteten XPI: `4c1a0254e01345b598b6e15f08ef29dc68665eccb6358f278c18bf723f8c2630`.

Die zunächst fehlende CSS-View in zwei neuen synthetischen Fixtures sowie veraltete UI-Erwartungen an die Diagnosefeldliste wurden korrigiert; die vollständigen Läufe oben sind danach erfolgreich. Keine angemeldete Live-Abnahme, Signierung oder AMO-Veröffentlichung. PR #2 bleibt offen; kein Merge.

## Historischer Stand: 0.2.6 – Playlist-Identität unabhängig vom Namen

Basis: **0.2.5**, Stand: 18.10.2026. [Aktueller Identitäts-/Namensvertrag, Diagnose, Datenschutz und nächster Zen-Test](PLAYLIST-IDENTITY.md).

- **Nutzerbestätigte Live-Evidenz mit 0.2.5:** 18 sichtbare `yt-lockup-view-model`-Karten, alle `missing_title_node`, `no_playlist_link: 0`, `conflicting_playlist_ids: 0`; zwölf Samples mit jeweils einem Playlist-Link und zwei Watch-Links. Kartenwachstum **0 → 4 → 18** und echtes Scrollen beobachtet. Das belegt den bisherigen Titel-Selektor als Akzeptanzblocker bei vorhandener URL-Identität, nicht eine konkrete aktuelle Heading-/ARIA-Beziehung. Die tatsächliche Live-Namensrelation bleibt **UNKNOWN**.
- **Aktueller Codevertrag:** `name: string | null`; neue Einträge setzen explizit `identityEvidence: playlist-url`, `nameStatus: confirmed | unknown`, `nameSource: playlist-heading | aria-labelledby | legacy-title | unknown | conflicting` und `writability: unknown`. Die Metadaten bleiben für gespeicherte Legacy-Einträge optional. Genau eine eindeutige gültige tatsächliche sichtbare Playlist-URL derselben Karte genügt für Identität; URL-Prüfungen unverändert streng. Fehlende/mehrdeutige Namen verwerfen keine belegte ID, keine Namen-/ID-Vermutungen.
- **Namensvertrag nur synthetisch belegt:** exklusive Playlist-Link-/Heading-Beziehung oder einzelne dokumentweit eindeutige, sichtbare, nicht geteilte lokale `aria-labelledby`-Referenz auf Überschrift/dedizierten Titel; Legacy-Titel nur mit eindeutiger Linkbeziehung. Nur sichtbarer Text derselben nächsten Karte; versteckte Unterelemente und verschachtelte Karteninhalte werden ausgeschlossen. Keine beliebigen `aria-label`-, Thumbnail- oder Kartentext-Fallbacks. Unbekannte künftige Titelstrukturen dürfen unbekannt bleiben.
- **Scan und Historie getrennt:** Deduplizierung über kanonische URLs im aktuellen Scan; bestätigter Name bleibt bei späterer namenloser Beobachtung erhalten. Bestätigte Namenskonflikte bleiben scanweit `name: null`. Historische Namen bleiben separat stale erhalten, bestätigen aber keinen frischen unbekannten Namen. Legacy-Strings erscheinen als „gespeichert (älterer Katalog)“, nicht als neu bestätigt.
- **Diagnose / UI:** Namensgründe können Warnungen an akzeptierten Identitäten sein; kein unsupported allein wegen fehlenden Namens. `identifiedUnnamed` zählt karteneigene namenlose Identitäten vor Namenserhaltung, letzte Runde/Maximum, keine Pollingsummen oder eindeutigen Katalog-IDs. Höchstens zwölf Samples einschließlich Namenswarnungen; `titleStructure` enthält nur freigegebene feste Strukturzähler. Bereinigte Kopie ohne URLs, Namen, tatsächliche IDs oder Attributwerte. Neutral getrennte Anzeige: ID nachgewiesen, Name bestätigt/unbekannt, Schreibbarkeit nicht bestätigt.
- **Unverändert:** Rechte, Fokus-/Arbeitstabverhalten, YouTube-Writes, Schreibgates, WL-Scanner und Vollständigkeitsprüfung. Feed bleibt Teilbestand, nie belegtes `complete`. Kein eigener aktueller angemeldeter Live-Test, kein garantierter Live-Namensnachweis.

### Qualitätsergebnisse 0.2.6

- `pnpm install --frozen-lockfile`, `pnpm check` (0 Fehler/Warnungen), `pnpm lint`, `pnpm format:check` und `git diff --check`: erfolgreich.
- `pnpm test`: **890/890 in 20 Dateien**, darunter **109 Playlist-Parser-/Scannerfälle**, **89 Diagnose-/Datenschutzfälle** und **4 Katalog-/Historienfälle**. Synthetisch geprüft: 0 → 4 → 18 namenlose Lockups mit zusätzlichen Watch-Links, semantische Namensbelege, fehlende/mehrdeutige Titel, widersprüchliche IDs, gleiche Namen verschiedener IDs, scanweite Konflikte und Deduplizierung. Versteckter Text und verschachtelte Karten dürfen keine Namen anderer Elemente einschleusen.
- `pnpm test:ui`: **92/92 in Chromium und Firefox**. 18 namenlose ID-belegte Einträge, gemischte Namenszustände, lokale Zielwahl ohne Schreibzugriff, Persistenz/Reload, Legacy-Namen ohne falsche frische Bestätigung und Erhalt historischer Namen geprüft.
- `pnpm package`: Produktionsbuild und `artifacts/latersift-0.2.6-unsigned.xpi` erfolgreich; `pnpm lint:extension`: **0 Fehler, 0 Warnungen, 0 Hinweise**.
- `pnpm test:firefox-extension` und `LATERSIFT_ADDON_PATH=artifacts/latersift-0.2.6-unsigned.xpi node scripts/test-firefox.mjs`: echtes MV3-Add-on aus `dist` und finaler XPI in **Firefox 157.0** temporär installiert, ohne Manifestwarnungen.
- SHA-256 der lokal getesteten XPI: `8b8e3d072e3c0c6ca1bcac6e1cecc1950b4070c5e3a490e5fed811a01c44d12e`.

Synthetische Fixtures und Add-on-Installation ersetzen keine angemeldete Live-Abnahme. Zum damaligen Freigabestand bestätigte der Nutzerbefund den alten Titelblocker und vorhandene Playlist-Links; die Aufnahme und Namensauflösung durch 0.2.6 waren noch nicht im angemeldeten Zen bestätigt. Der neuere, oben dokumentierte 0.2.6-Nutzerlauf belegt inzwischen 18 akzeptierte Lockups ohne Namen, weiterhin keine Namensauflösung. Keine Signierung/AMO-Veröffentlichung.

**Damals nächster Schritt (Aufnahme namenloser Lockups inzwischen nutzergemeldet):** im angemeldeten Zen mit 0.2.6 genau einmal „Playlists aktualisieren“ im inaktiven Arbeitstab. Bei derselben DOM-Lage mit 18 eindeutigen gültigen sichtbaren Playlist-URLs sind 18 akzeptierte Einträge zu erwarten, auch bei ausschließlich unbekannten Namen. Das ist kein festgelegter heutiger Zähler, keine Vollständigkeits- oder Namensgarantie. Nur Arbeitstab-Diagnose und bereinigtes Playlist-Diagnose-JSON zurückmelden; keine URLs, Namen, persönlichen Screenshots oder privaten Backups. [Genaue Checkliste](PLAYLIST-IDENTITY.md#nächster-zen-test--genau-eine-hintergrundaktualisierung). WL-Abnahme separat, keine echten Schreibtests.

## Historischer Stand: 0.2.5 – ausschließlich Playlist-Feed-Diagnose

Die folgenden Aussagen und Ergebnisse beschreiben **0.2.5**. Insbesondere die damalige Titelpflicht und rein ablehnungsbezogene Parsersemantik sind durch den [0.2.6-Vertrag](PLAYLIST-IDENTITY.md) überholt; die damaligen Befunde bleiben als historische Evidenz eingeordnet.

Basis: **0.2.4**, Stand: 18.10.2026. [Playlist-Feed-Diagnose: Evidenz, exakte Felder, Datenschutz und nächster Zen-Test](PLAYLIST-FEED-DIAGNOSTICS.md). Der Nutzer erlaubt ausdrücklich einen reinen Diagnoseschritt trotz noch unzureichender Evidenz für die Parserursache.

- **Nutzerbestätigte Live-Evidenz aus Zen mit 0.2.4:** `target-ready`, Origin YouTube, Marker passend, keine Navigationsfehler; `entries: 0`, `unsupportedCards: 4`, `rounds: 6`, `scrollAttempts: 5`, `observedScrolls: 0`, Dokumenthöhe **1258**, Viewport **1258**, `continuation: false`, `stable_unverified_end`. Damit ist die Navigation für diesen Nutzerlauf behoben; der Parser lehnt vier Kandidaten ab. Weder genaue Ablehnungsursache noch aktuelles DOM, tatsächlicher Playlist-Bestand, falscher Scrollcontainer oder Throttling sind damit belegt.
- **Umfang 0.2.5:** exakte Parser-Ablehnungsgründe mit letzten Zählern und Spitzenwerten statt Retry-Inflation, höchstens zwölf bereinigte Struktursamples, Kartenanzahl/-änderungen, Wachstums- und beobachtete Pagination-Hinweise. Scrollcontainer-Diagnose: höchstens 3.000 inspizierte Elemente und zwölf Berichte mit sicheren Tags, Geometrie, Auswahl- und Trunkierungskennzeichen; kein automatischer Wechsel. `scrollAvailability` betrifft nur den ausgewählten Kontext, auch wenn eine scrollbare Alternative existiert. Kein Scrollen ist nicht grundsätzlich ein Fehler.
- **Ehrliches Ende:** weiterhin begrenzt auf verzögertes Rendern warten; keine sofortige Ablehnung beim ersten leeren/unlesbaren Zustand. Bei normalem begrenztem Ende mit null akzeptierten Einträgen `failed` / `unsupported_dom`, wenn Kandidaten beobachtet wurden, sonst `failed` / `no_card_containers`. Mit akzeptierten Einträgen bleibt das normale Ergebnis `partial`, niemals belegte Vollständigkeit.
- **Datenschutz / Upgrade:** Formatgrenze baut das Diagnose-JSON aus freigegebenen Feldern neu auf; rohe Legacy-Fehlertexte und unbekannte Felder/Tags werden nicht durchgereicht. Kopierbutton und Textfeld-Fallback bleiben erhalten. Neue Diagnosefelder sind optional; alter Katalog und stale Einträge bleiben erhalten, kein Speicherreset.
- **Unverändert:** Parsing-Selektoren, strikte Identitätsprüfung, Rechte, YouTube-Writes, Fokusverhalten, Vollständigkeitsprüfung und Schreibgates. Pagination nur beobachten, keine Next-/Mehr-Klicks. Keine eigenen angemeldeten Live-Tests, keine neuen externen Netzwerk-/Browserproben in diesem Schritt; die Proben unter 0.2.4 sind historische Befunde.

### Qualitätsergebnisse 0.2.5

- `pnpm install --frozen-lockfile`, `pnpm check` (0 Fehler/Warnungen), `pnpm lint`, `pnpm format:check` und `git diff --check`: erfolgreich.
- `pnpm test`: **829/829 in 19 Dateien**, darunter 60 Playlist-Parser-/Scannerfälle, 81 Format-/Datenschutzfälle und 15 Scrollgeometrie-/Diagnosefälle. Keine neuen Parsing-Selektoren; bestehende Sicherheitskette weiterhin getestet.
- `pnpm test:ui`: **86/86 in Chromium und Firefox**. Vier abgewiesene Karten mit `unsupported_dom`, separat erfolgreiche Arbeitstabnavigation, fehlende Container, bereinigte Kopie, Clipboard-Ablehnung/fehlende API und unverändert erhaltener 0.2.4-Legacy-Katalog nach Reload getestet.
- `pnpm package`: Produktionsbuild und `artifacts/latersift-0.2.5-unsigned.xpi` erfolgreich; `pnpm lint:extension`: **0 Fehler, 0 Warnungen, 0 Hinweise**.
- `pnpm test:firefox-extension` und `LATERSIFT_ADDON_PATH=artifacts/latersift-0.2.5-unsigned.xpi node scripts/test-firefox.mjs`: echtes MV3-Add-on aus `dist` und finaler XPI in **Firefox 157.0** temporär installiert, ohne Manifestwarnungen.
- SHA-256 der lokal getesteten XPI: `92b89fefa8457a817e1364a79abe32caea49ca94bc6bc048741d47886386b48a`.

DOM-/UI-Tests sind synthetisch; Installationsprüfungen sind keine angemeldete Zen-/Feed-Abnahme. Keine Live-Parserkorrektur behauptet, keine Signierung/AMO-Veröffentlichung.

Damals nächster Schritt (durch den oben dokumentierten 0.2.5-Nutzerlauf inzwischen erfolgt): im angemeldeten Zen mit 0.2.5 genau einmal „Playlists aktualisieren“, danach Arbeitstab-Diagnose und bereinigtes Playlist-Diagnose-JSON kopieren, **nicht das private Backup**. Fehlen Titelknoten, leitet die Sample-Struktur eine gezielte bereinigte DOM-Inspektion an; ohne diese Evidenz keine geratenen Selektoren hinzufügen. WL-Abnahme weiterhin separat.

## Historischer Stand: 0.2.4 / M3.2.1 – Arbeitstab-Readiness und Diagnose

Basis: **0.2.3**, Stand: 18.10.2026. [M3.2.1: Codeursache, Vertrag, Evidenz und nächster Zen-Test](M3.2.1.md). Nutzerbestätigter Fehler in Zen mit LaterSift 0.2.3: **„Work tab navigated away from its marked source.“** Die konkrete auslösende Navigation bzw. Ladephase beim Nutzer ist **noch nicht diagnostisch bestätigt**; kein angemeldeter Zen-Reproduktionstest.

- **Belegte Codeursache:** `waitForWorkTab` verwendete die strikte Eigentumsprüfung `matches` als Readiness-Bedingung, bevor der Ladezustand berücksichtigt wurde. Initiales `about:blank`, fehlende URL oder Verlust des UUID-Fragments konnten damit fälschlich als Wegnavigation gelten. Das ist ein Codebefund, kein Nachweis des konkreten Nutzertriggers.
- **Readiness:** initial `about:blank`/fehlende URL/`loading` begrenzt bis 30 Sekunden pollen. Lesbar nur `https://www.youtube.com/feed/playlists` ohne Query, optional abschließender Slash, oder exakt `https://www.youtube.com/playlist?list=WL`; Fragment jeweils optional. Fremde abgeschlossene Ziele nie akzeptieren, insbesondere kein Consent und keine anderen Feed-Aliasse. Zieladresse bleibt unverändert.
- **Cleanup separat und strenger:** passende Tab-ID, exakte ursprüngliche URL mit UUID, `complete`, keine abweichende `pendingUrl`. Create-Snapshots werden bereits vor dem Journaling berücksichtigt. Beobachteter Markerverlust, abweichende initiale Lade-URL oder abweichende Pending-URL widerrufen Cleanup-Eigentum dauerhaft, auch bei späterer Rückkehr des Markers. Der Quellen-Lock bleibt für den weiterhin lesbaren Tab bis `close()` gehalten. Ladezustand oder unverifizierbarer Kontext erlaubt kein Schließen; Tabs dürfen offen bleiben.
- **Diagnose in beiden Importwegen:** feste Enums und freigegebene Pfadkategorien, schon vor Katalog bzw. erstem Checkpoint sichtbar; keine IDs, Hashwerte oder vollständigen URLs. `pendingUrl` ist weder erforderlich noch positiver Readiness-Beleg; MDN nennt dafür ausdrücklich die `tabs`-Berechtigung. Diese wird nicht hinzugefügt. Eine auf fremdem Host fehlende `tab.url` kann zu Timeout/`unknown` führen, nicht zu einer behaupteten Anmeldung/Consent-Ursache.
- **Damals für 0.2.4 vom Hauptagenten tatsächlich ausgeführte Netzwerkproben (nicht angemeldet):** Python `urllib` auf `/feed/playlists` lieferte HTTP 200, gleiche finale URL und gleichen Pfad, keinen Redirect und keine Canonical-Links. Eine frische Headless-Firefox-157-Browserprobe endete dagegen auf `consent.youtube.com/m`, mit erhaltenem Marker. Belegt ist eine client-/kontextabhängig mögliche Consent-Weiterleitung, weder eine veraltete Zieladresse noch die Ursache im angemeldeten Zen des Nutzers.

Keine neuen Berechtigungen, YouTube-Writes oder Schreibgates; bestehende Identitäts-, Vollständigkeits- und Schreibprüfungen bleiben unverändert. Nächster Schritt: beide lesenden Wege getrennt in Zen mit bereinigter Diagnose testen.

### Qualitätsergebnisse 0.2.4

- `pnpm install --frozen-lockfile`, `pnpm check` (0 Fehler/Warnungen), `pnpm lint`, `pnpm format:check` und `git diff --check`: erfolgreich.
- `pnpm test`: **723/723 in 18 Dateien**, darunter **97 Arbeitstab-Tests**. Initiales `about:blank`, fehlende/verzögerte URL, Markerverlust, Create-Snapshots, Pending-URL ohne zusätzliche Rechte, YouTube-/Consent-/Anmelde-Redirects, Fremdnavigation, Timeout und dauerhaftes Aufgeben der Schließberechtigung geprüft.
- `pnpm test:ui`: **74/74 in Chromium und Firefox**, mit Read-only-Mock-Transport und bereinigter Diagnose auch bei abgewiesener Navigation ohne Katalog. Verzögerter Start und markerloses Lesen ohne automatisches Schließen geprüft. Kein angemeldeter YouTube-Import bei diesen Fixtures.
- `pnpm package`: Produktionsbuild und `artifacts/latersift-0.2.4-unsigned.xpi` erfolgreich. `pnpm lint:extension`: **0 Fehler, 0 Warnungen, 0 Hinweise**.
- `pnpm test:firefox-extension` und `LATERSIFT_ADDON_PATH=artifacts/latersift-0.2.4-unsigned.xpi node scripts/test-firefox.mjs`: echtes MV3-Add-on aus `dist` und finaler XPI in **Firefox 157.0** temporär installiert, ohne Manifestwarnungen.
- SHA-256 der lokal getesteten XPI: `195db9a57f194e04baa4c2abdc6ed9410820bbd6d4a8463ff15ae0c8d9ab580d`.

Die unangemeldeten Netzwerkproben oben sind keine Live-Abnahme der Playlist-Erkennung und keine bestätigte Erklärung des konkreten Zen-Fehlers. Keine Signierung/AMO-Veröffentlichung. Historische Ergebnisse unten gelten nicht als Nachweis für 0.2.4.

## Historischer Stand: 0.2.3 / M3.2 – lesender Hintergrundbetrieb

Basis: **0.2.2**, Stand: 18.10.2026. Dokumentierter Implementierungsvertrag, **keine Live-Abnahme**. Keine Live-DOM-Aufnahme des Playlist-Feeds und kein angemeldeter Zen-Test verfügbar. [M3.2: Vertrag, Grenzen und getrennte manuelle Checklisten](M3.2.md).

1. **Schritt 1 – Playlist-Feed:** „Playlists aktualisieren“ liest `/feed/playlists` im eigenen inaktiven Arbeitstab. `src/adapter/playlists.ts` verwendet nur unbestätigte Kandidatenstrukturen, echte `/playlist?list=…`-Links und separates Titel-DOM derselben Karte. Sichtbarkeit ausschließlich aus expliziten Privacy-Badges, Eigentum immer `unknown`. Kein `complete`, auch nicht bei stabilem Ende. Katalog und vorherige stale Einträge liegen separat im `localStorage`, nicht im bisherigen JSON-Backup. Keine Schreibberechtigung aus Feedtreffern.
2. **Schritt 2 – experimenteller WL-Import:** sichtbare Hintergrundcheckbox standardmäßig ausgewählt; ausdrücklicher Start übergibt die Erlaubnis für echtes Hidden-Scrollen. Originale Vollständigkeitsprüfung unverändert. Historische 4.926 sind kein erwarteter aktueller Zähler. Pause/Fortsetzen und Neustart müssen gesicherte Teilbestände erhalten und im neuen Dokument erneut bestätigen.

Eigene Arbeitstabs: `active: false`, URL mit UUID-Fragment, separates `localStorage`-Journal, Web Locks pro Quelle. Own-only Cleanup bei Ende/Pause/Fehler und beim Wiederöffnen von LaterSift; exakte Tab-/URL-/Markerprüfung, niemals Originaltabs schließen. Bei Markerverlust Tab behalten. Crash zwischen Tab-Erstellung und Journalpersistenz kann einen nicht sicher aufräumbaren Tab hinterlassen. Kein automatischer Fokus, ausdrücklicher Aktivieren-Button während der Arbeit als Fallback. Bisheriger Save-Dialog bleibt unter „Erweitert“ als Vordergrunddiagnose erhalten; dessen aktiver Arbeitstab ist nicht mit dem neuen Feedscan zu verwechseln.

Timerverzögerung bleibt Heuristik; der Bridge-Watchdog für 60 Sekunden ohne Checkpoint wirkt nur bei tatsächlich ausgeführten Extension-Timern und nach ausstehenden Speicherbestätigungen. Keine garantierte Frist, Hintergrundnachladung oder Vollständigkeit. **A** ist ein inaktiver sichtbarer Tab, **B** (`tabs.hide`) nur konzeptionell und nicht implementiert. Page Visibility API: beide im Hintergrund `hidden`; Scroll-/IntersectionObserver-/Timerverhalten plattformabhängig, live ungeprüft. B benötigte zusätzlich `tabHide`, vorherigen Nutzerhinweis und Firefox-Benachrichtigung beim ersten Verstecken. Keine `tabHide`-Berechtigung, keine Stealth-Garantie, keine Konsolen-Berechtigungsumgehung.

Keine neuen YouTube-Writes oder Gates, keine gelockerten Identitäts-/Schreibprüfungen, keine zusätzlichen Berechtigungen. Abnahme ausschließlich lesend: Anmeldung, viele Playlists, tatsächliche DOM-Struktur, Lazy Loading/Pagination, gleiche Namen mit verschiedenen IDs, inaktiver Scan während anderer Tabnutzung, Pause/Fortsetzen/Neustart, Tabverlust, Markerverlust, Cleanup und ehrliche Unvollständigkeit; A manuell prüfen, B nicht als getestet ausgeben.

### Qualitätsergebnisse 0.2.3

- `pnpm install --frozen-lockfile`, `pnpm check` (0 Fehler/Warnungen), `pnpm lint`, `pnpm format:check` und `git diff --check`: erfolgreich.
- `pnpm test`: **653/653 in 18 Dateien**. Getrennt prüfbar: `tests/playlists.test.ts` (38 Feed-/Identitätsfälle), `tests/work-tabs.test.ts` (27 Lifecycle-Fälle), `tests/bridge.test.ts` (31 Transport-/Watchdog-Fälle) und `tests/scanner.test.ts` (53 Scanner-Fälle). DOM-Geometrie, Save-Sheet-Titel und bestehende Sicherheitskette zusätzlich geprüft.
- `pnpm test:ui`: **66/66 in Chromium und Firefox**. Mock-Transport mit `active: false`, Persistenz-vor-ACK, Tab-Bereinigung, Katalog über mehrere Teilaktualisierungen/Reload, bestätigte versus erhaltene IDs sowie Bibliotheks-/Backupzugriff trotz defektem Cleanup-Journal. Kein echter YouTube-Tab bei diesen Fixtures.
- `pnpm package`: Produktionsbuild und `artifacts/latersift-0.2.3-unsigned.xpi` erfolgreich. `pnpm lint:extension`: **0 Fehler, 0 Warnungen, 0 Hinweise**.
- `pnpm test:firefox-extension` sowie `LATERSIFT_ADDON_PATH=artifacts/latersift-0.2.3-unsigned.xpi node scripts/test-firefox.mjs`: echte temporäre MV3-Installation aus `dist` und finaler XPI in **Firefox 157.0**, keine Manifestwarnungen.
- SHA-256 der lokal getesteten XPI: `50a3a144b5c076457fd8d7c6aefb3e7e0104ae6c73b47793484609a4e8a64afb`.

Die erste PR-CI deckte bei `2f7e328` Header-Überlauf mit CI-Schriftmetriken auf. Der mobile Header und seine Navigation umbrechen jetzt bei Platzmangel; die unveränderte Viewport-Grenze wird zusätzlich mit größerer Navigationsschrift getestet. Nach der Korrektur wurden sämtliche UI-Prüfungen, Typ-/Lint-/Formatchecks, Paketierung, Erweiterungslint und beide Firefox-Installationen erneut erfolgreich ausgeführt.

Kein angemeldeter YouTube-/Zen-Live-Test, keine echte Messung von Hintergrund-IntersectionObserver oder Browser-Drosselung, kein `tabs.hide`-Versuch. Throttling, Tabverlust und Unterbrechungen sind synthetisch simuliert; Installationsprüfungen belegen keine Live-DOM-Kompatibilität. Keine Signierung/AMO-Veröffentlichung. Die folgenden historischen Ergebnisse gelten nicht als Nachweis für 0.2.3.

## Historischer Stand: 0.2.2 – Versionsanzeige und Dialogdiagnose

Stand: 18.10.2026. Header-Version aus dem installierten WebExtension-Manifest, auch mobil sichtbar. Aufklappbarer, kopierbarer Diagnosebericht nach der vorhandenen Playlist-Abfrage, auch nach Fehlern; UI-Zustand und Identitätsbeleg getrennt. Nur Zähler, Zeilennummern, freigegebene Attributnamen und feste Gründe; keine Namen, tatsächlichen IDs, Attributwerte, DOM-Inhalte oder rohen Fehlertexte. Details und lesende Zen-Abnahme: [DIALOG-DIAGNOSTICS.md](DIALOG-DIAGNOSTICS.md).

Keine neuen Schreibfunktionen, Berechtigungen, API-/Netzwerkanfragen oder Identitätsheuristiken. Sicherheitskette unverändert wirksam, keine echten Schreibtests, kein Backup-Restore. Diagnose bleibt flüchtig.

Lokale Prüfungen für 0.2.2:

- `pnpm install --frozen-lockfile`, `pnpm check` (0 Fehler/Warnungen), `pnpm lint`, `pnpm format:check`: erfolgreich.
- `pnpm test`: **534/534 in 16 Dateien**, einschließlich **15 Diagnose-/Datenschutzfällen** und **10 vollständigen synthetischen Integrationen**. Bestehende Schreib-Sicherheitskette weiterhin geprüft.
- `pnpm test:ui`: **58/58 in Chromium und Firefox**, einschließlich Manifestversion, Datenschutz bei Erfolg/Fehler und Clipboard-Erfolg/-Ablehnung.
- Produktionsbuild und `pnpm lint:extension`: erfolgreich, **0 Fehler, 0 Warnungen, 0 Hinweise**.
- Firefox **157.0**: echtes MV3-Add-on aus `dist` und der finalen XPI temporär installiert, keine Manifestwarnungen.
- `pnpm package`: `artifacts/latersift-0.2.2-unsigned.xpi` erstellt; unsigniert, keine AMO-Veröffentlichung.

Frühere CI-Ergebnisse unten gelten nicht als Nachweis für diesen Änderungsschritt. Keine eigenen angemeldeten YouTube-Live- oder Playlist-Schreibtests.

## Historischer Stand: 0.2.1 / M3.1 – 18.10.2026

Neue Sheet-Erkennung und rein lesende Playlist-Diagnose implementiert, basierend auf den vom Nutzer gemeldeten Strukturmerkmalen. Keine eigene angemeldete Live-Validierung. **Sheets sind keine Schreibziele**, selbst mit explizitem Link; ohne Link keine belegte ID. `aria-pressed` bleibt UI-Zustand, Mitgliedschaft `unknown`. Legacy-Sicherheitskette, Journal, Zustimmung und Pilotlimit bleiben wirksam.

Details: [M3.1-Vertrag, Identitätsbewertung, rein lesende Konsolendiagnose und Zen-Abnahme](M3.1.md). Der nächste manuelle Schritt ist ausschließlich „Playlists aus YouTube laden“ und Vergleich der Namen/Auswahlzustände. Keine echten Schreibtests ohne gesonderte Freigabe.

Lokale Prüfungen für 0.2.1:

- `pnpm install --frozen-lockfile`, `pnpm check` (0 Fehler/Warnungen), `pnpm lint`, `pnpm format:check`: erfolgreich.
- `pnpm test`: **514/514 in 15 Dateien**, darunter **44 neue Sheet-Adapterfälle** und **9 vollständige synthetische Integrationen**. Keine Live-YouTube-Mutation.
- `pnpm test:ui`: **50/50 in Chromium und Firefox**, ausschließlich lokale Fixtures.
- `pnpm build`, `pnpm lint:extension`: erfolgreich; **0 Fehler, 0 Warnungen, 0 Hinweise**.
- Firefox **157.0**: temporäre Installation des echten MV3-Add-ons aus `dist` und der finalen XPI erfolgreich; keine Manifestwarnungen. Installation belegt keine YouTube-Live-Kompatibilität.
- `pnpm package`: `artifacts/latersift-0.2.1-unsigned.xpi` erstellt, keine Signierung/AMO-Veröffentlichung.

Historische CI-Ergebnisse unten gelten nicht als CI-Nachweis für M3.1. Das neue Artefakt wird durch den vorhandenen Workflow beim Push erneut gebaut.

## Historischer Stand: 0.2.0

Stand: 17.10.2026 · **0.2.0**. M1 ist **nutzerbestätigt abgeschlossen**; M3 ist implementiert, aber **experimentell, vorläufig und noch nicht live abgenommen**. Keine Behauptung eines robust fertigen schreibenden MVP oder tatsächlicher allgemeiner YouTube-Kompatibilität.

## Evidenz klar trennen

| Bereich                        | Beleg / Einordnung                                                                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 live                        | **Nutzerbestätigt:** 4.926/4.926, `complete`, vollständiges JSON lokal gespeichert. YouTubes „Nicht verfügbare Videos anzeigen“ machte die fehlenden 240 sichtbar.                        |
| Eigener Agenten-Live-Test      | Kein eigener automatisierter angemeldeter Live-Nachweis; die M1-Aussage stammt ausdrücklich vom Nutzer.                                                                                   |
| M3 live                        | **Noch kein bestätigter Schreibpilot.** Es wurden keine eigenen Live-Schreibaktionen ausgeführt.                                                                                          |
| Historische 0.2.0-Verifikation | Vollständige lokale Prüffolge erfolgreich: **466/466 Vitest, 48/48 UI**; Push- und PR-CI für `b35391d` ebenfalls erfolgreich, Links unten.                                                |
| Fixtures / Smoke-Test          | Synthetische DOM-/UI-/Executor-Tests bzw. Add-on-Installation sind keine Live-M3-Abnahme.                                                                                                 |
| Distribution                   | `artifacts/latersift-0.2.0-unsigned.xpi` erstellt; echtes MV3-Add-on aus `dist` und finaler XPI erfolgreich in Firefox 157 installiert. Weiterhin unsigniert, keine AMO-Veröffentlichung. |

Der frühere Teilimport in Zen/CachyOS hatte 4.686 statt 4.926 IDs, höchste Position 4.686, unidentifizierbare Zeilen 0 und `incomplete`. Dieser Befund ist durch den späteren nutzerbestätigten vollständigen Scan **als aktueller M1-Abnahmestand überholt**. Die Null bezeichnete nicht die Verfügbarkeit aller Videos. Fortschritt nach Tabaktivierung war eine Beobachtung, kein isolierter Throttling-Nachweis; die 240 später eingeblendeten Einträge dürfen nicht nachträglich als bewiesener Throttlingfehler dargestellt werden.

## Implementierter Stand

Aktueller lesender Feedvertrag ab 0.2.6: [Playlist-Identität und unabhängige Namensevidenz](PLAYLIST-IDENTITY.md). Die historischen M3.2-Dokumente beschreiben ältere Titelsemantik, nicht die heutige Aufnahme namenloser Identitäten.

| Meilenstein  | Vorhanden                                                                                                                                                                 | Grenze / offene Abnahme                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 / M1.1    | DOM-Import, Lazy Loading/Virtualisierung, Vollständigkeitsprüfung, bestätigte Checkpoints, Recovery, Pause/Resume, Diagnose und JSON-Export                               | Vollständiger Live-Scan/Export nutzerbestätigt; keine Garantie für jede DOM-Variante oder einen atomaren Serverbestand                                              |
| M2           | Karten, lokale Entscheidungen, UUIDs, Undo, Runden, Pause/Resume, Tastatur/Pointer, Zusammenfassung                                                                       | Echte Touch-Hardware separat prüfen; Vormerken ist noch keine YouTube-Mutation                                                                                      |
| M3           | Nativer Save-DOM-Adapter, Playlist-Abfrage, Mitgliedschaft, Add/Remove, frische Prüfung, Freigaben, persistentes Journal, sequenzieller Executor, Stoppen und Pilotstufen | Experimentelle fail-closed Grundlage; alle Mutationen können im aktuellen Live-DOM unsupported sein. Erster 1er-Live-Pilot offen; manuelle Wiederfreigabe vorhanden |
| M4 / Betrieb | Konservative Verfügbarkeit, bestätigte lokale Bereinigung, Filter und Testinfrastruktur                                                                                   | Bereinigungs-Writes unterliegen M3-Gates; kein Backup-Import/Restore, keine Signierung/AMO-Abnahme                                                                  |

### M3: unterstützter Vertrag, nicht universeller YouTube-Adapter

- Nativer Save-/Speichern-Dialog mit semantischen Controls und isolierten unterstützten Renderern. Die Watch-URL allein genügt nicht: genau ein sichtbarer `ytd-watch-flexy` muss die angeforderte `video-id` tragen, der Save-Button muss darin liegen. Keine internen Properties oder APIs.
- **Auch WL verlangt einen expliziten Link `/playlist?list=WL` innerhalb derselben Checkbox-Option**, Archiv entsprechend `list=PL…`. Niemals Label allein: eine eigene Playlist namens „Watch later“ darf keinen WL-False-Match auslösen. Ohne WL-Link kein Remove; fehlende Identität ist `unknown`, nicht `absent`.
- Viele aktuelle YouTube-Varianten exponieren diese Links nicht: **Alle Mutationen können unsupported sein**, nicht nur Archivieren. Ehrliche fail-closed Grundlage, aktuelle Live-Kompatibilität unbekannt. Manuelle URL/ID und Titelzuordnung sind kein Bypass. Ab M3.1 gibt `getAvailablePlaylists` nicht identifizierte Zeilen nur zur Diagnose zurück; sie bleiben nicht schreibbar.
- `getPlaylistMembership` öffnet einen frischen Dialog; die Bridge erzwingt vor **jeder** Mitgliedschaftsbeobachtung zusätzlich `reload(..., { bypassCache: true })`, **auch nach Videowechsel**. Navigation allein oder optimistisches Checkbox-Feedback reicht nicht; diese DOM-Evidenz ersetzt keinen Live-Test.
- Die erweiterte Legacy-Discovery über den Save-Dialog und der Schreib-Ausführungsbutton öffnen ausdrücklich einen eigenen aktiven YouTube-Arbeitstab. Aktiv/fokussiert halten; keine wiederholte automatische Aktivierung. Original-WL-Tab und dieser Legacy-Arbeitstab bleiben zur unabhängigen Prüfung erhalten. Nicht mit dem neuen inaktiven Feedscan/WL-Arbeitstab aus M3.2 verwechseln.

### Sicherheitsgates und Wiederaufnahme

1. Neuester Scan muss `complete` sein; ein alter vollständiger Snapshot neben einem neueren Teilimport genügt nicht. Export lokal sichern und ausdrücklich bestätigen. **Verpflichtend im Executor:** `storage.claimExecution` prüft atomar den tatsächlichen vollständigen Snapshot-Datensatz, den kanonischen aktuellen Library-Stand (CAS) und die Freigabe, reserviert den Durchlauf und verbraucht die Freigabe im separaten `state`-Schlüssel `execution-ledger`. Veraltete Klone/Replay werden vor jedem Adapteraufruf abgewiesen; UI-Gates allein genügen nicht.
2. Zusammenfassung ohne Vorauswahl, anfänglich Limit **1**, konkrete Video-IDs/Aktionen/Ziel-URLs und gesonderte Zustimmung. Freigabe maximal 15 Minuten, an exakte Aktionen und Snapshot gebunden, nicht wiederverwendbar. Kein Schreiben beim Start/Scan/Swipe.
3. Persistentes Write-ahead-Journal mit stabilen Entscheidungs- und getrennten Add-/Remove-Schritt-UUIDs. `running` und Versuch vor Klick speichern; danach frisch beobachten und Ergebnis speichern. Speicherfehler stoppen weitere Mutationen. Zusätzlich Content → Background vor **jeder Mutation**: eigene Extension, YouTube-Sender und exakte Video-ID prüfen; Storage autorisiert atomar nur die exakt aktive beanspruchte Freigabe mit persistiertem laufendem WAL-Versuch und passendem Snapshot/Export. Einmaliges Permit pro Versuch im Ledger; rohes Bridge-Grant ohne beanspruchten WAL erlaubt keinen Klick. Background führt keine Jobs/Klicks aus.
4. Archivziel schon vorhanden: kein Add, aber erneut **frisches `present` vor WL-Remove** erforderlich. Fehlgeschlagenes/unbekanntes Add oder fehlende Zielbestätigung verbietet Remove. Teil-Erfolg bleibt separat erhalten.
5. WL vorab extern abwesend: `already_absent`, keine eigene erfolgreiche Änderung und kein blinder Add. `verified` allein belegt nicht, dass LaterSift etwas geändert hat. Mutationen liefern `{ changed: boolean }`; No-op (`false`) ist kein tatsächlicher Pilot-Änderungsnachweis.
6. Unterbrechung/unklarer Klickausgang: `unknown`, keine automatische Wiederholung. Beim Laden werden laufende Operationen von `running` zu `unknown`, laufende Scans zu `interrupted`. Wiederholung nur mit **neuer ausdrücklicher Freigabe und sämtlichen frischen Preflights**; alte Add-Evidenz reicht nicht. Die UI bietet `failed`/`unknown` ausdrücklich zur Wiederwahl an: erst manuell in YouTube prüfen, neu auswählen und neu zustimmen. `verified` bleibt deaktiviert. Widerspricht frischer Zustand einem bereits verifizierten Schritt, stoppt die Entscheidung als `unknown` zur manuellen Klärung; dieser Schritt wird nicht erneut ausgeführt, auch neue Zustimmung überschreibt das nicht.
7. Stoppen **nach der aktuellen Entscheidung**, bei Archivieren einschließlich Add/Remove/Verifikation; kein Rollback. Während Busy sind Schließen/Escape blockiert; Unmount trennt den Port und verhindert späte Panel-Commits. Fortschritt zeigt aktuelle Entscheidung und Ergebniszahlen für `verified`/`failed`/`unknown`.
8. Erst tatsächlich geänderte, verifizierte und direkt in YouTube vom Nutzer bestätigte Pilotentscheidung erlaubt ausdrücklich **1 → 5**. Nach vollständiger 5er-Stufe mit neuem Änderungsnachweis erneut ausdrücklich **5 → 25**. Keine automatische Mock-/Executor-Promotion, kein Hochstufen allein wegen `already_absent`.

### Speicherung / Upgrade / Rechte

Library-Schema **1/2 → 3**, dieselbe IndexedDB `latersift` mit Strukturversion **1**, Stores `state` und `snapshots`; separates Ledger unter `state` → `execution-ledger`, kein DB-Versionswechsel. Vorhandene Entscheidungen und vollständige Snapshots bleiben erhalten; kein destruktiver Store-Neubau. Vor Upgrade trotzdem JSON lokal exportieren und Erweiterungs-ID `latersift@almighty-atlas.github.io` sowie Browserprofil beibehalten. Temporäres Entfernen/Neuinstallation/Profilverlust kann Daten vernichten; der Export ist kein implementierter Restore.

**Keine neuen Privilegien:** weiterhin `unlimitedStorage` und Host `https://www.youtube.com/*`; kein `cookies`, kein `tabs`-Vollzugriff. Die bestehende Host-Berechtigung wird nun zusätzlich für ausdrücklich freigegebene native DOM-Aktionen verwendet. Keine Tokens, internen APIs, Telemetrie oder Serverjobs. Event Page öffnet die App und prüft atomare Permits, führt keine Jobs/Klicks aus.

## Verifikation und nächster Abnahmeschritt

Vollständige lokale Prüffolge für 0.2.0 am 17.10.2026:

- `pnpm check`: **0 Fehler, 0 Warnungen**; Lint und Formatprüfung erfolgreich.
- Vitest: **466/466 in 14 Dateien**, darunter **sechs vollständige Integrationstests** mit realem Executor, IndexedDB, Background-Autorität, Transport und nativem Adapter gegen synthetisches DOM. **Keine echte YouTube-Mutation.**
- UI: **48/48 in Chromium und Firefox**.
- Produktionsbuild erfolgreich; Web-ext: **0 Fehler, 0 Warnungen, 0 Hinweise**.
- Firefox **157**: echtes MV3-Add-on sowohl aus `dist` als auch aus der **finalen XPI** erfolgreich installiert; Installations-, kein Live-YouTube-Nachweis.
- `pnpm package`: `artifacts/latersift-0.2.0-unsigned.xpi` erstellt.

Die vorhandene geprüfte CI enthält bereits die Prüfbefehle und Artefaktbereitstellung; keine Workflow-Änderung nötig. Für Implementierungscommit `b35391d` waren sowohl die [Push-CI](https://github.com/almighty-atlas/latersift/actions/runs/39068907126) als auch die [PR-CI](https://github.com/almighty-atlas/latersift/actions/runs/39068910728) erfolgreich. [PR #2](https://github.com/almighty-atlas/latersift/pull/2) bleibt für Review und die ausdrücklich freigegebene manuelle Pilot-Abnahme offen; Folgeänderungen werden erneut geprüft. Testpaket: `artifacts/latersift-0.2.0-unsigned.xpi` sowie CI-Artefakt `latersift-unsigned`. Reproduktion und manuelle Kriterien: [TESTING.md](TESTING.md).

Der historische M3-Schreibpilot (nicht Teil der aktuellen Freigabe) wäre **genau ein bewusst ausgewähltes entbehrliches Video**, vorzugsweise **gewöhnliches Entfernen zuerst**, mit lokalem vollständigem Backup und unverändert geöffnetem Original-WL-Tab. Ergebnis zusätzlich direkt in YouTube prüfen. Bei nicht unterstütztem DOM oder `unknown` stoppen: keine Gates lockern, Klicks erzwingen, Limits erhöhen oder Speicherzustände umschreiben. Technischen Fehler mit minimalem bereinigtem DOM-Kontext melden, nicht mit vollständigem privatem Seiten-DOM. [Detaillierter erster Pilot](TESTING.md#erster-m3-live-pilot-genau-eine-entscheidung).

Keine Live-M3-Abnahme, garantierte Wiederherstellung oder fertige allgemeine YouTube-Schreibkompatibilität behauptet. Signierung und dauerhafte Installation bleiben separate Betriebsprüfungen, keine Voraussetzung für eine erfundene Erfolgsmeldung.
