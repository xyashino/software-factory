import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { jobs } from '../../src/db/schema/jobs';
import { orderPlans } from '../../src/db/schema/plans';
import { workOrders } from '../../src/db/schema/orders';
import { projects } from '../../src/db/schema/projects';
import { asJobId, asOrderId, asProjectId } from '../../src/domain/common/brand';
import {
  VALID_TOKEN,
  createTestApp,
  getJson,
  grantingAuth,
  postJson,
  type TestApp,
} from '../support/test-app';
import type { Db } from '../../src/db/client';

const PROJECT_ID = 'software-factory';
const AUTH = { authorization: `Bearer ${VALID_TOKEN}` };

type QueueFile = { filename: string; markdown: string };

const file = (
  slug: string,
  frontmatter: string[],
  title: string,
  description = '',
): QueueFile => ({
  filename: `${slug}.md`,
  markdown: [
    '---',
    ...frontmatter,
    '---',
    '',
    `# ${slug}: ${title}`,
    ...(description === '' ? [] : ['', description]),
    '',
  ].join('\n'),
});

const setup = () => {
  const { app, db } = createTestApp({
    auth: grantingAuth(['supervisor:read', 'supervisor:write']),
  });
  db.insert(projects)
    .values({
      projectId: asProjectId(PROJECT_ID),
      repoUrl: 'git@example.test:acme/software-factory.git',
      defaultBaseBranch: 'main',
      maxRunning: 5,
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  return { app, db };
};

const importQueue = (
  app: TestApp,
  commandId: string | null,
  files: QueueFile[],
  mode: 'dry_run' | 'apply' = 'apply',
): Promise<Response> =>
  postJson(
    app,
    '/api/v1/queue/import',
    {
      ...(commandId === null ? {} : { commandId }),
      projectId: PROJECT_ID,
      mode,
      files,
    },
    AUTH,
  );

const exportQueue = (app: TestApp): Promise<Response> =>
  getJson(app, `/api/v1/queue/export?projectId=${PROJECT_ID}`, AUTH);

const orderOf = async (app: TestApp, slug: string) => {
  const response = await getJson(
    app,
    `/api/v1/work-orders/${PROJECT_ID}:${slug}`,
    AUTH,
  );
  return response.json();
};

const orderCount = (db: Db): number =>
  db.select().from(workOrders).all().length;

describe('queue dry run and apply', () => {
  it('reports what an import would do and writes nothing on a dry run', async () => {
    const { app, db } = setup();
    const files = [
      file('pay-schema', ['line: feature'], 'Add schema'),
      file('pay-api', ['line: feature', 'depends_on: pay-schema'], 'Add API'),
    ];

    const response = await importQueue(app, null, files, 'dry_run');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      code: 200,
      mode: 'dry_run',
      created: 2,
      updated: 0,
      skipped: 0,
      errors: [],
    });
    expect(orderCount(db)).toBe(0);
  });

  it('creates stacked work orders and parks the child until its parent delivers', async () => {
    const { app } = setup();
    const files = [
      file('pay-schema', ['line: feature'], 'Add schema'),
      file('pay-api', ['line: feature', 'depends_on: pay-schema'], 'Add API'),
    ];

    const response = await importQueue(app, 'import-1', files);

    expect(await response.json()).toMatchObject({ created: 2, updated: 0 });
    expect(await orderOf(app, 'pay-schema')).toMatchObject({
      order: {
        state: 'queued',
        baseBranch: 'main',
        branch: 'factory/pay-schema',
      },
    });
    expect(await orderOf(app, 'pay-api')).toMatchObject({
      order: {
        state: 'waiting_parent',
        parentOrderId: `${PROJECT_ID}:pay-schema`,
        baseBranch: 'factory/pay-schema',
      },
    });
  });

  it('answers a replayed command id with the stored result and no new writes', async () => {
    const { app, db } = setup();
    const files = [file('pay-schema', ['line: feature'], 'Add schema')];
    await importQueue(app, 'import-2', files);

    const replay = await importQueue(app, 'import-2', files);

    expect(await replay.json()).toMatchObject({
      created: 1,
      updated: 0,
      skipped: 0,
    });
    expect(orderCount(db)).toBe(1);
  });

  it('rejects a task with two parents with 422 and writes nothing', async () => {
    const { app, db } = setup();
    const files = [
      file('pay-schema', ['line: feature'], 'Add schema'),
      file('pay-docs', ['line: feature'], 'Add docs'),
      file(
        'pay-api',
        ['line: feature', 'depends_on: [pay-schema, pay-docs]'],
        'Add API',
      ),
    ];

    const response = await importQueue(app, 'import-multi', files);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: 422,
      type: 'unprocessable-entity',
      errors: [
        {
          filename: 'pay-api.md',
          message: 'depends_on allows at most one parent',
        },
      ],
    });
    expect(orderCount(db)).toBe(0);
  });

  it('rejects a dependency cycle and names the task that closes it', async () => {
    const { app } = setup();
    const files = [
      file('pay-api', ['line: feature', 'depends_on: pay-schema'], 'Add API'),
      file(
        'pay-schema',
        ['line: feature', 'depends_on: pay-api'],
        'Add schema',
      ),
    ];

    const response = await importQueue(app, 'import-cycle', files);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      errors: [{ filename: 'pay-api.md', message: 'depends_on forms a cycle' }],
    });
  });

  it('skips a running order whose title changed and cancels it only on request', async () => {
    const { app, db } = setup();
    await importQueue(app, 'import-run', [
      file('pay-schema', ['line: feature'], 'Add schema'),
    ]);
    db.update(workOrders)
      .set({ state: 'running' })
      .where(eq(workOrders.slug, 'pay-schema'))
      .run();

    const renamed = await importQueue(app, 'import-rename', [
      file('pay-schema', ['line: feature'], 'Renamed schema'),
    ]);
    expect(await renamed.json()).toMatchObject({ skipped: 1, updated: 0 });
    expect(await orderOf(app, 'pay-schema')).toMatchObject({
      order: { title: 'Add schema', state: 'running' },
    });

    const cancelled = await importQueue(app, 'import-cancel', [
      file('pay-schema', ['line: feature', 'status: cancelled'], 'Add schema'),
    ]);
    expect(await cancelled.json()).toMatchObject({ updated: 1 });
    expect(await orderOf(app, 'pay-schema')).toMatchObject({
      order: { state: 'cancelled' },
    });
  });

  it('imports a todo status as a queued work order and exports it as queued', async () => {
    const { app } = setup();

    const response = await importQueue(app, 'import-todo-alias', [
      file('pay-schema', ['status: todo', 'line: feature'], 'Add schema'),
    ]);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ created: 1, errors: [] });
    expect(await orderOf(app, 'pay-schema')).toMatchObject({
      order: { state: 'queued' },
    });
    const exported = (await (await exportQueue(app)).json()) as {
      files: QueueFile[];
    };
    expect(exported.files.map((item) => item.markdown)).toContain(
      '---\nstatus: queued\npriority: medium\nline: feature\ntype: feat\n---\n\n# pay-schema: Add schema\n',
    );
  });
});

describe('queue export and round trip', () => {
  it('exports a queue that imports back with no drift', async () => {
    const { app } = setup();
    await importQueue(app, 'import-seed', [
      file(
        'pay-schema',
        ['priority: high', 'line: feature'],
        'Add schema',
        'Tables.',
      ),
      file(
        'pay-api',
        [
          'line: feature',
          'depends_on: pay-schema',
          'status: paused',
          'type: fix',
        ],
        'Add API',
      ),
    ]);
    const first = (await (await exportQueue(app)).json()) as {
      files: QueueFile[];
    };

    const reimport = await importQueue(app, 'import-roundtrip', first.files);
    const second = (await (await exportQueue(app)).json()) as {
      files: QueueFile[];
    };

    expect(await reimport.json()).toMatchObject({
      created: 0,
      updated: 0,
      skipped: 2,
    });
    expect(second.files.map((item) => item.markdown)).toEqual(
      first.files.map((item) => item.markdown),
    );
    expect(first.files.map((item) => item.markdown)).toContain(
      '---\nstatus: paused\npriority: medium\nline: feature\ndepends_on: pay-schema\ntype: fix\n---\n\n# pay-api: Add API\n',
    );
  });
});

describe('order plans and plan branches', () => {
  it('holds a plan root task until its plan is active, then releases it on re-import', async () => {
    const { app, db } = setup();
    await importQueue(app, 'import-plan', [
      file('pay-schema', ['line: feature', 'plan: payment-v2'], 'Add schema'),
    ]);
    expect(await orderOf(app, 'pay-schema')).toMatchObject({
      order: { state: 'waiting_parent', planId: `${PROJECT_ID}:payment-v2` },
    });

    const activation = await postJson(
      app,
      `/api/v1/order-plans/${PROJECT_ID}:payment-v2/transitions`,
      { action: 'activate' },
      AUTH,
    );
    expect(await activation.json()).toMatchObject({
      code: 200,
      plan: { state: 'branching', branch: 'feat/payment-v2' },
    });
    const planJobs = db
      .select()
      .from(jobs)
      .where(eq(jobs.kind, 'plan_branch'))
      .all();
    expect(planJobs).toHaveLength(1);
    expect(planJobs[0]).toMatchObject({
      status: 'ready',
      targetBranch: 'feat/payment-v2',
    });

    db.update(orderPlans)
      .set({ state: 'active', branchCommitSha: 'plan-sha' })
      .where(eq(orderPlans.slug, 'payment-v2'))
      .run();
    await importQueue(app, 'import-plan-active', [
      file('pay-schema', ['line: feature', 'plan: payment-v2'], 'Add schema'),
    ]);

    expect(await orderOf(app, 'pay-schema')).toMatchObject({
      order: {
        state: 'queued',
        baseBranch: 'feat/payment-v2',
        baseCommitSha: 'plan-sha',
      },
    });
  });

  it('shows the plan and its member work orders on the plan detail', async () => {
    const { app } = setup();
    await postJson(
      app,
      '/api/v1/order-plans',
      { projectId: PROJECT_ID, slug: 'payment-v2', title: 'Payments v2' },
      AUTH,
    );
    await importQueue(app, 'import-detail', [
      file('pay-schema', ['line: feature', 'plan: payment-v2'], 'Add schema'),
    ]);

    const response = await getJson(
      app,
      `/api/v1/order-plans/${PROJECT_ID}:payment-v2`,
      AUTH,
    );

    expect(await response.json()).toMatchObject({
      code: 200,
      plan: { state: 'draft', title: 'Payments v2' },
      workOrders: [{ slug: 'pay-schema' }],
    });
  });
});

describe('work order transitions and queue actions', () => {
  it('releases a stacked child when its parent is completed', async () => {
    const { app, db } = setup();
    await importQueue(app, 'import-stack', [
      file('pay-schema', ['line: feature'], 'Add schema'),
      file('pay-api', ['line: feature', 'depends_on: pay-schema'], 'Add API'),
    ]);
    db.update(workOrders)
      .set({ state: 'delivered', headCommitSha: 'parent-sha' })
      .where(eq(workOrders.slug, 'pay-schema'))
      .run();

    const completed = await postJson(
      app,
      `/api/v1/work-orders/${PROJECT_ID}:pay-schema/transitions`,
      { action: 'complete' },
      AUTH,
    );

    expect(await completed.json()).toMatchObject({
      order: { state: 'completed' },
    });
    expect(await orderOf(app, 'pay-api')).toMatchObject({
      order: { state: 'queued' },
    });
  });

  it('pauses and then cancels a batch of orders in one request', async () => {
    const { app } = setup();
    await importQueue(app, 'import-batch', [
      file('pay-schema', ['line: feature'], 'Add schema'),
      file('pay-docs', ['line: feature'], 'Add docs'),
    ]);
    const orderIds = [`${PROJECT_ID}:pay-schema`, `${PROJECT_ID}:pay-docs`];

    const paused = await postJson(
      app,
      '/api/v1/queue/actions',
      { action: 'pause', orderIds },
      AUTH,
    );
    expect(await paused.json()).toMatchObject({
      code: 200,
      orders: [{ state: 'paused' }, { state: 'paused' }],
    });

    const cancelled = await postJson(
      app,
      '/api/v1/queue/actions',
      { action: 'cancel', orderIds: [orderIds[0]] },
      AUTH,
    );
    expect(await cancelled.json()).toMatchObject({
      orders: [{ state: 'cancelled' }],
    });
  });

  it('refuses a queue action that does not fit the order state', async () => {
    const { app } = setup();
    await importQueue(app, 'import-refuse', [
      file('pay-schema', ['line: feature', 'status: cancelled'], 'Add schema'),
    ]);

    const response = await postJson(
      app,
      '/api/v1/queue/actions',
      { action: 'pause', orderIds: [`${PROJECT_ID}:pay-schema`] },
      AUTH,
    );

    expect(response.status).toBe(409);
  });

  it('creates a stacked work order by hand and reads its detail', async () => {
    const { app } = setup();
    await importQueue(app, 'import-hand', [
      file('pay-schema', ['line: feature'], 'Add schema'),
    ]);

    const created = await postJson(
      app,
      '/api/v1/work-orders',
      {
        projectId: PROJECT_ID,
        slug: 'pay-api',
        title: 'Add API',
        type: 'feat',
        lineName: 'feature',
        parentSlug: 'pay-schema',
      },
      AUTH,
    );

    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      order: {
        state: 'waiting_parent',
        parentOrderId: `${PROJECT_ID}:pay-schema`,
      },
    });
    expect(await orderOf(app, 'pay-api')).toMatchObject({
      order: { slug: 'pay-api' },
      steps: [],
      jobs: [],
      incidents: [],
    });
  });
});

describe('order plan reset', () => {
  const PLAN_SLUG = 'payment-v2';

  const importPlanMembers = (app: TestApp, slugs: string[]) =>
    importQueue(
      app,
      `import-${slugs.join('-')}`,
      slugs.map((slug) =>
        file(slug, ['line: feature', `plan: ${PLAN_SLUG}`], `Task ${slug}`),
      ),
    );

  const setPlanState = (db: Db, state: 'draft' | 'completed') =>
    db
      .update(orderPlans)
      .set({ state, branchCommitSha: 'plan-sha' })
      .where(eq(orderPlans.slug, PLAN_SLUG))
      .run();

  const resetPlan = (app: TestApp) =>
    postJson(
      app,
      `/api/v1/order-plans/${PROJECT_ID}:${PLAN_SLUG}/transitions`,
      { action: 'reset' },
      AUTH,
    );

  const planBranchJobs = (db: Db) =>
    db.select().from(jobs).where(eq(jobs.kind, 'plan_branch')).all();

  it('moves a completed plan to branching and queues one fresh plan branch job', async () => {
    const { app, db } = setup();
    await importPlanMembers(app, ['pay-schema']);
    setPlanState(db, 'completed');

    const response = await resetPlan(app);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      plan: { state: 'branching' },
    });
    const branchJobs = planBranchJobs(db);
    expect(branchJobs).toHaveLength(1);
    expect(branchJobs[0]).toMatchObject({
      status: 'ready',
      payloadJson: { planId: `${PROJECT_ID}:${PLAN_SLUG}`, fresh: true },
    });
  });

  it('cancels the in-flight job of a child and returns the child to step 0', async () => {
    const { app, db } = setup();
    await importPlanMembers(app, ['pay-schema']);
    setPlanState(db, 'completed');
    db.insert(jobs)
      .values({
        jobId: asJobId('job-live'),
        projectId: asProjectId(PROJECT_ID),
        orderId: asOrderId(`${PROJECT_ID}:pay-schema`),
        kind: 'run_operator',
        workspaceMode: 'reuse',
        status: 'running',
        repoUrl: 'git@example.test:acme/software-factory.git',
        baseBranch: 'main',
        targetBranch: 'factory/pay-schema',
        expectedPriorStepsJson: [],
        payloadJson: {},
        epoch: 1,
        createdAt: 1,
      })
      .run();
    db.update(workOrders)
      .set({ state: 'running', currentStepIndex: 2, activeJobId: 'job-live' })
      .where(eq(workOrders.slug, 'pay-schema'))
      .run();

    const response = await resetPlan(app);

    expect(await response.json()).toMatchObject({
      reset: [{ slug: 'pay-schema', state: 'waiting_parent' }],
      skipped: [],
    });
    const [order] = db
      .select()
      .from(workOrders)
      .where(eq(workOrders.slug, 'pay-schema'))
      .all();
    expect(order).toMatchObject({
      state: 'waiting_parent',
      currentStepIndex: 0,
      activeJobId: null,
    });
    const [job] = db
      .select()
      .from(jobs)
      .where(eq(jobs.jobId, asJobId('job-live')))
      .all();
    expect(job).toMatchObject({ status: 'cancelled' });
  });

  it('leaves a delivered child unchanged and lists it as skipped', async () => {
    const { app, db } = setup();
    await importPlanMembers(app, ['pay-done', 'pay-schema']);
    setPlanState(db, 'completed');
    db.update(workOrders)
      .set({ state: 'delivered', headCommitSha: 'done-sha' })
      .where(eq(workOrders.slug, 'pay-done'))
      .run();

    const response = await resetPlan(app);

    expect(await response.json()).toMatchObject({
      reset: [{ slug: 'pay-schema' }],
      skipped: [{ slug: 'pay-done', state: 'delivered' }],
    });
    const [done] = db
      .select()
      .from(workOrders)
      .where(eq(workOrders.slug, 'pay-done'))
      .all();
    expect(done).toMatchObject({
      state: 'delivered',
      headCommitSha: 'done-sha',
    });
  });

  it('refuses to reset a draft plan and queues no plan branch job', async () => {
    const { app, db } = setup();
    await importPlanMembers(app, ['pay-schema']);
    setPlanState(db, 'draft');

    const response = await resetPlan(app);

    expect(response.status).toBe(409);
    expect(planBranchJobs(db)).toHaveLength(0);
  });
});
