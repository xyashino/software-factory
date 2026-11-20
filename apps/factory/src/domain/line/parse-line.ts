import { parse } from 'yaml';
import { z } from 'zod';

const DEFAULT_MAX_ATTEMPTS = 1;
const DELIVER_STATION_ID = 'deliver';
const DURATION = /^(\d+)(s|m|h)$/;
const MS_PER_UNIT: Record<string, number> = {
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
  operator: z.string().trim().min(1).optional(),
  exec: z.array(z.string().trim().min(1)).default([]),
  inputs: z.array(z.string().trim().min(1)).default([]),
  timeout: z.string().trim().optional(),
  onFail: onFailSchema.optional(),
});

const operatorSchema = z.looseObject({
  profile: z.string().trim().min(1).optional(),
  runner: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  timeout: z.string().trim().optional(),
  headless: z.boolean().default(true),
  permission: z.enum(['read', 'write']).default('write'),
});

const lineSchema = z.looseObject({
  name: z.string().trim().min(1),
  stations: z.array(stationSchema).min(1),
  operators: z.record(z.string(), operatorSchema).default({}),
  workspace: z
    .looseObject({
      setup: z
        .looseObject({ exec: z.array(z.string().trim().min(1)).default([]) })
        .optional(),
    })
    .optional(),
  deliver: z.looseObject({ requireAdr: z.boolean().default(false) }).optional(),
});

export interface LineStation {
  stationId: string;
  stepIndex: number;
  kind: string;
  requiredFiles: string[];
  runner: string | null;
  maxAttempts: number;
  onFailRetryStationId: string | null;
  profile: string | null;
  model: string | null;
  exec: string[];
  inputs: string[];
  headless: boolean;
  permission: 'read' | 'write';
  timeoutMs: number | null;
}

export interface LineSnapshot {
  name: string;
  stations: LineStation[];
  setup: string[];
  requireAdr: boolean;
}

export interface WireStation {
  id: string;
  kind: string;
  requiredFiles: string[];
  maxAttempts: number;
  onFailRetryStationId?: string;
}

const durationMs = (text: string | undefined): number | null => {
  const match = text === undefined ? null : DURATION.exec(text);
  return match ? Number(match[1]) * (MS_PER_UNIT[match[2] ?? ''] ?? 0) : null;
};

const toStation = (
  station: z.infer<typeof stationSchema>,
  stepIndex: number,
  operators: Record<string, z.infer<typeof operatorSchema>>,
): LineStation => {
  const operator =
    station.operator === undefined ? undefined : operators[station.operator];
  return {
    stationId: station.id,
    stepIndex,
    kind: station.kind,
    requiredFiles: station.requiredFiles,
    runner: station.runner ?? operator?.runner ?? null,
    maxAttempts: station.onFail?.max ?? DEFAULT_MAX_ATTEMPTS,
    onFailRetryStationId: station.onFail?.retry ?? null,
    profile: operator?.profile ?? station.operator ?? null,
    model: operator?.model ?? null,
    exec: station.exec,
    inputs: station.inputs,
    headless: operator?.headless ?? true,
    permission: operator?.permission ?? 'write',
    timeoutMs: durationMs(station.timeout ?? operator?.timeout),
  };
};

export const parseLine = (text: string): LineSnapshot => {
  const line = lineSchema.parse(parse(text));
  const stations = line.stations.map((station, index) =>
    toStation(station, index, line.operators),
  );
  // Line files declare delivery as a top-level `deliver` block; the server wants it as the last station.
  if (
    line.deliver !== undefined &&
    stations.every((station) => station.kind !== 'deliver')
  ) {
    stations.push({
      stationId: DELIVER_STATION_ID,
      stepIndex: stations.length,
      kind: 'deliver',
      requiredFiles: [],
      runner: null,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      onFailRetryStationId: null,
      profile: null,
      model: null,
      exec: [],
      inputs: [],
      headless: true,
      permission: 'write',
      timeoutMs: null,
    });
  }
  return {
    name: line.name,
    stations,
    setup: line.workspace?.setup?.exec ?? [],
    requireAdr: line.deliver?.requireAdr ?? false,
  };
};

export const wireSnapshotOf = (
  snapshot: LineSnapshot,
): { name: string; stations: WireStation[] } => ({
  name: snapshot.name,
  stations: snapshot.stations.map((station) => ({
    id: station.stationId,
    kind: station.kind,
    requiredFiles: station.requiredFiles,
    maxAttempts: station.maxAttempts,
    ...(station.onFailRetryStationId === null
      ? {}
      : { onFailRetryStationId: station.onFailRetryStationId }),
  })),
});
