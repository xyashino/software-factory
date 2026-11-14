import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { seedProject } from '@repo/factory-runtime/seed';
import { pushTodo } from '@repo/factory-server/__tests__/e2e/fixture-repo';
import {
  ofType,
  orderOf,
  remoteTip,
  statusOf,
  until,
  todo,
  createWorld,
  PROJECT,
  type World,
} from './harness/world';

let world: World | undefined;

afterEach(async () => {
  await world?.close();
  world = undefined;
});

/** The fake GitHub's file of one branch, found by the branch it names (fake-gh.ts). */
const prFileOf = (ghDir: string, branch: string): string => {
  const file = readdirSync(ghDir)
    .filter((name) => name.endsWith('.json'))
    .find(
      (name) =>
        (
          JSON.parse(readFileSync(join(ghDir, name), 'utf8')) as {
            branch: string;
          }
        ).branch === branch,
    );
  if (file === undefined) throw new Error(`no pull request file for ${branch}`);
  return join(ghDir, file);
};

describe('a Factory whose database is lost', () => {
  it('rebuilds its Work orders from git: mid-Line resumes on its checkpoint, delivered stays delivered, merged is absent', async () => {
    world = await createWorld({
      'add-search': todo('Add search'),
      'add-export': todo('Add export'),
    });
    const w = world;
    const search = orderOf('add-search');
    const exported = orderOf('add-export');

    // Cell A runs the two todos to delivery: both have a PR on the fake GitHub.
    const a = await w.cell('cell-a');
    await until(
      async () =>
        (await statusOf(w, 'add-search')) === 'delivered' &&
        (await statusOf(w, 'add-export')) === 'delivered',
      'the first two Work orders to be delivered',
      120_000,
    );
    await a.kill9();

    // The third todo reaches the base branch now. Cell B runs its build with a hung runner, so the
    // order has plan and plan-review passed, and its checkpoint commit is pushed, when the build starts.
    await pushTodo(w.repo, 'add-login', todo('Add login'));
    await w.factory.client.call('intakeSync', {});
    const login = orderOf('add-login');
    const b = await w.cell('cell-b', { scenarios: { builder: 'silent' } });
    await until(
      async () =>
        ofType(await w.eventsOf(login), 'cycle_started').some(
          (started) => started.stationId === 'build',
        ),
      'cell B to start the build of add-login',
    );
    await b.kill9();
    const checkpoint = await remoteTip(w, 'factory/add-login');
    expect(checkpoint).toBeDefined();

    // The database is lost. Factory A stops, its files go, and export is not an option.
    await w.factory.stop();
    for (const name of ['factory.db', 'factory.db-wal', 'factory.db-shm']) {
      rmSync(join(w.dataDir, name), { force: true });
    }
    // The export-PR merges on GitHub and its todo leaves the base branch: it is finished, not recovered.
    const prFile = prFileOf(w.ghDir, 'factory/add-export');
    writeFileSync(
      prFile,
      JSON.stringify({
        ...(JSON.parse(readFileSync(prFile, 'utf8')) as Record<
          string,
          unknown
        >),
        state: 'MERGED',
      }),
    );
    await pushTodo(w.repo, 'add-export', undefined);

    // A fresh Factory on the same project: the project row, then the server, then the recovery.
    seedProject(w.dataDir, { projectId: PROJECT, repoUrl: w.repo });
    const fresh = await w.restartFactory();
    const report = await fresh.client.call('adminRecover', {});

    expect(report.recovered.map((order) => order.todoId).sort()).toEqual([
      'add-login',
      'add-search',
    ]);
    const mid = report.recovered.find((order) => order.todoId === 'add-login');
    expect(mid).toMatchObject({
      orderId: login,
      passedStations: ['plan', 'plan-review'],
      checkpoint,
      delivered: false,
    });
    const shipped = report.recovered.find(
      (order) => order.todoId === 'add-search',
    );
    expect(shipped).toMatchObject({ orderId: search, delivered: true });
    const board = (await fresh.client.call('board', {})).orders;
    expect(board.map((row) => row.orderId)).not.toContain(exported);
    expect(board.find((row) => row.orderId === login)).toMatchObject({
      stationId: 'build',
      nextKind: 'job',
    });
    expect(board.find((row) => row.orderId === search)?.status).toBe(
      'delivered',
    );

    // A second recovery changes nothing: the recovered orders keep their history.
    const again = await fresh.client.call('adminRecover', {});
    expect(again.recovered).toEqual([]);
    const searchBefore = (await w.eventsOf(search)).length;

    // The resumed order completes on top of its checkpoint, with one PR and no second build.
    await w.cell('cell-c');
    await until(
      async () => (await statusOf(w, 'add-login')) === 'delivered',
      'the recovered Work order to be delivered',
      120_000,
    );

    // The fresh database's history of the order starts at the recovery: one build, the first of its
    // Station, on the checkpoint commit, and one delivery.
    const events = await w.eventsOf(login);
    const builds = ofType(events, 'cycle_started').filter(
      (started) => started.stationId === 'build',
    );
    expect(ofType(events, 'order_recovered')).toHaveLength(1);
    expect(builds).toHaveLength(1);
    expect(builds[0]).toMatchObject({
      n: 1,
      cause: { kind: 'first' },
      baseCommit: checkpoint,
    });
    expect(ofType(events, 'delivery_finished')).toHaveLength(1);

    expect((await w.eventsOf(search)).length).toBe(searchBefore);
    expect(await remoteTip(w, 'factory/add-login')).toBeDefined();
  }, 300_000);
});
