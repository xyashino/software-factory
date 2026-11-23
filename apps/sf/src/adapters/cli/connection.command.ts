import { readFileSync } from 'node:fs';
import { defineCommand } from 'citty';
import { buildContext } from '../../bootstrap/context';
import { runWithoutToken } from '../../bootstrap/run';
import { ArgumentError } from '../../application/core/errors';
import { connectTarget } from '../../application/procedures/connection/connect.procedure';
import { createHqClient } from '../http/hq-client';
import { printLine, reportFailure } from './output';

const STDIN_FD = 0;

interface ConnectArgs {
  token: string | undefined;
  'token-stdin': boolean;
}

const promptSecret = (question: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const { stdin, stderr } = process;
    let value = '';
    const finish = (error?: ArgumentError): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stderr.write('\n');
      if (error === undefined) {
        resolve(value);
      } else {
        reject(error);
      }
    };
    const onData = (chunk: Buffer | string): void => {
      for (const char of chunk.toString()) {
        if (char === '\r' || char === '\n') {
          finish();
          return;
        }
        if (char === '\u0003') {
          finish(new ArgumentError('token prompt cancelled'));
          return;
        }
        value =
          char === '\u007f' || char === '\b'
            ? value.slice(0, -1)
            : value + char;
      }
    };
    stderr.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });

const tokenOf = (args: ConnectArgs): Promise<string> => {
  if (args['token-stdin']) {
    return Promise.resolve(readFileSync(STDIN_FD, 'utf8'));
  }
  if (args.token !== undefined) {
    return Promise.resolve(args.token);
  }
  if (process.stdin.isTTY) {
    return promptSecret('token: ');
  }
  throw new ArgumentError(
    'token is required: pass --token-stdin, --token or run in a terminal',
  );
};

const runConnect = async (input: {
  url: string;
  name?: string;
  token: string;
  default: boolean;
}): Promise<number> => {
  const { url } = connectTarget.parse(input);
  const result = await runWithoutToken(connectTarget, input, () => ({
    ...buildContext(),
    hq: createHqClient({ baseUrl: url }),
  }));
  if (result.kind === 'ok') {
    const active = result.value.active ? ' (active)' : '';
    printLine(`connected ${result.value.name} ${result.value.url}${active}`);
  }
  return reportFailure(result);
};

export const connectCommand = defineCommand({
  meta: {
    name: 'connect',
    description: 'Save an HQ URL and its supervisor token',
  },
  args: {
    url: {
      type: 'positional',
      required: true,
      description: 'HQ URL',
    },
    name: { type: 'string', description: 'Target name' },
    token: { type: 'string', description: 'Supervisor token' },
    'token-stdin': {
      type: 'boolean',
      default: false,
      description: 'Read the supervisor token from stdin',
    },
    default: {
      type: 'boolean',
      default: false,
      description: 'Make this target the active one',
    },
  },
  run: async ({ args }) => {
    const token = await tokenOf(args);
    process.exitCode = await runConnect({
      url: args.url,
      name: args.name,
      token,
      default: args.default,
    });
  },
});
