import type { Result } from '../result';
import { err, ok } from '../result';
import { type StoredEvent, storedEventSchema } from './events';

const CURRENT_SCHEMA_VERSION = 2;

/**
 * Stored schema version to the next one. Version 2 is current, so its upcaster is the identity.
 * Adding version 3 means adding an entry here that returns a version-3 envelope (CORE §11).
 */
const UPCASTERS: Readonly<Record<number, (raw: unknown) => unknown>> = {
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
