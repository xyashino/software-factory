import { describe, expect, it } from 'vitest';
import { mechanicTimeoutMs } from '../../../src/domain/line/parse-line';

const LINE = 'name: fast\nstations:\n  - id: build\n    kind: operator\n';

describe('mechanic timeout', () => {
  it('reads the timeout from the line mechanic block', () => {
    // Arrange
    const text = `${LINE}mechanic:\n  timeout: 40m\n`;

    // Act
    const timeout = mechanicTimeoutMs(text);

    // Assert
    expect(timeout).toBe(40 * 60_000);
  });

  it('falls back to 30 minutes when the line has no mechanic timeout', () => {
    expect(mechanicTimeoutMs(LINE)).toBe(30 * 60_000);
  });

  it('refuses a timeout that is not a duration', () => {
    // Arrange
    const text = `${LINE}mechanic:\n  timeout: soon\n`;

    // Act & Assert
    expect(() => mechanicTimeoutMs(text)).toThrow('invalid duration "soon"');
  });
});
