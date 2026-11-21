import { describe, expect, it } from 'vitest';
import type { CommandSpec } from '../../../../src/adapters/runners/runner';
import { claudeRunner } from '../../../../src/adapters/runners/claude';

const PROMPT = 'Read .cell/build/prompt.md and follow the instructions in it.';

describe('claude runner', () => {
  it('runs headless with model and json output when write is allowed', () => {
    // Arrange
    const spec: CommandSpec = {
      promptFile: '.cell/build/prompt.md',
      model: 'opus',
      permission: 'write',
    };

    // Act
    const argv = claudeRunner.buildCommand(spec);

    // Assert
    expect(argv).toEqual([
      'claude',
      '-p',
      PROMPT,
      '--dangerously-skip-permissions',
      '--output-format',
      'json',
      '--model',
      'opus',
    ]);
  });

  it('denies file edits and omits the model flag in read mode without a model', () => {
    // Arrange
    const spec: CommandSpec = {
      promptFile: '.cell/build/prompt.md',
      permission: 'read',
    };

    // Act
    const argv = claudeRunner.buildCommand(spec);

    // Assert
    expect(argv).toEqual([
      'claude',
      '-p',
      PROMPT,
      '--dangerously-skip-permissions',
      '--disallowedTools',
      'Write,Edit,MultiEdit,NotebookEdit',
      '--output-format',
      'json',
    ]);
  });

  it('is installed when its binary is on PATH', async () => {
    // Arrange
    const probe = async (binary: string) => binary === 'claude';

    // Act
    const installed = await claudeRunner.checkInstalled(probe);

    // Assert
    expect(installed).toBe(true);
  });
});
