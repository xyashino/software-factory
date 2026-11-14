/**
 * The fake runner of the distributed suite. A Cell finds `claude` and `cursor-agent` on its PATH; the
 * shims in `fake-bin/` run this file, which plays the Operator: it reads the role from the prompt the
 * Cell wrote, picks the scenario for that role from `FAKE_RUNNER_SCENARIOS` (default `done`), and runs
 * the scripted Operator with the same kickoff. Stdin and stdout are the Cell's, so typed signals reach
 * the scripted Operator. Every run is appended to `FAKE_RUNNER_LOG` for the tests to read.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The scripted Operator the e2e suite already uses; it ends the Cycle through the real operator CLI. */
const SCRIPTED = fileURLToPath(
  new URL('../../e2e/scripted-operator.ts', import.meta.url),
);

const KICKOFF_PREFIX = 'Read ';
const KICKOFF_SUFFIX = ' and follow';

/** The kickoff line the Cell passes to the runner: `Read <prompt> and follow ...`. */
const kickoffOf = (args: readonly string[]): string =>
  args.find((arg) => arg.startsWith(KICKOFF_PREFIX)) ?? '';

/** The role a prompt opens with: `You are the Builder for task ...` gives `builder`. */
const roleOf = (promptPath: string): string => {
  if (!existsSync(promptPath)) return 'unknown';
  const match = /You are the (.+?) for task/.exec(
    readFileSync(promptPath, 'utf8'),
  );
  return match?.[1]?.toLowerCase().replace(/ /g, '-') ?? 'unknown';
};

/** Roles that judge rather than produce: they end their Cycle with a verdict, so they pass by default. */
const JUDGES: Record<string, string> = {
  'plan-reviewer': 'verdict-pass',
  doctor: 'verdict-pass',
};

/** A scenario per role: one name for every run, or a list used run by run (past its end, the default). */
type ScenarioPlan = string | string[];

const scenariosOf = (): Record<string, ScenarioPlan> =>
  JSON.parse(process.env.FAKE_RUNNER_SCENARIOS ?? '{}') as Record<
    string,
    ScenarioPlan
  >;

/** The run log of this Cell: one JSON line per run, written by every runner the Cell started. */
const runsOf = (): { role: string }[] => {
  const log = process.env.FAKE_RUNNER_LOG;
  if (!log || !existsSync(log)) return [];
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as { role: string });
};

/** The scenario of this run: the role's plan at its n-th run, else the judge default, else `done`. */
const scenarioFor = (role: string): string => {
  const plan = scenariosOf()[role];
  if (typeof plan === 'string') return plan;
  const earlier = runsOf().filter((run) => run.role === role).length;
  return plan?.[earlier] ?? JUDGES[role] ?? 'done';
};

const kickoff = kickoffOf(process.argv.slice(2));
const promptPath = kickoff
  .slice(KICKOFF_PREFIX.length)
  .split(KICKOFF_SUFFIX)[0] as string;
const role = roleOf(promptPath);
const scenario = scenarioFor(role);

if (process.env.FAKE_RUNNER_LOG) {
  appendFileSync(
    process.env.FAKE_RUNNER_LOG,
    `${JSON.stringify({ role, scenario, promptPath, pid: process.pid })}\n`,
  );
}

const child = Bun.spawn(['bun', SCRIPTED, scenario, kickoff], {
  env: process.env,
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => child.kill(signal));
}
process.exit(await child.exited);
