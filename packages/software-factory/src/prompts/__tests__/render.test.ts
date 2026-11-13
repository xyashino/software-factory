import { describe, expect, it } from 'vitest';
import {
  MissingVariableError,
  renderTemplate,
  templateVariables,
} from '../render';

describe('renderTemplate', () => {
  it('replaces every placeholder with its value', () => {
    expect(
      renderTemplate('Task {{taskId}}: {{todoBody}}', {
        taskId: 't1',
        todoBody: 'x',
      }),
    ).toBe('Task t1: x');
  });

  it('throws MissingVariableError for a placeholder without a value', () => {
    expect(() => renderTemplate('Hi {{name}}', {})).toThrow(
      MissingVariableError,
    );
    expect(() => renderTemplate('Hi {{name}}', {})).toThrow(
      'missing template variable {{name}}',
    );
  });

  it('does not expand placeholders found inside a value', () => {
    expect(renderTemplate('{{a}}', { a: '{{b}}', b: 'no' })).toBe('{{b}}');
  });

  it('leaves text that is not a placeholder untouched', () => {
    expect(renderTemplate('{{ spaced }} and {single}', {})).toBe(
      '{{ spaced }} and {single}',
    );
  });
});

describe('templateVariables', () => {
  it('lists each placeholder once, in order of first appearance', () => {
    expect(templateVariables('{{b}} {{a}} {{b}} {{c_1}}')).toEqual([
      'b',
      'a',
      'c_1',
    ]);
  });

  it('returns an empty list when there are no placeholders', () => {
    expect(templateVariables('plain text')).toEqual([]);
  });
});
