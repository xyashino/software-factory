import type { Result } from '../result';
import { err, ok } from '../result';
import { type StoredEvent, storedEventSchema } from './events';

const CURRENT_SCHEMA_VERSION = 2;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Removes `requires` from every station of a pinned Line snapshot. Events stored before the
// capabilities were removed still carry it; no current Line has it, so the strict schema refuses it.
const withoutRequires = (
  raw: Record<string, unknown>,
): Record<string, unknown> => {
  const { event } = raw;
  if (!isRecord(event) || !isRecord(event.line)) return raw;
  const { snapshot } = event.line;
  if (!isRecord(snapshot) || !Array.isArray(snapshot.stations)) return raw;
  const stations = snapshot.stations.map((station: unknown) => {
    if (!isRecord(station) || !('requires' in station)) return station;
    const copy = { ...station };
    delete copy.requires;
    return copy;
  });
  return {
    ...raw,
    event: {
      ...event,
      line: { ...event.line, snapshot: { ...snapshot, stations } },
    },
  };
};

// Stored schema version to the next one. Version 2 is current; its upcaster only drops the `requires`
// key that pre-removal events carry. Adding version 3 means adding an entry here that returns a version-3
// envelope.
const UPCASTERS: Readonly<Record<number, (raw: unknown) => unknown>> = {
  [CURRENT_SCHEMA_VERSION]: (raw) =>
    isRecord(raw) ? withoutRequires(raw) : raw,
};

const versionOf = (raw: unknown): number | undefined => {
  if (typeof raw !== 'object' || raw === null || !('schemaVersion' in raw))
    return undefined;
  const version = raw.schemaVersion;
  return typeof version === 'number' ? version : undefined;
};

/**
 * Turns a stored event of any known version into the current envelope, validated with zod.
 * An unknown version or an invalid event is an error: a stored event is never skipped.
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
