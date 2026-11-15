import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { StoredEvent } from '@repo/factory-core/order/events';
import { todoFile } from '../fixture-repo';
import {
  createWorld,
  orderOf,
  remoteTip,
  startPrReporter,
  statusOf,
  until,
  type World,
} from './harness/world';

/**
 * The Order Plan end to end (PROTOCOL §10, ORDER-PLAN §2): three stacked Work orders on `feat/e2e`, one
 * plan PR into `main`. Real Cells run the plan jobs and the Line; GitHub is the fake `gh` of the suite,
 * and a merge is a real `git merge --no-ff` into the bare remote followed by the PR state `merged`.
 */

const CLI = fileURLToPath(
  new URL('../../../../cli/src/cli.ts', import.meta.url),
);
const PLAN = 'e2e';
const PLAN_BRANCH = 'feat/e2e';
const MAIN = 'main';

let world: World | undefined;
let stopReporter: (() => void) | undefined;
let observeDir: string | undefined;
let merges = 0;

afterEach(async () => {
  stopReporter?.();
  stopReporter = undefined;
  await world?.close();
  world = undefined;
  if (observeDir) rmSync(observeDir, { recursive: true, force: true });
  observeDir = undefined;
});

/** One pull request as the fake `gh` keeps it on disk. */
interface Pr {
  branch: string;
  url: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  base: string;
  draft: boolean;
  body: string;
}

/** What the scripted builder saw in its worktree, and the file it added (FAKE_OBSERVE_LOG). */
interface Observed {
  branch: string;
  seen: string[];
  wrote: string;
}

/** The fake `gh` file of a branch (the same name the fake writes). */
const prPath = (w: World, branch: string): string =>
  join(w.ghDir, `${branch.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);

const prOn = (w: World, branch: string): Pr | undefined =>
  existsSync(prPath(w, branch))
    ? (JSON.parse(readFileSync(prPath(w, branch), 'utf8')) as Pr)
    : undefined;

const writePr = (w: World, pr: Pr): void => {
  writeFileSync(prPath(w, pr.branch), JSON.stringify(pr));
};

/** Every pull request the fake holds. */
const allPrs = (w: World): Pr[] =>
  readdirSync(w.ghDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(w.ghDir, name), 'utf8')) as Pr);

/** A git command in `cwd`, with a fixed identity; throws with git's stderr when it fails. */
const git = (cwd: string, args: string[]): string => {
  const proc = Bun.spawnSync([
    'git',
    '-C',
    cwd,
    '-c',
    'user.name=factory-test',
    '-c',
    'user.email=factory-test@example.test',
    ...args,
  ]);
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${proc.stderr.toString()}`);
  }
  return proc.stdout.toString().trim();
};

/**
 * The fake GitHub's merge: `head` merged into `base` in the bare remote, the way GitHub merges a PR.
 * A sub-PR is merged with a merge commit and its head branch is deleted; the PRs that targeted that
 * head are retargeted to `base` (GitHub does that when the head is deleted). The plan PR is squashed.
 */
const mergePr = (
  w: World,
  head: string,
  base: string,
  how: 'merge' | 'squash',
): void => {
  merges += 1;
  const scratch = join(w.root, `merge-${merges}`);
  git(w.root, ['clone', '--quiet', w.repo, scratch]);
  git(scratch, ['checkout', '--quiet', '-B', base, `origin/${base}`]);
  if (how === 'merge') {
    git(scratch, [
      'merge',
      '--no-ff',
      '--quiet',
      '-m',
      `Merge ${head} into ${base}`,
      `origin/${head}`,
    ]);
  } else {
    git(scratch, ['merge', '--squash', '--quiet', `origin/${head}`]);
    git(scratch, ['commit', '--quiet', '-m', `${head} (squash)`]);
  }
  git(scratch, ['push', '--quiet', 'origin', base]);
  const pr = prOn(w, head);
  if (!pr) throw new Error(`no fake PR on ${head}`);
  writePr(w, { ...pr, state: 'MERGED' });
  if (how === 'merge') {
    git(scratch, ['push', '--quiet', 'origin', '--delete', head]);
    for (const other of allPrs(w)) {
      if (other.base === head && other.state === 'OPEN') {
        writePr(w, { ...other, base });
      }
    }
  }
};

/** The Supervisor CLI as a real process, against the data directory (socket when the server runs). */
const runCli = async (
  dataDir: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.FACTORY_CONFIG = join(dataDir, 'no-config.json');
  delete env.FACTORY_DATA_DIR;
  const child = Bun.spawn(
    [process.execPath, CLI, ...args, '--data-dir', dataDir, '--no-color'],
    { stdout: 'pipe', stderr: 'pipe', env },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code: await child.exited, stdout, stderr };
};

/** What the scripted builder logged, one line per build run. */
const observed = (path: string): Observed[] =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Observed)
    : [];

/** The plan row of this suite's plan, from the `plans` route. */
const planRow = async (w: World) => {
  const { plans } = await w.factory.client.call('plans', {});
  return plans.find((plan) => plan.slug === PLAN);
};

/** The global sequence number of the first event of one type in a Work order (its stream). */
const globalSeqOf = (
  events: StoredEvent[],
  type: StoredEvent['event']['type'],
): number | undefined =>
  events.find((stored) => stored.event.type === type)?.globalSeq;

describe('an Order Plan of three stacked Work orders', () => {
  it('runs wo-1, wo-2, wo-3 on feat/e2e and completes the plan', async () => {
    observeDir = mkdtempSync(join(tmpdir(), 'factory-plan-observe-'));
    const observe = join(observeDir, 'observed.log');
    world = await createWorld(
      {
        'wo-1': todoFile({ title: 'Add file A', v2: true, plan: PLAN }),
        'wo-2': todoFile({
          title: 'Add file B',
          v2: true,
          plan: PLAN,
          dependsOn: ['wo-1'],
        }),
        'wo-3': todoFile({
          title: 'Add file C',
          v2: true,
          plan: PLAN,
          dependsOn: ['wo-2'],
        }),
      },
      {
        bare: true,
        env: { FAKE_OBSERVE_LOG: observe },
      },
    );
    const w = world;
    stopReporter = startPrReporter(w);
    await w.cell('cell-a', { scenarios: { builder: 'add-file' } });

    // The plan branch is created by the Factory, from main, before the first member runs.
    await until(
      async () => (await remoteTip(w, PLAN_BRANCH)) !== undefined,
      'feat/e2e to exist',
      120_000,
    );

    // wo-1 delivers its PR into feat/e2e.
    await until(
      async () => (await statusOf(w, 'wo-1')) === 'delivered',
      'wo-1 to be delivered',
      180_000,
    );
    expect(prOn(w, 'factory/wo-1')?.base).toBe(PLAN_BRANCH);

    // wo-2 starts on factory/wo-1: it sees A and adds B. Its PR targets factory/wo-1.
    await until(
      () => observed(observe).some((o) => o.branch === 'factory/wo-2'),
      'wo-2 to build',
      180_000,
    );
    const wo2 = observed(observe).find((o) => o.branch === 'factory/wo-2');
    expect(wo2?.seen).toEqual(['a.txt']);
    expect(wo2?.wrote).toBe('b.txt');
    await until(
      async () => (await statusOf(w, 'wo-2')) === 'delivered',
      'wo-2 to be delivered',
      180_000,
    );
    expect(prOn(w, 'factory/wo-2')?.base).toBe('factory/wo-1');

    // Mid-flow, the CLI shows the chain over the socket: wo-1 delivered, wo-2 stacked on factory/wo-1.
    const midFlow = await runCli(w.dataDir, ['plan', 'status', PLAN]);
    expect(midFlow.code).toBe(0);
    expect(midFlow.stdout).toContain(
      'wo-1 [delivered] -> wo-2 [delivered, PR into factory/wo-1]',
    );

    // wo-2 is claimed only after wo-1 is delivered: its first claim comes after wo-1's delivery.
    const wo1Events = await w.eventsOf(orderOf('wo-1'));
    const wo2Events = await w.eventsOf(orderOf('wo-2'));
    const wo1Delivered = globalSeqOf(wo1Events, 'delivery_finished');
    const wo2FirstClaim = globalSeqOf(wo2Events, 'job_claimed');
    expect(wo1Delivered).toBeDefined();
    expect(wo2FirstClaim).toBeDefined();
    expect(wo2FirstClaim!).toBeGreaterThan(wo1Delivered!);

    // Merging wo-1 opens the draft plan PR feat/e2e -> main, once wo-1 is merged.
    mergePr(w, 'factory/wo-1', PLAN_BRANCH, 'merge');
    await until(
      () => prOn(w, PLAN_BRANCH) !== undefined,
      'the plan PR to open',
      120_000,
    ).catch(async (error: unknown) => {
      const row = await planRow(w);
      const board = (await w.factory.client.call('board', {})).orders.map(
        (o) => `${o.todoId}:${o.status}:${o.prState ?? '-'}`,
      );
      throw new Error(
        `${String(error)}\nplan=${JSON.stringify(row)}\nboard=${board.join(' ')}\nfactory=${w.factory.output().slice(-3000)}`,
      );
    });
    const planPr = prOn(w, PLAN_BRANCH);
    expect(planPr?.base).toBe(MAIN);
    expect(planPr?.draft).toBe(true);
    // The merge retargeted wo-2 onto feat/e2e (GitHub does this when the head branch is deleted).
    expect(prOn(w, 'factory/wo-2')?.base).toBe(PLAN_BRANCH);

    // wo-3 stacks on factory/wo-2: it sees A and B, adds C.
    await until(
      () => observed(observe).some((o) => o.branch === 'factory/wo-3'),
      'wo-3 to build',
      180_000,
    );
    const wo3 = observed(observe).find((o) => o.branch === 'factory/wo-3');
    expect(wo3?.seen).toEqual(['a.txt', 'b.txt']);
    expect(wo3?.wrote).toBe('c.txt');
    await until(
      async () => (await statusOf(w, 'wo-3')) === 'delivered',
      'wo-3 to be delivered',
      180_000,
    );
    expect(prOn(w, 'factory/wo-3')?.base).toBe('factory/wo-2');

    // Merge wo-2 and wo-3 into feat/e2e; each merge retargets the next sub-PR.
    mergePr(w, 'factory/wo-2', PLAN_BRANCH, 'merge');
    expect(prOn(w, 'factory/wo-3')?.base).toBe(PLAN_BRANCH);
    mergePr(w, 'factory/wo-3', PLAN_BRANCH, 'merge');

    // All three merged: the plan PR leaves draft, lists the sub-PRs, and the todos are gone from feat/e2e.
    await until(
      () => prOn(w, PLAN_BRANCH)?.draft === false,
      'the plan PR to be ready',
      180_000,
    );
    const body = prOn(w, PLAN_BRANCH)?.body ?? '';
    for (const branch of ['factory/wo-1', 'factory/wo-2', 'factory/wo-3']) {
      expect(body).toContain(prOn(w, branch)?.url ?? '\0missing');
    }
    for (const todo of ['wo-1', 'wo-2', 'wo-3']) {
      const present = Bun.spawnSync([
        'git',
        '-C',
        w.repo,
        'cat-file',
        '-e',
        `${PLAN_BRANCH}:todos/${todo}.md`,
      ]).exitCode;
      expect(present).not.toBe(0);
    }

    // The plan PR is squashed into main; the plan is completed.
    mergePr(w, PLAN_BRANCH, MAIN, 'squash');
    await until(
      async () => (await planRow(w))?.phase === 'completed',
      'the plan to complete',
      120_000,
    );

    // Socket and --once give the same output for the finished plan (RULES §6.5).
    const socketOut = await runCli(w.dataDir, ['plan', 'status', PLAN]);
    expect(socketOut.code).toBe(0);
    expect(socketOut.stdout).toContain('wo-3 [merged]');
    const socketLs = await runCli(w.dataDir, ['plan', 'ls']);
    expect(socketLs.code).toBe(0);
    expect(socketLs.stdout).toContain('completed');
    await w.factory.stop();
    const onceOut = await runCli(w.dataDir, ['plan', 'status', PLAN]);
    expect(onceOut.code).toBe(0);
    expect(onceOut.stdout).toBe(socketOut.stdout);
    const onceLs = await runCli(w.dataDir, ['plan', 'ls']);
    expect(onceLs.stdout).toBe(socketLs.stdout);
  }, 900_000);
});
