import { describe, expect, it } from 'vitest';
import {
  createOrderRequestSchema,
  createPlanRequestSchema,
  recordPlanPrStateRequestSchema,
  recordPrStateRequestSchema,
} from '../supervisor';

/**
 * The task API's request contracts (PROTOCOL §3.3): a Work order and an Order Plan carry their spec and a pinned
 * Line in the body, and the PR state routes take one of three states and an https PR url.
 */

const HASH = `sha256:${'a'.repeat(64)}`;
const PR_URL = 'https://github.com/example/repo/pull/12';

const line = {
  snapshotVersion: 1,
  name: 'standard',
  hash: HASH,
  stations: [
    {
      id: 'build',
      kind: 'operator',
      runner: 'claude',
      requires: [],
      maxRestarts: 0,
      maxLostRestarts: 0,
      verdict: false,
      artifacts: ['commit'],
    },
  ],
};

const order = {
  commandId: 'cmd-1',
  projectId: 'software-factory',
  todoId: 'sign-in',
  title: 'Add sign-in',
  type: 'feat',
  body: '# Add sign-in\n\nUsers can sign in.\n',
  line,
  priority: 'high',
  dependsOn: [],
};

const member = (todoId: string) => ({
  todoId,
  title: `Add ${todoId}`,
  type: 'feat',
  body: `# Add ${todoId}\n`,
  line,
  priority: 'medium',
});

describe('Work order request (createOrder)', () => {
  it('accepts a spec with the Line it pins', () => {
    expect(createOrderRequestSchema.safeParse(order).success).toBe(true);
  });

  it('refuses a Work order with no Line', () => {
    const withoutLine: Record<string, unknown> = { ...order };
    delete withoutLine.line;
    expect(createOrderRequestSchema.safeParse(withoutLine).success).toBe(false);
  });

  it('refuses a Line with no operator station', () => {
    const noOperator = {
      ...order,
      line: {
        ...line,
        stations: [
          {
            id: 'gate',
            kind: 'inspection',
            requires: [],
            maxRestarts: 0,
            maxLostRestarts: 0,
            artifacts: [],
            exec: ['pnpm test'],
          },
        ],
      },
    };
    expect(createOrderRequestSchema.safeParse(noOperator).success).toBe(false);
  });

  it('refuses a commit type outside the change categories', () => {
    expect(
      createOrderRequestSchema.safeParse({ ...order, type: 'yolo' }).success,
    ).toBe(false);
  });

  it('refuses a field the contract does not name', () => {
    expect(
      createOrderRequestSchema.safeParse({ ...order, removeTodo: 'todos/x.md' })
        .success,
    ).toBe(false);
  });
});

describe('Order Plan request (createPlan)', () => {
  it('accepts members listed in chain order', () => {
    const plan = {
      commandId: 'cmd-2',
      projectId: 'software-factory',
      slug: 'auth',
      members: [member('first'), member('second')],
    };
    expect(createPlanRequestSchema.safeParse(plan).success).toBe(true);
  });

  it('refuses a plan with no members', () => {
    const plan = {
      commandId: 'cmd-2',
      projectId: 'software-factory',
      slug: 'auth',
      members: [],
    };
    expect(createPlanRequestSchema.safeParse(plan).success).toBe(false);
  });

  it('refuses a member that names its own dependencies, which the chain already sets', () => {
    const plan = {
      commandId: 'cmd-2',
      projectId: 'software-factory',
      slug: 'auth',
      members: [{ ...member('first'), dependsOn: ['software-factory:x'] }],
    };
    expect(createPlanRequestSchema.safeParse(plan).success).toBe(false);
  });

  it('refuses a plan that lists one todo twice', () => {
    const plan = {
      commandId: 'cmd-2',
      projectId: 'software-factory',
      slug: 'auth',
      members: [member('same'), member('same')],
    };
    expect(createPlanRequestSchema.safeParse(plan).success).toBe(false);
  });
});

describe('PR state requests (recordPrState, recordPlanPrState)', () => {
  it.each(['open', 'merged', 'closed'])('accepts the PR state %s', (state) => {
    const request = {
      orderId: 'software-factory:sign-in',
      commandId: 'cmd-3',
      prUrl: PR_URL,
      state,
    };
    expect(recordPrStateRequestSchema.safeParse(request).success).toBe(true);
  });

  it('refuses a PR state outside open, merged and closed', () => {
    const request = {
      orderId: 'software-factory:sign-in',
      commandId: 'cmd-3',
      prUrl: PR_URL,
      state: 'draft',
    };
    expect(recordPrStateRequestSchema.safeParse(request).success).toBe(false);
  });

  it('refuses a PR url that is not https', () => {
    const request = {
      orderId: 'software-factory:sign-in',
      commandId: 'cmd-3',
      prUrl: 'http://example.test/pull/1',
      state: 'open',
    };
    expect(recordPrStateRequestSchema.safeParse(request).success).toBe(false);
  });

  it('accepts a plan PR state with its plan id', () => {
    const request = {
      planId: 'software-factory:plan:auth',
      commandId: 'cmd-4',
      prUrl: PR_URL,
      state: 'merged',
    };
    expect(recordPlanPrStateRequestSchema.safeParse(request).success).toBe(
      true,
    );
  });
});
