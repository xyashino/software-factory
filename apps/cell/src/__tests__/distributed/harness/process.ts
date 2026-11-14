/**
 * Process plumbing shared by the harness: every child runs in its own session, so a test can kill a whole
 * process tree (a Cell and the runner it started) in one signal, and its output is read while it runs.
 */

/** The test runner's own environment, as strings, for a child to inherit (git identity, HOME, locale). */
export const inheritedEnv = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

/** Lines a child printed, read in the background as they arrive. */
export interface OutputCapture {
  /** Everything printed so far, stdout and stderr together, in arrival order. */
  text(): string;
  /** Resolves once the stream has ended. */
  done: Promise<void>;
}

/** Starts reading one child stream into a buffer; the buffer is kept for the test's assertions. */
export const captureOutput = (
  stream: ReadableStream<Uint8Array> | null | undefined,
): OutputCapture => {
  let buffer = '';
  const decoder = new TextDecoder();
  const done = (async () => {
    if (!stream) return;
    const reader = stream.getReader();
    for (;;) {
      const { value, done: ended } = await reader.read();
      if (ended) return;
      buffer += decoder.decode(value, { stream: true });
    }
  })().catch(() => undefined);
  return { text: () => buffer, done };
};

/**
 * Starts `argv` in a session of its own, so the whole group can be signalled. `setsid` makes the child
 * a session leader; its pid is the group id.
 */
export const spawnGroup = (
  argv: string[],
  env: Record<string, string>,
): Bun.Subprocess<'ignore', 'pipe', 'pipe'> =>
  Bun.spawn(['setsid', ...argv], {
    env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });

/** Signals every process of a child's group. A group that is already gone is not an error. */
export const signalGroup = (pid: number, signal: NodeJS.Signals): void => {
  signalTo(-pid, signal);
};

/** Signals one process only: a graceful stop reaches the Cell, which passes it on to its own work. */
export const signalPid = (pid: number, signal: NodeJS.Signals): void => {
  signalTo(pid, signal);
};

const signalTo = (target: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(target, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
};

/** Resolves when `predicate` holds, polling; rejects with `what` after `timeoutMs`. */
export const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  what: string,
  timeoutMs = 20_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
