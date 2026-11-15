import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The Supervisor CLI entry point, run as a real process. */
export const CLI = fileURLToPath(new URL('../../cli.ts', import.meta.url));

const made: string[] = [];

/** A scratch directory the test removes in `afterAll` (see `removeScratch`). */
export const scratchDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};

/** Removes every scratch directory made so far. Call from `afterAll`. */
export const removeScratch = (): void => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
};

export interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs one `factory` command with no server running (each write is one `--once` run), against a data
 * directory, from `cwd`, with the developer's own config kept out. `stdin` is piped when given.
 */
export const runCli = async (
  dataDir: string,
  args: string[],
  options: { cwd?: string; stdin?: string; env?: Record<string, string> } = {},
): Promise<CliRun> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.FACTORY_CONFIG = join(dataDir, 'no-config.json');
  delete env.FACTORY_DATA_DIR;
  delete env.FACTORY_URL;
  delete env.FACTORY_TOKEN;
  Object.assign(env, options.env ?? {});
  const child = Bun.spawn(
    [process.execPath, CLI, ...args, '--data-dir', dataDir, '--no-color'],
    {
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: options.stdin === undefined ? 'ignore' : 'pipe',
      env,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    },
  );
  if (options.stdin !== undefined && child.stdin) {
    child.stdin.write(options.stdin);
    await child.stdin.end();
  }
  const code = await child.exited;
  return {
    code,
    stdout: await new Response(child.stdout).text(),
    stderr: await new Response(child.stderr).text(),
  };
};
