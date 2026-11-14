import { describe, expect, it } from 'vitest';
import { parseBind, remoteConfigFrom } from '../http/config';

describe('remote mode switch', () => {
  it('stays local when FACTORY_REMOTE is unset', () => {
    expect(remoteConfigFrom({})).toEqual({
      enabled: false,
      hostname: '127.0.0.1',
      port: 7878,
    });
  });

  it('turns the TCP listener on with FACTORY_REMOTE=1, on loopback by default', () => {
    expect(remoteConfigFrom({ FACTORY_REMOTE: '1' })).toEqual({
      enabled: true,
      hostname: '127.0.0.1',
      port: 7878,
    });
  });

  it('binds the address FACTORY_BIND names', () => {
    expect(
      remoteConfigFrom({ FACTORY_REMOTE: '1', FACTORY_BIND: '10.0.0.5:9000' }),
    ).toEqual({ enabled: true, hostname: '10.0.0.5', port: 9000 });
  });

  it('refuses a FACTORY_BIND that would be ignored', () => {
    expect(() => remoteConfigFrom({ FACTORY_BIND: '0.0.0.0:7878' })).toThrow(
      'FACTORY_BIND needs FACTORY_REMOTE=1',
    );
  });
});

describe('parseBind', () => {
  it('reads an IPv6 address in brackets', () => {
    expect(parseBind('[::1]:7878')).toEqual({ hostname: '::1', port: 7878 });
  });

  it('accepts port 0 for a free port', () => {
    expect(parseBind('127.0.0.1:0')).toEqual({
      hostname: '127.0.0.1',
      port: 0,
    });
  });

  it.each([
    '7878',
    ':7878',
    '127.0.0.1',
    '127.0.0.1:',
    '127.0.0.1:70000',
    '127.0.0.1:x',
  ])('refuses %s', (bind) => {
    expect(() => parseBind(bind)).toThrow(/FACTORY_BIND must be host:port/);
  });
});
