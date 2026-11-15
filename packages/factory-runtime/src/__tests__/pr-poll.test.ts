import { describe, expect, it, vi } from 'vitest';
import type { CommitSha, OrderId } from '@repo/factory-core/ids';
import type { BranchCommit } from '@repo/factory-core/ports/git-mirror';
import { pollPrStates } from '../pr-poll';
import { recoverFromGit } from '../recovery';
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
const cycleCommit = (n: number, station: string): BranchCommit => ({
  sha: sha(n),
  message: [
    `wip(${station}): cycle 1`,
    '',
    'Factory-Order: ORDER',
    `Factory-Station: ${station}`,
    `Factory-Cycle: 01J${n}`,
    'Factory-Epoch: 1',
    'Factory-Outcome: passed',
  ].join('\n'),
});

/** A todo in the base branch, intake run, and its branch passed and delivered with an open PR. */
const deliveredOrder = async (): Promise<{ w: World; orderId: OrderId }> => {
  const w = world();
  w.git.setTodos([{ file: `todos/${TODO_ID}.md`, text: todo('Add login') }]);
  await w.runtime.sync();
  const [order] = (await w.runtime.call('board', {})).orders;
  if (!order) throw new Error('intake created no Work order');
  const state = foldHistory(await w.ports.events.load(order.orderId));
  const stations = state?.line.stations.map((station) => station.id) ?? [];
  w.git.setBranches([
    {
      branch: BRANCH,
      commits: [
        cycleCommit(9, 'deliver'),
        ...stations.map((station, i) => cycleCommit(i + 1, station)).reverse(),
      ],
    },
  ]);
  w.prState.setForBranch(BRANCH, { prUrl: PR, state: 'open' });
  await recoverFromGit(w.ports, w.runtime.commands, PROJECT);
  return { w, orderId: order.orderId };
};

const prEventsOf = async (w: World, orderId: OrderId): Promise<string[]> =>
  (await w.ports.events.load(orderId))
    .map((stored) => stored.event.type)
    .filter((type) => type === 'pr_state_changed');

describe('PR poll', () => {
  it('reads every open PR in one batch and records a state that changed', async () => {
    const { w, orderId } = await deliveredOrder();
    const readMany = vi.spyOn(w.prState, 'readMany');
    const read = vi.spyOn(w.prState, 'read');
    w.prState.set(PR, 'merged');

    const asked = await pollPrStates(w.ports, w.runtime.commands);

    expect(asked).toBe(1);
    expect(readMany).toHaveBeenCalledTimes(1);
    expect(readMany).toHaveBeenCalledWith([PR]);
    expect(read).not.toHaveBeenCalled();
    const state = foldHistory(await w.ports.events.load(orderId));
    expect(state?.delivery?.state).toBe('merged');
  });

  it('records nothing for a state that is already stored, however often it polls', async () => {
    const { w, orderId } = await deliveredOrder();
    w.prState.set(PR, 'merged');
    await pollPrStates(w.ports, w.runtime.commands);
    const before = await prEventsOf(w, orderId);

    await pollPrStates(w.ports, w.runtime.commands);

    expect(await prEventsOf(w, orderId)).toEqual(before);
    expect(before).toHaveLength(1);
  });

  it('records nothing for a pull request whose state the reader did not return', async () => {
    const { w, orderId } = await deliveredOrder();

    await pollPrStates(w.ports, w.runtime.commands);

    expect(await prEventsOf(w, orderId)).toEqual([]);
    const state = foldHistory(await w.ports.events.load(orderId));
    expect(state?.delivery?.state).toBe('open');
  });
});
