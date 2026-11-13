import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadDefinitions } from '../../definitions/load';
import type { Definitions } from '../../definitions/types';
import { PACKAGE_ROOT } from '../../paths';
import { FakeClock } from '../../testing/fake-clock';
import { FakeGit } from '../../testing/fake-git';
import { FakeGithub } from '../../testing/fake-github';
import { FakeHerdr } from '../../testing/fake-herdr';
import { FakeProcess } from '../../testing/fake-process';
import { FakeStore } from '../../testing/fake-store';
import { FakeSystem } from '../../testing/fake-system';
import type { Deliverer, SupervisorPorts, WorkspaceRegistry } from '../ports';

const loaded = loadDefinitions(PACKAGE_ROOT);
if (!loaded.ok) throw new Error('shipped definitions must load');
export const definitions: Definitions = loaded.value;

/** A temp main checkout with one todo file. */
export const scratchRoot = (todos: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), 'sf-root-'));
  for (const [name, text] of Object.entries(todos)) {
    const path = join(root, 'todos', name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
};

export const todoText = (status: string, extra = ''): string => {
  return `---\nstatus: ${status}\n${extra}---\n\n# Todo: hello\n\nAdd a hello script.\n`;
};

export class MemoryWorkspaces implements WorkspaceRegistry {
  private readonly map = new Map<string, string>();
  get(taskId: string): string | undefined {
    return this.map.get(taskId);
  }
  set(taskId: string, workspaceId: string): void {
    this.map.set(taskId, workspaceId);
  }
  delete(taskId: string): void {
    this.map.delete(taskId);
  }
}

export class RecordingDeliverer implements Deliverer {
  readonly calls: { taskId: string; to: string }[] = [];
  readonly blockedCalls: { taskId: string; reason: string }[] = [];
  private prCount = 0;
  async deliver(input: { taskId: string; to: 'new-pr' }) {
    this.calls.push({ taskId: input.taskId, to: input.to });
    this.prCount += 1;
    return { prUrl: `https://example.test/pull/${this.prCount}` };
  }
  async publishBlocked(input: { taskId: string; reason: string }) {
    this.blockedCalls.push({ taskId: input.taskId, reason: input.reason });
    return { prUrl: `https://example.test/pr/blocked-${input.taskId}` };
  }
}

export interface Harness {
  root: string;
  clock: FakeClock;
  store: FakeStore;
  herdr: FakeHerdr;
  git: FakeGit;
  system: FakeSystem;
  process: FakeProcess;
  deliverer: RecordingDeliverer;
  github: FakeGithub;
  ports: SupervisorPorts;
}

export const harness = (root: string, system = new FakeSystem()): Harness => {
  const clock = new FakeClock(1_000);
  const store = new FakeStore(clock);
  const herdr = new FakeHerdr();
  const git = new FakeGit();
  const deliverer = new RecordingDeliverer();
  const github = new FakeGithub();
  const process = new FakeProcess();
  const ports: SupervisorPorts = {
    root,
    definitions,
    store,
    herdr,
    git,
    system,
    process,
    clock,
    deliverer,
    github,
    workspaces: new MemoryWorkspaces(),
    pathEnv: '/usr/bin',
    baseRef: 'origin/main',
  };
  return {
    root,
    clock,
    store,
    herdr,
    git,
    system,
    process,
    deliverer,
    github,
    ports,
  };
};

export const readText = (path: string): string => {
  return readFileSync(path, 'utf8');
};
