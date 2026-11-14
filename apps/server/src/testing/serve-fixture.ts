/**
 * Test fixture, not a product entry point: `factory-server` over a seeded data directory. The Cell's
 * integration tests spawn it by path, so the Cell never imports the runtime (apps/cell lint).
 *
 * Usage: `bun serve-fixture.ts <dataDir> <repoUrl> [checksJson]`. It seeds one project (`software-factory`,
 * repo `repoUrl`) and one Order `software-factory:todo-1` whose line starts with an inspection
 * (`quality-gate`, the `checksJson` commands, default `["true"]`), then serves the socket like `main.ts`
 * does. The line is written under the data directory, so the shipped definitions stay untouched.
 * Arguments, not environment variables: the turbo lint rule wants every env var declared.
 */
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BlobRef, ProjectId, TodoId } from '@repo/factory-core/ids';
import { orderIdOf } from '@repo/factory-core/ids';
import type { OrderCommand } from '@repo/factory-core/order/commands';
import { openRuntime } from '@repo/factory-runtime/open-runtime';
import { DEFINITIONS_ROOT } from '@repo/factory-runtime/paths';
import { seedProject } from '@repo/factory-runtime/seed';
import { startSocketListener } from '../socket/listener';

const PROJECT = 'software-factory' as ProjectId;
const TODO = 'todo-1' as TodoId;

/** The line the fixture serves: the quality gate first, then a builder the tests never claim. */
const lineYaml = (checks: string[]): string => `schemaVersion: 2
name: inspect
description: Quality gate first (integration fixture)
workspace:
  setup:
    timeout: 2m
    exec:
      - "true"
operators:
  builder:
    profile: builder
    runner: claude
    model: sonnet
    timeout: 10m
    headless: false
    permission: write
stations:
  - id: quality-gate
    kind: inspection
    timeout: 2m
    exec:
${checks.map((check) => `      - ${JSON.stringify(check)}`).join('\n')}
    requires: []
  - id: build
    kind: operator
    operator: builder
    inputs: []
    requires: []
deliver:
  commit: build.commit
  report: build.report
  to: new-pr
`;

const sha256Ref = (text: string): BlobRef =>
  `sha256:${createHash('sha256').update(text).digest('hex')}` as BlobRef;

/** Copies the shipped definitions under `dataDir/definitions` and replaces the lines with the fixture's. */
const fixtureDefinitions = (dataDir: string, checks: string[]): string => {
  const root = join(dataDir, 'definitions');
  rmSync(root, { recursive: true, force: true });
  cpSync(DEFINITIONS_ROOT, root, {
    recursive: true,
    filter: (source) => !source.includes('node_modules'),
  });
  rmSync(join(root, 'lines'), { recursive: true, force: true });
  mkdirSync(join(root, 'lines'), { recursive: true });
  writeFileSync(join(root, 'lines', 'inspect.yml'), lineYaml(checks));
  return root;
};

const main = async (): Promise<void> => {
  const [dataDir, repoUrl, checksJson = '["true"]'] = process.argv.slice(2);
  if (!dataDir || !repoUrl) {
    throw new Error('usage: serve-fixture <dataDir> <repoUrl> [checksJson]');
  }
  const checks = JSON.parse(checksJson) as string[];

  mkdirSync(dataDir, { recursive: true });
  seedProject(dataDir, { projectId: PROJECT, repoUrl, baseBranch: 'main' });
  const opened = openRuntime({
    dataDir,
    definitionsRoot: fixtureDefinitions(dataDir, checks),
  });
  await opened.runtime.start();

  const loaded = opened.ports.definitions.lines.get('inspect');
  if (!loaded) throw new Error('the fixture line did not load');
  const snapshotText = JSON.stringify(loaded.snapshot);
  const bodyText = `Body of ${TODO}`;
  const bodyBlob = sha256Ref(bodyText);
  const snapshotBlob = sha256Ref(snapshotText);
  await opened.ports.blobs.put(
    bodyBlob,
    new TextEncoder().encode(bodyText),
    'text/markdown',
  );
  await opened.ports.blobs.put(
    snapshotBlob,
    new TextEncoder().encode(snapshotText),
    'application/json',
  );

  const command: OrderCommand = {
    type: 'CreateOrder',
    projectId: PROJECT,
    todoId: TODO,
    spec: {
      title: `Title ${TODO}`,
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
    orderId: orderIdOf(PROJECT, TODO),
    commandId: `create-${TODO}`,
    command,
    actor: { kind: 'factory' },
  });

  const listener = startSocketListener({
    runtime: opened.runtime,
    socketPath: join(dataDir, 'factory.sock'),
  });
  console.log(`serve-fixture: listening on ${listener.socketPath}`);

  const stop = async (): Promise<void> => {
    await listener.stop();
    opened.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
};

await main();
