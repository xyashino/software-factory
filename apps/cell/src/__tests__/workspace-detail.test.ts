import { describe, expect, it } from 'vitest';
import { workspaceDetailOf } from '../jobs/workspace-detail';

describe('workspace failure detail sent to the server', () => {
  it('keeps a detail that names no machine-local value', () => {
    expect(workspaceDetailOf('worktree', 'base branch main is missing')).toBe(
      'base branch main is missing',
    );
  });

  it('replaces a detail that carries a Cell path, since the server refuses it', () => {
    const detail =
      "fatal: could not create work tree dir '/home/cell/data/worktrees/todo-01'";

    expect(workspaceDetailOf('worktree', detail)).toBe(
      'worktree failed on this Cell; the log holds the full output',
    );
  });

  it('caps a long detail at 500 characters', () => {
    const detail = `${'a'.repeat(600)}`;

    expect(workspaceDetailOf('setup', detail)).toHaveLength(500);
  });
});
