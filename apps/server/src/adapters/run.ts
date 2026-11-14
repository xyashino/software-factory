/**
 * Runs an external program and returns its stdout. A non-zero exit throws with the program's own
 * stderr, so a refusal from git or gh reads as it would in a terminal. No shell is involved: the
 * arguments are passed as they are.
 */
export const runProcess = async (
  argv: readonly string[],
  options: { cwd?: string } = {},
): Promise<string> => {
  const child = Bun.spawn([...argv], {
    stdout: 'pipe',
    stderr: 'pipe',
    ...(options.cwd ? { cwd: options.cwd } : {}),
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    throw new Error(`${argv[0]} exited ${code}: ${stderr.trim()}`);
  }
  return stdout;
};
