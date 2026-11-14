import { describe, expect, it } from 'vitest';
import { decide } from '../decide';
import { contextOf, created, cycleIdOf, cellIdOf } from './builders';
import { createCommand, stateOf } from './histories';

describe('decide on a Work order that does not exist', () => {
  it('creates the Work order from a CreateOrder', () => {
    const result = decide(undefined, createCommand(), contextOf());

    expect(result.ok && result.value.map((event) => event.type)).toEqual([
      'order_created',
    ]);
  });

  it('refuses every other command as not found', () => {
    const result = decide(
      undefined,
      { type: 'Cancel', reason: 'superseded' },
      contextOf({ kind: 'supervisor', name: 'dev' }),
    );

    expect(result).toEqual({ ok: false, error: { code: 'not_found' } });
  });

  it('refuses a Cycle command on a missing Work order as not found', () => {
    const result = decide(
      undefined,
      {
        type: 'FailCycle',
        cycleId: cycleIdOf(1),
        reason: 'crashed',
        detail: 'x',
      },
      contextOf({ kind: 'cell', cellId: cellIdOf(1) }, { epoch: 1 }),
    );

    expect(result).toEqual({ ok: false, error: { code: 'not_found' } });
  });
});

describe('decide on an existing Work order', () => {
  it('refuses a second CreateOrder with a precondition', () => {
    const result = decide(stateOf([created()]), createCommand(), contextOf());

    expect(result).toEqual({
      ok: false,
      error: { code: 'precondition', detail: 'the Work order already exists' },
    });
  });
});
