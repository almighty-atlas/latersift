import type { YouTubeAdapter } from './types';
import { scanWatchLater, type ScanEnvironment } from './scanner';
// Deliberately read-only until the mandatory authenticated M1 evidence exists.
export function createYouTubeAdapter(env: ScanEnvironment): YouTubeAdapter {
  return {
    capabilities: {
      scan: true,
      write: false,
      membership: false,
      playbackCheck: false,
    },
    scanWatchLater: (signal, checkpoint) =>
      scanWatchLater(env, signal, checkpoint),
  };
}
