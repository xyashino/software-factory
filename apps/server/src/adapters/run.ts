/** Options for one external program: its working directory, and the bytes written to its stdin. */
export interface RunOptions {
  cwd?: string;
  stdin?: string | Uint8Array;
}

/**
 * Runs an external program and returns its raw stdout. A non-zero exit throws with the program's own
 * stderr, so a refusal from git or gh reads as it would in a terminal. No shell is involved: the
 * arguments are passed as they are.
 */
export const runProcessBytes = async (
  argv: readonly string[],
  options: RunOptions = {},
): Promise<Uint8Array> => {
  const child = Bun.spawn([...argv], {
    stdin:
      options.stdin === undefined
        ? 'ignore'
        : typeof options.stdin === 'string'
          ? new TextEncoder().encode(options.stdin)
          : options.stdin,
    stdout: 'pipe',
    stderr: 'pipe',
    ...(options.cwd ? { cwd: options.cwd } : {}),
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    throw new Error(`${argv[0]} exited ${code}: ${stderr.trim()}`);
  }
  return new Uint8Array(stdout);
};

/** Runs an external program and returns its stdout as UTF-8 text (see `runProcessBytes`). */
export const runProcess = async (
  argv: readonly string[],
  options: RunOptions = {},
): Promise<string> =>
  new TextDecoder().decode(await runProcessBytes(argv, options));
