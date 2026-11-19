import { parse } from 'yaml';
import { z } from 'zod';

const DEFAULT_MAX_ATTEMPTS = 1;
const DEFAULT_MECHANIC_TIMEOUT_MS = 30 * 60_000;
const DURATION = /^(\d+)([smh])$/;
const UNIT_MS: Readonly<Record<string, number | undefined>> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
};

const onFailSchema = z.looseObject({
  retry: z.string().trim().min(1).optional(),
  max: z.number().int().min(1).optional(),
});

const stationSchema = z.looseObject({
  id: z.string().trim().min(1),
  kind: z.string().trim().min(1),
  requiredFiles: z.array(z.string().trim().min(1)).default([]),
  runner: z.string().trim().min(1).optional(),
  onFail: onFailSchema.optional(),
});

const mechanicSchema = z.looseObject({
  timeout: z.string().trim().min(1).optional(),
});

const lineSchema = z.looseObject({
  name: z.string().trim().min(1),
  stations: z.array(stationSchema).min(1),
  mechanic: mechanicSchema.optional(),
});

export interface LineStation {
  stationId: string;
  stepIndex: number;
  kind: string;
  requiredFiles: string[];
  runner: string | null;
  maxAttempts: number;
  onFailRetryStationId: string | null;
}

export interface LineSnapshot {
  name: string;
  stations: LineStation[];
}

const toStation = (
  station: z.infer<typeof stationSchema>,
  stepIndex: number,
): LineStation => ({
  stationId: station.id,
  stepIndex,
  kind: station.kind,
  requiredFiles: station.requiredFiles,
  runner: station.runner ?? null,
  maxAttempts: station.onFail?.max ?? DEFAULT_MAX_ATTEMPTS,
  onFailRetryStationId: station.onFail?.retry ?? null,
});

const durationMs = (text: string): number => {
  const match = DURATION.exec(text);
  const unit = match === null ? undefined : UNIT_MS[match[2] ?? ''];
  if (match === null || unit === undefined) {
    throw new Error(`invalid duration "${text}", use e.g. 30s, 40m or 1h`);
  }
  return Number(match[1]) * unit;
};

export const parseLine = (text: string): LineSnapshot => {
  const line = lineSchema.parse(parse(text));
  return {
    name: line.name,
    stations: line.stations.map(toStation),
  };
};

/** The Mechanic's timeout from the line's `mechanic` block; the default when the line has none. */
export const mechanicTimeoutMs = (text: string): number => {
  const timeout = lineSchema.parse(parse(text)).mechanic?.timeout;
  return timeout === undefined
    ? DEFAULT_MECHANIC_TIMEOUT_MS
    : durationMs(timeout);
};
