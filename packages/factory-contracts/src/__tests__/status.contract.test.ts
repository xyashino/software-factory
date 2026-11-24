import { describe, expect, it } from 'vitest';
import {
  DaemonStatusSchema,
  FactoryCredentialSchema,
  HqStateSchema,
} from '../status.contract';

const daemonStatus = {
  pid: 4242,
  hq: { kind: 'ok' },
  url: 'https://hq.example.test',
  factoryId: 'factory-1',
  cells: 2,
};

const credential = {
  url: 'https://hq.example.test',
  factoryId: 'factory-1',
  sessionToken: 'token-1',
};

describe('hq state', () => {
  it('accepts each connection state kind', () => {
    const states = [
      { kind: 'not_connected' },
      { kind: 'ok' },
      { kind: 'unreachable', since: 1_700_000_000_000 },
      { kind: 'rejected' },
    ];

    const results = states.map((state) => HqStateSchema.safeParse(state));

    expect(results.every((result) => result.success)).toBe(true);
  });

  it('rejects an unknown connection state kind', () => {
    const result = HqStateSchema.safeParse({ kind: 'sleeping' });

    expect(result.success).toBe(false);
  });
});

describe('daemon status', () => {
  it('accepts a status without a hq url or factory id', () => {
    const result = DaemonStatusSchema.safeParse({
      ...daemonStatus,
      url: null,
      factoryId: null,
    });

    expect(result.success).toBe(true);
  });

  it('rejects a status with an extra key', () => {
    const result = DaemonStatusSchema.safeParse({
      ...daemonStatus,
      uptime: 10,
    });

    expect(result.success).toBe(false);
  });

  it('rejects a status with a non-positive pid', () => {
    const result = DaemonStatusSchema.safeParse({ ...daemonStatus, pid: 0 });

    expect(result.success).toBe(false);
  });
});

describe('factory credential', () => {
  it('accepts a credential with an http url and a session token', () => {
    const result = FactoryCredentialSchema.safeParse(credential);

    expect(result.success).toBe(true);
  });

  it('rejects a credential whose url is not a url', () => {
    const result = FactoryCredentialSchema.safeParse({
      ...credential,
      url: 'not a url',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a credential with an empty session token', () => {
    const result = FactoryCredentialSchema.safeParse({
      ...credential,
      sessionToken: '',
    });

    expect(result.success).toBe(false);
  });
});
