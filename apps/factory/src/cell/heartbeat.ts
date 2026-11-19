import { heartbeatVerdict } from '../domain/cell/cell-loop';
import type { ClockPort } from '../application/ports/clock.port';

export interface HeartbeatOptions {
  clock: ClockPort;
  intervalMs: number;
  beat: () => Promise<readonly string[]>;
  onAbort: () => void;
}

export interface Heartbeat {
  stop: () => void;
}

export const startHeartbeat = (options: HeartbeatOptions): Heartbeat => {
  let failures = 0;
  let stopped = false;

  const tick = async (): Promise<'continue' | 'abort'> => {
    try {
      const signals = await options.beat();
      failures = 0;
      return heartbeatVerdict(failures, signals);
    } catch {
      failures += 1;
      return heartbeatVerdict(failures, []);
    }
  };

  const loop = async (): Promise<void> => {
    while (!stopped) {
      await options.clock.sleep(options.intervalMs);
      if (stopped) {
        return;
      }
      if ((await tick()) === 'abort') {
        stopped = true;
        options.onAbort();
        return;
      }
    }
  };

  void loop();
  return {
    stop: () => {
      stopped = true;
    },
  };
};
