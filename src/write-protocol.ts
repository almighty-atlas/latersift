import type { ApprovedAction, ExecutionApproval } from './operations';

export const WRITE_PORT = 'latersift-explicit-actions-v1';
export const AUTHORIZE_MUTATION = 'latersift-authorize-mutation-v1';
export type WriteMethod = 'playlists' | 'membership' | 'add' | 'remove';
export interface WriteRequest {
  type: 'request';
  method: WriteMethod;
  videoId: string;
  playlistId?: string;
  approval?: ExecutionApproval;
}
const validVideo = (id: unknown): id is string =>
  typeof id === 'string' && /^[\w-]{11}$/.test(id);
const validPlaylist = (id: unknown): id is string =>
  typeof id === 'string' && /^PL[\w-]{10,100}$/.test(id);

/** Only extension-authenticated callers reach this validator. No DOM-supplied authority. */
export function approvedAction(
  approval: ExecutionApproval,
  videoId: string,
): ApprovedAction {
  const created = Date.parse(approval?.createdAt),
    expires = Date.parse(approval?.expiresAt);
  if (
    !approval?.id ||
    !approval.snapshotId ||
    !Number.isFinite(created) ||
    !Number.isFinite(expires) ||
    created > Date.now() ||
    expires <= Date.now() ||
    expires <= created ||
    expires - created > 15 * 60 * 1000 ||
    !Array.isArray(approval.actions) ||
    approval.actions.length < 1 ||
    approval.actions.length > 25
  )
    throw new Error('Keine gültige zeitlich begrenzte Nutzerfreigabe.');
  const ids = new Set<string>(),
    videos = new Set<string>();
  for (const action of approval.actions) {
    if (
      !action ||
      !action.decisionId ||
      ids.has(action.decisionId) ||
      !validVideo(action.videoId) ||
      videos.has(action.videoId) ||
      !['remove', 'archive'].includes(action.kind) ||
      (action.kind === 'archive'
        ? !validPlaylist(action.targetPlaylist)
        : action.targetPlaylist !== null)
    )
      throw new Error('Nicht eindeutige oder ungültige Freigabe.');
    ids.add(action.decisionId);
    videos.add(action.videoId);
  }
  const action = approval.actions.find((a) => a.videoId === videoId);
  if (!action) throw new Error('Dieses Video wurde nicht freigegeben.');
  return action;
}
export function validateWriteRequest(value: unknown): WriteRequest {
  if (!value || typeof value !== 'object')
    throw new Error('Ungültige Anfrage.');
  const request = value as WriteRequest;
  if (
    request.type !== 'request' ||
    !['playlists', 'membership', 'add', 'remove'].includes(request.method) ||
    !validVideo(request.videoId)
  )
    throw new Error('Nicht unterstützte Anfrage.');
  if (
    (request.method === 'membership' || request.method === 'add') &&
    request.playlistId !== 'WL' &&
    !validPlaylist(request.playlistId)
  )
    throw new Error('Ungültige Playlist-ID.');
  if (request.approval) approvedAction(request.approval, request.videoId);
  if (request.method === 'add' || request.method === 'remove') {
    if (!request.approval)
      throw new Error('Schreiben ohne konkrete Nutzerfreigabe gesperrt.');
    const action = approvedAction(request.approval, request.videoId);
    if (
      request.method === 'add' &&
      (action.kind !== 'archive' ||
        action.targetPlaylist !== request.playlistId)
    )
      throw new Error('Nicht freigegebenes Archivziel.');
  }
  return request;
}
