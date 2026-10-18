import type { Scan } from '../model';
import type { ScanOptions } from './scanner';
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
    resume?: Scan,
    options?: ScanOptions,
  ): Promise<Scan>;
}
