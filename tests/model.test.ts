import { expect, it } from 'vitest';
import {
  emptyLibrary,
  safeCandidate,
  type Library,
  type Video,
} from '../src/model';

it('creates independent schema 3 libraries with conservative operation defaults', () => {
  const first = emptyLibrary();
  const second = emptyLibrary();
  expect(first.schemaVersion).toBe(3);
  expect(first.operations).toEqual({ limit: 1, attestations: [] });
  first.operations!.attestations.push({
    limit: 5,
    decisionId: 'pilot',
    confirmedAt: 'now',
  });
  expect(second.operations!.attestations).toEqual([]);
  const legacy: Library = { ...second, schemaVersion: 1 };
  delete legacy.operations;
  expect(legacy.operations).toBeUndefined();
});

it.each(['private', 'removed', 'unknown', 'available', 'restricted'] as const)(
  'only treats explicit private/removed availability as safe (%s)',
  (availability) => {
    expect(safeCandidate({ availability } as Video)).toBe(
      ['private', 'removed'].includes(availability),
    );
  },
);
