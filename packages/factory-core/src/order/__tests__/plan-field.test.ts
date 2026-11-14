import { describe, expect, it } from 'vitest';
import { decide } from '../decide';
import type { DecideContext, OrderCommand } from '../commands';
import { orderEventSchema } from '../events';
import { toProjection } from '../projection';
import { created, fold, history } from '../../testing/event-builders';
import { planSlugSchema } from '../../ids';

const META = {
  lastSeq: 1,
  createdAt: 0,
  updatedAt: 0,
  next: { kind: 'done' as const },
};

const ctx: DecideContext = {
  now: 0,
  ids: { next: () => '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
  actor: { kind: 'factory' },
  blobs: { exists: () => true, size: () => 0 },
};

/** A CreateOrder command for the built `created()` fields, with an optional plan. */
const createCommand = (plan?: string): OrderCommand => {
  const base = created({ baseBranch: 'release/9' });
  return {
    type: 'CreateOrder',
    projectId: base.projectId,
    todoId: base.todoId,
    spec: base.spec,
    priority: 'medium',
    dependsOn: [],
    line: base.line,
    baseBranch: 'release/9',
    ...(plan === undefined ? {} : { plan: planSlugSchema.parse(plan) }),
  };
};

describe('order_created.plan (CORE §12.1, no schemaVersion bump)', () => {
  it('reads an event stored without plan as a plain Work order', () => {
    const parsed = orderEventSchema.safeParse(created());
    expect(parsed.success).toBe(true);
    expect(parsed.success && 'plan' in parsed.data).toBe(false);
  });

  it('reads an event with a plan slug, and refuses a bad one', () => {
    expect(
      orderEventSchema.safeParse({ ...created(), plan: 'xyz' }).success,
    ).toBe(true);
    expect(
      orderEventSchema.safeParse({ ...created(), plan: 'Xyz' }).success,
    ).toBe(false);
  });
});

describe('CreateOrder: plan and pinned base', () => {
  it('copies the plan into the event only when set', () => {
    const plain = decide(undefined, createCommand(), ctx);
    expect(plain.ok && plain.value[0]).not.toHaveProperty('plan');
    const planned = decide(undefined, createCommand('xyz'), ctx);
    expect(planned.ok && planned.value[0]).toMatchObject({
      plan: 'xyz',
      baseBranch: 'release/9',
    });
  });

  it('keeps baseBranch and plan in the state and the projection', () => {
    const planned = decide(undefined, createCommand('xyz'), ctx);
    if (!planned.ok) throw new Error('create refused');
    const state = fold(history(...planned.value));
    expect(state.baseBranch).toBe('release/9');
    expect(state.plan).toBe('xyz');
    expect(toProjection(state, META)).toMatchObject({
      baseBranch: 'release/9',
      plan: 'xyz',
    });
  });

  it('gives a plain Work order no plan and the base it was created with', () => {
    const state = fold(history(created({ baseBranch: 'develop' })));
    expect(state.plan).toBeUndefined();
    expect(state.baseBranch).toBe('develop');
    expect(toProjection(state, META).plan).toBeNull();
  });
});
