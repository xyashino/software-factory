import { defineCommand } from 'citty';
import { buildContext } from '../../bootstrap/context';
import { runWithoutToken } from '../../bootstrap/run';
import {
  listTargets,
  removeTarget,
  useTarget,
} from '../../application/procedures/connection/target.procedure';
import { printLine, printTable, reportFailure } from './output';

const runList = async (): Promise<number> => {
  const result = await runWithoutToken(listTargets, {}, () => buildContext());
  if (result.kind === 'ok') {
    printTable(
      ['NAME', 'URL', 'ACTIVE'],
      result.value.targets.map((row) => [
        row.name,
        row.url,
        row.active ? '*' : '',
      ]),
    );
  }
  return reportFailure(result);
};

const runUse = async (name: string): Promise<number> => {
  const result = await runWithoutToken(useTarget, { name }, () =>
    buildContext(),
  );
  if (result.kind === 'ok') {
    printLine(`active target ${result.value.name} ${result.value.url}`);
  }
  return reportFailure(result);
};

const runRemove = async (name: string): Promise<number> => {
  const result = await runWithoutToken(removeTarget, { name }, () =>
    buildContext(),
  );
  if (result.kind === 'ok') {
    printLine(`removed target ${result.value.name}`);
  }
  return reportFailure(result);
};

export const targetCommand = defineCommand({
  meta: {
    name: 'target',
    description: 'List, select and remove saved factory targets',
  },
  subCommands: {
    ls: defineCommand({
      meta: { name: 'ls', description: 'List saved targets' },
      run: async () => {
        process.exitCode = await runList();
      },
    }),
    use: defineCommand({
      meta: { name: 'use', description: 'Make a saved target active' },
      args: {
        name: {
          type: 'positional',
          required: true,
          description: 'Target name',
        },
      },
      run: async ({ args }) => {
        process.exitCode = await runUse(args.name);
      },
    }),
    rm: defineCommand({
      meta: { name: 'rm', description: 'Remove a saved target' },
      args: {
        name: {
          type: 'positional',
          required: true,
          description: 'Target name',
        },
      },
      run: async ({ args }) => {
        process.exitCode = await runRemove(args.name);
      },
    }),
  },
});
