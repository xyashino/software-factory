import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The v1 scenario checklist (software-factory `engine/__tests__/scenarios.test.ts`): every v1 test
 * name, copied here, is either ported (a `// v1: "<name>"` comment sits on its v2 test) or not
 * applicable, with the reason in the table. Adding a v1 scenario means adding its row here.
 */
type Row =
  | { name: string; ported: true }
  | { name: string; ported: false; reason: string };

const NOT_APPLICABLE = {
  f1: 'v2 has no on-call operator that escalates to a human. The Andon holder is the Supervisor (CORE §10 I7), and no second operator runs.',
  f2: 'The worktree check that stopped a second operator is a runtime check in the Worker, not core state (CORE §1).',
  keepsBlocked:
    'v2 has no on-call operator attempt. A blocked Cycle holds its Andon until the Supervisor resumes it (CORE §5.3).',
} as const;

const checklist: Row[] = [
  { name: 'delivers after every step passes once, in order', ported: true },
  {
    name: 're-plans after a plan review rejection, then builds once the review passes',
    ported: true,
  },
  {
    name: 'gives the worker a fresh attempt with gate failures after a red gate, then audits',
    ported: true,
  },
  {
    name: 'reruns the build and the gate after an audit rejection, then delivers',
    ported: true,
  },
  {
    name: 'blocks with retries_exhausted when every gate run is red, after four builds',
    ported: true,
  },
  {
    name: 'blocks with retries_exhausted when the audit keeps rejecting, after three builds',
    ported: true,
  },
  {
    name: 'restarts a crashed build from its snapshot and delivers',
    ported: true,
  },
  {
    name: 'blocks with infra when the restarted build crashes again',
    ported: true,
  },
  {
    name: 'starts one more restart after a human unblocks an infra block',
    ported: true,
  },
  { name: 'blocks again once the human extra start is used up', ported: true },
  { name: 'gives the same events and actions on every run', ported: true },
  { name: 'bounds build attempts for any sequence of outcomes', ported: true },
  { name: 'never runs on the happy path of the %s workflow', ported: true },
  {
    name: 'grants one extra retry, then hands the second exhaustion to a human',
    ported: true,
  },
  {
    name: 'hands an incident to a human after the operator escalates, without a second operator (F1)',
    ported: false,
    reason: NOT_APPLICABLE.f1,
  },
  {
    name: 'blocks for a human, not another operator, when the operator changed the worktree (F2)',
    ported: false,
    reason: NOT_APPLICABLE.f2,
  },
  {
    name: 'keeps a task blocked for a human when the operator attempt fails',
    ported: false,
    reason: NOT_APPLICABLE.keepsBlocked,
  },
  {
    name: 'never starts the operator for a question a worker asked a human',
    ported: true,
  },
];

const SCENARIO_FILES = [
  'scenarios.workflow.test.ts',
  'scenarios.operator.test.ts',
  'scenarios.andon.test.ts',
  'invariants.test.ts',
];

const sourceOf = (file: string): string =>
  readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');

describe('the v1 scenario checklist', () => {
  it('lists the 18 v1 scenario names', () => {
    expect(checklist).toHaveLength(18);
  });

  it('gives every name once', () => {
    const names = checklist.map((row) => row.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives a reason for every name that is not ported', () => {
    for (const row of checklist) {
      if (!row.ported) {
        expect(row.reason.length, row.name).toBeGreaterThan(40);
      }
    }
  });

  it('marks a v1 name on the v2 test that ports it', () => {
    const sources = SCENARIO_FILES.map(sourceOf).join('\n');
    for (const row of checklist) {
      if (row.ported) {
        expect(sources, row.name).toContain(`// v1: "${row.name}"`);
      }
    }
  });

  it('ports at most the names it lists: no v1 mark without a row', () => {
    const sources = SCENARIO_FILES.map(sourceOf).join('\n');
    const marks = [...sources.matchAll(/\/\/ v1: "([^"]+)"/g)].map(
      (match) => match[1] ?? '',
    );
    const listed = new Set(checklist.map((row) => row.name));
    for (const mark of marks) {
      expect(listed.has(mark), mark).toBe(true);
    }
  });
});
