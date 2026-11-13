import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDefinitions } from '../load';
import { nitpickCatalog } from '../nitpick-catalog';

const PACKAGE_ROOT = join(import.meta.dirname, '..', '..', '..');
const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');

describe('shipped definitions', () => {
  const result = loadDefinitions(PACKAGE_ROOT);

  it('load without errors', () => {
    expect(result.ok ? [] : result.error).toEqual([]);
  });

  it('ship five roles, three workflows and eleven templates', () => {
    if (!result.ok) {
      throw new Error('shipped definitions are invalid');
    }
    expect([...result.value.roles.keys()].sort()).toEqual([
      'doctor',
      'operator',
      'plan-reviewer',
      'planner',
      'worker',
    ]);
    expect([...result.value.workflows.keys()].sort()).toEqual([
      'fast',
      'feature',
      'standard',
    ]);
    expect(result.value.templates.size).toBe(11);
  });

  it('give every shipped workflow an operator pool entry', () => {
    if (!result.ok) {
      throw new Error('shipped definitions are invalid');
    }
    for (const workflow of result.value.workflows.values()) {
      expect(workflow.operator?.role).toBe('operator');
    }
  });

  it('sync the repo root from origin/main before the worktree', () => {
    if (!result.ok) {
      throw new Error('shipped definitions are invalid');
    }
    for (const workflow of result.value.workflows.values()) {
      expect(workflow.sync?.exec).toEqual([
        'git fetch origin',
        'git reset --hard origin/main',
      ]);
      expect(workflow.sync?.timeoutMs).toBe(120_000);
    }
  });

  it('keep runner and model out of every role', () => {
    if (!result.ok) {
      throw new Error('shipped definitions are invalid');
    }
    for (const role of result.value.roles.values()) {
      expect(role.body).not.toMatch(/\brunner\b|\bmodel\b/i);
    }
  });

  it('declare their rules and skills', () => {
    if (!result.ok) {
      throw new Error('shipped definitions are invalid');
    }
    const declared = (id: string) => {
      const role = result.value.roles.get(id);
      return [role?.rules, role?.skills];
    };
    const judge = [['rich-commit', 'decision-log'], ['evidence']];
    const worker = [['rich-commit', 'decision-log', 'testing'], ['evidence']];
    expect(declared('doctor')).toEqual(judge);
    expect(declared('worker')).toEqual(worker);
  });

  it('find every declared rule and skill in .nitpick', async () => {
    const catalog = await nitpickCatalog(REPO_ROOT);
    const checked = loadDefinitions(PACKAGE_ROOT, catalog);
    expect(checked.ok ? [] : checked.error).toEqual([]);
  });
});
