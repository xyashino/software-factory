import { describe, expect, it } from 'vitest';
import {
  canCancel,
  canResume,
  isAllowedAction,
  isSameOrigin,
} from '../../src/lib/write-guard';
import { WORK_ORDER_STATE_LIST } from '../../src/lib/view-model';

const RESUMABLE = ['blocked', 'line_unavailable'];
const TERMINAL = ['delivered', 'completed', 'cancelled'];

describe('write guard', () => {
  it('allows resume and cancel as actions', () => {
    expect(isAllowedAction('resume')).toBe(true);
    expect(isAllowedAction('cancel')).toBe(true);
  });

  it.each(['pause', 'complete', ''])('rejects the action %j', (action) => {
    expect(isAllowedAction(action)).toBe(false);
  });

  it('offers resume only on blocked and line-unavailable orders', () => {
    const offered = WORK_ORDER_STATE_LIST.filter(canResume);
    expect([...offered].sort()).toEqual([...RESUMABLE].sort());
  });

  it('offers delete on every state except the terminal ones', () => {
    const offered = WORK_ORDER_STATE_LIST.filter(canCancel);
    expect(offered).toEqual(
      WORK_ORDER_STATE_LIST.filter((state) => !TERMINAL.includes(state)),
    );
  });

  it('accepts an origin that matches the host header', () => {
    expect(
      isSameOrigin(
        'http://127.0.0.1:4321',
        'http://localhost:4321/x',
        '127.0.0.1:4321',
      ),
    ).toBe(true);
  });

  it('rejects a foreign origin', () => {
    expect(
      isSameOrigin(
        'https://evil.test',
        'http://127.0.0.1:4321/x',
        '127.0.0.1:4321',
      ),
    ).toBe(false);
  });

  it('rejects a port mismatch', () => {
    expect(
      isSameOrigin(
        'http://127.0.0.1:9999',
        'http://127.0.0.1:4321/x',
        '127.0.0.1:4321',
      ),
    ).toBe(false);
  });

  it('rejects a missing origin', () => {
    expect(
      isSameOrigin(null, 'http://127.0.0.1:4321/x', '127.0.0.1:4321'),
    ).toBe(false);
  });

  it('rejects a missing host', () => {
    expect(
      isSameOrigin('http://127.0.0.1:4321', 'http://127.0.0.1:4321/x', null),
    ).toBe(false);
  });

  it('rejects an opaque origin', () => {
    expect(
      isSameOrigin('null', 'http://127.0.0.1:4321/x', '127.0.0.1:4321'),
    ).toBe(false);
  });
});
