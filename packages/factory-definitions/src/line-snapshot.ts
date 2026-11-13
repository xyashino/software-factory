import { createHash } from 'node:crypto';
import {
  lineSnapshotSchema,
  type LineSnapshot,
} from '@repo/factory-core/line/snapshot';
import { err, ok, type Result } from '@repo/factory-core/result';
import { zodErrors, type DefinitionError } from './errors';
import type { Line, LineStation } from './line-schema';
import type { OperatorProfile } from './operator-profile';

/** Placeholder hash used only while the snapshot body is validated. */
const EMPTY_HASH = `sha256:${'0'.repeat(64)}`;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

/** Keys sorted at every depth, no whitespace, `undefined` dropped: one byte form per value. */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
};

/** The canonical JSON text of a value: sorted keys, no whitespace, no `undefined`. */
export const canonicalJson = (value: unknown): string => {
  return JSON.stringify(canonical(value));
};

/**
 * Normalises one Line station into the core Station shape, looking up its
 * operator profile. Plain data: core's schema, not the type, has the last word.
 */
const toStation = (
  station: LineStation,
  line: Line,
  operators: ReadonlyMap<string, OperatorProfile>,
): Record<string, unknown> => {
  const base = {
    id: station.id,
    requires: station.requires,
    ...(station.onFail === undefined ? {} : { onFail: station.onFail }),
    maxRestarts: station.maxRestarts,
    maxLostRestarts: station.maxLostRestarts,
  };
  if (station.kind === 'inspection') {
    return { ...base, kind: 'inspection', artifacts: [], exec: station.exec };
  }
  const pool = line.operators[station.operator];
  const profile = pool === undefined ? undefined : operators.get(pool.profile);
  return {
    ...base,
    kind: 'operator',
    ...(pool === undefined ? {} : { runner: pool.runner }),
    verdict: profile?.verdict ?? false,
    artifacts: Object.keys(profile?.artifacts ?? {}).sort(),
  };
};

/**
 * The Line as the core reads it: stations only, no paths, no operator
 * details. Operator profiles supply the verdict and the artifact keys. The
 * result is validated with core's `lineSnapshotSchema` and hashed.
 */
export const toLineSnapshot = (
  file: string,
  line: Line,
  operators: ReadonlyMap<string, OperatorProfile>,
): Result<LineSnapshot, DefinitionError[]> => {
  const body = {
    snapshotVersion: 1,
    name: line.name,
    stations: line.stations.map((station) =>
      toStation(station, line, operators),
    ),
  };
  const check = lineSnapshotSchema.safeParse({ ...body, hash: EMPTY_HASH });
  if (!check.success) {
    return err(zodErrors(file, check.error));
  }
  const hash = hashLine(check.data);
  return ok({ ...check.data, hash });
};

/**
 * `sha256:<hex>` of the canonical JSON of a snapshot. The `hash` field itself
 * is left out of the hashed bytes, so the hash is a function of the content.
 */
export const hashLine = (
  snapshot: Omit<LineSnapshot, 'hash'> | LineSnapshot,
): string => {
  const body = Object.fromEntries(
    Object.entries(snapshot).filter(([key]) => key !== 'hash'),
  );
  const digest = createHash('sha256').update(canonicalJson(body)).digest('hex');
  return `sha256:${digest}`;
};
