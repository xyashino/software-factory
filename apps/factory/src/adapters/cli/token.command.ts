import { defineCommand } from 'citty';
import { type RunResult, run } from '../../bootstrap/run';
import { createToken } from '../../application/procedures/tokens/token-create.procedure';
import { EXIT } from '../../domain/exit-codes';
import { printError, printJson, printLine } from './output';

const reportFailure = <O>(result: RunResult<O>): number => {
  if (result.kind === 'ok') {
    return EXIT.ok;
  }
  printError(result.message);
  return result.exitCode;
};

const runCreate = async (
  input: { kind: string; name: string },
  json: boolean,
): Promise<number> => {
  const result = await run(createToken, input, 'supervisor');
  if (result.kind === 'ok') {
    if (json) {
      printJson(result.value);
    } else {
      printLine(result.value.token);
    }
  }
  return reportFailure(result);
};

export const tokenCommand = defineCommand({
  meta: {
    name: 'token',
    description: 'Mint tokens through the factory server API',
  },
  subCommands: {
    create: defineCommand({
      meta: {
        name: 'create',
        description: 'Create a token and print it once',
      },
      args: {
        kind: {
          type: 'string',
          required: true,
          description: 'cell_join or supervisor',
        },
        name: { type: 'string', required: true, description: 'Token label' },
        json: { type: 'boolean', default: false },
      },
      run: async ({ args }) => {
        process.exitCode = await runCreate(
          { kind: args.kind, name: args.name },
          args.json,
        );
      },
    }),
  },
});
