// Central labels make a later English translation straightforward.
import type { Availability, DecisionKind, OperationStatus } from './model';
export const availabilityLabels: Record<Availability, string> = {
  available: 'Verfügbarkeit bestätigt',
  private: 'Privat / nicht zugänglich',
  removed: 'Gelöscht',
  restricted: 'Eingeschränkt',
  unknown: 'Verfügbarkeit unbekannt',
};
export const decisionLabels: Record<DecisionKind, string> = {
  remove: 'Entfernen',
  archive: 'Archivieren',
  defer: 'Zurückstellen',
};
export const operationLabels: Record<OperationStatus, string> = {
  pending: 'Lokal ausstehend',
  running: 'Läuft',
  verified: 'Verifiziert',
  failed: 'Fehlgeschlagen',
  unknown: 'Unklar',
};
