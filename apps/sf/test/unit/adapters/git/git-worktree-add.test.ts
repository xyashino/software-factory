import { describe, expect, it } from 'vitest';
import { createGitAdapter } from '../../../../src/adapters/git/git';
import type {
  ProcessPort,
  ProcessResult,
} from '../../../../src/application/ports/process.port';

const OK: ProcessResult = { exitCode: 0, stdout: '', stderr: '' };

interface Call {
  args: string;
}

const recordingProcess = (
  replies: Record<string, ProcessResult> = {},
): { port: ProcessPort; calls: Call[] } => {
  const calls: Call[] = [];
  const port: ProcessPort = {
    run: async (_command, args) => {
      const key = args.join(' ');
      calls.push({ args: key });
      return replies[key] ?? OK;
    },
    spawnDetached: async () => 0,
    isAlive: () => false,
    terminate: () => undefined,
    probeUrl: async () => false,
  };
  return { port, calls };
};

const WORKTREE_ADD = 'worktree add /wt -b feat/x main';
const LOCAL_BASE_CHECK = 'rev-parse --verify --quiet refs/heads/main';

describe('git worktree add', () => {
  it('fetches origin before adding the worktree when origin exists', async () => {
    // Arrange
    const { port, calls } = recordingProcess();
    const git = createGitAdapter(port);

    // Act
    await git.worktreeAdd('/repo', '/wt', 'feat/x', 'main');

    // Assert
    expect(calls.map((call) => call.args)).toEqual([
      'remote get-url origin',
      'fetch origin',
      LOCAL_BASE_CHECK,
      WORKTREE_ADD,
    ]);
  });

  it('skips the fetch when the repo has no origin remote', async () => {
    // Arrange
    const { port, calls } = recordingProcess({
      'remote get-url origin': { exitCode: 2, stdout: '', stderr: 'no origin' },
    });
    const git = createGitAdapter(port);

    // Act
    await git.worktreeAdd('/repo', '/wt', 'feat/x', 'main');

    // Assert
    expect(calls.map((call) => call.args)).toEqual([
      'remote get-url origin',
      LOCAL_BASE_CHECK,
      WORKTREE_ADD,
    ]);
  });

  it('throws and adds no worktree when the fetch fails', async () => {
    // Arrange
    const { port, calls } = recordingProcess({
      'fetch origin': { exitCode: 128, stdout: '', stderr: 'unreachable' },
    });
    const git = createGitAdapter(port);

    // Act
    const attempt = git.worktreeAdd('/repo', '/wt', 'feat/x', 'main');

    // Assert
    await expect(attempt).rejects.toThrow(
      'git fetch origin failed: unreachable',
    );
    expect(calls.map((call) => call.args)).not.toContain(WORKTREE_ADD);
  });

  it('starts from the origin base when the base branch has no local ref', async () => {
    // Arrange
    const { port, calls } = recordingProcess({
      [LOCAL_BASE_CHECK]: { exitCode: 1, stdout: '', stderr: '' },
    });
    const git = createGitAdapter(port);

    // Act
    await git.worktreeAdd('/repo', '/wt', 'feat/x', 'main');

    // Assert
    expect(calls.map((call) => call.args)).toContain(
      'worktree add /wt -b feat/x origin/main',
    );
  });
});
