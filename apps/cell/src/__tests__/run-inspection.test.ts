import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import { WireFailure } from '@repo/factory-core/contracts/errors';
import type { Job } from '@repo/factory-core/contracts/job';
import type { CellId, CycleId, JobId, OrderId } from '@repo/factory-core/ids';
import { createSystemAdapter } from '../adapters/system/system.adapter';
import { runInspection } from '../jobs/run-inspection';
import type { JobContext } from '../jobs/send';
import { makeRepo } from '../testing/git-repo';

const CELL = '01J0000000000000000000000W' as CellId;
const JOB = '01J0000000000000000000000J' as JobId;
const CYCLE = '01J0000000000000000000000C' as CycleId;
const ORDER = 'software-factory:todo-1' as OrderId;

/** One call the job made: the route and the request it sent. */
interface Sent {
  route: string;
  request: {
    command?: { type: string } & Record<string, unknown>;
    ref?: string;
  };
}

type Answer = (sent: Sent) => unknown;

let root: string;
let origin: string;
let head: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-cell-inspection-'));
  origin = join(root, 'origin');
  head = makeRepo(origin);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The Factory's answers when everything is accepted: a StartCycle opens CYCLE. */
const accepting: Answer = (sent) => {
  if (sent.route === 'blobPut') return { ref: sent.request.ref };
  const events =
    sent.request.command?.type === 'StartCycle'
      ? [{ type: 'cycle_started', cycleId: CYCLE }]
      : [];
  return { dryRun: false, events, next: null };
};

/** A context whose client records every call and answers from `answer`. */
const contextWith = (answer: Answer = accepting) => {
  const calls: Sent[] = [];
  const client = {
    call: async (route: string, request: unknown) => {
      const sent = { route, request: request as Sent['request'] };
      calls.push(sent);
      return answer(sent);
    },
  } as unknown as FactoryClient;
  const context: JobContext = {
    client,
    cellId: CELL,
    system: createSystemAdapter(),
    cellDataDir: join(root, 'cell'),
    worktreeLimit: 8,
    inUse: new Set(),
  };
  return { context, calls };
};

/** An inspection job on the origin repo, running `exec` as its checks. */
const inspectionJob = (
  exec: string[],
  options: { setup?: string[]; inspectionTimeoutMs?: number } = {},
): Job =>
  ({
    jobId: JOB,
    orderId: ORDER,
    projectId: 'software-factory',
    epoch: 3,
    kind: 'run_inspection',
    repo: { url: origin, baseBranch: 'main', branch: 'factory/todo-1' },
    base: { branchBase: 'main' },
    workspace: {
      dir: 'todo-1',
      sync: [],
      setup: options.setup ?? [],
      timeoutMs: 60_000,
    },
    station: {
      stationId: 'quality-gate',
      cycleId: CYCLE,
      n: 1,
      cause: { kind: 'first' },
      exec,
      inspectionTimeoutMs: options.inspectionTimeoutMs,
    },
  }) as unknown as Job;

const signal = (): AbortSignal => new AbortController().signal;

/** Each call as `route` or `route:CommandType`, in the order sent. */
const shapeOf = (calls: Sent[]): string[] =>
  calls.map((call) =>
    call.request.command
      ? `${call.route}:${call.request.command.type}`
      : call.route,
  );

const commandsOf = (calls: Sent[], type: string) =>
  calls
    .map((call) => call.request.command)
    .filter((command) => command?.type === type);

/** The results of the ReportInspection the job sent, or none when it sent no report. */
interface ReportedResult {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  tail: string;
  logBlob: string;
}
const reportedResults = (calls: Sent[]): ReportedResult[] => {
  const [report] = commandsOf(calls, 'ReportInspection');
  return (
    (report as unknown as { results: ReportedResult[] } | undefined)?.results ??
    []
  );
};

describe('inspection job', () => {
  it('starts the Cycle from the worktree HEAD before any check is reported', async () => {
    const { context, calls } = contextWith();

    await runInspection(context, inspectionJob(['true', 'echo two']), signal());

    const shape = shapeOf(calls);
    expect(shape.indexOf('submitCommand:StartCycle')).toBeLessThan(
      shape.indexOf('submitCommand:ReportInspection'),
    );
    expect(commandsOf(calls, 'StartCycle')[0]).toMatchObject({
      baseCommit: head,
    });
  });

  it('reports the inspection as passed when every check exits 0', async () => {
    const { context, calls } = contextWith();

    await runInspection(context, inspectionJob(['true', 'echo two']), signal());

    const [report] = commandsOf(calls, 'ReportInspection');
    expect(report).toMatchObject({ cycleId: CYCLE, passed: true });
    expect(reportedResults(calls)).toHaveLength(2);
  });

  it('reports the inspection as failed when a check exits non-zero', async () => {
    const { context, calls } = contextWith();

    await runInspection(context, inspectionJob(['true', 'exit 2']), signal());

    const [report] = commandsOf(calls, 'ReportInspection');
    expect(report).toMatchObject({ passed: false });
    expect(reportedResults(calls).map((result) => result.exitCode)).toEqual([
      0, 2,
    ]);
  });

  it('runs every check even after one fails, the way the gate always has', async () => {
    const { context, calls } = contextWith();

    await runInspection(
      context,
      inspectionJob(['exit 1', 'echo still-runs']),
      signal(),
    );

    expect(reportedResults(calls)).toHaveLength(2);
  });

  it('reports a check that times out as failed', async () => {
    const { context, calls } = contextWith();

    await runInspection(
      context,
      inspectionJob(['sleep 30'], { inspectionTimeoutMs: 300 }),
      signal(),
    );

    const [report] = commandsOf(calls, 'ReportInspection');
    expect(report).toMatchObject({ passed: false });
    expect(reportedResults(calls)[0]?.timedOut).toBe(true);
  });

  it('keeps the tail to 2 KiB and strips terminal colour codes', async () => {
    const { context, calls } = contextWith();

    await runInspection(
      context,
      inspectionJob(['yes x | head -c 5000; printf "\\033[31mRED\\033[0m\\n"']),
      signal(),
    );

    const tail = reportedResults(calls)[0]?.tail ?? '';
    expect(tail).toContain('RED');
    expect(tail).not.toContain('\u001b');
    expect(new TextEncoder().encode(tail).length).toBeLessThanOrEqual(2048);
  });

  it('uploads the full log of each check as a blob the result names', async () => {
    const { context, calls } = contextWith();

    await runInspection(
      context,
      inspectionJob(['echo one', 'echo two']),
      signal(),
    );

    const uploads = calls.filter((call) => call.route === 'blobPut');
    expect(uploads).toHaveLength(2);
    expect(reportedResults(calls).map((result) => result.logBlob)).toEqual(
      uploads.map((upload) => upload.request.ref),
    );
  });

  it('fails the Cycle as crashed, and reports nothing, when a check changed a tracked or new file', async () => {
    const { context, calls } = contextWith();

    await runInspection(
      context,
      inspectionJob(['echo change > changed.txt']),
      signal(),
    );

    expect(commandsOf(calls, 'ReportInspection')).toHaveLength(0);
    expect(commandsOf(calls, 'FailCycle')).toEqual([
      {
        type: 'FailCycle',
        cycleId: CYCLE,
        reason: 'crashed',
        detail: 'read-only station changed files',
      },
    ]);
  });

  it('reports a workspace that fails to prepare without starting a Cycle', async () => {
    const { context, calls } = contextWith();

    await runInspection(
      context,
      inspectionJob(['true'], { setup: ['exit 4'] }),
      signal(),
    );

    expect(shapeOf(calls)).not.toContain('submitCommand:StartCycle');
    expect(commandsOf(calls, 'ReportWorkspaceFailed')).toEqual([
      expect.objectContaining({
        type: 'ReportWorkspaceFailed',
        stage: 'setup',
      }),
    ]);
  });

  it('reports a pinned base the repo does not have as a worktree failure, before the Cycle starts', async () => {
    const { context, calls } = contextWith();
    const job = {
      ...inspectionJob(['true']),
      base: 'a'.repeat(40),
    } as unknown as Job;

    await runInspection(context, job, signal());

    expect(shapeOf(calls)).not.toContain('submitCommand:StartCycle');
    expect(commandsOf(calls, 'ReportWorkspaceFailed')).toEqual([
      expect.objectContaining({ stage: 'worktree' }),
    ]);
  });

  it('fails the Cycle as crashed when something breaks after it starts', async () => {
    const { context, calls } = contextWith((sent) => {
      if (sent.route === 'blobPut') throw new Error('the blob store is down');
      return accepting(sent);
    });

    await expect(
      runInspection(context, inspectionJob(['true']), signal()),
    ).rejects.toThrow(/blob store/);

    expect(commandsOf(calls, 'FailCycle')).toEqual([
      expect.objectContaining({ reason: 'crashed', cycleId: CYCLE }),
    ]);
    expect(commandsOf(calls, 'ReportInspection')).toHaveLength(0);
  });

  it('sends no failure after a stale epoch refusal: the job is no longer its own', async () => {
    const { context, calls } = contextWith((sent) => {
      if (sent.request.command?.type === 'ReportInspection') {
        throw new WireFailure({ code: 'stale_epoch', current: 4 }, 409);
      }
      return accepting(sent);
    });

    await expect(
      runInspection(context, inspectionJob(['true']), signal()),
    ).rejects.toBeInstanceOf(WireFailure);

    expect(commandsOf(calls, 'FailCycle')).toHaveLength(0);
  });

  it('sends nothing at all when its signal is already aborted', async () => {
    const { context, calls } = contextWith();
    const aborted = new AbortController();
    aborted.abort('self-fenced');

    await runInspection(context, inspectionJob(['true']), aborted.signal);

    expect(calls).toEqual([]);
  });
});
