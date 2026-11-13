import { describe, expect, it } from 'vitest';
import { parseOperatorProfile } from '../operator-profile';

const FILE = 'operators/judge.md';

const parse = (extra: string) =>
  parseOperatorProfile(
    { file: FILE, path: `/x/${FILE}` },
    `---\nid: judge\nlabel: Judge\n${extra}artifacts:\n  report: report.md\n---\nBody\n`,
  );

describe('operator profile rules and skills', () => {
  it('parses declared rules and skills', () => {
    const result = parse('rules: [rich-commit, testing]\nskills: [evidence]\n');
    expect(result.ok && result.value.rules).toEqual(['rich-commit', 'testing']);
    expect(result.ok && result.value.skills).toEqual(['evidence']);
  });

  it('defaults both lists to empty', () => {
    const result = parse('');
    expect(result.ok && result.value.rules).toEqual([]);
    expect(result.ok && result.value.skills).toEqual([]);
  });

  it('rejects a rule that is not kebab-case, with the field', () => {
    const result = parse('rules: [Rich_Commit]\n');
    expect(!result.ok && result.error[0]).toMatchObject({
      file: FILE,
      field: 'rules[0]',
    });
    expect(!result.ok && result.error[0]?.message).toContain('kebab-case');
  });

  it('rejects an empty skill id', () => {
    const result = parse('skills: [""]\n');
    expect(!result.ok && result.error[0]?.field).toBe('skills[0]');
  });

  it('rejects a repeated rule', () => {
    const result = parse('rules: [testing, testing]\n');
    expect(!result.ok && result.error[0]?.message).toContain('twice');
  });
});

describe('operator profile file', () => {
  it('rejects a file without frontmatter', () => {
    const result = parseOperatorProfile(
      { file: FILE, path: `/x/${FILE}` },
      'no frontmatter here\n',
    );
    expect(!result.ok && result.error[0]).toMatchObject({
      file: FILE,
      field: 'frontmatter',
    });
  });

  it('reports YAML that does not parse, with the file', () => {
    const result = parseOperatorProfile(
      { file: FILE, path: `/x/${FILE}` },
      '---\nid: [judge\n---\nBody\n',
    );
    expect(!result.ok && result.error[0]).toMatchObject({
      file: FILE,
      field: 'yaml',
    });
  });

  it('rejects an id that differs from the file name', () => {
    const result = parseOperatorProfile(
      { file: FILE, path: `/x/${FILE}` },
      '---\nid: other\nlabel: Other\nartifacts:\n  report: report.md\n---\nBody\n',
    );
    expect(!result.ok && result.error).toContainEqual(
      expect.objectContaining({ field: 'id', file: FILE }),
    );
  });

  it('rejects an unknown template variable in the body', () => {
    const result = parseOperatorProfile(
      { file: FILE, path: `/x/${FILE}` },
      '---\nid: judge\nlabel: Judge\nartifacts:\n  report: report.md\n---\nHi {{nope}}\n',
    );
    expect(!result.ok && result.error).toContainEqual({
      file: FILE,
      field: 'template',
      message: 'unknown variable {{nope}}',
    });
  });

  it('accepts an artifact path variable for a declared artifact', () => {
    const result = parseOperatorProfile(
      { file: FILE, path: `/x/${FILE}` },
      '---\nid: judge\nlabel: Judge\nartifacts:\n  report: report.md\n---\nWrite {{reportPath}}\n',
    );
    expect(result.ok).toBe(true);
  });

  it('requires a judging profile to declare feedback.md', () => {
    const result = parseOperatorProfile(
      { file: FILE, path: `/x/${FILE}` },
      '---\nid: judge\nlabel: Judge\nverdict: true\nartifacts:\n  report: report.md\n---\nBody\n',
    );
    expect(!result.ok && result.error).toContainEqual(
      expect.objectContaining({ field: 'artifacts.feedback', file: FILE }),
    );
  });

  it('reads a judging profile with feedback.md as a verdict', () => {
    const result = parseOperatorProfile(
      { file: FILE, path: `/x/${FILE}` },
      '---\nid: judge\nlabel: Judge\nverdict: true\nartifacts:\n  feedback: feedback.md\n---\nBody\n',
    );
    expect(result.ok && result.value.verdict).toBe(true);
  });
});
