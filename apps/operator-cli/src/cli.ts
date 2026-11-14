#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import type { OperatorVerb } from '@repo/factory-core/contracts/operator';
import { callCell, OperatorError, SOCKET_ENV, TOKEN_ENV } from './client';
import { usage } from './usage';

/** Reads a named file the Operator points at; a missing file is a clear error, not a crash. */
const readFileArg = (path: string | undefined, flag: string): string => {
  if (path === undefined) throw new OperatorError(`${flag} needs a file`, 2);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new OperatorError(`${flag} file ${path} cannot be read`, 2);
  }
};

const flagValue = (
  args: readonly string[],
  flag: string,
): string | undefined => {
  const at = args.indexOf(flag);
  return at < 0 ? undefined : args[at + 1];
};

const positional = (args: readonly string[]): string[] => {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i]?.startsWith('--')) {
      i += 1;
      continue;
    }
    if (args[i] !== undefined) out.push(args[i] as string);
  }
  return out;
};

/** Turns argv into the verb the Cell understands, reading the named files on the way. */
export const toRequest = (argv: readonly string[]): OperatorVerb => {
  const [verb, ...rest] = argv;
  switch (verb) {
    case 'done':
      return { op: 'done' };
    case 'context':
      return { op: 'context' };
    case 'verdict': {
      const [outcome] = positional(rest);
      if (outcome === 'pass') return { op: 'verdict', pass: true };
      if (outcome === 'fail') {
        return {
          op: 'verdict',
          pass: false,
          feedback: readFileArg(flagValue(rest, '--feedback'), '--feedback'),
        };
      }
      throw new OperatorError(
        'verdict takes "pass" or "fail --feedback <file>"',
        2,
      );
    }
    case 'ask': {
      const [text] = positional(rest);
      if (text === undefined || text.trim() === '')
        throw new OperatorError('ask needs a question', 2);
      return { op: 'ask', text };
    }
    case 'tell': {
      const [to, text] = positional(rest);
      if (to === undefined || text === undefined)
        throw new OperatorError(
          'tell needs a station or supervisor and a note',
          2,
        );
      return { op: 'tell', to: to as never, text };
    }
    case 'block': {
      const reason = flagValue(rest, '--reason');
      if (reason === undefined || reason.trim() === '')
        throw new OperatorError('block needs --reason "<why>"', 2);
      return {
        op: 'block',
        reason,
        handover: readFileArg(flagValue(rest, '--handover'), '--handover'),
      };
    }
    default:
      throw new OperatorError(
        verb === undefined ? usage : `unknown command "${verb}"\n${usage}`,
        2,
      );
  }
};

const main = async (argv: readonly string[]): Promise<number> => {
  const socketPath = process.env[SOCKET_ENV];
  const token = process.env[TOKEN_ENV];
  if (socketPath === undefined || socketPath === '') {
    throw new OperatorError(
      `${SOCKET_ENV} is not set: run this inside a Cycle`,
      2,
    );
  }
  if (token === undefined || token === '') {
    throw new OperatorError(
      `${TOKEN_ENV} is not set: run this inside a Cycle`,
      2,
    );
  }
  const reply = await callCell(socketPath, toRequest(argv), token);
  if (!reply.ok) {
    process.stderr.write(`factory-operator: ${reply.code}: ${reply.message}\n`);
    return 1;
  }
  if (reply.result !== undefined) {
    process.stdout.write(`${JSON.stringify(reply.result, null, 2)}\n`);
  }
  return 0;
};

const run = (): void => {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(`${usage}\n`);
    return;
  }
  // The exit code is set, not forced: `process.exit` can cut a pipe's pending output short.
  main(argv)
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      if (error instanceof OperatorError) {
        process.stderr.write(`factory-operator: ${error.message}\n`);
        process.exitCode = error.exitCode;
        return;
      }
      process.stderr.write(
        `factory-operator: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
};

if (import.meta.main) run();
