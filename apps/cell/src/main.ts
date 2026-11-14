#!/usr/bin/env bun
import { WireFailure } from '@repo/factory-core/contracts/errors';
import { readConfig, configPath, cellDataDirOf } from './config';
import { startCell } from './cell';
import {
  factoryDataDirOf,
  socketFactoryClient,
  socketPathIn,
} from './factory-client';
import { loadOrCreateIdentity } from './identity';
import { newCellId } from './ids';
import { createSystemAdapter } from './adapters/system/system.adapter';
import { systemClock } from './clock/system-clock';
import { createHerdrPane } from './runners/herdr-pane';
import { usage } from './usage';

/** The version the Cell announces at hello. */
export const CELL_VERSION = '0.0.0';

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * `factory-cell`: a client of the running `factory-server` over `factory.sock` (PROTOCOL §2). It reads
 * its config, keeps its identity, says hello, and runs one claim loop per slot with one heartbeat loop.
 * SIGINT stops claims and aborts running jobs immediately; SIGTERM initiates a graceful leave, asking
 * live Operator stations to hand over before stopping.
 */
const main = async (): Promise<void> => {
  if (process.argv.includes('--help')) {
    console.log(usage);
    return;
  }

  const env = process.env;
  const config = readConfig(configPath(env));
  const cellDataDir = config.cellDataDir ?? cellDataDirOf(env);
  const identity = loadOrCreateIdentity(cellDataDir, () => newCellId());
  const socketPath = socketPathIn(
    config.factoryDataDir ?? factoryDataDirOf(env),
  );
  const client = socketFactoryClient({ socketPath });
  const workspaceId = env.HERDR_WORKSPACE_ID;

  const running = await startCell({
    client,
    cellId: identity.cellId,
    config,
    cellDataDir,
    system: createSystemAdapter(),
    clock: systemClock,
    version: CELL_VERSION,
    ...(workspaceId ? { pane: createHerdrPane({ workspaceId }) } : {}),
    onError: (error, context) =>
      console.error(`factory-cell: ${context}: ${messageOf(error)}`),
  }).catch((error: unknown) => {
    if (error instanceof WireFailure && error.error.code === 'unavailable') {
      throw new Error(`no factory-server answers on ${socketPath}`);
    }
    throw error;
  });
  console.log(
    `factory-cell: ${config.slots} slot(s) running as ${identity.cellId}`,
  );

  process.once('SIGINT', () => {
    console.log('factory-cell: SIGINT, stopping');
    running.stop();
    process.exit(0);
  });

  process.once('SIGTERM', () => {
    console.log('factory-cell: SIGTERM, leaving');
    void running.leave().then(
      ({ remaining }) => process.exit(remaining === 0 ? 0 : 1),
      (error: unknown) => {
        console.error(`factory-cell: leave failed: ${messageOf(error)}`);
        process.exit(1);
      },
    );
  });
};

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`factory-cell: ${messageOf(error)}`);
    process.exit(1);
  });
}
