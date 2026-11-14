import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import {
  orderIdOf,
  type BlobRef,
  type CellId,
  type ProjectId,
  type TodoId,
} from '@repo/factory-core/ids';
import type { OrderCommand } from '@repo/factory-core/order/commands';
import { canonicalJson } from '@repo/factory-definitions/line-snapshot';
import {
  openRuntime,
  type OpenedRuntime,
} from '@repo/factory-runtime/open-runtime';
import { seedProject } from '@repo/factory-runtime/seed';

/**
 * Test fixture for the CLI's integration tests: seeds a data directory before a server starts.
 * It creates project `software-factory`, two Work orders on the `feature` Line, and a Cell that
 * has claimed the first order, started its Cycle and asked a question. Run as
 * `bun seed-order.ts <dataDir>`; it prints the ids as one JSON line and exits.
 *
 * The runtime is opened here because the CLI never does (STRUCTURE §3); a test that needs data
 * spawns this file instead of importing the runtime.
 */
export const PROJECT = 'software-factory' as ProjectId;
export const CELL = '01J0000000000000000000000W';
export const ANSWERABLE = `${PROJECT}:todo-a`;
export const PLAIN = `${PROJECT}:todo-b`;

const sha256Ref = (text: string): BlobRef =>
  `sha256:${createHash('sha256').update(text).digest('hex')}` as BlobRef;

const createOrder = async (
  opened: OpenedRuntime,
  todoId: string,
): Promise<void> => {
  const loaded = opened.ports.definitions.lines.get('feature');
  if (!loaded) throw new Error('the feature Line does not load');
  const body = `Body of ${todoId}`;
  const bodyBlob = sha256Ref(body);
  await opened.ports.blobs.put(
    bodyBlob,
    new TextEncoder().encode(body),
    'text/markdown',
  );
  // The snapshot blob is the canonical JSON of the Line, so its ref is the Line hash (STORAGE §2).
  const { hash, ...snapshotBody } = loaded.snapshot;
  const snapshotBlob = hash as BlobRef;
  await opened.ports.blobs.put(
    snapshotBlob,
    new TextEncoder().encode(canonicalJson(snapshotBody)),
    'application/json',
  );
  const command: OrderCommand = {
    type: 'CreateOrder',
    projectId: PROJECT,
    todoId: todoId as TodoId,
    spec: {
      title: `Title ${todoId}`,
      type: 'feat',
      bodyBlob,
      contentHash: bodyBlob,
    },
    priority: 'medium',
    dependsOn: [],
    line: {
      name: loaded.snapshot.name,
      hash: loaded.snapshot.hash,
      snapshotBlob,
      snapshot: loaded.snapshot,
    },
    baseBranch: 'main',
  };
  await opened.runtime.commands.submit({
    orderId: orderIdOf(PROJECT, todoId as TodoId),
    commandId: `create-${todoId}`,
    command,
    actor: { kind: 'factory' },
  });
};

/**
 * Seeds the directory. With `plain`, only the two orders are created: no Cell, no Cycle, so every
 * blob the events cite is stored and the export archive is complete.
 */
const seed = async (
  dataDir: string,
  plain: boolean,
): Promise<{ questionId: string | null }> => {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  seedProject(dataDir, {
    projectId: PROJECT,
    repoUrl: 'https://example.test/sf.git',
  });
  const opened = openRuntime({ dataDir });
  try {
    await createOrder(opened, 'todo-a');
    await createOrder(opened, 'todo-b');
    if (plain) return { questionId: null };
    const runtime = opened.runtime;
    await runtime.call('hello', {
      cellId: CELL as CellId,
      version: '0.1.0',
      projects: [PROJECT],
      runners: ['claude'],
      capabilities: [],
      slots: 1,
    });
    const claimed = await runtime.call('claim', {
      cellId: CELL as CellId,
      waitMs: 0,
    });
    const job = claimed.job;
    if (!job) throw new Error('no job was claimed');
    const started = await runtime.call('submitCommand', {
      cellId: CELL as CellId,
      orderId: job.orderId,
      commandId: 'seed-start',
      epoch: job.epoch,
      command: { type: 'StartCycle', baseCommit: 'a'.repeat(40) as never },
    });
    const cycle = started.events.find(
      (event) => event.type === 'cycle_started',
    );
    if (!cycle || cycle.type !== 'cycle_started')
      throw new Error('no cycle started');
    const asked = await runtime.call('submitCommand', {
      cellId: CELL as CellId,
      orderId: job.orderId,
      commandId: 'seed-ask',
      epoch: job.epoch,
      command: {
        type: 'AskQuestion',
        cycleId: cycle.cycleId,
        text: 'Which branch?',
      },
    });
    const question = asked.events.find(
      (event) => event.type === 'question_asked',
    );
    if (!question || question.type !== 'question_asked') {
      throw new Error('no question asked');
    }
    return { questionId: question.questionId };
  } finally {
    opened.close();
  }
};

if (import.meta.main) {
  const dataDir = process.argv[2];
  if (!dataDir) throw new Error('usage: seed-order.ts <dataDir> [--plain]');
  const { questionId } = await seed(dataDir, process.argv.includes('--plain'));
  console.log(
    JSON.stringify({ answerable: ANSWERABLE, plain: PLAIN, questionId }),
  );
}
