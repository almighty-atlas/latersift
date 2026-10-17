export type Availability =
  'available' | 'private' | 'removed' | 'restricted' | 'unknown';
export interface Video {
  id: string;
  url: string;
  title: string | null;
  channel: string | null;
  thumbnail: string | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  position: number | null;
  availability: Availability;
  evidence: string | null;
  scannedAt: string;
  originalPlaylist: 'WL';
}
export interface Scan {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'complete' | 'interrupted' | 'incomplete' | 'failed';
  expectedCount: number | null;
  videos: Video[];
  unidentifiableRows: number;
  message: string;
}
export type DecisionKind = 'remove' | 'archive' | 'defer';
export type OperationStatus =
  'pending' | 'running' | 'verified' | 'failed' | 'unknown';
export interface Decision {
  id: string;
  videoId: string;
  sessionId: string;
  kind: DecisionKind;
  targetPlaylist: string | null;
  createdAt: string;
  status: OperationStatus;
}
export interface Session {
  id: string;
  size: number;
  videoIds: string[];
  paused: boolean;
  createdAt: string;
}
export interface Library {
  schemaVersion: 1;
  scans: Scan[];
  decisions: Decision[];
  session: Session | null;
  archivePlaylist: string;
}
export const emptyLibrary = (): Library => ({
  schemaVersion: 1,
  scans: [],
  decisions: [],
  session: null,
  archivePlaylist: '',
});
export const latestScan = (lib: Library) => lib.scans.at(-1);
export const safeCandidate = (v: Video) =>
  v.availability === 'private' || v.availability === 'removed';
export interface VideoRecommendationProvider {
  recommend(
    video: Video,
  ): Promise<{ action: 'keep' | 'remove'; reason: string } | null>;
}
