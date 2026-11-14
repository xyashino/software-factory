import type { FactoryClient } from '@repo/factory-core/contracts/client';
import { WireFailure } from '@repo/factory-core/contracts/errors';
import { newCommandId } from './client/command-id';
import { factoryClientFor } from './client/transport';
import {
  ConfigError,
  configFilePath,
  readFileConfig,
  resolveSettings,
  type Settings,
} from './config';
import { describeFailure } from './render/failure';
import { paintFor, type Paint } from './render/paint';
import { DEFAULT_SERVER_BIN } from './server-bin';

/** The flags every command accepts (PROTOCOL §10). */
export interface GlobalFlags {
  dataDir?: string;
  json?: boolean;
  noColor?: boolean;
}

/**
 * The argument definitions every command shares, spread into each command's `args`. Colour is a
 * `color` flag that defaults on: citty reads `--no-color` as `color: false`.
 */
export const globalArgs = {
  'data-dir': {
    type: 'string',
    description:
      'The data directory (default $FACTORY_DATA_DIR, else ~/.local/share/factory)',
  },
  json: {
    type: 'boolean',
    description: 'Print the answer as JSON, uncoloured',
  },
  color: {
    type: 'boolean',
    default: true,
    description: 'Colour the output (--no-color turns it off)',
  },
} as const;

/** Reads the global flags out of a command's parsed args. */
export const flagsOf = (args: {
  'data-dir'?: unknown;
  json?: unknown;
  color?: unknown;
}): GlobalFlags => ({
  ...(typeof args['data-dir'] === 'string' && args['data-dir'] !== ''
    ? { dataDir: args['data-dir'] }
    : {}),
  json: args.json === true,
  noColor: args.color === false,
});

/** What a command needs: its settings, the client to the runtime, the colours and a command id. */
export interface Context {
  settings: Settings;
  json: boolean;
  paint: Paint;
  client: FactoryClient;
  /** One ULID per invocation (PROTOCOL §6): call it once, before the first call of the command. */
  commandId(): string;
  now(): number;
}

/** Builds the context of one invocation: config, settings, transport and colours. */
export const createContext = (
  flags: GlobalFlags,
  env: NodeJS.ProcessEnv = process.env,
): Context => {
  const file = readFileConfig(configFilePath(env));
  const settings = resolveSettings({
    flags,
    env,
    file,
    defaultServerBin: DEFAULT_SERVER_BIN,
  });
  const client = factoryClientFor({
    dataDir: settings.dataDir,
    serverBin: settings.serverBin,
  });
  return {
    settings,
    json: flags.json === true,
    paint: paintFor(settings.color && flags.json !== true),
    client,
    commandId: () => newCommandId(),
    now: () => Date.now(),
  };
};

/** The one-line message of an error a command raised. */
export const messageOf = (error: unknown): string => {
  if (error instanceof WireFailure) return describeFailure(error.error);
  if (error instanceof ConfigError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

/**
 * Runs a command body. A failure is printed on stderr as one line and the exit code is 1, so every
 * command fails the same way and a script can tell a refusal from a success.
 */
export const withErrors = async (body: () => Promise<void>): Promise<void> => {
  try {
    await body();
  } catch (error) {
    console.error(`factory: ${messageOf(error)}`);
    process.exitCode = 1;
  }
};

/** Prints a value as one JSON line (no colour, ever). */
export const printJson = (value: unknown): void => {
  console.log(JSON.stringify(value));
};
