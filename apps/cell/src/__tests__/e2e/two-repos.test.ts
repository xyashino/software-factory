import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Job } from '@repo/factory-core/contracts/job';
import type { LineSnapshot } from '@repo/factory-core/line/snapshot';
import type {
  BlobRef,
  CellId,
  ProjectId,
  TodoId,
} from '@repo/factory-core/ids';
import { orderIdOf } from '@repo/factory-core/ids';
import {
  openRuntime,
  type OpenedRuntime,
} from '@repo/factory-runtime/open-runtime';
import { seedProject, shippedLine } from '@repo/factory-runtime/seed';
import {
  PROMPT_CONFIG,
  renderDelivery,
  renderOperatorPrompt,
} from '../../jobs/render';
import { factoryFiles } from '../../testing/factory-fixture';
import { makeRepo } from '../../testing/git-repo';

/**
 * Two repositories with distinct `.factory/` configurations run against one factory-server (passive-server-03):
 * each Work order is created through the task API with a pinned Line, claimed, and rendered by the Cell from its
 * own repo. The server holds neither repo's templates, operators or PR body: its job payloads carry none of them.
 */

const ALPHA = 'alpha-service' as ProjectId;
const BRAVO = 'bravo-service' as ProjectId;
const ALPHA_CELL = '01J0000000000000000000000A' as CellId;
const BRAVO_CELL = '01J0000000000000000000000B' as CellId;
const TASK_BLOB = `sha256:${'1'.repeat(64)}` as BlobRef;

let root: string;
let opened: OpenedRuntime;
let alphaRepo: string;
let bravoRepo: string;

/** The shipped `.factory/` with one marker in the Operator profile and one in the PR body. */
const withMarker = (
  files: Record<string, string>,
  marker: string,
): Record<string, string> => ({
  ...files,
  '.factory/operators/builder.md': `${files['.factory/operators/builder.md'] ?? ''}\nPROFILE-${marker}\n`,
  '.factory/templates/pr/body.md': `${files['.factory/templates/pr/body.md'] ?? ''}\nPR-${marker}\n`,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cell-two-repos-'));
  alphaRepo = join(root, 'alpha');
  bravoRepo = join(root, 'bravo');
  makeRepo(alphaRepo, {
    'README.md': '# alpha\n',
    ...withMarker(factoryFiles(), 'ALPHA'),
  });
  makeRepo(bravoRepo, {
    'README.md': '# bravo\n',
    ...withMarker(factoryFiles(), 'BRAVO'),
  });
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  seedProject(dataDir, { projectId: ALPHA, repoUrl: alphaRepo });
  seedProject(dataDir, { projectId: BRAVO, repoUrl: bravoRepo });
  opened = openRuntime({ dataDir });
});

afterEach(() => {
  opened.close();
  rmSync(root, { recursive: true, force: true });
});

/** The shipped `standard` Line, as a caller pins it: the repository's own `.factory/lines/standard.yml`. */
const standardLine = (): LineSnapshot => shippedLine('standard');

/** The blob reader of the runtime, as a Cell downloads its blobs. */
const blobsOf =
  (runtime: OpenedRuntime['runtime']) =>
  async (ref: BlobRef): Promise<Uint8Array> => {
    const answer = await runtime.call('blobGet', { ref });
    return Buffer.from(answer.base64, 'base64');
  };

describe('two repositories with distinct .factory/ on one factory-server', () => {
  it('renders each Operator prompt from its own repo, and the server payloads carry neither', async () => {
    const { runtime } = opened;
    await runtime.start();
    const line = standardLine();
    for (const [projectId, todoId] of [
      [ALPHA, 'add-a' as TodoId],
      [BRAVO, 'add-b' as TodoId],
    ] as const) {
      await runtime.call('createOrder', {
        commandId: `create-${todoId}`,
        projectId,
        todoId,
        title: `Add ${todoId}`,
        type: 'feat',
        body: `# Add ${todoId}\n\nThe ${todoId} task.\n`,
        line,
        priority: 'medium',
        dependsOn: [],
      });
    }
    for (const [cellId, project] of [
      [ALPHA_CELL, ALPHA],
      [BRAVO_CELL, BRAVO],
    ] as const) {
      await runtime.call('hello', {
        cellId,
        version: 'test',
        projects: [project],
        runners: ['claude'],
        capabilities: [],
        slots: 1,
      });
    }
    const alphaJob = (
      await runtime.call('claim', { cellId: ALPHA_CELL, waitMs: 0 })
    ).job as Job;
    const bravoJob = (
      await runtime.call('claim', { cellId: BRAVO_CELL, waitMs: 0 })
    ).job as Job;
    expect(alphaJob.orderId).toBe(orderIdOf(ALPHA, 'add-a' as TodoId));
    expect(bravoJob.orderId).toBe(orderIdOf(BRAVO, 'add-b' as TodoId));

    const alphaPrompt = await renderOperatorPrompt({
      job: alphaJob,
      worktree: alphaRepo,
      blobs: blobsOf(runtime),
      config: PROMPT_CONFIG,
    });
    const bravoPrompt = await renderOperatorPrompt({
      job: bravoJob,
      worktree: bravoRepo,
      blobs: blobsOf(runtime),
      config: PROMPT_CONFIG,
    });

    expect(alphaPrompt).toContain('PROFILE-ALPHA');
    expect(alphaPrompt).not.toContain('PROFILE-BRAVO');
    expect(bravoPrompt).toContain('PROFILE-BRAVO');
    expect(bravoPrompt).not.toContain('PROFILE-ALPHA');
    expect(alphaPrompt).toContain('The add-a task.');
    expect(bravoPrompt).toContain('The add-b task.');
    const payloads = JSON.stringify([alphaJob, bravoJob]);
    expect(payloads).not.toContain('PROFILE-');
    expect(payloads).not.toContain('PR-ALPHA');
    expect(payloads).not.toContain('PR-BRAVO');
  });

  it('renders each PR body from its own repo template', async () => {
    const taskText = new TextEncoder().encode('The task.\n');
    const bodyFor = (worktree: string) =>
      renderDelivery({
        deliver: {
          taskId: 'add-a',
          type: 'feat',
          title: 'Add a',
          todoBodyBlob: TASK_BLOB,
          logCommand: 'factory log alpha-service:add-a',
          verification: [],
        },
        worktree,
        blobs: async () => taskText,
      }).then((rendered) => rendered.body);

    const alpha = await bodyFor(alphaRepo);
    const bravo = await bodyFor(bravoRepo);

    expect(alpha).toContain('PR-ALPHA');
    expect(alpha).not.toContain('PR-BRAVO');
    expect(bravo).toContain('PR-BRAVO');
    expect(bravo).not.toContain('PR-ALPHA');
  });

  it('fails a render cleanly when the repo has no .factory/', async () => {
    const bare = join(root, 'no-factory');
    mkdirSync(bare);

    await expect(
      renderDelivery({
        deliver: {
          taskId: 'add-a',
          type: 'feat',
          title: 'Add a',
          todoBodyBlob: TASK_BLOB,
          logCommand: 'factory log alpha-service:add-a',
          verification: [],
        },
        worktree: bare,
        blobs: async () => new Uint8Array(),
      }),
    ).rejects.toThrow(/invalid \.factory\//);
  });
});
