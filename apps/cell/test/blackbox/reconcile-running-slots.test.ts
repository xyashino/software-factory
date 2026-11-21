import { hostname } from 'node:os';
import { describe, expect, it } from 'vitest';
import { reconcileRunningSlots } from '../../src/application/procedures/cells/reconcile-running-slots';
import { createFakeSupervisor } from '../support/fakes';
import { createTestApp, postJson } from '../support/test-app';

const REPO = '/work/app';

describe('boot reconcile', () => {
  it('restarts only the cells whose desired state is running', async () => {
    const context = createTestApp();
    context.repoInspector.addRepo(REPO);
    await postJson(context.app, '/api/v1/factories', {
      name: 'local',
      url: 'http://127.0.0.1:7070',
      joinToken: 'join-secret',
    });
    await postJson(context.app, '/api/v1/cells', {
      repoRoot: REPO,
      count: 2,
    });
    await postJson(context.app, `/api/v1/cells/${hostname()}-2/stop`, {});
    const afterRestart = createFakeSupervisor();

    await reconcileRunningSlots({
      db: context.db,
      clock: context.clock,
      eventBus: context.eventBus,
      supervisor: afterRestart,
    });

    const restarted = await context.app.request('/api/v1/cells');
    const body = (await restarted.json()) as {
      cells: { name: string; runtimeStatus: string }[];
    };
    expect(afterRestart.starts).toHaveLength(1);
    expect(body.cells.find((cell) => cell.name === hostname())).toMatchObject({
      runtimeStatus: 'running',
    });
  });
});
