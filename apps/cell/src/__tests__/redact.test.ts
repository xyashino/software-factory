import { describe, expect, it } from 'vitest';
import { freeText } from '@repo/factory-core/order/events';
import { isMachineIndependentText } from '@repo/factory-core/machine-local';
import { redactDetail } from '../jobs/redact';
import { tailOf } from '../jobs/send';

const BAD_ENDINGS = [
  '/home/factory/.local/share/factory-cell/worktrees/software-factory_v2-fix/...',
  '/tmp/foo',
  '~/dir',
  'localhost:3000',
  '127.0.0.1:7878',
  'pid=1234',
  'pane %12',
  'C:\\Users\\factory\\out',
  'build.internal',
];

const bytesOf = (text: string): number => new TextEncoder().encode(text).length;

describe('tail of a command output', () => {
  it.each(BAD_ENDINGS)(
    'keeps the tail machine-independent when output ends with %s',
    (ending) => {
      const tail = tailOf(`compiled ok\nfailed at ${ending}`);

      expect(isMachineIndependentText(tail)).toBe(true);
      expect(bytesOf(tail)).toBeLessThanOrEqual(2048);
      expect(tail).toContain('failed at');
    },
  );

  it('keeps benign output unchanged', () => {
    expect(tailOf('3 tests passed\nall green')).toBe(
      '3 tests passed\nall green',
    );
  });

  it('keeps the tail within 2 KiB of UTF-8 and never breaks a character', () => {
    const tail = tailOf(`${'ż'.repeat(2000)}end`);

    expect(bytesOf(tail)).toBeLessThanOrEqual(2048);
    expect(tail.endsWith('end')).toBe(true);
    expect(tail).not.toContain('\uFFFD');
  });

  it('keeps a token split by the 2 KiB cut from leaving a machine-local fragment', () => {
    const log = `${'x'.repeat(2040)} /var/lib/factory/cells/deep/path/here`;

    const tail = tailOf(log);

    expect(bytesOf(tail)).toBeLessThanOrEqual(2048);
    expect(isMachineIndependentText(tail)).toBe(true);
  });

  it('strips terminal colour codes before it redacts', () => {
    const tail = tailOf('\u001b[31merror at /tmp/foo\u001b[0m');

    expect(tail).not.toContain('\u001b');
    expect(isMachineIndependentText(tail)).toBe(true);
  });

  it('redacts a large log of paths into a tail that passes the guard', () => {
    const log = Array.from(
      { length: 500 },
      (_, index) => `/home/factory/run/${index}.log`,
    ).join('\n');

    const tail = tailOf(log);

    expect(bytesOf(tail)).toBeLessThanOrEqual(2048);
    expect(isMachineIndependentText(tail)).toBe(true);
  });
});

describe('failure detail', () => {
  it.each(BAD_ENDINGS)(
    'makes a detail that ends with %s pass freeText',
    (ending) => {
      const detail = redactDetail(`push refused: ${ending}`, 500, 'end');

      expect(detail.length).toBeLessThanOrEqual(500);
      expect(freeText.safeParse(detail).success).toBe(true);
    },
  );

  it('keeps the start of a message when it is the start that is cut', () => {
    const detail = redactDetail(`${'a'.repeat(600)} /tmp/foo`, 500);

    expect(detail.length).toBeLessThanOrEqual(500);
    expect(detail.startsWith('aaaa')).toBe(true);
    expect(freeText.safeParse(detail).success).toBe(true);
  });
});
