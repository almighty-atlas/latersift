# Version und integrierte Dialogdiagnose (0.2.2)

Die Versionsmarke im Header liest `browser.runtime.getManifest().version` des installierten Add-ons. Sie bleibt auf schmalen Ansichten sichtbar. Im lokalen UI-Preview ohne Manifest-API steht ausdrücklich „Version unbekannt“; es gibt keine fest codierte Ersatzversion.

## Nächster Zen-Test – ausschließlich lesend

1. 0.2.2 im bestehenden Profil mit derselben Erweiterungs-ID laden. Version im Header prüfen; vorhandenes JSON vor dem Update lokal sichern.
2. Archivziel öffnen → **Playlists aus YouTube laden**. Den eigenen YouTube-Arbeitstab bis zum Abschluss aktiv/fokussiert lassen. Keine Playlist-Schaltflächen betätigen.
3. Zurück in LaterSift **Technische YouTube-Dialogdiagnose** aufklappen. Der Bericht ist nach Erfolg und nach Erkennungsfehlern verfügbar. Bei Problemen vor einer Content-Antwort steht stattdessen ein bereinigter Verbindungs-/Diagnosefehler bereit.
4. **Diagnose kopieren** wählen. Falls der Browser die Zwischenablage ablehnt, den schreibgeschützten Bericht markieren und manuell kopieren. Dafür wird keine zusätzliche Browser-Berechtigung angefordert.
5. Bericht mit der Version im Header melden. Die Namen bleiben nur in der normalen Playlist-Anzeige; der kopierbare Bericht enthält sie nicht.

## Bedeutung und Datenschutz

Der JSON-Bericht enthält die erkannte Variante `legacy`, `sheet` oder `unsupported`, Zeilenzahl, gültige/unbekannte/widersprüchliche UI-Zustände, Zahl eindeutig belegter Zeilen-IDs, Zahl nicht identifizierter Zeilen, eine feste Auswahl bekannter öffentlicher Attributnamen und feste Fehler-/Sperrgründe pro nummerierter Zeile. Unbekannte frei benannte Attribute werden ausgeschlossen, weil sogar ein Attributname private Daten enthalten könnte. Attributwerte werden nie ausgegeben.

`provenPlaylistIds` zählt nur eindeutige explizite YouTube-Playlist-Links innerhalb einer passenden Zeile eines eindeutig erkannten Save-Dialogs. Widersprüchliche oder doppelte Link-IDs zählen nicht als belegt. **Es werden keine tatsächlichen ID-Werte kopiert.** Ohne bestätigten Dialog können trotzdem erkennbare Zeilen und deren UI-Zustände zur Diagnose gezählt werden; ihre Identität bleibt unbestätigt.

UI-Zustand und Identität sind getrennte Felder. Ein gültiges `aria-pressed` oder ein belegter Link beweist keine dauerhaft gespeicherte Mitgliedschaft. Sheets bleiben vollständig für Schreibaktionen gesperrt. Legacy-Archivziele bleiben bei unvollständiger ID-Zuordnung gesperrt. Die bestehenden Freigaben, das Journal und das Pilotlimit werden nicht verändert.

Die Diagnose wird innerhalb derselben vorhandenen Playlist-Antwort mitgegeben; es gibt keinen zusätzlichen Browserauftrag, keine API-/Netzwerkanfrage und keine automatische Übermittlung. Sie liegt nur im Arbeitsspeicher der App, nicht im Backup oder in IndexedDB. Bei einem Fehler nach erfolgreichem Lesen kann der letzte gelesene Zählerstand mit dem abschließenden Fehlergrund erhalten bleiben.

Der kopierbare Bericht wird beim Content-Transport, beim Empfang und vor der Formatierung aus einem festen Schema neu aufgebaut. Er enthält keine Playlist-Namen, Video-/Playlist-IDs, Cookies, Tokens, URL-Parameter, Attributwerte, DOM-Inhalte oder rohen Fehlermeldungen. Fehler aus YouTube können weiterhin als bisherige Meldung in der normalen Oberfläche erscheinen; sie gelangen nicht in den Bericht.

## Prüfung und Grenzen

Regressionen prüfen eine von der Paketversion abweichende synthetische Manifestversion, Desktop-/Mobilanzeige, beide Discovery-Ausgänge, Zwischenablage-Erfolg/-Ablehnung, private Daten in Fehlern/Attributen/Transportfeldern, Legacy-Verhalten und den vollständigen bestehenden Sicherheitspfad. Fixtures sind kein angemeldeter Zen-/YouTube-Live-Nachweis. Es wurden keine echten Schreibtests durchgeführt.

Aktuelle Prüfergebnisse und Paket: [STATUS.md](STATUS.md). DOM-Vertrag und Identitätsgrenzen: [M3.1.md](M3.1.md).
