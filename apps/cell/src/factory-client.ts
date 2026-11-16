import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  DISCOVERY_FILE_NAME,
  parseDiscovery,
  type Discovery,
} from '@repo/factory-core/contracts/discovery';
import type { CellId, OrderId } from '@repo/factory-core/ids';
import type { OrderCommand } from '@repo/factory-core/order/commands';

export type { FactoryClient } from '@repo/factory-core/contracts/client';

/** `$FACTORY_DATA_DIR`, else `~/.local/share/factory` (STORAGE §1). */
export const factoryDataDirOf = (env: NodeJS.ProcessEnv): string =>
  env.FACTORY_DATA_DIR ?? join(homedir(), '.local', 'share', 'factory');

/**
 * The discovery file a running `factory-server` wrote into its data directory (PROTOCOL §2). Absent or
 * damaged reads as undefined: no server is known there.
 */
export const discoveryIn = (dataDir: string): Discovery | undefined => {
  const path = join(dataDir, DISCOVERY_FILE_NAME);
  if (!existsSync(path)) return undefined;
  try {
    return parseDiscovery(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
};

/** The parts of a command that name it: the same content always gives the same commandId. */
export interface CommandIdInput {
  cellId: CellId;
  orderId: OrderId;
  epoch: number;
  command: OrderCommand;
}

/** Recursively sorts object keys, so the same value always serialises to the same text. */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonical((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value;
};

/**
 * The content-derived commandId (retry-safe): sha256 hex of the canonical JSON of the command's
 * identity. A retry of the same content reuses the id, so the server returns the stored answer; a
 * different command (another type, another cycle) gets another id.
 */
export const commandIdOf = (input: CommandIdInput): string =>
  createHash('sha256')
    .update(
      JSON.stringify(
        canonical({
          cellId: input.cellId,
          orderId: input.orderId,
          epoch: input.epoch,
          command: input.command,
        }),
      ),
    )
    .digest('hex')
    .slice(0, 128);
