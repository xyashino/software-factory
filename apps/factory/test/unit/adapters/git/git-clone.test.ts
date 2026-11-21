import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGitAdapter } from '../../../../src/adapters/git/git';
import type {
  ProcessPort,
  ProcessResult,
} from '../../../../src/application/ports/process.port';

const OK: ProcessResult = { exitCode: 0, stdout: '', stderr: '' };
const NO_ORIGIN: ProcessResult = { exitCode: 2, stdout: '', stderr: 'no' };

const dirs: string[] = [];

const recordingProcess = (
  replies: Record<string, ProcessResult> = {},
): { port: ProcessPort; calls: string[] } => {
  const calls: string[] = [];
  const port: ProcessPort = {
    run: async (_command, args) => {
      const key = args.join(' ');
      calls.push(key);
      return replies[key] ?? OK;
    },
    spawnDetached: async () => 0,
    isAlive: () => false,
    terminate: () => undefined,
    probeUrl: async () => false,
  };
  return { port, calls };
};

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('git clone', () => {
  it('clones the project into a workspace whose parent directories are created', async () => {
    // Arrange
    const root = mkdtempSync(join(tmpdir(), 'sf-git-clone-'));
    dirs.push(root);
    const dest = join(root, 'workspaces', 'alpha');
    const { port, calls } = recordingProcess();
    const git = createGitAdapter(port);

    // Act
    await git.clone('https://example.test/alpha.git', dest);

    // Assert
    expect(calls).toEqual([`clone https://example.test/alpha.git ${dest}`]);
    expect(existsSync(join(root, 'workspaces'))).toBe(true);
  });
});

describe('git origin url', () => {
  it('reads the origin url of a checkout', async () => {
    // Arrange
    const { port } = recordingProcess({
      'remote get-url origin': {
        exitCode: 0,
        stdout: 'https://example.test/alpha.git\n',
        stderr: '',
      },
    });
    const git = createGitAdapter(port);

    // Act
    const origin = await git.originUrl('/workspaces/alpha');

    // Assert
    expect(origin).toBe('https://example.test/alpha.git');
  });

  it('reports no origin when the checkout has none', async () => {
    // Arrange
    const { port } = recordingProcess({ 'remote get-url origin': NO_ORIGIN });
    const git = createGitAdapter(port);

    // Act
    const origin = await git.originUrl('/workspaces/alpha');

    // Assert
    expect(origin).toBeNull();
  });
});
