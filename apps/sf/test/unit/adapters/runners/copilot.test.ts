import { describe, expect, it } from 'vitest';
import type { CommandSpec } from '../../../../src/adapters/runners/runner';
import { copilotRunner } from '../../../../src/adapters/runners/copilot';

const PROMPT = 'Read .cell/build/prompt.md and follow the instructions in it.';

describe('copilot runner', () => {
  it('runs headless with unattended tools and json output when write is allowed', () => {
    // Arrange
    const spec: CommandSpec = {
      promptFile: '.cell/build/prompt.md',
      model: 'gpt-5',
      permission: 'write',
    };

    // Act
    const argv = copilotRunner.buildCommand(spec);

    // Assert
    expect(argv).toEqual([
      'copilot',
      '-p',
      PROMPT,
      '--allow-all-tools',
      '--no-ask-user',
      '--trust-folder',
      '--output-format',
      'json',
      '--model',
      'gpt-5',
    ]);
  });

  it('denies file writes last and omits the model flag in read mode without a model', () => {
    // Arrange
    const spec: CommandSpec = {
      promptFile: '.cell/build/prompt.md',
      permission: 'read',
    };

    // Act
    const argv = copilotRunner.buildCommand(spec);

    // Assert
    expect(argv).toEqual([
      'copilot',
      '-p',
      PROMPT,
      '--allow-all-tools',
      '--no-ask-user',
      '--trust-folder',
      '--output-format',
      'json',
      '--deny-tool',
      'write',
    ]);
  });

  it('has no interactive mode', () => {
    // Arrange
    const runner = copilotRunner;

    // Act
    const interactive = runner.buildInteractive;

    // Assert
    expect(interactive).toBeUndefined();
  });

  it('is installed when its binary is on PATH', async () => {
    // Arrange
    const probe = async (binary: string) => binary === 'copilot';

    // Act
    const installed = await copilotRunner.checkInstalled(probe);

    // Assert
    expect(installed).toBe(true);
  });

  it('is missing when copilot is not on PATH', async () => {
    // Arrange
    const probe = async () => false;

    // Act
    const installed = await copilotRunner.checkInstalled(probe);

    // Assert
    expect(installed).toBe(false);
  });
});
