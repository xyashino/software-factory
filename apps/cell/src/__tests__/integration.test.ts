import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import type { Job } from '@repo/factory-core/contracts/job';
import type { CellId, OrderId } from '@repo/factory-core/ids';
import { startCell, type RunningCell } from '../cell';
import { parseConfig } from '../config';
import { createSystemAdapter } from '../adapters/system/system.adapter';
import { systemClock } from '../clock/system-clock';
import { socketFactoryClient, socketPathIn } from '../factory-client';
import { createJobRegistry } from '../jobs/registry';
import { runJob } from '../jobs/run-job';
import type { JobContext } from '../jobs/send';
import { createHeartbeat } from '../loops/heartbeat';
import { makeRepo } from '../testing/git-repo';

/** The fixture server: factory-server over a seeded data directory, spawned by path (no import). */
const FIXTURE = fileURLToPath(
  new URL('../../../server/src/testing/serve-fixture.ts', import.meta.url),
);
const CELL = '01J0000000000000000000000W' as CellId;
const ORDER = 'software-factory:todo-1' as OrderId;
const ONE_SLOT = parseConfig('slots = 1\nprojects = ["software-factory"]');

let root: string;
let origin: string;
let dataDir: string;
let cellDataDir: string;
const children: Bun.Subprocess[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-cell-integration-'));
  origin = join(root, 'origin');
  dataDir = join(root, 'factory');
  cellDataDir = join(root, 'cell');
  makeRepo(origin);
  mkdirSync(dataDir, { recursive: true });
});

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill('SIGKILL');
    await child.exited;
  }
  rmSync(root, { recursive: true, force: true });
});

/** Starts the fixture server with `checks` as the quality gate, and waits until its socket listens. */
const startFactory = async (checks: string[]): Promise<Bun.Subprocess> => {
  const child = Bun.spawn(
    ['bun', FIXTURE, dataDir, origin, JSON.stringify(checks)],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  children.push(child);
  for (let waited = 0; waited < 20_000; waited += 50) {
    if (existsSync(socketPathIn(dataDir))) return child;
    await Bun.sleep(50);
  }
  throw new Error('the fixture server did not open its socket');
};

const socketClient = (): FactoryClient =>
  socketFactoryClient({ socketPath: socketPathIn(dataDir) });

/** The Order's events, as their type names, in order. */
const eventTypes = async (client: FactoryClient): Promise<string[]> => {
  const detail = await client.call('orderDetail', { orderId: ORDER });
  return detail.events.map((stored) => stored.event.type);
};

/** Waits until `predicate` holds on the Order's events, or fails after `ms`. */
const waitForEvents = async (
  client: FactoryClient,
  predicate: (types: string[]) => boolean,
  ms = 20_000,
): Promise<string[]> => {
  let seen: string[] = [];
  for (let waited = 0; waited < ms; waited += 100) {
    seen = await eventTypes(client);
    if (predicate(seen)) return seen;
    await Bun.sleep(100);
  }
  throw new Error(
    `the Order did not reach the expected events; it has: ${seen.join(', ')}`,
  );
};

/** The job context a Cell runs a claimed job with, over the given client. */
const jobContext = (client: FactoryClient): JobContext => ({
  client,
  cellId: CELL,
  system: createSystemAdapter(),
  cellDataDir,
  worktreeLimit: 8,
  inUse: new Set(),
});

/** Socket inodes a process holds, from its file descriptors. */
const socketInodes = (pid: number): Set<string> => {
  const inodes = new Set<string>();
  for (const fd of readdirSync(`/proc/${pid}/fd`)) {
    try {
      const match = /^socket:\[(\d+)\]$/.exec(
        readlinkSync(`/proc/${pid}/fd/${fd}`),
      );
      if (match?.[1]) inodes.add(match[1]);
    } catch {
      // The descriptor closed while we looked.
    }
  }
  return inodes;
};

/** Inodes of TCP sockets in LISTEN state, from the kernel's tables. */
const listeningTcpInodes = (): Set<string> => {
  const inodes = new Set<string>();
  for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
    const rows = readFileSync(table, 'utf8').split('\n').slice(1);
    for (const row of rows) {
      const fields = row.trim().split(/\s+/);
      if (fields[3] === '0A' && fields[9]) inodes.add(fields[9]);
    }
  }
  return inodes;
};

describe('Cell over the socket', () => {
  it('says hello and gets the runtime config back', async () => {
    await startFactory(['echo inspected']);

    const answer = await socketClient().call('hello', {
      cellId: CELL,
      version: 'test',
      projects: ['software-factory'],
      runners: [],
      capabilities: [],
      slots: 1,
    });

    expect(answer.config.selfFenceMs).toBeGreaterThan(0);
    expect(answer.config.leaseTtlMs).toBeGreaterThan(answer.config.selfFenceMs);
  });

  it('serves the socket and opens no TCP listener', async () => {
    const child = await startFactory(['echo inspected']);

    const own = socketInodes(child.pid);
    const listening = listeningTcpInodes();

    expect(own.size).toBeGreaterThan(0);
    expect([...own].filter((inode) => listening.has(inode))).toEqual([]);
  });

  it('claims an Inspection job, keeps it alive, and reports it accepted, in that order', async () => {
    await startFactory(['echo inspected']);
    const client = socketClient();
    await client.call('hello', {
      cellId: CELL,
      version: 'test',
      projects: ['software-factory'],
      runners: [],
      capabilities: [],
      slots: 1,
    });

    const claimed = await client.call('claim', { cellId: CELL, waitMs: 0 });
    const job = claimed.job as Job;
    expect(job.kind).toBe('run_inspection');

    const registry = createJobRegistry();
    const { signal } = registry.start(job.jobId);
    const heartbeat = createHeartbeat({
      client,
      cellId: CELL,
      registry,
      clock: systemClock,
      selfFenceMs: 45_000,
    });
    await heartbeat.tick();
    expect(registry.activeJobIds()).toEqual([job.jobId]);
    await runJob(jobContext(client), job, signal);
    registry.finish(job.jobId);

    const types = await waitForEvents(client, (seen) =>
      seen.includes('inspection_finished'),
    );
    const started = types.indexOf('cycle_started');
    expect(started).toBeGreaterThanOrEqual(0);
    expect(started).toBeLessThan(types.indexOf('inspection_finished'));
  });

  it('runs a Cell end to end: claim, heartbeat and report, through startCell', async () => {
    await startFactory(['echo inspected']);
    const client = socketClient();
    const loopErrors: string[] = [];
    const running: RunningCell = await startCell({
      client,
      cellId: CELL,
      config: ONE_SLOT,
      cellDataDir,
      system: createSystemAdapter(),
      clock: systemClock,
      version: 'test',
      timing: { heartbeatMs: 200, claimWaitMs: 0, idlePauseMs: 50 },
      onError: (error, context) => {
        loopErrors.push(`${context}: ${String(error)}`);
      },
    });

    try {
      const types = await waitForEvents(client, (seen) =>
        seen.includes('inspection_finished'),
      );

      expect(types.indexOf('cycle_started')).toBeLessThan(
        types.indexOf('inspection_finished'),
      );
      expect(types).not.toContain('cycle_failed');
      expect(loopErrors).toEqual([]);
    } finally {
      running.stop();
    }
  });

  it('fails the Cycle as crashed when the check dirties the worktree', async () => {
    await startFactory(['echo change > changed.txt']);
    const client = socketClient();
    const running = await startCell({
      client,
      cellId: CELL,
      config: ONE_SLOT,
      cellDataDir,
      system: createSystemAdapter(),
      clock: systemClock,
      version: 'test',
      timing: { heartbeatMs: 200, claimWaitMs: 0, idlePauseMs: 50 },
    });

    try {
      const types = await waitForEvents(client, (seen) =>
        seen.includes('cycle_failed'),
      );

      expect(types).toContain('cycle_started');
      expect(types).not.toContain('inspection_finished');
    } finally {
      running.stop();
    }
  });

  it('stops a job before its lease can expire when heartbeats stop reaching the Factory', async () => {
    await startFactory(['sleep 30']);
    const socket = socketClient();
    const hello = await socket.call('hello', {
      cellId: CELL,
      version: 'test',
      projects: ['software-factory'],
      runners: [],
      capabilities: [],
      slots: 1,
    });
    const claimed = await socket.call('claim', { cellId: CELL, waitMs: 0 });
    const job = claimed.job as Job;

    // The Cell's heartbeats never reach the Factory: every other call goes through.
    const unreachable = {
      call: (route: string, request: unknown) => {
        if (route === 'heartbeat')
          return Promise.reject(new Error('unreachable'));
        return socket.call(route as 'claim', request as never);
      },
    } as unknown as FactoryClient;
    const registry = createJobRegistry();
    const { signal } = registry.start(job.jobId);
    const heartbeat = createHeartbeat({
      client: unreachable,
      cellId: CELL,
      registry,
      clock: systemClock,
      selfFenceMs: 1_000,
    });
    const fence = setInterval(() => heartbeat.checkFence(), 100);
    const beat = setInterval(() => void heartbeat.tick(), 200);

    const started = performance.now();
    try {
      await runJob(jobContext(unreachable), job, signal).catch(() => undefined);
    } finally {
      clearInterval(fence);
      clearInterval(beat);
      registry.finish(job.jobId);
    }
    const elapsedMs = performance.now() - started;

    expect(heartbeat.fenced).toBe(true);
    expect(signal.aborted).toBe(true);
    // The check sleeps 30 s and the lease lasts a minute: the job must end at the fence (about 1 s),
    // well before its lease could expire, not when the sleep would have ended.
    expect(elapsedMs).toBeLessThan(10_000);
    expect(elapsedMs).toBeLessThan(hello.config.leaseTtlMs);
    const types = await eventTypes(socket);
    expect(types).not.toContain('inspection_finished');
    expect(types).not.toContain('cycle_failed');
  });
});
