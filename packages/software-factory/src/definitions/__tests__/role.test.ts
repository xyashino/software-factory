import { describe, expect, it } from 'vitest';
import { parseRole } from '../role';

const parse = (extra: string) => {
  return parseRole(
    { file: 'roles/judge.md', path: '/x/roles/judge.md' },
    `---\nid: judge\nlabel: Judge\n${extra}artifacts:\n  report: report.md\n---\nBody\n`,
  );
};

describe('role rules and skills', () => {
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

  it('rejects a rule that is not kebab-case', () => {
    const result = parse('rules: [Rich_Commit]\n');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error[0]?.field).toBe('rules[0]');
    expect(!result.ok && result.error[0]?.message).toContain('kebab-case');
  });

  it('rejects an empty skill id', () => {
    const result = parse('skills: [""]\n');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error[0]?.field).toBe('skills[0]');
  });

  it('rejects a repeated rule', () => {
    const result = parse('rules: [testing, testing]\n');
    expect(!result.ok && result.error[0]?.message).toContain('twice');
  });
});
