import { describe, expect, it } from 'vitest';
import { PR_ADR_TOKEN } from '@repo/factory-core/contracts/job';
import type { BlobRef, CommitSha } from '@repo/factory-core/ids';
import type { WorkOrderState } from '@repo/factory-core/order/state';
import { fakeBlobStore } from '@repo/factory-core/testing';
import { buildJob, storeText } from '../job-builder';
import {
  artifactBlob,
  extractObjective,
  formatPrBody,
  usableCommitMessage,
  verificationLines,
} from '../pr-body';
import { DEFAULT_CONFIG } from '../ports';
import { PROJECT, REPO, shippedDefinitions } from './test-kit';

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

  it('checks every Inspection command and Operator station of the Line', () => {
    const line = shippedDefinitions().lines.get('standard')!.line;

    const lines = verificationLines(line);

    expect(lines).toContain('- [x] `pnpm lint`');
    expect(lines).toContain('- [x] Operator station `build` (builder)');
    expect(lines.every((item) => item.startsWith('- [x] '))).toBe(true);
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

describe('deliver job', () => {
  const deliverState = async (
    blobs: ReturnType<typeof fakeBlobStore>,
    commitText?: string,
  ): Promise<WorkOrderState> => {
    const artifacts: Record<string, BlobRef> = {};
    if (commitText !== undefined) {
      artifacts.commit = await storeText(blobs, commitText, 'text/plain');
    }
    artifacts.report = await storeText(blobs, '- did it', 'text/markdown');
    return {
      orderId: `${PROJECT}:add-login`,
      projectId: PROJECT,
      todoId: 'add-login',
      baseBranch: 'main',
      dependsOn: [],
      line: { name: 'standard' },
      spec: {
        title: 'add-login: Add login',
        type: 'feat',
        bodyBlob: await storeText(blobs, TODO_BODY, 'text/markdown'),
      },
      activeJob: { jobId: '01J0000000000000000000000J', epoch: 4 },
      cycles: [{ stationId: 'build', status: 'passed', artifacts }],
    } as unknown as WorkOrderState;
  };

  const build = async (commitText?: string) => {
    const blobs = fakeBlobStore();
    const ports = {
      blobs,
      definitions: shippedDefinitions(),
      config: DEFAULT_CONFIG,
    };
    const job = await buildJob(
      ports,
      await deliverState(blobs, commitText),
      {
        projectId: PROJECT,
        repoUrl: REPO,
        baseBranch: 'main',
        maxRunning: 2,
        depPolicy: 'delivered',
      },
      { kind: 'deliver', base: 'a'.repeat(40) as CommitSha },
    );
    const body = new TextDecoder().decode(
      await blobs.get(job.deliver!.bodyBlob),
    );
    return { job, body };
  };

  it("takes the title and commit from the builder's commit artifact", async () => {
    const { job, body } = await build(COMMIT);

    expect(job.deliver?.commitMessage).toBe(COMMIT);
    expect(job.deliver?.title).toBe('feat(factory): add SSO login');
    expect(body).toContain('## 🎯 Summary');
    expect(body).toContain('- Wire the SSO callback');
    expect(body).toContain('- did it');
  });

  it('falls back to a generated commit when the builder wrote none', async () => {
    const { job } = await build();

    expect(job.deliver?.title).toBe('feat(factory): Add login');
    expect(job.deliver?.commitMessage).toContain(
      'Deliver the Work order for todo add-login',
    );
  });
});
