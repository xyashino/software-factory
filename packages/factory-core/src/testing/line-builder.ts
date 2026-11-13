import {
  type LineSnapshot,
  type Station,
  lineSnapshotSchema,
} from '../line/snapshot';
import { stationIdSchema, type StationId } from '../ids';

/** Fields of a Station the builder can set. Defaults match a plain operator Station. */
export interface StationOptions {
  requires?: string[];
  maxRestarts?: number;
  maxLostRestarts?: number;
  artifacts?: string[];
  verdict?: boolean;
  onFail?: { retry: string; max: number };
  exec?: string[];
}

const stationOf = (id: string): StationId => stationIdSchema.parse(id);

const operator = (id: string, options: StationOptions): Station => ({
  id: stationOf(id),
  kind: 'operator',
  runner: 'claude',
  requires: options.requires ?? [],
  maxRestarts: options.maxRestarts ?? 1,
  maxLostRestarts: options.maxLostRestarts ?? 3,
  artifacts: options.artifacts ?? [],
  ...(options.verdict ? { verdict: true } : {}),
  ...(options.onFail
    ? {
        onFail: {
          retry: stationOf(options.onFail.retry),
          max: options.onFail.max,
        },
      }
    : {}),
});

const inspection = (id: string, options: StationOptions): Station => ({
  id: stationOf(id),
  kind: 'inspection',
  requires: options.requires ?? [],
  maxRestarts: options.maxRestarts ?? 1,
  maxLostRestarts: options.maxLostRestarts ?? 3,
  artifacts: options.artifacts ?? [],
  exec: options.exec ?? ['pnpm test'],
  ...(options.onFail
    ? {
        onFail: {
          retry: stationOf(options.onFail.retry),
          max: options.onFail.max,
        },
      }
    : {}),
});

/** Builds a Line snapshot Station by Station, in order. `build()` validates it with the schema. */
export interface LineBuilder {
  operator(id: string, options?: StationOptions): LineBuilder;
  inspection(id: string, options?: StationOptions): LineBuilder;
  build(): LineSnapshot;
}

export const lineBuilder = (name = 'factory-default'): LineBuilder => {
  const stations: Station[] = [];
  const builder: LineBuilder = {
    operator: (id, options = {}) => {
      stations.push(operator(id, options));
      return builder;
    },
    inspection: (id, options = {}) => {
      stations.push(inspection(id, options));
      return builder;
    },
    build: () =>
      lineSnapshotSchema.parse({
        snapshotVersion: 1,
        name,
        hash: `sha256:${'a'.repeat(64)}`,
        stations,
      }),
  };
  return builder;
};
