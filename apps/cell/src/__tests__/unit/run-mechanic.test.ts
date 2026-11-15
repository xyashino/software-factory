import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandResult } from '@repo/factory-core/contracts/cell';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import { jobSchema, type Job } from '@repo/factory-core/contracts/job';
import type { BlobRef, CellId } from '@repo/factory-core/ids';
import { createSystemAdapter } from '../../adapters/system/system.adapter';
import { runMechanic, type MechanicDeps } from '../../jobs/run-mechanic';
import { prepareWorkspace } from '../../workspace';
import {
  createHerdrPane,
  type HerdrExec,
  type HerdrOutcome,
} from '../../runners/herdr-pane';
import type { LaunchSpec, PaneDriver, PaneReading } from '../../ports';
import { git, makeRepo } from '../../testing/git-repo';

const JOB_ID = '01M7FHM3CH4N1C0B0000000001';
const ORDER_ID = 'software-factory:v2-24-mechanic';
const PROMPT = `sha256:${'a'.repeat(64)}` as BlobRef;
const CELL = 'cell-test' as CellId;

type Command = { type: string } & Record<string, unknown>;

interface Submitted {
  command: Command;
  epoch?: number;
}

/** What one run of the Mechanic left behind: the replies it got, the pane it opened, and what closed. */
interface Seen {
  spec?: LaunchSpec & { name: string; task: string };
  replies: Record<string, unknown>[];
  closed: string[];
}

const newSeen = (): Seen => ({ replies: [], closed: [] });

const mechanicJob = (overrides: Partial<Job> = {}): Job =>
  jobSchema.parse({
    jobId: JOB_ID,
    orderId: ORDER_ID,
    projectId: 'software-factory',
    epoch: 4,
    kind: 'mechanic',
    repo: {
      url: 'https://example.test/sf.git',
      baseBranch: 'main',
      branch: 'factory/v2-24-mechanic',
    },
    base: { branchBase: 'main' },
    mechanic: {
      andonAt: 2000,
      n: 1,
      promptBlob: PROMPT,
      operator: {
        profile: 'mechanic',
        runner: 'claude',
        model: 'opus',
        permission: 'write',
        headless: false,
        timeoutMs: 600_000,
      },
    },
    ...overrides,
  });

/** A fake runtime: records every command it is sent and answers each with an empty result. */
const fakeClient = (refuse?: { code: string; detail: string }) => {
  const submitted: Submitted[] = [];
  const client = {
    call: async (route: string, request: unknown) => {
      if (route === 'blobGet') {
        return { base64: Buffer.from('# Incident\n').toString('base64') };
      }
      if (route === 'submitCommand') {
        const req = request as { command: Command; epoch?: number };
        submitted.push({ command: req.command, epoch: req.epoch });
        if (refuse)
          throw { error: { code: refuse.code, detail: refuse.detail } };
        const result: CommandResult = { dryRun: false, events: [], next: null };
        return result;
      }
      throw new Error(`unexpected route ${route}`);
    },
  } as unknown as FactoryClient;
  return { client, submitted };
};

/** One request to the Mechanic's operator socket, sent as `factory-operator` sends it. */
const askOperator = (
  env: Record<string, string>,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    const socket = createConnection(env.FACTORY_OPERATOR_SOCKET ?? '');
    let data = '';
    socket.setEncoding('utf8');
    socket.on('connect', () =>
      socket.write(
        `${JSON.stringify({ token: env.FACTORY_CYCLE_TOKEN, ...body })}\n`,
      ),
    );
    socket.on('data', (chunk: string) => {
      data += chunk;
    });
    socket.on('end', () =>
      resolve(JSON.parse(data) as Record<string, unknown>),
    );
    socket.on('error', reject);
  });

/** A pane whose Mechanic, once the pane opens, runs `onOpen` / sends `script` to the operator socket. */
const scriptedPane = (
  script: Record<string, unknown>[],
  seen: Seen,
  read: PaneReading['operator'] = 'working',
  onOpen?: (spec: LaunchSpec & { name: string; task: string }) => void,
): PaneDriver => {
  // Once the script is sent, the Mechanic has exited: a pane with no incident then reads as gone.
  let sent = false;
  return {
    open: async (spec) => {
      seen.spec = spec;
      onOpen?.(spec);
      for (const body of script) {
        seen.replies.push(await askOperator(spec.env, body));
      }
      sent = true;
    },
    type: async () => undefined,
    read: async () => ({ operator: sent ? 'gone' : read }),
    tail: async () => '',
    close: async (name) => {
      seen.closed.push(name);
    },
    confirmTrust: async () => false,
    closeTask: async () => undefined,
  };
};

const depsFor = (
  dataDir: string,
  client: FactoryClient,
  pane: PaneDriver,
  extra: Partial<MechanicDeps> = {},
): MechanicDeps => ({
  client,
  cellId: CELL,
  dataDir,
  pane,
  now: () => Date.now(),
  sleep: async () => undefined,
  tickMs: 1,
  ...extra,
});

const incident = (
  action: 'resume' | 'cancel' | 'nudge' | 'escalate' | 'repair',
  diagnosis = 'the Operator reported a block',
): Record<string, unknown> => ({
  op: 'incident',
  diagnosis,
  action,
  changes: [],
  outcome: `took ${action}`,
});

describe('the Mechanic job run (CORE §14.3, §14.4)', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'mech-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('records the incident, then resumes the Work order as the Mechanic', async () => {
    const { client, submitted } = fakeClient();
    const seen = newSeen();
    const pane = scriptedPane(
      [incident('resume', 'the pane was blocked during startup')],
      seen,
    );

    const next = await runMechanic(
      mechanicJob(),
      depsFor(dataDir, client, pane),
    );

    expect(next).toBeNull();
    expect(submitted.map((s) => s.command.type)).toEqual([
      'RecordIncident',
      'Resume',
    ]);
    expect(submitted[0]?.command).toMatchObject({
      action: { kind: 'resume' },
      diagnosis: 'the pane was blocked during startup',
    });
    expect(submitted[1]?.command).toEqual({
      type: 'Resume',
      mode: { kind: 'retry_station' },
    });
    expect(submitted.every((s) => s.epoch === 4)).toBe(true);
    expect(seen.replies).toEqual([{ ok: true }]);
    expect(seen.closed).toHaveLength(1);
  });

  it('falls back to the repair dir without workspace deps and refuses the Operator verbs', async () => {
    const { client, submitted } = fakeClient();
    const seen = newSeen();
    const pane = scriptedPane(
      [
        { op: 'done' },
        { op: 'verdict', pass: true },
        { op: 'block', reason: 'stuck', handover: 'notes' },
        incident('nudge'),
      ],
      seen,
    );

    await runMechanic(mechanicJob(), depsFor(dataDir, client, pane));

    expect(seen.spec?.cwd).toContain(join(dataDir, 'repairs'));
    expect(seen.spec?.cwd).not.toContain('worktrees');
    expect(seen.spec?.cwd).not.toBe(dataDir);
    expect(seen.spec?.env.PATH?.split(':')[0]).toContain(
      join(dataDir, 'repairs'),
    );
    // The Operator verbs are refused, and no command is sent for them.
    expect(seen.replies.slice(0, 3).map((reply) => reply.code)).toEqual([
      'precondition',
      'precondition',
      'precondition',
    ]);
    expect(submitted.map((s) => s.command.type)).toEqual([
      'RecordIncident',
      'Nudge',
    ]);
  });

  it('prepares the Work order worktree, commits and pushes Mechanic edits, and records commit and changes', async () => {
    const origin = join(dataDir, 'origin');
    const head = makeRepo(origin);
    const cellDataDir = join(dataDir, 'cell');
    const { client, submitted } = fakeClient();
    const seen = newSeen();
    const inUse = new Set<string>();
    const job = mechanicJob({
      repo: {
        url: origin,
        baseBranch: 'main',
        branch: 'factory/v2-24-mechanic',
      },
      base: head as Job['base'],
      workspace: {
        dir: 'v2-24-mechanic',
        sync: [],
        setup: [],
        timeoutMs: 30_000,
      },
    });
    const pane = scriptedPane(
      [incident('repair', 'fixed failing test before deliver')],
      seen,
      'working',
      (spec) => {
        writeFileSync(join(spec.cwd, 'README.md'), '# fixed\n');
        writeFileSync(join(spec.cwd, 'fix.ts'), 'export const fixed = true;\n');
      },
    );

    await runMechanic(
      job,
      depsFor(cellDataDir, client, pane, {
        system: createSystemAdapter(),
        worktreeLimit: 4,
        inUse,
      }),
    );

    expect(seen.spec?.cwd).toContain(join(cellDataDir, 'worktrees'));
    expect(inUse.size).toBe(0);
    expect(seen.replies).toEqual([{ ok: true }]);
    expect(submitted.map((s) => s.command.type)).toEqual([
      'RecordIncident',
      'Resume',
    ]);
    const recorded = submitted[0]?.command as {
      commit?: string;
      action?: { kind: string };
      changes?: Array<{ kind: string; path: string; ref: string }>;
    };
    expect(recorded.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(recorded.commit).not.toBe(head);
    expect(recorded.action).toEqual({ kind: 'repair' });
    expect(recorded.changes).toEqual([
      { kind: 'file', path: 'README.md', ref: recorded.commit },
      { kind: 'file', path: 'fix.ts', ref: recorded.commit },
    ]);
    expect(git(origin, 'rev-parse', 'refs/heads/factory/v2-24-mechanic')).toBe(
      recorded.commit,
    );
  });

  it('falls back to the repair dir with a note when preparing the worktree fails', async () => {
    const cellDataDir = join(dataDir, 'cell');
    const { client, submitted } = fakeClient();
    const seen = newSeen();
    let capturedPrompt = '';
    const job = mechanicJob({
      repo: {
        url: join(dataDir, 'missing.git'),
        baseBranch: 'main',
        branch: 'factory/v2-24-mechanic',
      },
      workspace: {
        dir: 'v2-24-mechanic',
        sync: [],
        setup: [],
        timeoutMs: 30_000,
      },
    });
    const pane = scriptedPane(
      [incident('escalate', 'repo missing')],
      seen,
      'working',
      (spec) => {
        const repairDir = spec.cwd;
        capturedPrompt = readFileSync(join(repairDir, 'prompt.md'), 'utf8');
      },
    );

    await runMechanic(
      job,
      depsFor(cellDataDir, client, pane, {
        system: createSystemAdapter(),
        worktreeLimit: 4,
      }),
    );

    expect(seen.spec?.cwd).toContain(join(cellDataDir, 'repairs'));
    expect(capturedPrompt).toContain(
      'Preparing the Work order worktree failed',
    );
    expect(submitted.map((s) => s.command.type)).toEqual(['RecordIncident']);
  });

  it('prepares a worktree in workspace.ts for a Mechanic job with workspace', async () => {
    const origin = join(dataDir, 'origin');
    const head = makeRepo(origin);
    const cellDataDir = join(dataDir, 'cell');
    const job = mechanicJob({
      repo: {
        url: origin,
        baseBranch: 'main',
        branch: 'factory/v2-24-mechanic',
      },
      base: head as Job['base'],
      workspace: {
        dir: 'v2-24-mechanic',
        sync: [],
        setup: [],
        timeoutMs: 30_000,
      },
    });

    const result = await prepareWorkspace({ job, dataDir: cellDataDir });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.base).toBe(head);
    expect(result.worktree).toContain('worktrees');
  });

  it('escalates an Andon it cannot resolve, with the incident attached', async () => {
    const { client, submitted } = fakeClient();
    const seen = newSeen();
    const pane = scriptedPane(
      [
        {
          op: 'escalate',
          diagnosis: 'no repair found',
          outcome: 'handed to the Supervisor',
        },
      ],
      seen,
    );

    await runMechanic(mechanicJob(), depsFor(dataDir, client, pane));

    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.command).toEqual({
      type: 'RecordIncident',
      diagnosis: 'no repair found',
      action: { kind: 'escalate' },
      changes: [],
      outcome: 'handed to the Supervisor',
    });
  });

  it('reports a refused incident and sends no follow-up command', async () => {
    const { client, submitted } = fakeClient({
      code: 'precondition',
      detail: 'the Andon already has an incident',
    });
    const seen = newSeen();
    const pane = scriptedPane([incident('resume')], seen);

    await runMechanic(mechanicJob(), depsFor(dataDir, client, pane));

    expect(seen.replies[0]).toMatchObject({ ok: false, code: 'rejected' });
    expect(submitted.map((s) => s.command.type)).toEqual(['RecordIncident']);
  });

  it('sends no command when the pane exits before it records an incident', async () => {
    const { client, submitted } = fakeClient();
    const seen = newSeen();
    const pane = scriptedPane([], seen, 'gone');

    const next = await runMechanic(
      mechanicJob(),
      depsFor(dataDir, client, pane),
    );

    expect(next).toBeNull();
    expect(submitted).toHaveLength(0);
    expect(seen.closed).toHaveLength(1);
  });

  it('confirms the folder-trust screen blocking its pane, then records the incident and resumes', async () => {
    const { client, submitted } = fakeClient();
    const seen = newSeen();
    const trustScreen =
      'Do you trust the contents of this project?\n> Yes, I trust this folder\n  No';
    const calls: string[][] = [];
    let starts = 0;
    const exec: HerdrExec = async (args): Promise<HerdrOutcome> => {
      calls.push([...args]);
      if (args[0] === 'workspace') {
        return { code: 0, stdout: '{"workspace_id":"w1"}', stderr: '' };
      }
      if (args[0] === 'tab') {
        return {
          code: 0,
          stdout: '{"tab_id":"t1","pane_id":"p1"}',
          stderr: '',
        };
      }
      if (args[0] === 'agent' && args[1] === 'start') {
        starts += 1;
        if (starts === 1) {
          return {
            code: 1,
            stdout:
              '{"error":{"code":"agent_not_ready","message":"blocked during startup"}}',
            stderr: '',
          };
        }
        return { code: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'agent' && args[1] === 'read') {
        return { code: 0, stdout: trustScreen, stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    const herdr = createHerdrPane({ exec });
    // The Herdr driver opens the Mechanic's pane and confirms the trust screen; then the Mechanic speaks.
    const pane: PaneDriver = {
      ...herdr,
      open: async (spec) => {
        seen.spec = spec;
        await herdr.open(spec);
        seen.replies.push(
          await askOperator(
            spec.env,
            incident(
              'resume',
              'the pane was blocked on the folder-trust screen',
            ),
          ),
        );
      },
      close: async (name) => {
        seen.closed.push(name);
        await herdr.close(name);
      },
    };

    const next = await runMechanic(
      mechanicJob(),
      depsFor(dataDir, client, pane),
    );

    expect(next).toBeNull();
    expect(
      calls.some(
        (c) =>
          c[0] === 'agent' &&
          c[1] === 'send-keys' &&
          c[c.length - 1] === 'Enter',
      ),
    ).toBe(true);
    expect(starts).toBe(1);
    expect(seen.replies).toEqual([{ ok: true }]);
    expect(submitted.map((s) => s.command.type)).toEqual([
      'RecordIncident',
      'Resume',
    ]);
  });

  it('opens its pane in the Work order todo workspace, with the order log tab', async () => {
    const { client } = fakeClient();
    const seen = newSeen();
    const pane = scriptedPane([incident('resume')], seen);

    await runMechanic(mechanicJob(), depsFor(dataDir, client, pane));

    expect(seen.spec?.task).toBe('v2-24-mechanic');
    expect(seen.spec?.name).toMatch(/^mechanic_[0-9a-f]{6}_1$/);
    expect(seen.spec).toMatchObject({
      logCommand: expect.stringContaining(` log "${ORDER_ID}" -f`),
    });
  });

  it('keeps polling a blocked pane once the folder-trust screen is confirmed', async () => {
    const { client, submitted } = fakeClient();
    const seen = newSeen();
    let reads = 0;
    let confirms = 0;
    const pane: PaneDriver = {
      open: async (spec) => {
        seen.spec = spec;
      },
      type: async () => undefined,
      read: async () => {
        reads += 1;
        return { operator: reads === 1 ? 'blocked' : 'gone' };
      },
      tail: async () => '',
      close: async (name) => {
        seen.closed.push(name);
      },
      confirmTrust: async () => {
        confirms += 1;
        return true;
      },
      closeTask: async () => undefined,
    };

    await runMechanic(mechanicJob(), depsFor(dataDir, client, pane));

    expect(confirms).toBe(1);
    expect(reads).toBe(2);
    expect(submitted).toHaveLength(0);
  });

  it('escalates a blocked pane it cannot confirm, so the Work order is not left stuck', async () => {
    const { client, submitted } = fakeClient();
    const seen = newSeen();
    const pane: PaneDriver = {
      open: async (spec) => {
        seen.spec = spec;
      },
      type: async () => undefined,
      read: async () => ({ operator: 'blocked' }),
      tail: async () => '',
      close: async (name) => {
        seen.closed.push(name);
      },
      confirmTrust: async () => false,
      closeTask: async () => undefined,
    };

    await runMechanic(mechanicJob(), depsFor(dataDir, client, pane));

    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.command).toMatchObject({
      type: 'RecordIncident',
      action: { kind: 'escalate' },
    });
    expect(seen.closed).toHaveLength(1);
  });
});
