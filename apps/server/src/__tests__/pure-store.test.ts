import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProjectId } from '@repo/factory-core/ids';
import {
  openRuntime,
  type OpenedRuntime,
} from '@repo/factory-runtime/open-runtime';
import type { Timers } from '@repo/factory-runtime/ports';
import { seedProject } from '@repo/factory-runtime/seed';

/**
 * The server is a pure store (passive-server-04): it holds tasks and state, runs no loop and no timer,
 * and reaches no git, no gh and no repository definition. These tests hold it to that.
 */

const PROJECT = 'software-factory' as ProjectId;

let root: string | undefined;
let opened: OpenedRuntime | undefined;

afterEach(() => {
  opened?.close();
  opened = undefined;
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

const freshDataDir = (): string => {
  root = mkdtempSync(join(tmpdir(), 'factory-pure-store-'));
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  seedProject(dataDir, {
    projectId: PROJECT,
    repoUrl: 'https://example.test/software-factory.git',
  });
  return dataDir;
};

describe('factory-server as a pure store', () => {
  it('opens and serves the board with no git or gh on PATH and no repository definitions', async () => {
    const dataDir = freshDataDir();
    const path = process.env.PATH;
    process.env.PATH = '';
    try {
      opened = openRuntime({ dataDir });
      await opened.runtime.start();

      const board = await opened.runtime.call('board', {});

      expect(board).toEqual({ orders: [] });
    } finally {
      process.env.PATH = path;
    }
  });

  it('registers no timer on start: boot grace is the only thing it arms', async () => {
    const dataDir = freshDataDir();
    let armed = 0;
    const timers: Timers = {
      after: () => {
        armed += 1;
        return () => undefined;
      },
    };
    opened = openRuntime({ dataDir, timers });

    await opened.runtime.start();

    expect(armed).toBe(0);
  });
});
