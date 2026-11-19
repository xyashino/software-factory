import { describe, expect, it } from 'vitest';
import { renderOperatorPrompt } from '../../../src/domain/cell/render-prompt';

const PROFILE = [
  '---',
  'id: planner',
  'rules: [coding]',
  'skills: [caveman]',
  'artifacts:',
  '  plan: plan.md',
  '---',
  '',
  'Task {{taskId}}, attempt {{attemptId}}.',
  'Write {{path}}{{plan}}, then run `factory-operator done`.',
].join('\n');

describe('operator prompt', () => {
  it('fills the profile and appends the task', () => {
    // Arrange & Act
    const prompt = renderOperatorPrompt({
      profileText: PROFILE,
      taskId: 'add-root-readme',
      attemptId: 'job-1',
      stepId: 'step-0',
      title: 'Write the root README',
      description: 'Rewrite README.md.',
      inputs: [],
      context: null,
    });

    // Assert
    expect(prompt).toContain('Task add-root-readme, attempt job-1.');
    expect(prompt).toContain('Write .cell/step-0/plan.md');
    expect(prompt).toContain('bun apps/factory/src/cli.ts operator done');
    expect(prompt).toContain(
      '## Task\n\n# Write the root README\n\nRewrite README.md.',
    );
  });
});
