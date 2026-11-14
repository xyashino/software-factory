import { describe, expect, it } from 'vitest';
import {
  fillPrompt,
  typedFor,
  type RuntimePromptSet,
} from '../../cycle/signals';

const prompts: RuntimePromptSet = {
  answer: 'The Supervisor answered: {{text}}',
  nudge: 'Note from the Supervisor: {{text}}',
  idleReminder: 'Continue your work.',
  silentReminder: 'Are you still there?',
  handoverRequest: 'Write your Handover and run factory-operator block.',
};

describe('signals', () => {
  it('types an answer through the answer prompt, with the text filled in', () => {
    expect(
      typedFor(
        {
          signalId: 's1',
          jobId: '01J0000000000000000000000J' as never,
          kind: 'answer',
          questionId: '01J0000000000000000000000Q' as never,
          text: 'use JWT',
        },
        prompts,
      ),
    ).toBe('The Supervisor answered: use JWT');
  });

  it('types a nudge through the nudge prompt', () => {
    expect(
      typedFor(
        {
          signalId: 's2',
          jobId: '01J0000000000000000000000J' as never,
          kind: 'nudge',
          text: 'stop reading',
        },
        prompts,
      ),
    ).toBe('Note from the Supervisor: stop reading');
  });

  it('leaves an unknown placeholder as written rather than typing a hole', () => {
    expect(fillPrompt('hello {{name}} and {{text}}', { text: 'x' })).toBe(
      'hello {{name}} and x',
    );
  });
});
