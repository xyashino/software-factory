import { randomBytes, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  WriterHeldError,
  type OpenedRuntime,
} from '@repo/factory-runtime/open-runtime';
import { openForAdmin, runAdminCommand } from './admin-command';
import { runOnce } from './once';
import { startHttpListener, type HttpListener } from './http/listener';
import { listenerConfigFrom, type ListenerConfig } from './http/config';
import { removeDiscovery, writeDiscovery } from './http/discovery';
import { runtimeConfigFrom } from './runtime-config';
import { usage } from './usage';

/**
 * How long the join token a local Cell enrolls with stays valid. A new one is minted on
 * every start, and the previous one is revoked on a clean shutdown, so it only outlives a crash by this much.
 */
export const LOCAL_JOIN_TTL_S = 24 * 60 * 60;

/** The data directory: `$FACTORY_DATA_DIR`, else `~/.local/share/factory`. */
export const dataDirFromEnv = (env: NodeJS.ProcessEnv): string =>
  env.FACTORY_DATA_DIR ?? join(homedir(), '.local', 'share', 'factory');

/**
 * The data directory: `--data-dir <path>` (or `--data-dir=<path>`) wins over `$FACTORY_DATA_DIR`,
 * which wins over `~/.local/share/factory`.
 */
export const resolveDataDir = (
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): string => {
  const index = argv.indexOf('--data-dir');
  const inline = argv.find((arg) => arg.startsWith('--data-dir='));
  const flag = inline?.slice('--data-dir='.length) ?? argv[index + 1];
  if (index !== -1 || inline !== undefined) {
    if (flag && flag.length > 0) return flag;
  }
  return dataDirFromEnv(env);
};

const stripDataDirFlag = (argv: readonly string[]): string[] => {
  const result: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--data-dir') {
      index += 1;
      continue;
    }
    if (arg.startsWith('--data-dir=')) continue;
    result.push(arg);
  }
  return result;
};

// `factory-server`: the single writer of a Factory data directory. It takes the writer
// lock, arms the runtime's boot grace, serves HTTP + SSE on its address, writes the
// discovery file for local clients, and shuts down cleanly on SIGINT or SIGTERM: the discovery file is
// removed, the listener stops, the local join token is revoked, the lock is released.
//
// The signal handlers are installed before anything is opened, so a signal that arrives while the
// server starts still goes through the same shutdown.
const main = async (): Promise<void> => {
  if (process.argv.includes('--help')) {
    console.log(usage);
    return;
  }
  const rawArgs = process.argv.slice(2);
  const dataDir = resolveDataDir(rawArgs, process.env);
  if (rawArgs.includes('--once')) {
    const input = await Bun.stdin.text();
    const result = await runOnce(dataDir, input);
    console.log(JSON.stringify(result.output));
    process.exitCode = result.exitCode;
    return;
  }
  const positional = stripDataDirFlag(rawArgs);
  if (positional[0] === 'admin') {
    process.exitCode = await runAdminCommand(positional.slice(1), dataDir);
    return;
  }
  let listenerConfig: ListenerConfig;
  let timing: ReturnType<typeof runtimeConfigFrom>;
  try {
    listenerConfig = listenerConfigFrom(process.env);
    timing = runtimeConfigFrom(process.env);
  } catch (error) {
    console.error(`factory-server: ${(error as Error).message}`);
    process.exitCode = 2;
    return;
  }
  const state: {
    stopping: boolean;
    opened?: OpenedRuntime;
    http?: HttpListener;
    localToken?: string;
    localJoinTokenId?: string;
  } = { stopping: false };

  const shutdown = async (signal: string): Promise<void> => {
    if (state.stopping) return;
    state.stopping = true;
    console.log(`factory-server: ${signal}, shutting down`);
    // The discovery file goes first, so no local client is pointed at a listener that is closing.
    if (state.localToken !== undefined) {
      removeDiscovery(dataDir, state.localToken);
    }
    await state.http?.stop();
    if (state.opened && state.localJoinTokenId !== undefined) {
      await state.opened.runtime
        .call('joinTokenRevoke', { joinTokenId: state.localJoinTokenId })
        .catch(() => undefined);
    }
    state.opened?.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  let opened: OpenedRuntime;
  try {
    opened = openForAdmin(dataDir, timing);
  } catch (error) {
    if (error instanceof WriterHeldError) {
      console.error(
        `factory-server: another factory-server holds ${error.lockFile}`,
      );
      process.exit(1);
    }
    throw error;
  }
  state.opened = opened;

  await opened.runtime.start();
  if (state.stopping) return;

  // The local supervisor token lives in memory only; the join token is a runtime token, revoked on exit.
  const localToken = randomBytes(32).toString('base64url');
  const joinToken = await opened.runtime.call('joinTokenCreate', {
    commandId: `local-${randomUUID()}`,
    name: 'local-cells',
    ttlSeconds: LOCAL_JOIN_TTL_S,
  });
  state.localJoinTokenId = joinToken.joinTokenId;

  try {
    state.http = startHttpListener({
      runtime: opened.runtime,
      hostname: listenerConfig.hostname,
      port: listenerConfig.port,
      localToken,
      ...(listenerConfig.githubWebhookSecret !== undefined
        ? { githubWebhookSecret: listenerConfig.githubWebhookSecret }
        : {}),
    });
  } catch (error) {
    console.error(
      `factory-server: cannot listen on ${listenerConfig.hostname}:${listenerConfig.port}: ${(error as Error).message}`,
    );
    await opened.runtime
      .call('joinTokenRevoke', { joinTokenId: joinToken.joinTokenId })
      .catch(() => undefined);
    opened.close();
    process.exit(1);
  }
  state.localToken = localToken;
  writeDiscovery(dataDir, {
    url: state.http.url,
    token: localToken,
    joinToken: joinToken.token,
  });
  console.log(`factory-server: listening on ${state.http.url}`);
};

if (import.meta.main) {
  await main();
}
