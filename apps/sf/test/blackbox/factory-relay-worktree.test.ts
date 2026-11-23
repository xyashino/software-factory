import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRelay, RELAY_PATH } from '../../src/daemon/relay';

const HQ_URL = 'http://hq.test';
const RELAY_ORIGIN = `http://127.0.0.1:7071${RELAY_PATH}`;
const HQ_CELL_ID = 'hq-cell-1';
const CELL_SESSION = 'cell-session-1';
const JOB = {
  jobId: 'job-9',
  orderId: 'hq:feature-x',
  stepId: 'step-2',
  epoch: 4,
};
const WORKTREE = '.worktrees/feature-x';

interface HqCall {
  path: string;
  authorization: string | null;
  body: unknown;
}

const replyOf = (path: string, body: unknown): Response => {
  if (path === '/api/v1/cells/enroll') {
    return Response.json(
      {
        code: 201,
        cellId: HQ_CELL_ID,
        sessionToken: CELL_SESSION,
        expiresAt: 9_999,
      },
      { status: 201 },
    );
  }
  if (path === '/api/v1/cells/claims') {
    return Response.json({ code: 200, job: JOB, signals: [] });
  }
  const action =
    typeof body === 'object' && body !== null && 'action' in body
      ? body.action
      : null;
  const nextJob = action === 'worktree_missing' ? JOB : null;
  return Response.json({ code: 200, action, nextJob });
};

const hqCalls = (): HqCall[] => {
  const calls: HqCall[] = [];
  vi.stubGlobal(
    'fetch',
    async (url: string, init?: RequestInit): Promise<Response> => {
      const path = new URL(url).pathname;
      const body: unknown = JSON.parse(String(init?.body ?? 'null'));
      calls.push({
        path,
        authorization: new Headers(init?.headers).get('authorization'),
        body,
      });
      return replyOf(path, body);
    },
  );
  return calls;
};

const setup = () => {
  const calls = hqCalls();
  let alive = true;
  const relay = createRelay({
    credential: () => ({
      url: HQ_URL,
      factoryId: 'factory-1',
      sessionToken: 'factory-secret',
    }),
    alive: () => alive,
    kill: async () => true,
  });
  const send = (token: string, path: string, body: unknown) =>
    relay.handle(
      new Request(`${RELAY_ORIGIN}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
    );
  return {
    calls,
    relay,
    send,
    processGone: () => {
      alive = false;
    },
  };
};

const enrolled = async (
  harness: ReturnType<typeof setup>,
  cellId: string,
): Promise<string> => {
  const token = harness.relay.issue(cellId);
  await harness.send(token, '/api/v1/cells/enroll', {
    projectId: 'software-factory',
    name: 'ignored',
    allowedLines: ['*'],
    runners: ['claude'],
  });
  return token;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('factory relay worktree report', () => {
  it('lost worktree reports the Cell job to HQ after the process is gone', async () => {
    // Arrange
    const harness = setup();
    const token = await enrolled(harness, 'cell-1');
    await harness.send(token, '/api/v1/cells/claims', {});
    harness.processGone();

    // Act
    const reported = await harness.relay.reportWorktreeMissing('cell-1', [
      WORKTREE,
    ]);

    // Assert
    const transition = harness.calls.at(-1);
    expect(reported).toBe(true);
    expect(transition?.path).toBe('/api/v1/jobs/job-9/transitions');
    expect(transition?.authorization).toBe(`Bearer ${CELL_SESSION}`);
    expect(transition?.body).toMatchObject({
      action: 'worktree_missing',
      epoch: 4,
      missingStepId: 'step-2',
      missingFiles: [WORKTREE],
      commandId: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('same incident gets the same command id', async () => {
    // Arrange
    const harness = setup();
    const token = await enrolled(harness, 'cell-1');
    await harness.send(token, '/api/v1/cells/claims', {});

    // Act
    await harness.relay.reportWorktreeMissing('cell-1', [WORKTREE]);
    await harness.relay.reportWorktreeMissing('cell-1', [WORKTREE]);

    // Assert
    const [first, second] = harness.calls
      .filter((call) => call.path.endsWith('/transitions'))
      .map((call) => call.body);
    expect(first).toMatchObject({ commandId: expect.any(String) });
    expect(second).toEqual(first);
  });

  it('Cell without a claimed job has nothing to report', async () => {
    // Arrange
    const harness = setup();
    await enrolled(harness, 'cell-1');

    // Act
    const reported = await harness.relay.reportWorktreeMissing('cell-1', [
      WORKTREE,
    ]);

    // Assert
    expect(reported).toBe(false);
    expect(
      harness.calls.some((call) => call.path.endsWith('/transitions')),
    ).toBe(false);
  });

  it('job the Cell completed is not reported', async () => {
    // Arrange
    const harness = setup();
    const token = await enrolled(harness, 'cell-1');
    await harness.send(token, '/api/v1/cells/claims', {});
    await harness.send(token, '/api/v1/jobs/job-9/transitions', {
      action: 'complete',
      commandId: 'done',
      epoch: 4,
      producedFiles: [],
    });

    // Act
    const reported = await harness.relay.reportWorktreeMissing('cell-1', [
      WORKTREE,
    ]);

    // Assert
    expect(reported).toBe(false);
  });
});
