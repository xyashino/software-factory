import { defineCommand, runCommand, type CommandDef } from 'citty';
import type { ExitCode } from './exit-codes';
import { usage } from './usage';
import type { Io, Verb } from './verbs/define-verb';

const PROGRAM = 'factory-operator';

const HELP_FLAGS = ['--help', '-h'];

const REGISTERED_VERBS: readonly Verb[] = [];

type Outcome = { exitCode: ExitCode };

const isHelp = (argv: readonly string[]): boolean =>
  argv.length === 0 || argv.some((arg) => HELP_FLAGS.includes(arg));

const verbCommand = (verb: Verb, io: Io, outcome: Outcome): CommandDef =>
  defineCommand({
    meta: { name: verb.name, description: verb.description },
    run: async ({ rawArgs }) => {
      outcome.exitCode = await verb.run(rawArgs, io);
    },
  });

export const runCli = async (
  argv: readonly string[],
  io: Io,
  verbs: readonly Verb[] = REGISTERED_VERBS,
): Promise<ExitCode> => {
  if (isHelp(argv)) {
    io.stdout(usage(PROGRAM, verbs));
    return 0;
  }
  const [name, ...rest] = argv;
  if (!verbs.some((verb) => verb.name === name)) {
    io.stderr(`unknown verb: ${name ?? ''}`);
    return 2;
  }
  const outcome: Outcome = { exitCode: 0 };
  const root = defineCommand({
    meta: { name: PROGRAM },
    subCommands: Object.fromEntries(
      verbs.map((verb) => [verb.name, verbCommand(verb, io, outcome)]),
    ),
  });
  await runCommand(root, { rawArgs: [name ?? '', ...rest] });
  return outcome.exitCode;
};

if (import.meta.main) {
  const code = await runCli(
    process.argv.slice(2),
    {
      env: process.env,
      stdout: (line) => process.stdout.write(`${line}\n`),
      stderr: (line) => process.stderr.write(`${line}\n`),
    },
    REGISTERED_VERBS,
  );
  process.exitCode = code;
}
