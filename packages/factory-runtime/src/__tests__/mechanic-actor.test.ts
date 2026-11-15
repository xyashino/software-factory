import { describe, expect, it } from 'vitest';
import type { CellId, CommitSha, JobId } from '@repo/factory-core/ids';
import type { OrderCommand } from '@repo/factory-core/order/commands';
import type { WorkOrderState } from '@repo/factory-core/order/state';
import { fakeBlobStore } from '@repo/factory-core/testing';
import { buildJob, storeText } from '../job-builder';
import { actorOfCellCommand } from '../operations';
import { DEFAULT_CONFIG } from '../ports';
import { buildIncidentPrompt } from '../prompts/incident-prompt';
import { PROJECT, REPO, shippedDefinitions } from './test-kit';

const CELL = 'cell-a' as CellId;

describe('the actor a Cell command runs as (CORE §14.3)', () => {
  it('runs the incident and the Mechanic follow-ups as the Mechanic', () => {
    const commands: OrderCommand[] = [
      {
        type: 'RecordIncident',
        diagnosis: 'the pane was blocked',
        action: { kind: 'resume' },
        changes: [],
        outcome: 'resumed',
      },
      { type: 'Resume', mode: { kind: 'retry_station' } },
      { type: 'Cancel', reason: 'not recoverable' },
      { type: 'Nudge', text: 'continue' },
    ];
    for (const command of commands) {
      expect(actorOfCellCommand(CELL, command)).toEqual({
        kind: 'mechanic',
        name: 'mechanic',
      });
    }
  });

  it("keeps every other Cell command the Cell's own", () => {
    expect(
      actorOfCellCommand(CELL, { type: 'ClaimJob', cellId: CELL }),
    ).toEqual({ kind: 'cell', cellId: CELL });
  });
});

describe('Mechanic job builder & prompt', () => {
  it('builds a mechanic job with workspace, checkpoint base, and write permission', async () => {
    const blobs = fakeBlobStore();
    const defs = shippedDefinitions();
    const line = defs.lines.get('standard')!.snapshot;
    const commit = 'b'.repeat(40) as CommitSha;
    const state = {
      orderId: `${PROJECT}:fix-ci`,
      projectId: PROJECT,
      todoId: 'fix-ci',
      baseBranch: 'main',
      dependsOn: [],
      line,
      spec: {
        title: 'fix-ci: Fix CI',
        type: 'fix',
        bodyBlob: await storeText(blobs, '# Fix CI', 'text/markdown'),
      },
      activeJob: { jobId: '01J0000000000000000000000M' as JobId, epoch: 5 },
      andon: {
        reason: 'delivery_failed',
        detail: 'pre-commit failed',
        at: 2000,
      },
      checkpoint: { commit, afterStation: 'audit' },
      cycles: [],
    } as unknown as WorkOrderState;

    const job = await buildJob(
      {
        blobs,
        runtimePrompts: defs.runtimePrompts,
        config: DEFAULT_CONFIG,
      },
      state,
      {
        projectId: PROJECT,
        repoUrl: REPO,
        baseBranch: 'main',
        maxRunning: 2,
        depPolicy: 'delivered',
      },
      { kind: 'mechanic', andonAt: 2000, n: 1 },
    );

    expect(job.workspace).toBeDefined();
    expect(job.workspace?.dir).toBe('fix-ci');
    expect(job.base).toBe(commit);
    expect(job.mechanic?.operator.permission).toBe('write');
    expect(job.mechanic?.operator.headless).toBe(false);
    expect(job.mechanic?.incident).toEqual({
      reason: 'delivery_failed',
      detail: 'pre-commit failed',
    });
    const prompt = buildIncidentPrompt(job.mechanic!.incident);
    expect(prompt).toContain('--action repair');
    expect(prompt).toContain('git worktree at its current commit');
  });

  it('buildIncidentPrompt tells the Mechanic it can edit files in the worktree', () => {
    const text = buildIncidentPrompt({
      reason: 'delivery_failed',
      detail: 'tests failed',
    });
    expect(text).toContain('fix the code, tests, config, or');
    expect(text).not.toContain('may not edit');
  });
});
