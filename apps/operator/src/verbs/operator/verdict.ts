import { z } from 'zod';
import { defineVerb, type Io, type Verb } from '../define-verb';
import type { ExitCode } from '../../exit-codes';

const pass = defineVerb({
  name: 'pass',
  description: 'Review station passes',
  args: z.object({}),
  readFiles: {},
  toRequest: () => ({ verb: 'verdict', result: 'pass' }),
});

const fail = defineVerb({
  name: 'fail',
  description: 'Review station fails; the file is the feedback',
  args: z.object({}),
  readFiles: { feedback: { required: true } },
  toRequest: (_args, { feedback }) => ({
    verb: 'verdict',
    result: 'fail',
    feedback,
  }),
});

const SUBCOMMANDS = new Map<string, Verb>([
  ['pass', pass],
  ['fail', fail],
]);

const usageError = (subcommand: string | undefined, io: Io): ExitCode => {
  io.stderr(`verdict expects pass or fail, got: ${subcommand ?? ''}`);
  return 2;
};

export const verdict: Verb = {
  name: 'verdict',
  description: 'Record the review verdict: pass | fail',
  options: [
    ...pass.options,
    ...fail.options.map((option) => ({ ...option, required: false })),
  ],
  run: async (argv, io) => {
    const [subcommand, ...rest] = argv;
    const sub =
      subcommand === undefined ? undefined : SUBCOMMANDS.get(subcommand);
    if (sub === undefined) {
      return usageError(subcommand, io);
    }
    return sub.run(rest, io);
  },
};
