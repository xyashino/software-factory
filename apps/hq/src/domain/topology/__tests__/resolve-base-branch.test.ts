import { describe, expect, it } from 'vitest';
import {
  resolveBaseBranch,
  type ParentRef,
  type PlanRef,
} from '../resolve-base-branch';

const plan = (state: PlanRef['state']): PlanRef => ({
  state,
  baseBranch: 'main',
  branch: 'feat/payment-v2',
  branchCommitSha: 'plan-sha',
});

const parent = (
  state: ParentRef['state'],
  headCommitSha: string | null = 'parent-sha',
): ParentRef => ({
  state,
  branch: 'factory/pay-schema',
  headCommitSha,
});

const order = { baseBranch: 'main', branch: 'factory/pay-api' };

describe('base branch resolution', () => {
  it('starts the plan branch from main when the plan is branching', () => {
    const result = resolveBaseBranch({
      kind: 'plan_init',
      plan: plan('branching'),
    });

    expect(result).toEqual({
      isReady: true,
      initialState: 'queued',
      baseBranch: 'main',
      baseCommitSha: null,
      targetBranch: 'feat/payment-v2',
    });
  });

  it('keeps the plan branch init waiting when the plan is still a draft', () => {
    const result = resolveBaseBranch({
      kind: 'plan_init',
      plan: plan('draft'),
    });

    expect(result).toMatchObject({
      isReady: false,
      initialState: 'waiting_parent',
    });
  });

  it('runs a standalone work order from the base branch right away', () => {
    const result = resolveBaseBranch({
      kind: 'order',
      order,
      plan: null,
      parent: null,
    });

    expect(result).toEqual({
      isReady: true,
      initialState: 'queued',
      baseBranch: 'main',
      baseCommitSha: null,
      targetBranch: 'factory/pay-api',
    });
  });

  it('stacks a standalone child on its parent once the parent is delivered', () => {
    const result = resolveBaseBranch({
      kind: 'order',
      order,
      plan: null,
      parent: parent('delivered'),
    });

    expect(result).toEqual({
      isReady: true,
      initialState: 'queued',
      baseBranch: 'factory/pay-schema',
      baseCommitSha: 'parent-sha',
      targetBranch: 'factory/pay-api',
    });
  });

  it('keeps a standalone child waiting while its parent is still running', () => {
    const result = resolveBaseBranch({
      kind: 'order',
      order,
      plan: null,
      parent: parent('running'),
    });

    expect(result).toMatchObject({
      isReady: false,
      initialState: 'waiting_parent',
      baseBranch: 'factory/pay-schema',
    });
  });

  it('accepts a completed parent as delivered for a stacked child', () => {
    const result = resolveBaseBranch({
      kind: 'order',
      order,
      plan: null,
      parent: parent('completed', null),
    });

    expect(result).toMatchObject({
      isReady: true,
      baseCommitSha: null,
    });
  });

  it('runs a plan root work order from the plan branch once the plan is active', () => {
    const result = resolveBaseBranch({
      kind: 'order',
      order,
      plan: plan('active'),
      parent: null,
    });

    expect(result).toEqual({
      isReady: true,
      initialState: 'queued',
      baseBranch: 'feat/payment-v2',
      baseCommitSha: 'plan-sha',
      targetBranch: 'factory/pay-api',
    });
  });

  it('keeps a plan root work order waiting until its plan is active', () => {
    const result = resolveBaseBranch({
      kind: 'order',
      order,
      plan: plan('branching'),
      parent: null,
    });

    expect(result).toMatchObject({
      isReady: false,
      initialState: 'waiting_parent',
      baseBranch: 'feat/payment-v2',
    });
  });

  it('stacks a plan step work order on its parent, ignoring the plan state', () => {
    const result = resolveBaseBranch({
      kind: 'order',
      order,
      plan: plan('draft'),
      parent: parent('delivered'),
    });

    expect(result).toEqual({
      isReady: true,
      initialState: 'queued',
      baseBranch: 'factory/pay-schema',
      baseCommitSha: 'parent-sha',
      targetBranch: 'factory/pay-api',
    });
  });

  it('keeps a plan step work order waiting while its parent is not delivered', () => {
    const result = resolveBaseBranch({
      kind: 'order',
      order,
      plan: plan('active'),
      parent: parent('queued'),
    });

    expect(result).toMatchObject({
      isReady: false,
      baseBranch: 'factory/pay-schema',
    });
  });
});
