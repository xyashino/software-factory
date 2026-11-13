import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDefinitions } from '../../definitions/load';
import type { Definitions, Role } from '../../definitions/types';
import { buildPrompt } from '../build-prompt';
import { PACKAGE_ROOT_FOR_TESTS } from './package-root';

const defs = loadDefinitions(PACKAGE_ROOT_FOR_TESTS);
if (!defs.ok) throw new Error('shipped definitions must load');
const shipped: Definitions = defs.value;

const role = (id: string): Role => {
  const found = shipped.roles.get(id);
  if (found === undefined) throw new Error(`no role ${id}`);
  return found;
};

const base = {
  templates: shipped.templates,
  taskId: 'task-1',
  attemptId: 'att-1',
  todoBody: 'x',
  context: { inputs: [], notes: [], feedback: undefined },
  artifacts: { report: '/e/report.md', commit: '/e/commit.txt' },
  evidenceDir: '/e',
  budget: undefined,
  cliCommands: ['- `sf done`: finish the step'],
};

describe('buildPrompt', () => {
  it('renders the role body with ids, artifact paths and the CLI guide', () => {
    const prompt = buildPrompt({
      role: role('worker'),
      templates: shipped.templates,
      taskId: 'task-1',
      attemptId: 'att-1',
      todoBody: 'Add a hello script.',
      context: { inputs: [], notes: [], feedback: undefined },
      artifacts: {
        report: '/evidence/report.md',
        commit: '/evidence/commit.txt',
      },
      evidenceDir: '/evidence',
      budget: undefined,
      cliCommands: ['- `sf done`: finish the step'],
    });
    expect(prompt).toContain('task task-1, attempt att-1');
    expect(prompt).toContain('Add a hello script.');
    expect(prompt).toContain('/evidence/report.md');
    expect(prompt).toContain('/evidence/commit.txt');
    expect(prompt).toContain('## sf commands');
    expect(prompt).toContain('`sf done`: finish the step');
    expect(prompt).not.toContain('{{');
  });

  it('lists declared rules and skills before the CLI guide', () => {
    const prompt = buildPrompt({
      ...base,
      role: {
        ...role('worker'),
        rules: ['rich-commit'],
        skills: ['evidence'],
      },
    });
    expect(prompt).toContain('- rich-commit: .nitpick/config.ts');
    expect(prompt).toContain('- evidence: .nitpick/skills/evidence/SKILL.md');
    expect(prompt).not.toContain('.agents');
    expect(prompt.indexOf('## Skills')).toBeLessThan(
      prompt.indexOf('## sf commands'),
    );
  });

  it('adds no rules or skills block when the role declares none', () => {
    const prompt = buildPrompt({
      ...base,
      role: { ...role('worker'), rules: [], skills: [] },
    });
    expect(prompt).not.toContain('## Rules');
    expect(prompt).not.toContain('## Skills');
    expect(prompt).not.toContain('{{');
  });

  it('inlines gate feedback with its failing command and tail', () => {
    const prompt = buildPrompt({
      role: role('worker'),
      templates: shipped.templates,
      taskId: 'task-1',
      attemptId: 'att-2',
      todoBody: 'x',
      context: {
        notes: [],
        inputs: [],
        feedback: {
          kind: 'gate',
          fromAttempt: 'att-1',
          failures: [
            {
              command: 'pnpm test',
              exitCode: 1,
              timedOut: false,
              tail: 'expected 2 got 3',
              logPath: '/evidence/att-1/2.log',
            },
          ],
        },
      },
      artifacts: { report: '/r', commit: '/c' },
      evidenceDir: '/evidence',
      budget: { retry: 1, max: 3 },
      cliCommands: [],
    });
    expect(prompt).toContain('`pnpm test` (exit 1)');
    expect(prompt).toContain('expected 2 got 3');
    expect(prompt).toContain('gate retry 1/3');
  });

  it('tells the doctor the gate passed, with its commands, and forbids re-running them', () => {
    const prompt = buildPrompt({
      role: role('doctor'),
      templates: shipped.templates,
      taskId: 'task-1',
      attemptId: 'att-3',
      todoBody: 'x',
      context: {
        notes: [],
        feedback: undefined,
        inputs: [
          {
            kind: 'gate',
            stepId: 'quality-gate',
            attemptId: 'quality-gate-1',
            commands: ['pnpm check-types', 'pnpm test'],
          },
        ],
      },
      artifacts: { feedback: '/f' },
      evidenceDir: '/evidence',
      budget: undefined,
      cliCommands: [],
    });
    expect(prompt).toContain('`quality-gate` passed (attempt quality-gate-1)');
    expect(prompt).toContain('- `pnpm check-types`');
    expect(prompt).toContain('- `pnpm test`');
    expect(prompt).toContain('Do not re-run these commands');
    expect(prompt).toContain('Run no commands.');
  });

  it('renders nothing for a gate that has not passed', () => {
    const prompt = buildPrompt({
      role: role('doctor'),
      templates: shipped.templates,
      taskId: 'task-1',
      attemptId: 'att-3',
      todoBody: 'x',
      context: {
        notes: [],
        feedback: undefined,
        inputs: [
          {
            kind: 'gate',
            stepId: 'quality-gate',
            attemptId: undefined,
            commands: ['pnpm test'],
          },
        ],
      },
      artifacts: { feedback: '/f' },
      evidenceDir: '/evidence',
      budget: undefined,
      cliCommands: [],
    });
    expect(prompt).not.toContain('Gate result:');
  });

  it('reads inline input artifacts from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sf-prompt-'));
    const plan = join(dir, 'plan.md');
    writeFileSync(plan, 'THE PLAN BODY');
    const prompt = buildPrompt({
      role: role('worker'),
      templates: shipped.templates,
      taskId: 'task-1',
      attemptId: 'att-3',
      todoBody: 'x',
      context: {
        notes: [],
        inputs: [
          {
            kind: 'artifact',
            stepId: 'plan',
            artifactKey: 'plan',
            attemptId: 'att-0',
            path: plan,
          },
        ],
        feedback: undefined,
      },
      artifacts: { report: '/r', commit: '/c' },
      evidenceDir: dir,
      budget: undefined,
      cliCommands: [],
    });
    expect(prompt).toContain('## Input: plan.plan');
    expect(prompt).toContain('THE PLAN BODY');
  });

  it('renders notes from earlier steps and the extra incident sections', () => {
    const prompt = buildPrompt({
      role: role('worker'),
      templates: shipped.templates,
      taskId: 'task-1',
      attemptId: 'att-4',
      todoBody: 'x',
      context: {
        notes: [{ fromStep: 'plan', text: 'use the cache' }],
        inputs: [],
        feedback: undefined,
      },
      artifacts: { report: '/r', commit: '/c' },
      evidenceDir: '/evidence',
      budget: undefined,
      cliCommands: [],
      extraContext: ['## Incident\n\nboom'],
    });
    expect(prompt).toContain('Note from step `plan`');
    expect(prompt).toContain('use the cache');
    expect(prompt.indexOf('use the cache')).toBeLessThan(
      prompt.indexOf('## Incident'),
    );
    expect(prompt).not.toContain('{{');
  });
});
