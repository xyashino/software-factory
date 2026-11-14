import {
  wireErrorSchema,
  type WireError,
} from '@repo/factory-core/contracts/errors';
import { ROUTES, type RouteName } from '@repo/factory-core/contracts/routes';

/** Exit codes of `factory-server --once` (PROTOCOL §10, apps/server/src/once.ts). */
export const ONCE_EXIT = {
  ok: 0,
  failed: 1,
  refused: 2,
  writerHeld: 3,
} as const;

/** What the CLI gets back from one `--once` run. */
export type OnceResult =
  | { kind: 'ok'; response: unknown }
  | { kind: 'refused'; error: WireError }
  | { kind: 'writer-held' }
  | { kind: 'failed' };

export interface OnceOptions {
  /** The `factory-server` entry point to run. */
  serverBin: string;
  dataDir: string;
  /** Runs a command. Injected so tests can see the command line; defaults to `Bun.spawn`. */
  spawn?: (
    argv: string[],
    stdin: string,
  ) => Promise<{ code: number; stdout: string }>;
}

const spawnProcess = async (
  argv: string[],
  stdin: string,
): Promise<{ code: number; stdout: string }> => {
  const child = Bun.spawn(argv, {
    stdin: new Blob([stdin]),
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const code = await child.exited;
  return { code, stdout: await new Response(child.stdout).text() };
};

/**
 * Runs one route through `factory-server --once` (PROTOCOL §10): a subprocess that takes the writer
 * lock, runs the command, prints the answer and exits, so the lock is released with the process.
 * The CLI itself never opens the database (STRUCTURE §3).
 */
export const runOnce = async (
  options: OnceOptions,
  route: RouteName,
  request: unknown,
): Promise<OnceResult> => {
  const spawn = options.spawn ?? spawnProcess;
  const argv = [
    process.execPath,
    options.serverBin,
    '--once',
    '--data-dir',
    options.dataDir,
  ];
  const { code, stdout } = await spawn(
    argv,
    JSON.stringify({ route, request }),
  );
  if (code === ONCE_EXIT.writerHeld) return { kind: 'writer-held' };

  let output: unknown;
  try {
    output = JSON.parse(stdout);
  } catch {
    return { kind: 'failed' };
  }
  const body = output as { ok?: boolean; response?: unknown; error?: unknown };
  if (body.ok === true && code === ONCE_EXIT.ok) {
    return {
      kind: 'ok',
      response: ROUTES[route].response.parse(body.response),
    };
  }
  const parsed = wireErrorSchema.safeParse(body.error);
  if (code === ONCE_EXIT.refused && parsed.success) {
    return { kind: 'refused', error: parsed.data };
  }
  return { kind: 'failed' };
};
