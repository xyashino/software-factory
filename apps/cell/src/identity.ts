import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { cellIdSchema, type CellId } from '@repo/factory-core/ids';

/** The file that holds a Cell's identity, inside the Cell's data directory. */
export const IDENTITY_FILE_NAME = 'credential';

/**
 * Who this Cell is. The local socket needs only the cellId, which the Cell makes once and keeps; the
 * remote join (v2-18) adds the credential the Factory issues.
 */
export interface CellIdentity {
  cellId: CellId;
  credential?: string;
}

const identitySchema = z
  .object({
    cellId: cellIdSchema,
    credential: z.string().min(1).max(4096).optional(),
  })
  .strict();

const identityPath = (dataDir: string): string =>
  join(dataDir, IDENTITY_FILE_NAME);

/** The stored identity, or undefined when none is stored or the file does not parse. */
export const readIdentity = (dataDir: string): CellIdentity | undefined => {
  let text: string;
  try {
    text = readFileSync(identityPath(dataDir), 'utf8');
  } catch {
    return undefined;
  }
  const parsed = identitySchema.safeParse(safeJson(text));
  return parsed.success ? parsed.data : undefined;
};

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** Stores the identity with mode 0600: the credential is a secret, nothing else may read it. */
export const writeIdentity = (
  dataDir: string,
  identity: CellIdentity,
): void => {
  mkdirSync(dataDir, { recursive: true });
  const path = identityPath(dataDir);
  writeFileSync(path, JSON.stringify(identity), { mode: 0o600 });
  chmodSync(path, 0o600);
};

/** Removes the stored identity. The next `loadOrCreateIdentity` makes a new one. */
export const deleteIdentity = (dataDir: string): void => {
  rmSync(identityPath(dataDir), { force: true });
};

/**
 * The stored identity, or a new one made by `newCellId` and stored at once. Calling it again returns the
 * same identity until the file is deleted.
 */
export const loadOrCreateIdentity = (
  dataDir: string,
  newCellId: () => CellId,
): CellIdentity => {
  const stored = readIdentity(dataDir);
  if (stored) return stored;
  const identity: CellIdentity = { cellId: newCellId() };
  writeIdentity(dataDir, identity);
  return identity;
};
