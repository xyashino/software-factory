import { describe, expect, it } from 'vitest';
import { createRunnerCatalog } from '../../../../src/adapters/runners/catalog';
import {
  getRunner,
  RUNNER_NAMES,
} from '../../../../src/adapters/runners/registry';

describe('runner registry', () => {
  it('registers exactly the six runners in order', () => {
    // Arrange
    const expected = [
      'claude',
      'codex',
      'cursor',
      'antigravity',
      'opencode',
      'copilot',
    ];

    // Act
    const names = [...RUNNER_NAMES];

    // Assert
    expect(names).toEqual(expected);
  });

  it('finds no runner for an unknown name', () => {
    // Arrange
    const name = 'herdr-pane';

    // Act
    const runner = getRunner(name);

    // Assert
    expect(runner).toBeUndefined();
  });

  it('reports a registered runner as unavailable when its binary is missing', async () => {
    // Arrange
    const catalog = createRunnerCatalog(async () => false);

    // Act
    const installed = await catalog.isInstalled('claude');

    // Assert
    expect(installed).toBe(false);
  });

  it('builds no command line for an unknown runner', () => {
    // Arrange
    const catalog = createRunnerCatalog(async () => true);

    // Act
    const commandLine = catalog.commandLine('unknown', '.cell/build/prompt.md');

    // Assert
    expect(commandLine).toBeUndefined();
  });
});
