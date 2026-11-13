import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDefinitions } from '../load';

const FIXTURE_ROOT = join(import.meta.dirname, 'fixtures', 'valid');

describe('valid definitions', () => {
  const result = loadDefinitions(FIXTURE_ROOT);

  it('load with the expected roles, workflows and templates', () => {
    if (!result.ok) {
      throw new Error(JSON.stringify(result.error));
    }
    expect([...result.value.roles.keys()].sort()).toEqual([
      'doctor',
      'operator',
      'planner',
      'worker',
    ]);
    expect([...result.value.workflows.keys()]).toEqual(['feature']);
    expect(result.value.templates.size).toBe(11);
  });

  it('turn durations into milliseconds and references into typed refs', () => {
    if (!result.ok) {
      throw new Error(JSON.stringify(result.error));
    }
    const workflow = result.value.workflows.get('feature');
    expect(workflow?.setup.timeoutMs).toBe(600_000);
    expect(workflow?.agents.worker).toEqual({
      role: 'worker',
      runner: 'claude',
      model: 'sonnet',
      timeoutMs: 3_600_000,
      headless: false,
      permission: 'write',
    });
    expect(workflow?.agents.doctor).toMatchObject({
      headless: true,
      permission: 'read',
    });
    expect(workflow?.steps[1]).toMatchObject({
      id: 'build',
      inputs: [{ stepId: 'plan', artifactKey: 'plan' }],
    });
    expect(workflow?.steps[2]).toMatchObject({
      id: 'quality-gate',
      timeoutMs: 900_000,
    });
    expect(workflow?.steps[3]).toMatchObject({
      id: 'audit',
      inputs: [
        { stepId: 'plan', artifactKey: 'plan' },
        { stepId: 'build', artifactKey: 'report' },
        { source: 'gate', stepId: 'quality-gate' },
      ],
    });
    expect(workflow?.deliver.to).toBe('new-pr');
  });

  it('read the optional operator pool entry', () => {
    if (!result.ok) {
      throw new Error(JSON.stringify(result.error));
    }
    expect(result.value.workflows.get('feature')?.operator).toEqual({
      role: 'operator',
      runner: 'claude',
      model: 'sonnet',
      timeoutMs: 1_200_000,
      headless: false,
      permission: 'write',
    });
  });

  it('give each role its body', () => {
    if (!result.ok) {
      throw new Error(JSON.stringify(result.error));
    }
    const doctor = result.value.roles.get('doctor');
    expect(doctor?.verdict).toBe(true);
    expect(doctor?.body).toContain('Decision log: Exactly one new entry');
    expect(result.value.roles.get('worker')?.verdict).toBe(false);
  });
});
