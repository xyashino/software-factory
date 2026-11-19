import { parseArgs } from 'node:util';
import { z } from 'zod';
import { sendRequest, type Env, type Fields } from '../client';
import {
  exitCodeFor,
  lineFor,
  type ArgumentError,
  type ExitCode,
  type Result,
} from '../exit-codes';
import { readInputFile } from '../files';

type ArgsShape = z.ZodRawShape;

type FileSpec = { required: boolean };

type FileSpecs = Record<string, FileSpec>;

type FileContents<F extends FileSpecs> = {
  [K in keyof F]: F[K]['required'] extends true ? string : string | undefined;
};

type Values = Record<string, string | undefined>;

type Parsed = { kind: 'ok'; values: Values } | ArgumentError;

type Files =
  { kind: 'ok'; files: Record<string, string | undefined> } | ArgumentError;

export type Io = {
  env: Env;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export type VerbOption = { flag: string; required: boolean };

export type VerbSpec<A extends ArgsShape, F extends FileSpecs> = {
  name: string;
  description: string;
  args: z.ZodObject<A>;
  readFiles: F;
  toRequest: (args: z.infer<z.ZodObject<A>>, files: FileContents<F>) => Fields;
};

export type Verb = {
  name: string;
  description: string;
  options: VerbOption[];
  run: (argv: readonly string[], io: Io) => Promise<ExitCode>;
};

const flagName = (key: string): string =>
  key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

const argumentError = (message: string): ArgumentError => ({
  kind: 'argument_error',
  message,
});

const isRequired = (schema: z.core.$ZodType): boolean =>
  !z.safeParse(schema, undefined).success;

const parseFlags = (
  argv: readonly string[],
  keys: readonly string[],
): Parsed => {
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: Object.fromEntries(
        keys.map((key) => [flagName(key), { type: 'string' as const }]),
      ),
      allowPositionals: false,
      strict: true,
    });
    return { kind: 'ok', values };
  } catch (error) {
    return argumentError(
      error instanceof Error ? error.message : 'invalid arguments',
    );
  }
};

const pickArgs = (keys: readonly string[], values: Values): Values =>
  Object.fromEntries(keys.map((key) => [key, values[flagName(key)]]));

const readFiles = (specs: FileSpecs, values: Values): Files => {
  const files: Record<string, string | undefined> = {};
  for (const [key, spec] of Object.entries(specs)) {
    const path = values[flagName(key)];
    if (path === undefined) {
      if (spec.required) {
        return argumentError(`--${flagName(key)} is required`);
      }
      files[key] = undefined;
      continue;
    }
    const read = readInputFile(path);
    if (read.kind === 'argument_error') {
      return read;
    }
    files[key] = read.text;
  }
  return { kind: 'ok', files };
};

const issueFlag = (issue: z.core.$ZodIssue): string =>
  `--${flagName(String(issue.path[0] ?? ''))}`;

const execute = async <A extends ArgsShape, F extends FileSpecs>(
  spec: VerbSpec<A, F>,
  argv: readonly string[],
  env: Env,
): Promise<Result> => {
  const argKeys = Object.keys(spec.args.shape);
  const fileKeys = Object.keys(spec.readFiles);

  const flags = parseFlags(argv, [...argKeys, ...fileKeys]);
  if (flags.kind === 'argument_error') {
    return flags;
  }

  const args = spec.args.safeParse(pickArgs(argKeys, flags.values));
  if (!args.success) {
    const flagsInError = args.error.issues.map(issueFlag).join(', ');
    return argumentError(`invalid value for ${flagsInError}`);
  }

  const files = readFiles(spec.readFiles, flags.values);
  if (files.kind === 'argument_error') {
    return files;
  }

  const request = spec.toRequest(args.data, files.files as FileContents<F>);
  return sendRequest(request, env);
};

export const defineVerb = <A extends ArgsShape, F extends FileSpecs>(
  spec: VerbSpec<A, F>,
): Verb => ({
  name: spec.name,
  description: spec.description,
  options: [
    ...Object.entries(spec.args.shape).map(([key, schema]) => ({
      flag: `--${flagName(key)}`,
      required: isRequired(schema),
    })),
    ...Object.entries(spec.readFiles).map(([key, file]) => ({
      flag: `--${flagName(key)}`,
      required: file.required,
    })),
  ],
  run: async (argv, io) => {
    const result = await execute(spec, argv, io.env);
    if (result.kind === 'ok') {
      io.stdout(lineFor(result));
    } else {
      io.stderr(lineFor(result));
    }
    return exitCodeFor(result);
  },
});
