import { describe, expect, it } from 'vitest';
import type { CommandSpec } from '../../../../src/adapters/runners/runner';
import { antigravityRunner } from '../../../../src/adapters/runners/antigravity';

const PROMPT = 'Read .cell/build/prompt.md and follow the instructions in it.';

describe('antigravity runner', () => {
  it('runs agy in auto mode with json output and model', () => {
    // Arrange
    const spec: CommandSpec = {
      promptFile: '.cell/build/prompt.md',
      model: 'gemini-3',
      permission: 'write',
    };

    // Act
    const argv = antigravityRunner.buildCommand(spec);

    // Assert
    expect(argv).toEqual([
      'agy',
      '--mode',
      'auto',
      '--dangerously-skip-permissions',
      '--output-format',
      'json',
      '--model',
      'gemini-3',
      '-p',
      PROMPT,
    ]);
  });

  it('is installed when agy is on PATH', async () => {
    // Arrange
    const probe = async (binary: string) => binary === 'agy';

    // Act
    const installed = await antigravityRunner.checkInstalled(probe);

    // Assert
    expect(installed).toBe(true);
  });
});
