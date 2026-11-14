import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gitMirror } from '@repo/factory-server/adapters/git-mirror';
import { socketFactoryClient } from '@repo/factory-server/socket/client';
import {
  startSocketListener,
  type SocketListener,
} from '@repo/factory-server/socket/listener';
import {
  createFixtureRepo,
  todoFile,
} from '@repo/factory-server/__tests__/e2e/fixture-repo';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import type { Job } from '@repo/factory-core/contracts/job';
import type { CellId, ProjectId } from '@repo/factory-core/ids';
import type { StoredEvent } from '@repo/factory-core/order/events';
import { fakePrState } from '@repo/factory-core/testing';
import {
  openRuntime,
  type OpenedRuntime,
} from '@repo/factory-runtime/open-runtime';
import { seedProject } from '@repo/factory-runtime/seed';
import { systemClock } from '../../clock/system-clock';
import { createRegistry, type StationRegistry } from '../../cycle/registry';
import { createJobRegistry } from '../../jobs/registry';
import { leaveCell } from '../../leave';
import {
  runOperatorStation,
  type RunnerLaunch,
  type RunnerUsage,
  type StationDeps,
  type StationTiming,
} from '../../jobs/run-operator-station';
import { createHeartbeat } from '../../loops/heartbeat';
import { runGit } from '../../git';
import type { PaneDriver } from '../../ports';
import { spawnHeadless } from '../../runners/headless';
import { prepareWorkspace } from '../../workspace';
import { commitOf, must } from '../helpers/git';

type Client = FactoryClient;

const PROJECT = 'software-factory' as ProjectId;
const CELL = '01J0000000000000000000000W' as CellId;
const SCRIPT = fileURLToPath(
  new URL('./scripted-operator.ts', import.meta.url),
);
const TODO = 'add-login';
const BRANCH = `factory/${TODO}`;

const FAST: StationTiming = {
  tickMs: 20,
  questionHoldMs: 60_000,
  handoverGraceMs: 60_000,
};

let root: string;
let dataDir: string;
let cellDir: string;
let repo: string;
let opened: OpenedRuntime | undefined;
let listener: SocketListener | undefined;
const prState = fakePrState();

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'cell-e2e-'));
  dataDir = join(root, 'data');
  cellDir = join(root, 'cell');
  mkdirSync(dataDir);
  mkdirSync(cellDir);
  repo = await createFixtureRepo(join(root, 'repo'), {
    [TODO]: todoFile({ title: 'Add login', v2: true }),
  });
  seedProject(dataDir, { projectId: PROJECT, repoUrl: repo });
});

afterEach(async () => {
  await listener?.stop();
  listener = undefined;
  opened?.close();
  opened = undefined;
  rmSync(root, { recursive: true, force: true });
});

/** Opens the runtime's data directory and serves it on its socket, the way factory-server does. */
const serve = async (): Promise<Client> => {
  opened = openRuntime({
    dataDir,
    git: gitMirror({ mirrorsDir: join(dataDir, 'mirrors') }),
    prState,
    config: { intakePollMs: 0, prPollMs: 0 },
  });
  await opened.runtime.start();
  const socketPath = join(dataDir, 'factory.sock');
  listener = startSocketListener({ runtime: opened.runtime, socketPath });
  const client = socketFactoryClient({ socketPath });
  await client.call('intakeSync', {});
  await client.call('hello', {
    cellId: CELL,
    version: '0.1.0',
    projects: [PROJECT],
    runners: ['claude', 'cursor'],
    capabilities: [],
    slots: 1,
  });
  return client;
};

/** The job runs headless: the scripted runner is a process, not a Herdr pane (the Herdr path is unit-tested). */
const asHeadless = (job: Job): Job => {
  if (job.station?.operator === undefined)
    throw new Error('the job is not an Operator station');
  return {
    ...job,
    station: {
      ...job.station,
      operator: { ...job.station.operator, headless: true },
    },
  };
};

const claim = async (client: Client, waitMs = 0): Promise<Job> => {
  const job = (await client.call('claim', { cellId: CELL, waitMs })).job;
  if (job === null) throw new Error('expected a claimable job');
  return asHeadless(job);
};

const eventsOf = async (client: Client, job: Job): Promise<StoredEvent[]> =>
  (await client.call('orderDetail', { orderId: job.orderId })).events;

const hasEvent = (events: StoredEvent[], type: string): boolean =>
  events.some((stored) => stored.event.type === type);

const eventOf = (events: StoredEvent[], type: string) =>
  events.find((stored) => stored.event.type === type)?.event;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
): Promise<void> => {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (await predicate()) return;
    await sleep(20);
  }
  throw new Error('condition never held');
};

/** The usage line the scripted runner prints (`USAGE {json}`), read from its stdout log. */
const parseUsage = (stdout: string): RunnerUsage | undefined => {
  const line = stdout.split('\n').find((text) => text.startsWith('USAGE '));
  return line === undefined
    ? undefined
    : (JSON.parse(line.slice('USAGE '.length)) as RunnerUsage);
};

/** The Station dependencies of a run: real git, workspace and spawn, and a scripted runner. */
const depsFor = (
  client: Client,
  job: Job,
  scenario: string,
  options: {
    timing?: Partial<StationTiming>;
    registry?: StationRegistry;
    wrapped?: Client;
    usage?: RunnerLaunch['usage'];
  } = {},
): StationDeps => {
  const runner = job.station?.operator?.runner ?? 'claude';
  const launch: RunnerLaunch = {
    binary: 'bun',
    kickoffArgs: (kickoff) => [SCRIPT, scenario, kickoff],
    ...(options.usage === undefined ? {} : { usage: options.usage }),
  };
  return {
    client: options.wrapped ?? client,
    cellId: CELL,
    dataDir: cellDir,
    clock: { now: () => Date.now() },
    sleep,
    git: runGit,
    workspace: (current) =>
      prepareWorkspace({ job: current, dataDir: cellDir }),
    runners: { [runner]: launch },
    spawn: spawnHeadless,
    timing: { ...FAST, ...options.timing },
    registry: options.registry ?? createRegistry(),
  };
};

const remoteBranchSha = async (): Promise<string> =>
  must(repo, ['rev-parse', '--verify', '-q', `refs/heads/${BRANCH}`]).catch(
    () => '',
  );

describe('Operator station against the runtime', () => {
  it('runs a station to done: the Cycle completes and the commit carries the passed trailer', async () => {
    const client = await serve();
    const job = await claim(client);

    const next = await runOperatorStation(job, depsFor(client, job, 'done'));

    const events = await eventsOf(client, job);
    expect(hasEvent(events, 'cycle_completed')).toBe(true);
    const onBranch = await commitOf(repo, `refs/heads/${BRANCH}`);
    expect(onBranch.subject).toBe(
      `wip(${job.station?.stationId}): cycle ${job.station?.n}`,
    );
    expect(onBranch.body).toContain('Factory-Outcome: passed');
    expect(onBranch.body).toContain(`Factory-Order: ${job.orderId}`);
    expect(next?.orderId ?? job.orderId).toBe(job.orderId);
  });

  it('records a failed verdict with its feedback and the failed outcome', async () => {
    const client = await serve();
    const plan = await claim(client);
    const next = await runOperatorStation(plan, depsFor(client, plan, 'done'));
    if (next === null)
      throw new Error('expected the plan to hand on the review job');
    const review = asHeadless(next);
    expect(review.station?.verdict).toBe(true);

    await runOperatorStation(review, depsFor(client, review, 'verdict-fail'));

    const events = await eventsOf(client, review);
    expect(hasEvent(events, 'verdict_recorded')).toBe(true);
    expect((await commitOf(repo, `refs/heads/${BRANCH}`)).body).toContain(
      'Factory-Outcome: failed',
    );
  });

  it('records a passing verdict and the passed outcome on the commit', async () => {
    const client = await serve();
    const plan = await claim(client);
    const next = await runOperatorStation(plan, depsFor(client, plan, 'done'));
    if (next === null)
      throw new Error('expected the plan to hand on the review job');
    const review = asHeadless(next);

    await runOperatorStation(review, depsFor(client, review, 'verdict-pass'));

    expect(hasEvent(await eventsOf(client, review), 'verdict_recorded')).toBe(
      true,
    );
    expect((await commitOf(repo, `refs/heads/${BRANCH}`)).body).toContain(
      'Factory-Outcome: passed',
    );
  });

  it('blocks the Cycle with its Handover when the Operator reports a block', async () => {
    const client = await serve();
    const job = await claim(client);

    await runOperatorStation(job, depsFor(client, job, 'block'));

    expect(hasEvent(await eventsOf(client, job), 'cycle_blocked')).toBe(true);
    expect((await commitOf(repo, `refs/heads/${BRANCH}`)).body).toContain(
      'Factory-Outcome: blocked',
    );
  });

  it('answers a question: the Supervisor answer returns to the ask, and the Cycle carries on', async () => {
    const client = await serve();
    const job = await claim(client);
    const running = runOperatorStation(job, depsFor(client, job, 'ask'));

    const questionId = await questionIdOf(client, job);
    await client.call('answer', {
      orderId: job.orderId,
      commandId: `${job.jobId}:answer`,
      questionId,
      text: 'postgres',
    } as never);
    await running;

    const events = await eventsOf(client, job);
    expect(hasEvent(events, 'question_answered')).toBe(true);
    expect(hasEvent(events, 'cycle_completed')).toBe(true);
  });

  it('types a nudge into the running Operator', async () => {
    const client = await serve();
    const job = await claim(client);
    const running = runOperatorStation(job, depsFor(client, job, 'nudge'));
    await waitFor(async () =>
      hasEvent(await eventsOf(client, job), 'cycle_started'),
    );

    await client.call('nudge', {
      orderId: job.orderId,
      commandId: `${job.jobId}:nudge`,
      text: 'focus on the login form',
    } as never);
    await running;

    expect(hasEvent(await eventsOf(client, job), 'nudged')).toBe(true);
  });

  it('fails the Cycle as timed out when the Operator stays silent past its timeout', async () => {
    const client = await serve();
    const job = await claim(client);
    job.station!.operator!.timeoutMs = 400;

    await runOperatorStation(job, depsFor(client, job, 'silent'));

    expect(eventOf(await eventsOf(client, job), 'cycle_failed')).toMatchObject({
      reason: 'timed_out',
    });
  });

  it('blocks the Cycle as question_timeout when the Operator ignores the hold', async () => {
    const client = await serve();
    const job = await claim(client);
    job.station!.operator!.timeoutMs = 60_000;

    const running = runOperatorStation(
      job,
      depsFor(client, job, 'ignore-request', {
        timing: { questionHoldMs: 150, handoverGraceMs: 150 },
      }),
    );
    await questionIdOf(client, job);
    await running;

    expect(eventOf(await eventsOf(client, job), 'cycle_blocked')).toMatchObject(
      {
        source: 'runtime',
        reason: 'question_timeout',
      },
    );
    // The runtime block is a terminal outcome: it is checkpointed like any other (PROTOCOL §8.2).
    expect((await commitOf(repo, `refs/heads/${BRANCH}`)).body).toContain(
      'Factory-Outcome: blocked',
    );
  });

  it('observes a pane station through its driver: a pane that reads blocked is blocked by the runtime', async () => {
    const client = await serve();
    const claimed = (await client.call('claim', { cellId: CELL, waitMs: 0 }))
      .job;
    if (claimed === null) throw new Error('expected a claimable job');
    const job: Job = {
      ...claimed,
      station: {
        ...claimed.station!,
        operator: { ...claimed.station!.operator!, headless: false },
      },
    };
    const pane: PaneDriver = {
      open: async () => undefined,
      type: async () => undefined,
      read: async () => ({ operator: 'blocked' }),
      tail: async () => '',
      close: async () => undefined,
    };

    await runOperatorStation(job, {
      ...depsFor(client, job, 'silent'),
      pane,
    });

    expect(eventOf(await eventsOf(client, job), 'cycle_blocked')).toMatchObject(
      { source: 'runtime', reason: 'runner_prompt' },
    );
    expect((await commitOf(repo, `refs/heads/${BRANCH}`)).body).toContain(
      'Factory-Outcome: blocked',
    );
  });

  it('records the usage the runner reports after the Cycle ends', async () => {
    const client = await serve();
    const job = await claim(client);

    await runOperatorStation(
      job,
      depsFor(client, job, 'done-with-usage', { usage: parseUsage }),
    );

    expect(
      eventOf(await eventsOf(client, job), 'usage_recorded'),
    ).toMatchObject({ inputTokens: 3, outputTokens: 5, costUsd: 0.25 });
  });

  it('never pushes when the dry run answers stale_epoch', async () => {
    const client = await serve();
    const job = await claim(client);
    const wrapped: Client = {
      call: (route, request) =>
        route === 'submitCommand' &&
        (request as { dryRun?: boolean }).dryRun === true
          ? client.call(route, { ...(request as object), epoch: 999 } as never)
          : client.call(route, request as never),
    } as Client;

    await runOperatorStation(job, depsFor(client, job, 'done', { wrapped }));

    expect(await remoteBranchSha()).toBe('');
  });

  it('leaves with a Handover: the Operator writes it and the Cycle is handed over', async () => {
    const client = await serve();
    const job = await claim(client);
    const registry = createRegistry();
    const running = runOperatorStation(
      job,
      depsFor(client, job, 'hand-over-on-request', { registry }),
    );

    await waitFor(() => registry.all().length === 1);
    await leaveCell({ registry, sleep, now: () => Date.now(), pollMs: 20 });
    await running;

    expect(hasEvent(await eventsOf(client, job), 'cycle_handed_over')).toBe(
      true,
    );
    expect((await commitOf(repo, `refs/heads/${BRANCH}`)).body).toContain(
      'Factory-Outcome: handed_over',
    );
  });

  it('releases the job when a leaving Operator does not hand over in time', async () => {
    const client = await serve();
    const job = await claim(client);
    const registry = createRegistry();
    const running = runOperatorStation(
      job,
      depsFor(client, job, 'ignore-request', {
        registry,
        timing: { handoverGraceMs: 150 },
      }),
    );

    await waitFor(() => registry.all().length === 1);
    await leaveCell({ registry, sleep, now: () => Date.now(), pollMs: 20 });
    await running;

    expect(hasEvent(await eventsOf(client, job), 'job_lost')).toBe(true);
  });

  it('receives signals through the shared Cell heartbeat without sending duplicate heartbeats', async () => {
    const client = await serve();
    const job = await claim(client);
    const jobs = createJobRegistry();
    const handle = jobs.start(job.jobId);
    const heartbeat = createHeartbeat({
      client,
      cellId: CELL,
      registry: jobs,
      clock: systemClock,
      selfFenceMs: 45_000,
    });
    const beat = setInterval(() => {
      void heartbeat.tick();
    }, 20);
    let directHeartbeats = 0;
    const wrapped: Client = {
      call: (route, request) => {
        if (route === 'heartbeat') directHeartbeats += 1;
        return client.call(route as 'claim', request as never);
      },
    } as Client;

    try {
      const running = runOperatorStation(job, {
        ...depsFor(client, job, 'ask', { wrapped }),
        signal: handle.signal,
        takeSignals: () => jobs.takeSignals(job.jobId),
      });
      const questionId = await questionIdOf(client, job);
      await client.call('answer', {
        orderId: job.orderId,
        commandId: `${job.jobId}:answer`,
        questionId,
        text: 'postgres',
      } as never);
      await running;
    } finally {
      clearInterval(beat);
      jobs.finish(job.jobId);
    }

    expect(directHeartbeats).toBe(0);
    const events = await eventsOf(client, job);
    expect(hasEvent(events, 'question_answered')).toBe(true);
    expect(hasEvent(events, 'cycle_completed')).toBe(true);
  });
});

/** Waits for the Operator to open a question and returns its id from the event feed. */
const questionIdOf = async (client: Client, job: Job): Promise<string> => {
  let found = '';
  await waitFor(async () => {
    const question = eventOf(await eventsOf(client, job), 'question_asked') as
      { questionId?: string } | undefined;
    if (question?.questionId !== undefined) found = question.questionId;
    return found !== '';
  });
  return found;
};
