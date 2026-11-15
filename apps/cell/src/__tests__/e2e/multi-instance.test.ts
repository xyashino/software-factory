import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  startSocketListener,
  type SocketListener,
} from '@repo/factory-server/socket/listener';
import {
  openRuntime,
  type OpenedRuntime,
} from '@repo/factory-runtime/open-runtime';
import { inheritedEnv } from '../distributed/harness/process';
import { cellRepo } from '../helpers/cell-repo';

const CELL_MAIN = fileURLToPath(new URL('../../main.ts', import.meta.url));
const START_LINE = /factory-cell: running as (\S+)/;

let root: string;
let opened: OpenedRuntime | undefined;
let listener: SocketListener | undefined;
let children: Bun.Subprocess<'ignore', 'pipe', 'pipe'>[] = [];

const readUntilCellId = async (
  stream: ReadableStream<Uint8Array>,
  timeoutMs = 10_000,
): Promise<string> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now());
      const next = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((resolve) =>
          setTimeout(
            () => resolve({ done: true, value: undefined }),
            remaining,
          ),
        ),
      ]);
      if (next.done || !next.value) break;
      text += decoder.decode(next.value, { stream: true });
      const match = START_LINE.exec(text);
      if (match?.[1]) return match[1];
    }
  } finally {
    reader.releaseLock();
  }
  throw new Error(`cell did not print start line; got:\n${text}`);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cell-multi-'));
  children = [];
});

afterEach(async () => {
  for (const child of children) {
    try {
      child.kill('SIGKILL');
      await child.exited;
    } catch {
      // ignore
    }
  }
  await listener?.stop();
  opened?.close();
  listener = undefined;
  opened = undefined;
  rmSync(root, { recursive: true, force: true });
});

describe('launching multiple factory-cell processes with the same config', () => {
  it('registers two distinct cells instead of sharing one identity', async () => {
    const factoryDataDir = join(root, 'factory');
    const configHome = join(root, 'config');
    const dataHome = join(root, 'share');
    mkdirSync(factoryDataDir, { recursive: true });
    mkdirSync(join(configHome, 'factory-cell'), { recursive: true });
    mkdirSync(dataHome, { recursive: true });

    opened = openRuntime({ dataDir: factoryDataDir });
    await opened.runtime.start();
    listener = startSocketListener({
      runtime: opened.runtime,
      socketPath: join(factoryDataDir, 'factory.sock'),
    });

    writeFileSync(
      join(configHome, 'factory-cell', 'config.toml'),
      [
        'projects = []',
        'runners = ["claude"]',
        `factory_data_dir = "${factoryDataDir}"`,
        '',
      ].join('\n'),
    );

    const env = {
      ...inheritedEnv(),
      XDG_CONFIG_HOME: configHome,
      XDG_DATA_HOME: dataHome,
    };

    const repo = await cellRepo(join(root, 'repo'));
    const first = Bun.spawn(['bun', CELL_MAIN, '--repo-dir', repo], {
      env,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    children.push(first);
    const id1 = await readUntilCellId(first.stdout);

    const second = Bun.spawn(['bun', CELL_MAIN, '--repo-dir', repo], {
      env,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    children.push(second);
    const id2 = await readUntilCellId(second.stdout);

    expect(id1).not.toBe(id2);

    const registered = await opened.ports.cells.list();
    const ids = registered.map((cell) => cell.cellId);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
    expect(registered).toHaveLength(2);
  });
});
