import type { Result } from '../result';
import { err, ok } from '../result';
import { type StoredEvent, storedEventSchema } from './events';

const CURRENT_SCHEMA_VERSION = 3;

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A pinned Line snapshot of version 1 as version 2 (CORE §11). The only change is the workspace: `setup` was
 * the one changeover, and it becomes `changeover`. Stations and deliver without a changeover keep the line's,
 * as they always did, so the upcast changes no meaning. The stored hash stays: it names the bytes already stored.
 */
const upcastSnapshotV1 = (snapshot: Json): Json => {
  const { workspace } = snapshot;
  if (!isRecord(workspace)) return { ...snapshot, snapshotVersion: 2 };
  const { setup, ...rest } = workspace;
  return {
    ...snapshot,
    snapshotVersion: 2,
    workspace: setup === undefined ? rest : { ...rest, changeover: setup },
  };
};

/** A pinned Line (`order_created`, `spec_updated`): its snapshot upcast when it is version 1. */
const upcastPinnedLine = (line: unknown): unknown => {
  if (!isRecord(line) || !isRecord(line.snapshot)) return line;
  if (line.snapshot.snapshotVersion !== 1) return line;
  return { ...line, snapshot: upcastSnapshotV1(line.snapshot) };
};

/**
 * Version 2 to version 3: the workspace stage `setup` is `changeover`, and a pinned snapshot of version 1 is
 * upcast with it. Every other event is unchanged.
 */
const upcastV2 = (raw: Json): Json => {
  const { event } = raw;
  if (!isRecord(event)) return { ...raw, schemaVersion: 3 };
  let next: Json = event;
  if (event.type === 'workspace_failed' && event.stage === 'setup') {
    next = { ...next, stage: 'changeover' };
  }
  if (
    (event.type === 'order_created' || event.type === 'spec_updated') &&
    event.line !== undefined
  ) {
    next = { ...next, line: upcastPinnedLine(event.line) };
  }
  return { ...raw, schemaVersion: 3, event: next };
};

/**
 * Stored schema version to the next one. Version 3 is current, so its upcaster is the identity.
 * Version 2 upcasts to version 3 (CORE §11).
 */
const UPCASTERS: Readonly<Record<number, (raw: unknown) => unknown>> = {
  2: (raw) => (isRecord(raw) ? upcastV2(raw) : raw),
  [CURRENT_SCHEMA_VERSION]: (raw) => raw,
};

const versionOf = (raw: unknown): number | undefined => {
  if (typeof raw !== 'object' || raw === null || !('schemaVersion' in raw))
    return undefined;
  const version = raw.schemaVersion;
  return typeof version === 'number' ? version : undefined;
};

/**
 * Turns a stored event of any known version into the current envelope, validated with zod.
 * An unknown version or an invalid event is an error: a stored event is never skipped (CORE §3.2).
 */
export const upcastEvent = (raw: unknown): Result<StoredEvent, string> => {
  const version = versionOf(raw);
  if (version === undefined) return err('stored event has no schemaVersion');
  const upcaster = UPCASTERS[version];
  if (!upcaster) return err(`no upcaster for schemaVersion ${version}`);
  const parsed = storedEventSchema.safeParse(upcaster(raw));
  if (!parsed.success)
    return err(`invalid stored event: ${parsed.error.message}`);
  return ok(parsed.data);
};
