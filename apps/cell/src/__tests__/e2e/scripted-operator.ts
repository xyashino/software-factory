/**
 * A scripted Operator for the e2e tests. It runs as the runner process of a station: it reads its
 * Cycle through `factory-operator context`, writes the declared outputs, then ends the Cycle with
 * the real `factory-operator` CLI, the same way an agent would. Usage: `bun scripted-operator.ts
 * <scenario> <kickoff>`. Every line the Cell types into it is logged to `typed.log` beside the
 * Cycle socket, never in the worktree.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(
  new URL('../../../../operator-cli/src/cli.ts', import.meta.url),
);
const [scenario = 'done', kickoff = ''] = process.argv.slice(2);
// The kickoff names the prompt file, which sits in the Cycle directory: that is where logs go.
const cycleDir = dirname(
  kickoff.replace(/^Read /, '').split(' and follow')[0] ?? '.',
);
const typedLog = join(cycleDir, 'typed.log');

const operator = async (
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> => {
  const child = Bun.spawn(['bun', CLI, ...args], {
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code: await child.exited, stdout, stderr };
};

/** The outputs of this Cycle, written with their declared paths relative to the worktree. */
const writeOutputs = async (): Promise<void> => {
  const context = await operator(['context']);
  const parsed = JSON.parse(context.stdout) as { outputs: string[] };
  for (const path of parsed.outputs) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `# ${path}\n\nwritten by the scripted Operator\n`);
  }
};

/** Waits for the first line the Cell types; every typed line is logged. */
const nextTyped = (): Promise<string> =>
  new Promise((resolve) => {
    const reader = createInterface({ input: process.stdin });
    reader.on('line', (line) => {
      appendFileSync(typedLog, `${line}\n`);
      reader.close();
      resolve(line);
    });
  });

/**
 * Keeps the process alive without doing anything, as a stuck agent is. The timer also ends the
 * process on its own after a while, so an aborted test never leaves an Operator running.
 */
const stayAlive = (): Promise<void> =>
  new Promise(() => {
    setInterval(() => undefined, 1_000);
    setTimeout(() => process.exit(0), 30_000);
  });

const finish = async (args: string[]): Promise<never> => {
  const result = await operator(args);
  process.exit(result.code);
};

const scenarios: Record<string, () => Promise<void>> = {
  done: async () => {
    await writeOutputs();
    await finish(['done']);
  },
  'done-with-usage': async () => {
    // A runner that reports its usage on stdout, the way the Cell's usage parser reads it.
    console.log('USAGE {"inputTokens":3,"outputTokens":5,"costUsd":0.25}');
    await writeOutputs();
    await finish(['done']);
  },
  'verdict-fail': async () => {
    await writeOutputs();
    writeFileSync(
      join(cycleDir, 'feedback.md'),
      'the plan misses the error case\n',
    );
    await finish([
      'verdict',
      'fail',
      '--feedback',
      join(cycleDir, 'feedback.md'),
    ]);
  },
  'verdict-pass': async () => {
    await writeOutputs();
    await finish(['verdict', 'pass']);
  },
  block: async () => {
    writeFileSync(join(cycleDir, 'handover.md'), 'stuck on the schema\n');
    await finish([
      'block',
      '--reason',
      'stuck on the schema',
      '--handover',
      join(cycleDir, 'handover.md'),
    ]);
  },
  ask: async () => {
    const answered = await operator(['ask', 'which database?']);
    writeFileSync(join(cycleDir, 'answer.txt'), answered.stdout);
    await writeOutputs();
    await finish(['done']);
  },
  nudge: async () => {
    await nextTyped();
    await writeOutputs();
    await finish(['done']);
  },
  silent: async () => {
    await stayAlive();
  },
  'hand-over-on-request': async () => {
    await nextTyped();
    writeFileSync(
      join(cycleDir, 'handover.md'),
      'partial plan, next Operator continues\n',
    );
    await finish([
      'block',
      '--reason',
      'handed over',
      '--handover',
      join(cycleDir, 'handover.md'),
    ]);
  },
  'ignore-request': async () => {
    // Opens a question nobody answers, then ignores every request to hand over.
    void operator(['ask', 'which database?']);
    await stayAlive();
  },
};

const run = scenarios[scenario];
if (run === undefined) {
  process.stderr.write(`unknown scenario ${scenario}\n`);
  process.exit(2);
}
void run();
