import { parse } from 'yaml';
import { z } from 'zod';

const DEFAULT_MAX_ATTEMPTS = 1;

const onFailSchema = z.looseObject({
  retry: z.string().trim().min(1).optional(),
  max: z.number().int().min(1).optional(),
});

const commandBlockSchema = z.looseObject({
  exec: z.array(z.string().trim().min(1)).default([]),
});

const operatorSchema = z.looseObject({
  profile: z.string().trim().min(1).optional(),
  runner: z.string().trim().min(1).optional(),
});

const stationSchema = z.looseObject({
  id: z.string().trim().min(1),
  kind: z.string().trim().min(1),
  operator: z.string().trim().min(1).optional(),
  requiredFiles: z.array(z.string().trim().min(1)).default([]),
  inputs: z.array(z.string().trim().min(1)).default([]),
  exec: z.array(z.string().trim().min(1)).default([]),
  runner: z.string().trim().min(1).optional(),
  onFail: onFailSchema.optional(),
});

const lineSchema = z.looseObject({
  name: z.string().trim().min(1),
  operators: z.record(z.string(), operatorSchema).default({}),
  stations: z.array(stationSchema).min(1),
  workspace: z
    .looseObject({
      sync: commandBlockSchema.optional(),
      setup: commandBlockSchema.optional(),
    })
    .optional(),
  deliver: z.looseObject({}).optional(),
});

export interface LineStation {
  stationId: string;
  stepIndex: number;
  kind: string;
  requiredFiles: string[];
  exec: string[];
  inputs: string[];
  runner: string | null;
  profile: string | null;
  maxAttempts: number;
  onFailRetryStationId: string | null;
}

export interface LineSnapshot {
  name: string;
  prepare: string[];
  stations: LineStation[];
}

const toStation = (
  station: z.infer<typeof stationSchema>,
  stepIndex: number,
  operators: z.infer<typeof lineSchema>['operators'],
): LineStation => ({
  stationId: station.id,
  stepIndex,
  kind: station.kind,
  requiredFiles: station.requiredFiles,
  exec: station.exec,
  inputs: station.inputs,
  runner:
    station.runner ??
    (station.operator === undefined
      ? null
      : (operators[station.operator]?.runner ?? null)),
  profile:
    station.operator === undefined
      ? null
      : (operators[station.operator]?.profile ?? null),
  maxAttempts: station.onFail?.max ?? DEFAULT_MAX_ATTEMPTS,
  onFailRetryStationId: station.onFail?.retry ?? null,
});

const DELIVER_STATION_ID = 'deliver';

const deliverStationOf = (stepIndex: number): LineStation => ({
  stationId: DELIVER_STATION_ID,
  stepIndex,
  kind: 'deliver',
  requiredFiles: [],
  exec: [],
  inputs: [],
  runner: null,
  profile: null,
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  onFailRetryStationId: null,
});

export const parseLine = (text: string): LineSnapshot => {
  const line = lineSchema.parse(parse(text));
  const stations = line.stations.map((station, stepIndex) =>
    toStation(station, stepIndex, line.operators),
  );
  if (line.deliver !== undefined) {
    stations.push(deliverStationOf(stations.length));
  }
  return {
    name: line.name,
    prepare: [
      ...(line.workspace?.sync?.exec ?? []),
      ...(line.workspace?.setup?.exec ?? []),
    ],
    stations,
  };
};

/** The snapshot as factory-server reads it: `id` for the station, no Cell-only fields. */
export const toWireSnapshot = (snapshot: LineSnapshot) => ({
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
