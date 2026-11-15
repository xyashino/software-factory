#!/usr/bin/env bun
import { hostname } from 'node:os';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import type { CellId } from '@repo/factory-core/ids';
import { WireFailure } from '@repo/factory-core/contracts/errors';
import { readConfig, cellDataDirOf } from './config';
import { loadCellConfig } from './repo-config';
import { startCell, type RunningCell } from './cell';
import {
  factoryDataDirOf,
  socketFactoryClient,
  socketPathIn,
} from './factory-client';
import {
  deleteIdentity,
  ensureCredential,
  loadOrCreateIdentity,
} from './identity';
import { claimInstanceDir } from './instance-lock';
import {
  isUnauthorized,
  joinRemote,
  remoteFactoryClient,
} from './remote-client';
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
 * The value of a `--name <value>` or `--name=<value>` flag in the command line, or undefined when the
 * flag is absent. A flag with no value is refused.
 */
const flagValue = (
  name: string,
  argv: readonly string[] = process.argv,
): string | undefined => {
  const at = argv.indexOf(name);
  if (at >= 0) {
    const value = argv[at + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${name} needs a value`);
    }
    return value;
  }
  return argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
};

/**
 * The Cell's identity and client. Local mode (the default) keeps the socket and the local id. Remote mode
 * (`factory_url` in the config) joins the Factory once with `FACTORY_JOIN_TOKEN`, keeps the credential it
 * is given, and talks HTTP with it. The join token is read from the environment and never written down.
 */
const connect = async (
  config: ReturnType<typeof readConfig>,
  cellDataDir: string,
  env: NodeJS.ProcessEnv,
  instance: number,
): Promise<{
  identity: { cellId: CellId };
  client: FactoryClient;
  target: string;
}> => {
  const baseUrl = config.factoryUrl;
  if (baseUrl === undefined) {
    const identity = loadOrCreateIdentity(cellDataDir, () => newCellId());
    const socketPath = socketPathIn(
      config.factoryDataDir ?? factoryDataDirOf(env),
    );
    return {
      identity,
      client: socketFactoryClient({ socketPath }),
      target: socketPath,
    };
  }
  const joinName = instance === 1 ? hostname() : `${hostname()}-${instance}`;
  const { cellId, credential } = await ensureCredential(
    cellDataDir,
    async () => {
      const joinToken = env.FACTORY_JOIN_TOKEN;
      if (!joinToken) {
        throw new Error(
          `this Cell has no credential for ${baseUrl}: set FACTORY_JOIN_TOKEN to join it`,
        );
      }
      return joinRemote({ baseUrl, joinToken, name: joinName });
    },
  );
  return {
    identity: { cellId },
    client: remoteFactoryClient({ baseUrl, credential }),
    target: baseUrl,
  };
};

/**
 * `factory-cell`: a client of the running `factory-server`, over `factory.sock` (PROTOCOL §2) or, in
 * remote mode, over HTTP. It reads
 * its config, claims an exclusive instance directory, keeps its identity, says hello, and runs one claim
 * loop with one heartbeat loop. SIGINT stops claims and aborts running jobs immediately; SIGTERM
 * initiates a graceful leave, asking live Operator stations to hand over before stopping.
 */
const main = async (): Promise<void> => {
  if (process.argv.includes('--help')) {
    console.log(usage);
    return;
  }

  const env = process.env;
  const loaded = loadCellConfig({
    env,
    repoDir: flagValue('--repo-dir'),
    cwd: process.cwd(),
  });
  const config = loaded.config;
  if (loaded.repoPath !== undefined) {
    console.log(`factory-cell: config from ${loaded.repoPath}`);
  }
  const baseCellDataDir = config.cellDataDir ?? cellDataDirOf(env);
  const instanceClaim = claimInstanceDir(baseCellDataDir);
  const cellDataDir = instanceClaim.cellDataDir;
  const remote = config.factoryUrl !== undefined;

  let current: RunningCell | undefined;
  let joining = false;

  /** Starts the Cell: connect (stored identity, or a join), then hello and the loops. */
  const start = async (): Promise<void> => {
    const { identity, client, target } = await connect(
      config,
      cellDataDir,
      env,
      instanceClaim.instance,
    );
    const running = await startCell({
      client,
      cellId: identity.cellId,
      config,
      cellDataDir,
      system: createSystemAdapter(),
      clock: systemClock,
      version: CELL_VERSION,
      pane: createHerdrPane(),
      onError: (error, context) =>
        console.error(`factory-cell: ${context}: ${messageOf(error)}`),
      onUnauthorized: () => void rejoin(),
    }).catch((error: unknown) => {
      if (error instanceof WireFailure && error.error.code === 'unavailable') {
        throw new Error(`no factory-server answers on ${target}`);
      }
      throw error;
    });
    current = running;
    if (instanceClaim.instance > 1) {
      console.log(
        `factory-cell: instance #${instanceClaim.instance} using ${cellDataDir}`,
      );
    }
    console.log(`factory-cell: running as ${identity.cellId}`);
  };

  /**
   * The Factory refused the credential (401) in remote mode: the Cell has stopped its jobs; the stored
   * credential is removed and the Cell joins again with `FACTORY_JOIN_TOKEN`, as a new Cell (PROTOCOL §1).
   */
  const rejoin = async (): Promise<void> => {
    if (joining) return;
    joining = true;
    console.error(
      "factory-cell: the Factory refused this Cell's credential; jobs stopped, joining again",
    );
    deleteIdentity(cellDataDir);
    try {
      await start();
    } catch (error) {
      console.error(`factory-cell: join failed: ${messageOf(error)}`);
      instanceClaim.release();
      process.exit(1);
    } finally {
      joining = false;
    }
  };

  try {
    await start();
  } catch (error) {
    if (!remote || !isUnauthorized(error)) {
      instanceClaim.release();
      throw error;
    }
    await rejoin();
  }

  process.once('SIGINT', () => {
    console.log('factory-cell: SIGINT, stopping');
    current?.stop();
    instanceClaim.release();
    process.exit(0);
  });

  process.once('SIGTERM', () => {
    console.log('factory-cell: SIGTERM, leaving');
    if (!current) {
      instanceClaim.release();
      process.exit(0);
    }
    void current.leave().then(
      ({ remaining }) => {
        instanceClaim.release();
        process.exit(remaining === 0 ? 0 : 1);
      },
      (error: unknown) => {
        console.error(`factory-cell: leave failed: ${messageOf(error)}`);
        instanceClaim.release();
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
