import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dispatchInternal } from '../../../src/bootstrap/entry-dispatch';

const PROBE_ENV = 'SF_DISPATCH_PROBE';
const dirs: string[] = [];

const webEntryWritingProbe = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-dispatch-'));
  dirs.push(dir);
  const entry = join(dir, 'entry.mjs');
  writeFileSync(entry, `process.env.${PROBE_ENV} = 'loaded';\n`);
  return entry;
};

afterEach(() => {
  delete process.env[PROBE_ENV];
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('internal dispatch', () => {
  it('leaves ordinary commands to the CLI', async () => {
    // Arrange
    const args = ['server', 'start', '--json'];

    // Act
    const handled = await dispatchInternal(args);

    // Assert
    expect(handled).toBe(false);
    expect(process.env[PROBE_ENV]).toBeUndefined();
  });

  it('runs the web entry named after the web marker', async () => {
    // Arrange
    const args = ['__web', webEntryWritingProbe()];

    // Act
    const handled = await dispatchInternal(args);

    // Assert
    expect(handled).toBe(true);
    expect(process.env[PROBE_ENV]).toBe('loaded');
  });

  it('leaves the web marker alone when no entry follows', async () => {
    // Arrange
    const args = ['__web'];

    // Act
    const handled = await dispatchInternal(args);

    // Assert
    expect(handled).toBe(false);
  });
});
