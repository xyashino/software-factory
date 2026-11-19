import { parse } from 'yaml';
import { z } from 'zod';

const DEFAULT_MAX_ATTEMPTS = 1;

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

const lineSchema = z.looseObject({
  name: z.string().trim().min(1),
  stations: z.array(stationSchema).min(1),
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

export const parseLine = (text: string): LineSnapshot => {
  const line = lineSchema.parse(parse(text));
  return {
    name: line.name,
    stations: line.stations.map(toStation),
  };
};
