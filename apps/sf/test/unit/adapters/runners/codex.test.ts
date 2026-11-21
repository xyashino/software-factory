import { describe, expect, it } from 'vitest';
import type { CommandSpec } from '../../../../src/adapters/runners/runner';
import { codexRunner } from '../../../../src/adapters/runners/codex';

const PROMPT = 'Read .cell/build/prompt.md and follow the instructions in it.';

describe('codex runner', () => {
  it('runs exec with bypassed approvals, json output and model', () => {
    // Arrange
    const spec: CommandSpec = {
      promptFile: '.cell/build/prompt.md',
      model: 'gpt-5',
      permission: 'write',
    };

    // Act
    const argv = codexRunner.buildCommand(spec);

    // Assert
    expect(argv).toEqual([
      'codex',
      'exec',
      '--dangerously-bypass-approvals-and-sandbox',
      '--json',
      '-m',
      'gpt-5',
      PROMPT,
    ]);
  });

  it('runs read-only with approvals off before exec in read mode', () => {
    // Arrange
    const spec: CommandSpec = {
      promptFile: '.cell/build/prompt.md',
      permission: 'read',
    };

    // Act
    const argv = codexRunner.buildCommand(spec);

    // Assert
    expect(argv).toEqual([
      'codex',
      '--ask-for-approval',
      'never',
      'exec',
      '--sandbox',
      'read-only',
      '--json',
      PROMPT,
    ]);
  });

  it('is missing when its binary is not on PATH', async () => {
    // Arrange
    const probe = async () => false;

    // Act
    const installed = await codexRunner.checkInstalled(probe);

    // Assert
    expect(installed).toBe(false);
  });
});
