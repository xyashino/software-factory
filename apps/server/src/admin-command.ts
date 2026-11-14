import { resolve } from 'node:path';
import {
  openRuntime,
  WriterHeldError,
  type OpenedRuntime,
} from '@repo/factory-runtime/open-runtime';
import { ghPrState } from './adapters/pr-state';
import { gitMirror } from './adapters/git-mirror';
import { adminUsage } from './usage';

/** The admin operations of STORAGE §7, by their command names. */
const OPERATIONS = [
  'backup',
  'export',
  'import',
  'rebuild-projections',
] as const;
type Operation = (typeof OPERATIONS)[number];

const isOperation = (name: string | undefined): name is Operation =>
  OPERATIONS.includes(name as Operation);

/** Opens the data directory as its single writer, with the real git and PR adapters. */
export const openForAdmin = (dataDir: string): OpenedRuntime =>
  openRuntime({
    dataDir,
    git: gitMirror({ mirrorsDir: `${dataDir}/mirrors` }),
    prState: ghPrState(),
  });

/**
 * `factory-server admin token create <name>` (PROTOCOL §1): creates a supervisor token through the
 * runtime, the only way one is created. The plain token is printed once, on stdout, with its name;
 * only its hash is stored. No network route creates one.
 */
const runTokenCommand = async (
  args: readonly string[],
  dataDir: string,
): Promise<number> => {
  const [verb, name] = args;
  if (verb !== 'create' || !name || name.length > 128) {
    console.error(adminUsage);
    return 2;
  }
  let opened: OpenedRuntime;
  try {
    opened = openForAdmin(dataDir);
  } catch (error) {
    if (error instanceof WriterHeldError) {
      console.error(
        `factory-server admin: ${error.lockFile} is held by a running factory-server; stop it to create a token`,
      );
      return 1;
    }
    throw error;
  }
  try {
    console.log(
      JSON.stringify(await opened.runtime.remote.createSupervisorToken(name)),
    );
    return 0;
  } finally {
    opened.close();
  }
};

/**
 * `factory-server admin <backup|export|import|rebuild-projections> [file]`: one shot against a data
 * directory that no server runs on. The writer lock decides: a running server makes this fail with
 * a pointer to the socket route (`factory admin`), which runs the same operation inside that server.
 * Prints the result as JSON on stdout. Returns the process exit code.
 */
export const runAdminCommand = async (
  args: readonly string[],
  dataDir: string,
): Promise<number> => {
  const [name, file] = args;
  if (name === 'token') return runTokenCommand(args.slice(1), dataDir);
  if (!isOperation(name) || (name !== 'rebuild-projections' && !file)) {
    console.error(adminUsage);
    return 2;
  }

  let opened: OpenedRuntime;
  try {
    opened = openForAdmin(dataDir);
  } catch (error) {
    if (error instanceof WriterHeldError) {
      console.error(
        `factory-server admin: ${error.lockFile} is held by a running factory-server; run "factory admin ${name}" through it, or stop the server`,
      );
      return 1;
    }
    throw error;
  }
  try {
    const admin = opened.runtime.admin;
    const absolute = file ? resolve(file) : undefined;
    switch (name) {
      case 'backup':
        console.log(
          JSON.stringify({
            file: absolute,
            counts: await admin.backup(absolute!),
          }),
        );
        break;
      case 'export':
        console.log(
          JSON.stringify({
            file: absolute,
            counts: await admin.exportTo(absolute!),
          }),
        );
        break;
      case 'import':
        console.log(JSON.stringify(await admin.importFrom(absolute!)));
        break;
      case 'rebuild-projections':
        console.log(JSON.stringify({ rows: await admin.rebuildProjections() }));
        break;
    }
    return 0;
  } finally {
    opened.close();
  }
};
