import { describe, expect, it } from 'vitest';
import type { CommandSpec } from '../../../../src/adapters/runners/runner';
import { opencodeRunner } from '../../../../src/adapters/runners/opencode';

const PROMPT = 'Read .cell/build/prompt.md and follow the instructions in it.';

describe('opencode runner', () => {
  it('runs one prompt with the model flag', () => {
    // Arrange
    const spec: CommandSpec = {
      promptFile: '.cell/build/prompt.md',
      model: 'anthropic/claude-sonnet',
      permission: 'write',
    };

    // Act
    const argv = opencodeRunner.buildCommand(spec);

    // Assert
    expect(argv).toEqual([
      'opencode',
      'run',
      '-m',
      'anthropic/claude-sonnet',
      PROMPT,
    ]);
  });

  it('is missing when opencode is not on PATH', async () => {
    // Arrange
    const probe = async () => false;

    // Act
    const installed = await opencodeRunner.checkInstalled(probe);

    // Assert
    expect(installed).toBe(false);
  });
});
