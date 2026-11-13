import { describe, expect, it } from 'vitest';
import type { Workflow } from '../../definitions/types';
import type { TaskState } from '../../engine/state';
import { verificationFor } from '../execute';

const workflow: Workflow = {
  name: 'feature',
  description: '',
  setup: { timeoutMs: 1000, exec: [] },
  agents: {
    doctor: {
      role: 'doctor',
      runner: 'claude',
      model: 'm',
      timeoutMs: 1,
      headless: false,
      permission: 'write',
    },
  },
  steps: [
    { id: 'build', type: 'agent', agent: 'doctor', inputs: [] },
    {
      id: 'quality-gate',
      type: 'commands',
      exec: ['pnpm test', 'pnpm lint'],
      timeoutMs: 1,
    },
    { id: 'audit', type: 'agent', agent: 'doctor', inputs: [] },
  ],
  deliver: {
    commit: { stepId: 'build', artifactKey: 'commit' },
    report: { stepId: 'build', artifactKey: 'report' },
    to: 'new-pr',
  },
  path: '',
};

const stateWithPassed = (passed: string[]): TaskState => {
  return {
    status: 'running',
    task: undefined,
    setupOk: true,
    cursor: 0,
    attempts: [],
    current: undefined,
    retriesUsed: {},
    pendingFeedback: undefined,
    lastPassed: Object.fromEntries(passed.map((step) => [step, 'a'])),
    openQuestion: undefined,
    notes: [],
    operator: undefined,
    operatorRan: false,
    operatorChecked: false,
    extraRetry: undefined,
    pendingPrompts: [],
    escalation: undefined,
    block: undefined,
    deliveryStarted: false,
    delivered: undefined,
    blockedPr: undefined,
    parked: false,
  };
};

describe('PR verification checklist', () => {
  it('lists every gate command and agent step, checked only once they passed', () => {
    expect(
      verificationFor(workflow, stateWithPassed(['build', 'quality-gate'])),
    ).toEqual([
      { label: 'Agent step `build` (doctor)', passed: true },
      { label: '`pnpm test`', passed: true },
      { label: '`pnpm lint`', passed: true },
      { label: 'Agent step `audit` (doctor)', passed: false },
    ]);
  });

  it('checks nothing when no step has passed', () => {
    expect(
      verificationFor(workflow, stateWithPassed([])).every(
        (item) => !item.passed,
      ),
    ).toBe(true);
  });
});
