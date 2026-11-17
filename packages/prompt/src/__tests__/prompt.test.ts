import { describe, expect, it } from 'vitest';
import { parsePrompt, renderPrompt } from '../prompt';

const file = (frontmatter: string, body: string): string =>
  `---\n${frontmatter}\n---\n${body}`;

const SYNC = file(
  [
    'id: entry',
    'stage: sync',
    'input:',
    '  rules: list',
    '  title: string',
  ].join('\n'),
  '# {{title}}\n\n{{#each rules}}- {{this}}\n{{/each}}',
);

describe('a prompt file', () => {
  it('reads its id, stage and inputs from the frontmatter', () => {
    const prompt = parsePrompt(SYNC);

    expect(prompt.id).toBe('entry');
    expect(prompt.stage).toBe('sync');
    expect(prompt.input).toEqual({ rules: 'list', title: 'string' });
  });

  it('is refused without a frontmatter block', () => {
    expect(() => parsePrompt('# no frontmatter')).toThrow(/frontmatter/);
  });

  it('is refused when the stage is not sync or runtime', () => {
    const source = file('id: x\nstage: build', 'body');

    expect(() => parsePrompt(source)).toThrow(/stage/);
  });

  it('is refused when an input has an unknown type', () => {
    const source = file('id: x\nstage: sync\ninput:\n  n: integer', 'body');

    expect(() => parsePrompt(source)).toThrow(/input\.n/);
  });
});

describe('rendering a prompt', () => {
  it('fills the placeholders and keeps Markdown characters as written', () => {
    const prompt = parsePrompt(SYNC);

    const text = renderPrompt(prompt, {
      inputs: { title: 'Rules & <b>', rules: ['one', 'two'] },
    });

    expect(text).toBe('# Rules & <b>\n\n- one\n- two\n');
  });

  it('calls a helper and includes a partial', () => {
    const prompt = parsePrompt(
      file(
        'id: rules\nstage: sync\ninput:\n  names: list',
        '{{> line}}{{#each names}}{{ref this}}{{/each}}',
      ),
    );

    const text = renderPrompt(prompt, {
      inputs: { names: ['git', 'testing'] },
      partials: { line: 'Rules:' },
      helpers: {
        ref: (id: unknown) => `[${String(id)}](rules/${String(id)}.md)`,
      },
    });

    expect(text).toBe('Rules:[git](rules/git.md)[testing](rules/testing.md)');
  });

  it('is refused when a declared input is missing', () => {
    const prompt = parsePrompt(SYNC);

    expect(() => renderPrompt(prompt, { inputs: { rules: [] } })).toThrow(
      /title/,
    );
  });

  it('is refused when an input has the wrong type', () => {
    const prompt = parsePrompt(SYNC);

    expect(() =>
      renderPrompt(prompt, { inputs: { title: 'x', rules: 'one' } }),
    ).toThrow(/rules/);
  });

  it('is refused when an input is not declared', () => {
    const prompt = parsePrompt(SYNC);

    expect(() =>
      renderPrompt(prompt, { inputs: { title: 'x', rules: [], extra: 1 } }),
    ).toThrow(/extra/);
  });

  it('is refused when the body uses a placeholder the frontmatter does not declare', () => {
    const prompt = parsePrompt(file('id: x\nstage: sync', 'Hi {{name}}'));

    expect(() => renderPrompt(prompt, { inputs: {} })).toThrow(/name/);
  });
});
