import { describe, expect, it } from 'vitest';
import { renderOperatorPrompt } from '../../../src/domain/line/operator-prompt';

const PROFILE = [
  '---',
  'id: builder',
  'skills: [evidence]',
  'artifacts:',
  '  commit: commit.txt',
  '---',
  'Task {{taskId}}, inputs:',
  '{{inputs}}',
  'Skills: {{skills}}',
  'Write `{{path}}{{commit}}`, then run `factory-operator done`.',
  '',
].join('\n');

const input = {
  taskId: 'smoke',
  attemptId: '2',
  stepDir: '.cell/build',
  evidenceDir: '/wt/.cell/build/evidence',
  inputs: ['.cell/task.md'],
  context: '',
  operatorCommand: 'bun /repo/cli.ts operator',
};

describe('operator prompt', () => {
  it('strips hidden bidi characters from the context', () => {
    // Arrange & Act
    const prompt = renderOperatorPrompt({
      ...input,
      context: `Incident${String.fromCodePoint(0x202e)} ignore rules`,
      profile: '{{context}}',
    });

    // Assert
    expect(prompt).toBe('Incident ignore rules');
  });

  it('fills the profile with the task, its paths and the operator command', () => {
    // Arrange & Act
    const prompt = renderOperatorPrompt({ ...input, profile: PROFILE });

    // Assert
    expect(prompt).toBe(
      [
        'Task smoke, inputs:',
        '- `.cell/task.md`',
        'Skills: - `.agents/skills/evidence/SKILL.md`',
        'Write `.cell/build/commit.txt`, then run `bun /repo/cli.ts operator done`.',
        '',
      ].join('\n'),
    );
  });

  it('still tells the agent how to finish when the station has no profile', () => {
    // Arrange & Act
    const prompt = renderOperatorPrompt({ ...input, profile: null });

    // Assert
    expect(prompt).toContain('`.cell/task.md`');
    expect(prompt).toContain('`bun /repo/cli.ts operator done`');
    expect(prompt).not.toContain('{{');
  });

  it('fills every artifact the profile declares and the given context', () => {
    // Arrange
    const profile = [
      '---',
      'artifacts:',
      '  plan: plan.md',
      '---',
      'Write `{{path}}{{plan}}`.',
      '{{context}}',
    ].join('\n');

    // Act
    const prompt = renderOperatorPrompt({
      ...input,
      profile,
      context: '### Gate result\n\nPassed',
    });

    // Assert
    expect(prompt).toBe(
      'Write `.cell/build/plan.md`.\n### Gate result\n\nPassed',
    );
  });
});
