import { describe, expect, it } from 'vitest';
import { listenerConfigFrom, parseBind } from '../http/config';

describe('listener config', () => {
  it('listens on loopback port 7878 when nothing is set, with no switch to turn it on', () => {
    expect(listenerConfigFrom({})).toEqual({
      hostname: '127.0.0.1',
      port: 7878,
    });
  });

  it('binds where FACTORY_BIND says, without any other switch', () => {
    expect(listenerConfigFrom({ FACTORY_BIND: '10.0.0.5:9000' })).toEqual({
      hostname: '10.0.0.5',
      port: 9000,
    });
  });

  it('accepts port 0, which asks the system for a free port (tests)', () => {
    expect(listenerConfigFrom({ FACTORY_BIND: '127.0.0.1:0' }).port).toBe(0);
  });

  it('reads the GitHub webhook secret when it is set', () => {
    expect(listenerConfigFrom({ GITHUB_WEBHOOK_SECRET: 'shh' })).toEqual({
      hostname: '127.0.0.1',
      port: 7878,
      githubWebhookSecret: 'shh',
    });
  });

  it('refuses a bind address that is not host:port', () => {
    expect(() => listenerConfigFrom({ FACTORY_BIND: 'nope' })).toThrow(
      'FACTORY_BIND must be host:port',
    );
  });
});

describe('parseBind', () => {
  it('reads an IPv6 address in brackets', () => {
    expect(parseBind('[::1]:7878')).toEqual({ hostname: '::1', port: 7878 });
  });

  it('refuses a port above 65535', () => {
    expect(() => parseBind('127.0.0.1:70000')).toThrow('host:port');
  });
});
