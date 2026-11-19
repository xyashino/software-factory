import type { EpochMs } from '../../domain/common/time';

export interface ClockPort {
  now(): EpochMs;
  sleep(ms: number): Promise<void>;
}
