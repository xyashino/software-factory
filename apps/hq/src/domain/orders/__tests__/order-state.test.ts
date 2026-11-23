import { describe, expect, it } from 'vitest';
import { nextPlanState, nextWorkOrderState } from '../order-state';

describe('order plan transitions', () => {
  it('moves a draft plan into branching when it is activated', () => {
    expect(nextPlanState('draft', 'activate')).toBe('branching');
  });

  it('refuses to activate a plan that is already active', () => {
    expect(nextPlanState('active', 'activate')).toBeNull();
  });

  it('retries only a failed plan', () => {
    expect(nextPlanState('failed', 'retry')).toBe('branching');
    expect(nextPlanState('branching', 'retry')).toBeNull();
  });

  it('completes an active or ready plan only', () => {
    expect(nextPlanState('active', 'complete')).toBe('completed');
    expect(nextPlanState('ready', 'complete')).toBe('completed');
    expect(nextPlanState('draft', 'complete')).toBeNull();
  });

  it('cancels any plan that has not finished', () => {
    expect(nextPlanState('branching', 'cancel')).toBe('cancelled');
    expect(nextPlanState('completed', 'cancel')).toBeNull();
    expect(nextPlanState('cancelled', 'cancel')).toBeNull();
  });
});

describe('work order transitions', () => {
  it('pauses a queued or waiting order', () => {
    expect(nextWorkOrderState('queued', 'pause', true)).toBe('paused');
    expect(nextWorkOrderState('waiting_parent', 'pause', false)).toBe('paused');
    expect(nextWorkOrderState('running', 'pause', true)).toBeNull();
  });

  it('unpauses into queued when the order is ready, else into waiting', () => {
    expect(nextWorkOrderState('paused', 'unpause', true)).toBe('queued');
    expect(nextWorkOrderState('paused', 'unpause', false)).toBe(
      'waiting_parent',
    );
    expect(nextWorkOrderState('queued', 'unpause', true)).toBeNull();
  });

  it('resumes a blocked or line unavailable order by readiness', () => {
    expect(nextWorkOrderState('blocked', 'resume', true)).toBe('queued');
    expect(nextWorkOrderState('line_unavailable', 'resume', false)).toBe(
      'waiting_parent',
    );
    expect(nextWorkOrderState('delivered', 'resume', true)).toBeNull();
  });

  it('resets a paused order to scratch without unpausing it', () => {
    expect(nextWorkOrderState('paused', 'reset_to_scratch', true)).toBe(
      'paused',
    );
    expect(nextWorkOrderState('blocked', 'reset_to_scratch', true)).toBe(
      'queued',
    );
    expect(nextWorkOrderState('running', 'reset_to_scratch', true)).toBeNull();
  });

  it('reopens a delivered, completed or cancelled order by readiness', () => {
    expect(nextWorkOrderState('delivered', 'reopen', true)).toBe('queued');
    expect(nextWorkOrderState('completed', 'reopen', false)).toBe(
      'waiting_parent',
    );
    expect(nextWorkOrderState('cancelled', 'reopen', true)).toBe('queued');
    expect(nextWorkOrderState('queued', 'reopen', true)).toBeNull();
  });

  it('completes only a delivered order', () => {
    expect(nextWorkOrderState('delivered', 'complete', true)).toBe('completed');
    expect(nextWorkOrderState('running', 'complete', true)).toBeNull();
  });

  it('cancels any order that is not already finished', () => {
    expect(nextWorkOrderState('running', 'cancel', true)).toBe('cancelled');
    expect(nextWorkOrderState('completed', 'cancel', true)).toBeNull();
    expect(nextWorkOrderState('cancelled', 'cancel', true)).toBeNull();
  });
});
