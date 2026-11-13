import { describe, expect, it } from 'vitest';
import { stationOf } from './builders';
import { orderCommandSchema } from '../commands';

describe('command schema', () => {
  it('accepts a resume to an earlier Station', () => {
    const result = orderCommandSchema.safeParse({
      type: 'Resume',
      mode: { kind: 'restart_from', stationId: stationOf('build') },
    });

    expect(result.success).toBe(true);
  });

  it('rejects a command type the catalogue does not have', () => {
    const result = orderCommandSchema.safeParse({ type: 'Explode' });

    expect(result.success).toBe(false);
  });

  it('rejects a cancel reason over 4 KiB', () => {
    const result = orderCommandSchema.safeParse({
      type: 'Cancel',
      reason: 'x'.repeat(4097),
    });

    expect(result.success).toBe(false);
  });

  it('rejects a reason that names a machine-local path', () => {
    const result = orderCommandSchema.safeParse({
      type: 'Cancel',
      reason: 'see /home/dev/notes for the decision',
    });

    expect(result.success).toBe(false);
  });
});
