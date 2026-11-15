import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * A git command's stdout. A non-zero exit throws with its stderr. No shell: the arguments go as they are.
 * Test helper only: the server runs no git (STORAGE §8), the Cell's repository work is what these test.
 */
const runGit = async (argv: readonly string[]): Promise<string> => {
  const child = Bun.spawn([...argv], {
    stdout: 'pipe',
    stderr: 'pipe',
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

/** A todo file as a repository holds it: frontmatter, a title, a body. */
export const todoFile = (options: {
  title: string;
  body?: string;
  status?: 'todo' | 'done' | 'cancelled';
  v2?: boolean;
  /** The Order Plan slug this todo is a member of (`plan:` in the frontmatter). */
  plan?: string;
  /** The todo ids this todo depends on (`depends_on:`). */
  dependsOn?: string[];
}): string => {
  const plan = options.plan === undefined ? '' : `plan: ${options.plan}\n`;
  const dependsOn =
    options.dependsOn === undefined || options.dependsOn.length === 0
      ? ''
      : `depends_on: [${options.dependsOn.join(', ')}]\n`;
  return `---\nstatus: ${options.status ?? 'todo'}\n${options.v2 ? 'factory: v2\n' : ''}${plan}${dependsOn}priority: high\n---\n\n# ${options.title}\n\n${options.body ?? 'Users can sign in.'}\n`;
};

/**
 * A real git repository on `main` with one commit: the given todo files under `todos/`. The Cell clones
 * and pushes it with the real git, so the tests exercise `git` and not a stand-in.
 */
export const createFixtureRepo = async (
  dir: string,
  todos: Record<string, string>,
): Promise<string> => {
  await mkdir(join(dir, 'todos'), { recursive: true });
  for (const [name, text] of Object.entries(todos)) {
    await Bun.write(join(dir, 'todos', `${name}.md`), text);
  }
  await runGit(['git', '-C', dir, 'init', '--quiet', '-b', 'main']);
  await runGit(['git', '-C', dir, 'add', '.']);
  await runGit([
    'git',
    '-C',
    dir,
    '-c',
    'user.name=fixture',
    '-c',
    'user.email=fixture@example.test',
    'commit',
    '--quiet',
    '-m',
    'fixture todos',
  ]);
  return dir;
};

/** Writes one more todo file and commits it, as a push to the base branch would. */
export const pushTodo = async (
  dir: string,
  name: string,
  text: string | undefined,
): Promise<void> => {
  const path = join(dir, 'todos', `${name}.md`);
  if (text === undefined) {
    await runGit(['git', '-C', dir, 'rm', '--quiet', `todos/${name}.md`]);
  } else {
    await Bun.write(path, text);
    await runGit(['git', '-C', dir, 'add', `todos/${name}.md`]);
  }
  await runGit([
    'git',
    '-C',
    dir,
    '-c',
    'user.name=fixture',
    '-c',
    'user.email=fixture@example.test',
    'commit',
    '--quiet',
    '-m',
    `todo ${name}`,
  ]);
};
