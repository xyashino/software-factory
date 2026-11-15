import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineCommand } from 'citty';
import type { ProjectId } from '@repo/factory-core/ids';
import {
  createContext,
  flagsOf,
  globalArgs,
  printJson,
  withErrors,
} from '../context';

/** Every `*.md` file directly in `dir`, as intake expects it: `todos/<name>.md` and its text. */
export const readTodoFolder = (
  dir: string,
): { file: string; text: string }[] => {
  const root = resolve(dir);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`${root} is not a directory`);
  }
  return readdirSync(root)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => ({
      file: `todos/${name}`,
      text: readFileSync(join(root, name), 'utf8'),
    }));
};

/**
 * `factory sync` (PROTOCOL §3.1, `/v1/supervisor/intake/sync`). By default it sends the local todo
 * folder (`./todos`, or `--dir`) and replaces the project's board with it: new todos become Work
 * orders, changed ones are updated, and every unfinished Work order whose todo is not in the folder is
 * cancelled, running or not. `--git` runs the old intake from the project's git base branch instead.
 */
export const syncCommand = defineCommand({
  meta: {
    name: 'sync',
    description:
      'Replace the board with the local todos/ folder (or pull the git base branch with --git)',
  },
  args: {
    ...globalArgs,
    dir: {
      type: 'string',
      description: 'Todo folder to send (default ./todos)',
    },
    project: {
      type: 'string',
      description: 'Project to sync into (needed when several are registered)',
    },
    git: {
      type: 'boolean',
      description: "Read todos from the project's git base branch instead",
    },
  },
  run: ({ args }) =>
    withErrors(async () => {
      const ctx = createContext(flagsOf(args));
      const projectId =
        args.project === undefined
          ? {}
          : { projectId: args.project as ProjectId };
      const files = args.git
        ? undefined
        : readTodoFolder(args.dir === undefined ? 'todos' : String(args.dir));
      const result = await ctx.client.call('intakeSync', {
        commandId: ctx.commandId(),
        ...projectId,
        ...(files ? { files, replace: true } : {}),
      });
      if (ctx.json) return printJson(result);
      for (const report of result.projects) {
        const line = (label: string, ids: readonly string[]): void => {
          if (ids.length > 0) console.log(`  ${label}: ${ids.join(', ')}`);
        };
        console.log(`${report.projectId}:`);
        line('created', report.created);
        line('updated', report.updated);
        line('cancelled', report.cancelled);
        line('spec drift', report.specDrift);
        for (const problem of report.diagnostics) {
          console.log(
            `  ! ${problem.todoId}: ${problem.kind}: ${problem.message}`,
          );
        }
      }
      console.log(`intake ran: ${result.created} Work order(s) created`);
    }),
});
