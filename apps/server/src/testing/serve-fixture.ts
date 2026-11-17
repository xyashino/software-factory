/**
 * Test fixture, not a product entry point: `factory-server` over a seeded data directory. The Cell's
 * integration tests spawn it by path, so the Cell never imports the runtime (apps/cell lint).
 *
 * Usage: `bun serve-fixture.ts <dataDir> <repoUrl> [checksJson] [continuation]`. It seeds one project
 * (`software-factory`, repo `repoUrl`) and one Order `software-factory:todo-1` whose line starts with an
 * inspection (`quality-gate`, the `checksJson` commands, default `["true"]`), then serves HTTP on a free
 * loopback port and writes the discovery file, as `main.ts` does. The line is written under the data
 * directory, so the shipped definitions stay untouched.
 * `continuation` (`true` by default) is the runtime's PROTOCOL §4 flag: `false` leaves every next job in
 * the queue, so a test's own Cell claims it instead of receiving it from the command that ends a job.
 * Arguments, not environment variables: the turbo lint rule wants every env var declared.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ProjectId, TodoId } from '@repo/factory-core/ids';
import { openRuntime } from '@repo/factory-runtime/open-runtime';
import { fixtureLine, seedProject } from '@repo/factory-runtime/seed';
import { removeDiscovery, writeDiscovery } from '../http/discovery';
import { startHttpListener, type HttpListener } from '../http/listener';

const PROJECT = 'software-factory' as ProjectId;
const TODO = 'todo-1' as TodoId;

/** This repository's own `.factory/`: the operator profiles the fixture line names. */
const SHIPPED_FACTORY = fileURLToPath(
  new URL('../../../../.factory', import.meta.url),
);

/** The line the fixture serves: the quality gate first, then a builder the tests never claim. */
const lineYaml = (checks: string[]): string => `name: inspect
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
  - id: build
    kind: operator
    operator: builder
    inputs: []
deliver:
  commit: build.commit
  report: build.report
  to: new-pr
`;

const main = async (): Promise<void> => {
  const [dataDir, repoUrl, checksJson = '["true"]', continuation = 'true'] =
    process.argv.slice(2);
  if (!dataDir || !repoUrl) {
    throw new Error(
      'usage: serve-fixture <dataDir> <repoUrl> [checksJson] [continuation]',
    );
  }
  const checks = JSON.parse(checksJson) as string[];

  mkdirSync(dataDir, { recursive: true });
  seedProject(dataDir, { projectId: PROJECT, repoUrl, baseBranch: 'main' });
  const line = fixtureLine(
    dataDir,
    SHIPPED_FACTORY,
    'inspect',
    lineYaml(checks),
  );
  const opened = openRuntime({
    dataDir,
    config: { continuation: continuation === 'true' },
  });
  await opened.runtime.start();

  // The Work order is created the way a Supervisor creates one: through the task API, with the Line it pins.
  await opened.runtime.call('createOrder', {
    commandId: `create-${TODO}`,
    projectId: PROJECT,
    todoId: TODO,
    title: `Title ${TODO}`,
    type: 'feat',
    body: `Body of ${TODO}\n`,
    line,
    priority: 'medium',
    dependsOn: [],
    baseBranch: 'main',
  });

  // The local token and the local join token are minted the way main.ts mints them.
  const localToken = randomBytes(32).toString('base64url');
  const joinToken = await opened.runtime.call('joinTokenCreate', {
    commandId: `fixture-${randomUUID()}`,
    name: 'local-cells',
    ttlSeconds: 3600,
  });
  const listener: HttpListener = startHttpListener({
    runtime: opened.runtime,
    hostname: '127.0.0.1',
    port: 0,
    localToken,
  });
  writeDiscovery(dataDir, {
    url: listener.url,
    token: localToken,
    joinToken: joinToken.token,
  });
  console.log(`serve-fixture: listening on ${listener.url}`);

  const stop = async (): Promise<void> => {
    removeDiscovery(dataDir, localToken);
    await listener.stop();
    opened.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
};

await main();
