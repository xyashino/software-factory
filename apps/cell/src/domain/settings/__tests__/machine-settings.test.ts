import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MACHINE_SETTINGS,
  validateMachineSettings,
} from '../machine-settings';

describe('machine settings', () => {
  it('defaults to loopback on port 7071', () => {
    expect(DEFAULT_MACHINE_SETTINGS).toEqual({ host: '127.0.0.1', port: 7071 });
  });

  it('accepts a valid host and port', () => {
    const settings = { host: '0.0.0.0', port: 8080 };

    expect(validateMachineSettings(settings)).toEqual(settings);
  });

  it('rejects an empty host', () => {
    expect(() => validateMachineSettings({ host: ' ', port: 7071 })).toThrow(
      'host must not be empty',
    );
  });

  it('rejects port zero', () => {
    expect(() =>
      validateMachineSettings({ host: '127.0.0.1', port: 0 }),
    ).toThrow('port must be an integer from 1');
  });

  it('rejects a fractional port', () => {
    expect(() =>
      validateMachineSettings({ host: '127.0.0.1', port: 70.5 }),
    ).toThrow('port must be an integer from 1');
  });

  it('rejects a port above 65535', () => {
    expect(() =>
      validateMachineSettings({ host: '127.0.0.1', port: 65_536 }),
    ).toThrow('port must not exceed 65535');
  });
});
