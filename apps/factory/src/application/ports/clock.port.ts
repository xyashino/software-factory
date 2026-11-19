import type { EpochMs } from '../../domain/common/time';

export interface ClockPort {
  now(): EpochMs;
}
