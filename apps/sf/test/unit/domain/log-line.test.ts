import { describe, expect, it } from 'vitest';
import { renderLogLine } from '../../../src/domain/cell/log-line';

const ESC = '\u001b[';
const AT = Date.UTC(2026, 10, 19, 22, 44, 49);
// eslint-disable-next-line no-control-regex
const stripAnsi = (text: string): string => text.replace(/\u001b\[\d+m/g, '');

describe('cell log line', () => {
  it('shows the clock, order, station, action and detail in columns', () => {
    // Arrange & Act
    const line = renderLogLine({
      at: AT,
      order: 'pane-smoke',
      station: 'build',
      action: 'complete',
    });

    // Assert
    expect(stripAnsi(line).trim().split(/\s+/)).toEqual([
      '22:44:49',
      'pane-smoke',
      'build',
      'complete',
    ]);
  });

  it('paints a failure red and keeps its detail on one line', () => {
    // Arrange & Act
    const line = renderLogLine({
      at: AT,
      order: 'pane-smoke',
      station: 'quality-gate',
      action: 'fail',
      detail: 'bun run ci:verify\nexited 1',
    });

    // Assert
    expect(line).toContain(`${ESC}31mfail`);
    expect(line.endsWith('bun run ci:verify exited 1')).toBe(true);
  });

  it('paints every delivery action green', () => {
    // Arrange & Act
    const line = renderLogLine({
      at: AT,
      order: 'pane-smoke',
      station: 'deliver',
      action: 'complete',
    });

    // Assert
    expect(line).toContain(`${ESC}32mcomplete`);
  });

  it('drops colour codes that a failed command left in the detail', () => {
    // Arrange & Act
    const line = renderLogLine({
      at: AT,
      order: 'pane-smoke',
      station: 'quality-gate',
      action: 'fail',
      detail: `${ESC}31mTypeError${ESC}39m: boom`,
    });

    // Assert
    expect(line.endsWith('TypeError: boom')).toBe(true);
  });
});
