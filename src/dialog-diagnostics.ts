// Only fixed vocabulary and numeric observations may cross into a copyable report.
export const failureReasons = {
  'focus-lost': 'Der YouTube-Arbeitstab ist nicht aktiv und fokussiert.',
  aborted: 'Die Abfrage wurde abgebrochen.',
  'video-context':
    'Der angeforderte Video-Kontext ist nicht eindeutig bestätigt.',
  'youtube-error':
    'YouTube meldet einen Fehler oder ein Limit; dessen Inhalt wird nicht kopiert.',
  'dialog-already-open': 'Vor der Abfrage war bereits ein Dialog geöffnet.',
  'save-control':
    'Der Save-/Speichern-Button fehlt, ist deaktiviert oder mehrdeutig.',
  'ambiguous-dialog': 'Mehrere sichtbare Dialoge oder Dialogwurzeln erkannt.',
  'dialog-changed': 'Der Dialog wurde geschlossen oder ersetzt.',
  'sheet-popup': 'Dem Sheet fehlen die erwarteten Dropdown-/Popup-Vorfahren.',
  'sheet-layout': 'Das Sheet hat kein eindeutig sichtbares Layout.',
  'sheet-header':
    'Der Sheet-Header fehlt, ist mehrdeutig oder trägt keinen unterstützten Save-Titel.',
  'no-playlist-rows':
    'Der Dialog wurde erkannt, aber nach zehn Sekunden fehlen unterstützte sichtbare Playlist-Zeilen.',
  'unsupported-structure':
    'Die sichtbare Dialog- oder Zeilenstruktur wird nicht unterstützt.',
  'ambiguous-identity':
    'Playlist-Links sind widersprüchlich oder nicht eindeutig.',
  timeout:
    'Der erwartete Dialogzustand wurde nicht innerhalb von zehn Sekunden erkannt.',
  'connection-unavailable':
    'Keine abgeschlossene Antwort aus dem YouTube-Arbeitstab verfügbar.',
  'diagnosis-unavailable':
    'Kein gültiger bereinigter DOM-Diagnosebericht verfügbar.',
} as const;
export type DialogFailure = keyof typeof failureReasons;
export const unsupportedReasons = {
  'sheet-readonly': 'Neue Sheets werden ausschließlich lesend unterstützt.',
  'unproven-identity':
    'Keine eindeutige Playlist-ID durch einen expliziten Zeilenlink belegt.',
  'ambiguous-identity': 'Mehrdeutige oder doppelte Playlist-Link-Identität.',
  'unknown-selection': 'Der UI-Auswahlzustand fehlt oder ist ungültig.',
  'conflicting-selection': 'Die UI-Auswahlzustände widersprechen sich.',
  'disabled-control': 'Der Eintrag oder sein Auswahl-Control ist deaktiviert.',
  'missing-name':
    'Der zugängliche Name fehlt oder ist nicht eindeutig zugeordnet.',
  'unsupported-row': 'Die Struktur des Eintrags wird nicht unterstützt.',
  'incomplete-id-map':
    'Mindestens ein Dialogeintrag hat keine belegte ID; Legacy-Archivziel bleibt gesperrt.',
  'unverified-dialog':
    'Der zugehörige Save-Dialog ist nicht eindeutig bestätigt.',
} as const;
export type UnsupportedReason = keyof typeof unsupportedReasons;
// A closed vocabulary prevents even attribute names containing private data from leaking.
export const publicAttributeNames = [
  'id',
  'role',
  'href',
  'aria-label',
  'aria-labelledby',
  'aria-pressed',
  'aria-checked',
  'aria-disabled',
  'aria-hidden',
  'disabled',
  'hidden',
  'inert',
  'playlist-id',
  'data-playlist-id',
  'list-id',
  'data-list-id',
  'data-id',
  'browse-id',
  'data-browse-id',
  'data-target-id',
] as const;
export type PublicAttributeName = (typeof publicAttributeNames)[number];
export interface DialogDiagnostic {
  schemaVersion: 1;
  variant: 'legacy' | 'sheet' | 'unsupported';
  playlistRows: number;
  selectionStates: { valid: number; unknown: number; contradictory: number };
  provenPlaylistIds: number;
  unidentifiedRows: number;
  publicAttributeNames: PublicAttributeName[];
  failureReason: DialogFailure | null;
  rows: {
    index: number;
    uiState: 'valid' | 'unknown' | 'contradictory';
    identity: 'explicit-link' | 'unverified' | 'ambiguous';
    unsupportedReasons: UnsupportedReason[];
  }[];
}
export function emptyDialogDiagnostic(
  failureReason: DialogFailure,
): DialogDiagnostic {
  return {
    schemaVersion: 1,
    variant: 'unsupported',
    playlistRows: 0,
    selectionStates: { valid: 0, unknown: 0, contradictory: 0 },
    provenPlaylistIds: 0,
    unidentifiedRows: 0,
    publicAttributeNames: [],
    failureReason,
    rows: [],
  };
}
const own = (map: object, key: unknown): key is string =>
  typeof key === 'string' && Object.hasOwn(map, key);
const count = (n: unknown): number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000
    ? n
    : 0;
/** Reconstruct, never spread wire objects, DOM data, or Error.message into the report. */
export function sanitizeDialogDiagnostic(value: unknown): DialogDiagnostic {
  if (!value || typeof value !== 'object')
    return emptyDialogDiagnostic('diagnosis-unavailable');
  const data = value as Partial<DialogDiagnostic>;
  if (
    data.schemaVersion !== 1 ||
    !Array.isArray(data.rows) ||
    data.rows.length > 1000
  )
    return emptyDialogDiagnostic('diagnosis-unavailable');
  return {
    schemaVersion: 1,
    variant:
      data.variant === 'legacy' || data.variant === 'sheet'
        ? data.variant
        : 'unsupported',
    playlistRows: count(data.playlistRows),
    selectionStates: {
      valid: count(data.selectionStates?.valid),
      unknown: count(data.selectionStates?.unknown),
      contradictory: count(data.selectionStates?.contradictory),
    },
    provenPlaylistIds: count(data.provenPlaylistIds),
    unidentifiedRows: count(data.unidentifiedRows),
    publicAttributeNames: publicAttributeNames.filter(
      (name) =>
        Array.isArray(data.publicAttributeNames) &&
        data.publicAttributeNames.includes(name),
    ),
    failureReason:
      data.failureReason === null
        ? null
        : own(failureReasons, data.failureReason)
          ? (data.failureReason as DialogFailure)
          : 'diagnosis-unavailable',
    rows: data.rows.map((row, index) => ({
      index: index + 1,
      uiState:
        row?.uiState === 'valid' || row?.uiState === 'contradictory'
          ? row.uiState
          : 'unknown',
      identity:
        row?.identity === 'explicit-link' || row?.identity === 'ambiguous'
          ? row.identity
          : 'unverified',
      unsupportedReasons: (
        Object.keys(unsupportedReasons) as UnsupportedReason[]
      ).filter(
        (reason) =>
          Array.isArray(row?.unsupportedReasons) &&
          row.unsupportedReasons.includes(reason),
      ),
    })),
  };
}
export function formatDialogDiagnostic(value: DialogDiagnostic): string {
  const report = sanitizeDialogDiagnostic(value);
  return JSON.stringify(
    {
      ...report,
      uiStateIsNotPersistedMembership: true,
      failureExplanation: report.failureReason
        ? failureReasons[report.failureReason]
        : null,
      rows: report.rows.map((row) => ({
        ...row,
        unsupportedExplanations: row.unsupportedReasons.map(
          (reason) => unsupportedReasons[reason],
        ),
      })),
    },
    null,
    2,
  );
}
