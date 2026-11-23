import { resolve } from 'node:path';
import { defineCommand } from 'citty';
import { run } from '../../bootstrap/run';
import { DEFAULT_TODO_DIR, REPO_CONFIG_PATH } from '../../config';
import {
  type ExportResult,
  exportTodos,
} from '../../application/procedures/todos/export.procedure';
import {
  type ImportResult,
  importTodos,
} from '../../application/procedures/todos/import.procedure';
import { EXIT } from '../../domain/exit-codes';
import { printJson, printLine, reportFailure } from './output';

const cwd = (): string => process.cwd();

const printImport = (result: ImportResult, json: boolean): void => {
  if (json) {
    printJson(result);
    return;
  }
  if (result.mode === 'dry_run') {
    printLine(
      `dry run: would send ${result.sent.length} file(s) to ${result.projectId}, paused ${result.paused}`,
    );
    for (const filename of result.sent) {
      printLine(`  send ${filename}`);
    }
  } else {
    printLine(
      `imported to ${result.projectId}: created ${result.created}, updated ${result.updated}, unchanged ${result.unchanged}, paused ${result.paused}`,
    );
  }
  for (const skip of result.skipped) {
    printLine(`  skip ${skip.filename}: ${skip.reason}`);
  }
  for (const error of result.errors) {
    printLine(`  error ${error.filename}: ${error.message}`);
  }
};

const printExport = (result: ExportResult, json: boolean): void => {
  if (json) {
    printJson(result);
    return;
  }
  printLine(`exported ${result.projectId}: written ${result.written.length}`);
  for (const filename of result.written) {
    printLine(`  wrote ${filename}`);
  }
  for (const filename of result.refused) {
    printLine(`  refused ${filename}: exists, pass --force to overwrite`);
  }
};

const runImport = async (
  dir: string,
  dryRun: boolean,
  paused: boolean,
  json: boolean,
) => {
  const result = await run(
    importTodos,
    {
      configPath: resolve(cwd(), REPO_CONFIG_PATH),
      dir: resolve(cwd(), dir),
      dryRun,
      paused,
    },
    'supervisor',
  );
  if (result.kind === 'ok') {
    printImport(result.value, json);
    return result.value.errors.length > 0 ? EXIT.refused : EXIT.ok;
  }
  return reportFailure(result);
};

const runExport = async (dir: string, force: boolean, json: boolean) => {
  const result = await run(
    exportTodos,
    {
      configPath: resolve(cwd(), REPO_CONFIG_PATH),
      dir: resolve(cwd(), dir),
      force,
    },
    'supervisor',
  );
  if (result.kind === 'ok') {
    printExport(result.value, json);
    return result.value.refused.length > 0 ? EXIT.refused : EXIT.ok;
  }
  return reportFailure(result);
};

export const todosCommand = defineCommand({
  meta: {
    name: 'todos',
    description: 'Move todos/*.md between files and HQ',
  },
  subCommands: {
    import: defineCommand({
      meta: {
        name: 'import',
        description: 'Push todos/*.md to HQ',
      },
      args: {
        dir: { type: 'string', default: DEFAULT_TODO_DIR },
        'dry-run': { type: 'boolean', default: false },
        paused: {
          type: 'boolean',
          default: false,
          description:
            'Import every todo as paused, except cancelled. Files on disk are not changed',
        },
        json: { type: 'boolean', default: false },
      },
      run: async ({ args }) => {
        process.exitCode = await runImport(
          args.dir,
          args['dry-run'],
          args.paused,
          args.json,
        );
      },
    }),
    export: defineCommand({
      meta: {
        name: 'export',
        description: 'Write the server queue to todos/*.md files',
      },
      args: {
        dir: { type: 'string', default: DEFAULT_TODO_DIR },
        force: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
      },
      run: async ({ args }) => {
        process.exitCode = await runExport(args.dir, args.force, args.json);
      },
    }),
  },
});
