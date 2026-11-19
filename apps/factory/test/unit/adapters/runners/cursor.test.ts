import { describe, expect, it } from 'vitest';
import type { CommandSpec } from '../../../../src/adapters/runners/runner';
import { cursorRunner } from '../../../../src/adapters/runners/cursor';

const PROMPT = 'Read .cell/build/prompt.md and follow the instructions in it.';

describe('cursor runner', () => {
  it('runs print mode with force, trust and model when write is allowed', () => {
    // Arrange
    const spec: CommandSpec = {
      promptFile: '.cell/build/prompt.md',
      model: 'sonnet',
      permission: 'write',
    };

    // Act
    const argv = cursorRunner.buildCommand(spec);

    // Assert
    expect(argv).toEqual([
      'cursor-agent',
      '-p',
      '--force',
      '--trust',
      '--approve-mcps',
      '--output-format',
      'json',
      '--model',
      'sonnet',
      PROMPT,
    ]);
  });

  it('plans without edits in read mode', () => {
    // Arrange
    const spec: CommandSpec = {
      promptFile: '.cell/build/prompt.md',
      permission: 'read',
    };

    // Act
    const argv = cursorRunner.buildCommand(spec);

    // Assert
    expect(argv).toEqual([
      'cursor-agent',
      '-p',
      '--mode',
      'plan',
      '--force',
      '--trust',
      '--approve-mcps',
      '--output-format',
      'json',
      PROMPT,
    ]);
  });

  it('is installed when cursor-agent is on PATH', async () => {
    // Arrange
    const probe = async (binary: string) => binary === 'cursor-agent';

    // Act
    const installed = await cursorRunner.checkInstalled(probe);

    // Assert
    expect(installed).toBe(true);
  });
});
