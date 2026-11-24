import { describe, expect, it } from 'vitest';
import { availableActions } from '@/modules/work-orders/domain/transitions';
import { isAllowedWebAction, isSameOrigin } from '@/server/write-guard';

describe('work order transition rules', () => {
  it('allows pause and cancel for queued orders', () => {
    expect(availableActions('queued')).toEqual(['pause', 'cancel']);
  });

  it('allows unpause and cancel for paused orders', () => {
    expect(availableActions('paused')).toEqual(['unpause', 'cancel']);
  });

  it('allows resume and cancel for blocked orders', () => {
    expect(availableActions('blocked')).toEqual(['resume', 'cancel']);
  });

  it('exposes no actions for terminal states', () => {
    expect(availableActions('delivered')).toEqual([]);
    expect(availableActions('completed')).toEqual([]);
    expect(availableActions('cancelled')).toEqual([]);
  });
});

describe('BFF write guard', () => {
  it('accepts same-origin requests and rejects foreign or missing origins', () => {
    expect(
      isSameOrigin(
        'http://127.0.0.1:4322',
        'http://localhost:4322/api/work-orders/1/transitions',
        '127.0.0.1:4322',
      ),
    ).toBe(true);
    expect(
      isSameOrigin(
        'https://evil.example',
        'http://localhost:4322/api/work-orders/1/transitions',
        '127.0.0.1:4322',
      ),
    ).toBe(false);
    expect(
      isSameOrigin(
        null,
        'http://localhost:4322/api/work-orders/1/transitions',
        '127.0.0.1:4322',
      ),
    ).toBe(false);
  });

  it('allows only supported web transition actions', () => {
    expect(isAllowedWebAction('resume')).toBe(true);
    expect(isAllowedWebAction('cancel')).toBe(true);
    expect(isAllowedWebAction('delete_everything')).toBe(false);
  });
});
