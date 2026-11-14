import { describe, expect, it } from 'vitest';
import { runtimeConfigFrom } from '../runtime-config';

describe('runtime timing knobs from the environment', () => {
  it('keeps the production defaults when no knob is set', () => {
    expect(runtimeConfigFrom({})).toEqual({});
  });

  it('applies each knob the operator sets', () => {
    expect(
      runtimeConfigFrom({
        FACTORY_LEASE_TTL_MS: '3000',
        FACTORY_HEARTBEAT_MS: '300',
        FACTORY_REAPER_MS: '200',
        FACTORY_SELF_FENCE_MS: '2000',
        FACTORY_CLAIM_TICK_MS: '100',
      }),
    ).toEqual({
      leaseTtlMs: 3000,
      heartbeatMs: 300,
      reaperMs: 200,
      selfFenceMs: 2000,
      claimTickMs: 100,
    });
  });

  it('refuses a knob that is not a positive whole number of milliseconds', () => {
    expect(() => runtimeConfigFrom({ FACTORY_HEARTBEAT_MS: 'soon' })).toThrow(
      'FACTORY_HEARTBEAT_MS',
    );
    expect(() => runtimeConfigFrom({ FACTORY_REAPER_MS: '0' })).toThrow(
      'FACTORY_REAPER_MS',
    );
  });

  it('reads the cut-over flag: 0 turns the v2 todo filter off, 1 keeps it on', () => {
    expect(runtimeConfigFrom({ FACTORY_V2_ONLY: '0' })).toEqual({
      v2Only: false,
    });
    expect(runtimeConfigFrom({ FACTORY_V2_ONLY: '1' })).toEqual({
      v2Only: true,
    });
    expect(() => runtimeConfigFrom({ FACTORY_V2_ONLY: 'off' })).toThrow(
      'FACTORY_V2_ONLY',
    );
  });

  it('refuses a self-fence that is not shorter than the lease TTL (PROTOCOL §5.1)', () => {
    expect(() =>
      runtimeConfigFrom({
        FACTORY_LEASE_TTL_MS: '3000',
        FACTORY_SELF_FENCE_MS: '3000',
      }),
    ).toThrow('FACTORY_SELF_FENCE_MS');
  });

  it('compares a set self-fence with the default TTL when only the fence is set', () => {
    expect(() => runtimeConfigFrom({ FACTORY_SELF_FENCE_MS: '90000' })).toThrow(
      'FACTORY_SELF_FENCE_MS',
    );
  });
});
