import { describe, expect, it } from 'vitest';
import type { CommitSha, OrderId, ProjectId } from '@repo/factory-core/ids';
import { nextJob } from '@repo/factory-core/order/next-job';
import type { BranchCommit } from '@repo/factory-core/ports/git-mirror';
import { checkpointOf, recoverFromGit, trailersOf } from '../recovery';
import { foldHistory } from '../state';
import { PROJECT, world, type World } from './test-kit';

const TODO_ID = 'add-login';
const BRANCH = `factory/${TODO_ID}`;
const PR = 'https://github.com/example/software-factory/pull/7';

const todo = (title: string): string =>
  `---\nstatus: todo\nfactory: v2\n---\n\n# ${title}\n\nBody.\n`;

const sha = (n: number): CommitSha =>
  n.toString(16).padStart(40, '0') as CommitSha;

/** A checkpoint commit as `checkpoint.ts` writes it: subject, then the trailers of PROTOCOL §8.2. */
const cycleCommit = (
  n: number,
  station: string,
  outcome: string,
  order = 'ORDER',
): BranchCommit => ({
  sha: sha(n),
  message: [
    `wip(${station}): cycle 1`,
    '',
    `Factory-Order: ${order}`,
    `Factory-Station: ${station}`,
    `Factory-Cycle: 01J${n}`,
    `Factory-Epoch: 1`,
    `Factory-Outcome: ${outcome}`,
  ].join('\n'),
});

const orderOf = async (w: World): Promise<OrderId> => {
  const [order] = (await w.runtime.call('board', {})).orders;
  if (!order) throw new Error('intake created no Work order');
  return order.orderId;
};

/** A fresh database with the todo in the base branch, intake run, and its order id. */
const setUp = async (): Promise<{ w: World; orderId: OrderId }> => {
  const w = world();
  w.git.setTodos([{ file: `todos/${TODO_ID}.md`, text: todo('Add login') }]);
  await w.runtime.sync();
  return { w, orderId: await orderOf(w) };
};

/** The Station ids of the order's pinned Line, in order. */
const stationsOf = async (w: World, orderId: OrderId): Promise<string[]> => {
  const state = foldHistory(await w.ports.events.load(orderId));
  return state?.line.stations.map((station) => station.id) ?? [];
};

describe('checkpointOf', () => {
  const stations = [{ id: 'plan' }, { id: 'build' }] as unknown as Parameters<
    typeof checkpointOf
  >[1];

  it('reads the Factory trailers of a commit message', () => {
    const trailers = trailersOf(cycleCommit(1, 'plan', 'passed').message);

    expect(trailers).toEqual({
      'Factory-Order': 'ORDER',
      'Factory-Station': 'plan',
      'Factory-Cycle': '01J1',
      'Factory-Epoch': '1',
      'Factory-Outcome': 'passed',
    });
  });

  it('takes the newest passed commit and the Stations up to it', () => {
    const found = checkpointOf(
      {
        branch: BRANCH,
        commits: [
          cycleCommit(2, 'build', 'passed'),
          cycleCommit(1, 'plan', 'passed'),
        ],
      },
      stations,
    );

    expect(found).toEqual({
      commit: sha(2),
      passedStations: ['plan', 'build'],
      afterStation: 'build',
    });
  });

  it('skips a commit that names a Station the Line does not have', () => {
    const found = checkpointOf(
      {
        branch: BRANCH,
        commits: [
          cycleCommit(2, 'deploy', 'passed'),
          cycleCommit(1, 'plan', 'passed'),
        ],
      },
      stations,
    );

    expect(found?.commit).toBe(sha(1));
  });

  it('is undefined when no commit passed', () => {
    const found = checkpointOf(
      { branch: BRANCH, commits: [cycleCommit(1, 'plan', 'failed')] },
      stations,
    );

    expect(found).toBeUndefined();
  });
});

describe('recoverFromGit', () => {
  it('appends order_recovered at the newest passed commit and resumes after it', async () => {
    const { w, orderId } = await setUp();
    const [plan, build] = await stationsOf(w, orderId);
    w.git.setBranches([
      {
        branch: BRANCH,
        commits: [
          cycleCommit(3, build!, 'failed'),
          cycleCommit(2, build!, 'passed'),
          cycleCommit(1, plan!, 'passed'),
        ],
      },
    ]);

    const report = await recoverFromGit(w.ports, w.runtime.commands, PROJECT);

    expect(report.recovered).toEqual([
      {
        orderId,
        todoId: TODO_ID,
        passedStations: [plan, build],
        checkpoint: sha(2),
        delivered: false,
      },
    ]);
    const state = foldHistory(await w.ports.events.load(orderId));
    expect(state?.recovered).toEqual([plan, build]);
    expect(state?.checkpoint).toEqual({ commit: sha(2), afterStation: build });
    expect(nextJob(state!)).toMatchObject({
      kind: 'job',
      job: {
        kind: 'run_operator_station',
        stationId: (await stationsOf(w, orderId))[2],
        base: sha(2),
      },
    });
  });

  it('ignores newer commits without the passed trailer (failed, blocked, no trailers)', async () => {
    const { w, orderId } = await setUp();
    const [plan] = await stationsOf(w, orderId);
    w.git.setBranches([
      {
        branch: BRANCH,
        commits: [
          cycleCommit(4, plan!, 'blocked'),
          { sha: sha(3), message: 'chore: tidy\n' },
          cycleCommit(1, plan!, 'passed'),
        ],
      },
    ]);

    const report = await recoverFromGit(w.ports, w.runtime.commands, PROJECT);

    expect(report.recovered.map((order) => order.checkpoint)).toEqual([sha(1)]);
  });

  it('skips a Work order whose branch has no passed commit, and writes nothing', async () => {
    const { w, orderId } = await setUp();
    w.git.setBranches([
      { branch: BRANCH, commits: [cycleCommit(1, 'plan', 'failed')] },
    ]);

    const report = await recoverFromGit(w.ports, w.runtime.commands, PROJECT);

    expect(report.recovered).toEqual([]);
    expect(report.skipped).toEqual([
      {
        orderId,
        todoId: TODO_ID,
        reason: `no commit with Factory-Outcome: passed on ${BRANCH}`,
      },
    ]);
    const events = await w.ports.events.load(orderId);
    expect(events.map((stored) => stored.event.type)).toEqual([
      'order_created',
    ]);
  });

  it('marks an order delivered when its branch has an open PR, with every Station passed', async () => {
    const { w, orderId } = await setUp();
    const stations = await stationsOf(w, orderId);
    w.git.setBranches([
      {
        branch: BRANCH,
        commits: [
          cycleCommit(9, 'deliver', 'passed'),
          ...stations
            .map((_, i) => cycleCommit(i + 1, stations[i]!, 'passed'))
            .reverse(),
        ],
      },
    ]);
    w.prState.setForBranch(BRANCH, { prUrl: PR, state: 'open' });

    const report = await recoverFromGit(w.ports, w.runtime.commands, PROJECT);

    expect(report.recovered).toEqual([
      expect.objectContaining({ orderId, delivered: true, checkpoint: sha(9) }),
    ]);
    const state = foldHistory(await w.ports.events.load(orderId));
    expect(state?.phase).toEqual({ kind: 'delivered' });
    expect(state?.delivery).toEqual({
      prUrl: PR,
      commit: sha(9),
      state: 'open',
    });
    expect(nextJob(state!)).toEqual({ kind: 'done' });
  });

  it('ignores a closed, unmerged PR and recovers from the newest passed checkpoint', async () => {
    const { w, orderId } = await setUp();
    const [plan, build] = await stationsOf(w, orderId);
    w.git.setBranches([
      {
        branch: BRANCH,
        commits: [
          cycleCommit(2, build!, 'passed'),
          cycleCommit(1, plan!, 'passed'),
        ],
      },
    ]);
    w.prState.setForBranch(BRANCH, { prUrl: PR, state: 'closed' });

    const report = await recoverFromGit(w.ports, w.runtime.commands, PROJECT);

    expect(report.recovered).toEqual([
      {
        orderId,
        todoId: TODO_ID,
        passedStations: [plan, build],
        checkpoint: sha(2),
        delivered: false,
      },
    ]);
    const state = foldHistory(await w.ports.events.load(orderId));
    expect(state?.delivery).toBeUndefined();
    expect(state?.phase).not.toEqual({ kind: 'delivered' });
  });

  it('skips a Work order whose only PR is closed and whose branch has no passed commit', async () => {
    const { w, orderId } = await setUp();
    w.git.setBranches([
      { branch: BRANCH, commits: [cycleCommit(1, 'plan', 'failed')] },
    ]);
    w.prState.setForBranch(BRANCH, { prUrl: PR, state: 'closed' });

    const report = await recoverFromGit(w.ports, w.runtime.commands, PROJECT);

    expect(report.recovered).toEqual([]);
    expect(report.skipped).toEqual([
      {
        orderId,
        todoId: TODO_ID,
        reason: `no commit with Factory-Outcome: passed on ${BRANCH}`,
      },
    ]);
  });

  it('records the state of an existing PR, merged included', async () => {
    const { w, orderId } = await setUp();
    const stations = await stationsOf(w, orderId);
    w.git.setBranches([
      { branch: BRANCH, commits: [cycleCommit(9, stations.at(-1)!, 'passed')] },
    ]);
    w.prState.setForBranch(BRANCH, { prUrl: PR, state: 'merged' });

    await recoverFromGit(w.ports, w.runtime.commands, PROJECT);

    const state = foldHistory(await w.ports.events.load(orderId));
    expect(state?.delivery?.state).toBe('merged');
  });

  it('is idempotent: a second run appends nothing and skips the recovered order', async () => {
    const { w, orderId } = await setUp();
    const [plan] = await stationsOf(w, orderId);
    w.git.setBranches([
      { branch: BRANCH, commits: [cycleCommit(1, plan!, 'passed')] },
    ]);
    await recoverFromGit(w.ports, w.runtime.commands, PROJECT);
    const before = (await w.ports.events.load(orderId)).length;

    const second = await recoverFromGit(w.ports, w.runtime.commands, PROJECT);

    expect((await w.ports.events.load(orderId)).length).toBe(before);
    expect(second.recovered).toEqual([]);
    expect(second.skipped).toEqual([
      { orderId, todoId: TODO_ID, reason: 'already has progress' },
    ]);
  });

  it('recovers nothing for a project that is not named', async () => {
    const { w, orderId } = await setUp();
    const [plan] = await stationsOf(w, orderId);
    w.git.setBranches([
      { branch: BRANCH, commits: [cycleCommit(1, plan!, 'passed')] },
    ]);

    const report = await recoverFromGit(
      w.ports,
      w.runtime.commands,
      'other' as ProjectId,
    );

    expect(report).toEqual({ recovered: [], skipped: [] });
  });
});
