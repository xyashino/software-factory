import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Job } from '@repo/factory-core/contracts/job';
import {
  deleteSession,
  listSessions,
  sessionPathOf,
  writeSession,
  type Session,
} from '../../cycle/session';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cell-session-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const ORDER = 'software-factory:add-login';
const JOB = '01J7Q2X8M4K0R6T9W3Y5Z7B1CD';
const CYCLE = '01J7Q2X8M4K0R6T9W3Y5Z7B1CE';

/** A station's session, as the Cell writes it when a pane opens. The job is a deliver job, a valid Job shape. */
const sessionOf = (overrides: Partial<Session> = {}): Session => ({
  orderId: ORDER,
  jobId: JOB,
  cycleId: CYCLE,
  epoch: 2,
  stationId: 'build',
  paneName: 'build_abc123_1',
  tabId: 'tab-7',
  taskName: 'add-login',
  operatorToken: 'a'.repeat(48),
  operatorPort: 41234,
  worktree: '/repo/.worktrees/add-login',
  startedAt: 1_000,
  cycle: {
    startedAt: 1_000,
    pausedMs: 0,
    reminders: { idle: 1, silent: 0 },
  },
  job: {
    jobId: JOB,
    orderId: ORDER,
    projectId: 'software-factory',
    epoch: 2,
    kind: 'deliver',
    repo: {
      url: 'https://example.invalid/repo.git',
      baseBranch: 'main',
      branch: 'factory/add-login',
    },
    base: { branchBase: 'main' },
    workspace: {
      dir: 'add-login',
      sync: [],
      setup: [],
      timeoutMs: 60_000,
      mode: 'reuse',
    },
    deliver: {
      taskId: 'add-login',
      type: 'feat',
      title: 'Add login',
      todoBodyBlob: `sha256:${'a'.repeat(64)}`,
      commitBlob: `sha256:${'c'.repeat(64)}`,
      logCommand: `factory log ${ORDER}`,
      verification: [
        { kind: 'operator', stationId: 'build', profile: 'builder' },
      ],
    },
  } as unknown as Job,
  ...overrides,
});

describe('the session store of a pane Operator', () => {
  it('keeps a session the next start reads back unchanged', () => {
    const session = sessionOf();

    writeSession(dataDir, session);

    expect(listSessions(dataDir)).toEqual([session]);
  });

  it('writes the session owner-only, since it holds the operator token', () => {
    writeSession(dataDir, sessionOf());

    const mode = statSync(sessionPathOf(dataDir, CYCLE)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('skips a session file that is not valid JSON or not a session', () => {
    writeSession(dataDir, sessionOf());
    const broken = join(dataDir, 'cycles', 'broken', 'session.json');
    mkdirSync(dirname(broken), { recursive: true });
    writeFileSync(broken, '{"not": "a session"');
    const partial = join(dataDir, 'cycles', 'partial', 'session.json');
    mkdirSync(dirname(partial), { recursive: true });
    writeFileSync(partial, '{"jobId": "only this"}');

    expect(listSessions(dataDir)).toEqual([sessionOf()]);
  });

  it('removes a session when its Cycle ends, and a second removal is not an error', () => {
    writeSession(dataDir, sessionOf());

    deleteSession(dataDir, CYCLE);
    deleteSession(dataDir, CYCLE);

    expect(listSessions(dataDir)).toEqual([]);
  });

  it('lists nothing before any session exists', () => {
    expect(listSessions(dataDir)).toEqual([]);
  });
});
