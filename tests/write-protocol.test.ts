import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionApproval } from '../src/operations';
import {
  approvedAction,
  validateWriteRequest,
  WRITE_PORT,
} from '../src/write-protocol';

const videoId = 'abcdefghijk';
const target = 'PL1234567890';
function approval(): ExecutionApproval {
  return {
    id: 'approval',
    snapshotId: 'snapshot',
    createdAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    actions: [
      {
        decisionId: 'decision',
        videoId,
        kind: 'archive',
        targetPlaylist: target,
      },
    ],
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('write protocol authority boundary', () => {
  it('uses a separate explicit-write channel', () => {
    expect(WRITE_PORT).toBe('latersift-explicit-actions-v1');
    expect(WRITE_PORT).not.toBe('latersift-readonly-v1');
  });
  it.each(['playlists', 'membership'])(
    'permits unauthenticated read-only %s discovery',
    (method) => {
      const request = { type: 'request', method, videoId, playlistId: 'WL' };
      expect(validateWriteRequest(request)).toBe(request);
    },
  );
  it.each(['add', 'remove'])(
    'rejects %s without approval even with DOM-like authority fields',
    (method) => {
      expect(() =>
        validateWriteRequest({
          type: 'request',
          method,
          videoId,
          playlistId: target,
          approved: true,
          userGesture: true,
        }),
      ).toThrow(/Nutzerfreigabe/);
    },
  );
  it.each([
    null,
    undefined,
    false,
    1,
    'request',
    {},
    { type: 'scan' },
    { type: 'request', method: 'execute', videoId },
    { type: 'request', method: 'playlists', videoId: 'short' },
    { type: 'request', method: 'playlists', videoId: 'abcdefghij!' },
  ])('rejects malformed or unsupported input %j', (value) => {
    expect(() => validateWriteRequest(value)).toThrow();
  });
  it.each(['membership', 'add'])(
    'rejects malformed playlist IDs for %s',
    (method) => {
      for (const playlistId of [
        undefined,
        '',
        'PLshort',
        'WL?x=1',
        'https://youtube.com/playlist?list=PL1234567890',
      ]) {
        expect(() =>
          validateWriteRequest({
            type: 'request',
            method,
            videoId,
            playlistId,
            approval: approval(),
          }),
        ).toThrow(/Playlist-ID/);
      }
    },
  );
  it('binds mutations to the exact approved video, action and archive target', () => {
    const auth = approval();
    const add = {
      type: 'request',
      method: 'add',
      videoId,
      playlistId: target,
      approval: auth,
    };
    expect(validateWriteRequest(add)).toBe(add);
    expect(validateWriteRequest({ ...add, method: 'remove' }).method).toBe(
      'remove',
    );
    expect(() =>
      validateWriteRequest({ ...add, videoId: 'lmnopqrstuv' }),
    ).toThrow(/Video/);
    expect(() =>
      validateWriteRequest({ ...add, playlistId: 'PLabcdefghij' }),
    ).toThrow(/Archivziel/);
    expect(() => validateWriteRequest({ ...add, playlistId: 'WL' })).toThrow(
      /Archivziel/,
    );
    auth.actions[0] = {
      ...auth.actions[0],
      kind: 'remove',
      targetPlaylist: null,
    };
    expect(() => validateWriteRequest(add)).toThrow(/Archivziel/);
    expect(validateWriteRequest({ ...add, method: 'remove' }).method).toBe(
      'remove',
    );
  });
  it('also validates supplied approvals on reads instead of downgrading to discovery', () => {
    const auth = approval();
    auth.expiresAt = new Date(Date.now()).toISOString();
    expect(() =>
      validateWriteRequest({
        type: 'request',
        method: 'playlists',
        videoId,
        approval: auth,
      }),
    ).toThrow(/Nutzerfreigabe/);
  });
  it('expires exactly at the deadline, including an already validated request', () => {
    const auth = approval();
    expect(approvedAction(auth, videoId)).toBe(auth.actions[0]);
    vi.setSystemTime(new Date(auth.expiresAt).getTime() - 1);
    expect(approvedAction(auth, videoId)).toBe(auth.actions[0]);
    vi.advanceTimersByTime(1);
    expect(() => approvedAction(auth, videoId)).toThrow(/Nutzerfreigabe/);
  });
  it.each([
    'missing-id',
    'missing-snapshot',
    'invalid-created',
    'invalid-expiry',
    'future',
    'expired',
    'reversed',
    'too-long',
    'empty',
    'too-many',
    'duplicate-decision',
    'duplicate-video',
    'invalid-video',
    'invalid-kind',
    'invalid-target',
    'remove-with-target',
    'null-action',
  ])('rejects invalid approval: %s', (defect) => {
    const auth = approval();
    // Deliberately untrusted wire data, not an ExecutionApproval assertion.
    const wire = { ...auth, actions: [...auth.actions] };
    let invalid: unknown = wire;
    switch (defect) {
      case 'missing-id':
        wire.id = '';
        break;
      case 'missing-snapshot':
        wire.snapshotId = '';
        break;
      case 'invalid-created':
        wire.createdAt = 'invalid';
        break;
      case 'invalid-expiry':
        wire.expiresAt = 'invalid';
        break;
      case 'future':
        wire.createdAt = new Date(Date.now() + 1).toISOString();
        break;
      case 'expired':
        wire.expiresAt = new Date(Date.now()).toISOString();
        break;
      case 'reversed':
        wire.expiresAt = wire.createdAt;
        break;
      case 'too-long':
        wire.expiresAt = new Date(
          Date.parse(wire.createdAt) + 900_001,
        ).toISOString();
        break;
      case 'empty':
        wire.actions = [];
        break;
      case 'too-many':
        wire.actions = Array.from({ length: 26 }, (_, i) => ({
          ...auth.actions[0],
          decisionId: `d${i}`,
          videoId: String(i).padStart(11, '0'),
        }));
        break;
      case 'duplicate-decision':
        wire.actions.push({ ...auth.actions[0], videoId: 'lmnopqrstuv' });
        break;
      case 'duplicate-video':
        wire.actions.push({ ...auth.actions[0], decisionId: 'other' });
        break;
      case 'invalid-video':
        wire.actions[0] = { ...auth.actions[0], videoId: 'bad' };
        break;
      case 'invalid-kind':
        invalid = { ...wire, actions: [{ ...auth.actions[0], kind: 'defer' }] };
        break;
      case 'invalid-target':
        wire.actions[0] = { ...auth.actions[0], targetPlaylist: 'WL' };
        break;
      case 'remove-with-target':
        wire.actions[0] = { ...auth.actions[0], kind: 'remove' };
        break;
      case 'null-action':
        invalid = { ...wire, actions: [null] };
        break;
    }
    expect(() =>
      validateWriteRequest({
        type: 'request',
        method: 'remove',
        videoId,
        approval: invalid,
      }),
    ).toThrow();
  });
  it('accepts the bounded maximum of 25 unique actions and a 15-minute lifetime', () => {
    const auth = approval();
    auth.expiresAt = new Date(
      Date.parse(auth.createdAt) + 900_000,
    ).toISOString();
    auth.actions = Array.from({ length: 25 }, (_, i) => ({
      decisionId: `d${i}`,
      videoId: String(i).padStart(11, '0'),
      kind: 'remove',
      targetPlaylist: null,
    }));
    expect(approvedAction(auth, auth.actions[24].videoId)).toBe(
      auth.actions[24],
    );
  });
});
