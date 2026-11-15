import { describe, expect, it } from 'vitest';
import { PR_ADR_TOKEN } from '@repo/factory-core/contracts/job';
import type { BlobRef } from '@repo/factory-core/ids';
import type { WorkOrderState } from '@repo/factory-core/order/state';
import {
  artifactBlob,
  extractObjective,
  formatPrBody,
  usableCommitMessage,
  verificationLinesOf,
} from '../pr-body';
import { shippedDefinitions } from './test-kit';

const TODO_BODY = `# add-login: Add login

## Objective

Let people sign in with SSO.

## Deliverables

- A login page
`;

const COMMIT = `feat(factory): add SSO login

- Add the login page
- Wire the SSO callback`;

describe('PR body (v1 format)', () => {
  it('takes the objective section, or the whole body when there is none', () => {
    expect(extractObjective(TODO_BODY)).toBe('Let people sign in with SSO.');
    expect(extractObjective('Just text.')).toBe('Just text.');
  });

  it('accepts a `type(scope): title` commit and refuses anything else', () => {
    expect(usableCommitMessage(`${COMMIT}\n\n`)).toBe(COMMIT);
    expect(usableCommitMessage('add login')).toBeUndefined();
    expect(usableCommitMessage('feat: no scope')).toBeUndefined();
    expect(usableCommitMessage('')).toBeUndefined();
  });

  it('lists every Inspection command and Operator station of the job', () => {
    const lines = verificationLinesOf([
      {
        kind: 'inspection',
        stationId: 'quality-gate',
        commands: ['pnpm lint'],
      },
      { kind: 'operator', stationId: 'build', profile: 'builder' },
    ]);

    expect(lines).toEqual([
      '- [x] `pnpm lint`',
      '- [x] Operator station `build` (builder)',
    ]);
  });

  it('says so when the job names no verification step', () => {
    expect(verificationLinesOf([])).toEqual([
      '_No verification steps in the Line._',
    ]);
  });

  it('renders the template with the changes, the report, and the ADR left for the Cell', () => {
    const body = formatPrBody(
      {
        taskId: 'add-login',
        type: 'feat',
        todoBody: TODO_BODY,
        commitMessage: COMMIT,
        report: '- changed login.ts',
        logCommand: 'factory log software-factory:add-login',
        verification: ['- [x] `pnpm test`'],
      },
      shippedDefinitions().prTemplates,
    );

    expect(body).toContain('## 🎯 Summary');
    expect(body).toContain('Task: `add-login` (feat)');
    expect(body).toContain('Let people sign in with SSO.');
    expect(body).toContain('- Add the login page\n- Wire the SSO callback');
    expect(body).toContain(PR_ADR_TOKEN);
    expect(body).toContain('- [x] `pnpm test`');
    expect(body).toContain(
      'Event log: `factory log software-factory:add-login`',
    );
    expect(body).toContain('- changed login.ts');
    expect(body.endsWith('\n')).toBe(true);
  });

  it('reads an artifact from the latest passed Cycle only', () => {
    const ref = (n: number) => `sha256:${String(n).repeat(64)}` as BlobRef;
    const state = {
      cycles: [
        { stationId: 'build', status: 'passed', artifacts: { commit: ref(1) } },
        { stationId: 'build', status: 'passed', artifacts: { commit: ref(2) } },
        { stationId: 'build', status: 'failed', artifacts: { commit: ref(3) } },
      ],
    } as unknown as Pick<WorkOrderState, 'cycles'>;

    expect(
      artifactBlob(state, { stationId: 'build', artifactKey: 'commit' }),
    ).toBe(ref(2));
  });
});
