import type { Scan } from '../model';
export interface YouTubeAdapter {
  readonly capabilities: {
    scan: true;
    write: false;
    membership: false;
    playbackCheck: false;
  };
  scanWatchLater(
    signal: AbortSignal,
    checkpoint: (scan: Scan) => Promise<void>,
  ): Promise<Scan>;
}
