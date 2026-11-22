import { describe, expect, it } from 'vitest';
import { parseReply } from '@repo/zod-contract-kit/reply';
import { getHealthContract } from '../health.contract';
import { getSettingsContract } from '../settings.contract';
import { listCellsContract } from '../cells.contract';
import { RUNTIME_STATUSES } from '../enums/cells';
import { RUNNERS } from '../enums/settings';

const settings = {
  herdr_enabled: false,
  default_runner: 'claude',
  restart_backoff_ms: 1000,
  max_local_cells: 4,
  git_fetch_on_worktree: true,
};

describe('health reply', () => {
  it('accepts a count for every runtime status', () => {
    const byRuntimeStatus = Object.fromEntries(
      RUNTIME_STATUSES.map((status) => [status, 0]),
    );
    const body = {
      code: 200,
      pid: 42,
      defaultFactory: null,
      cells: { total: 0, byRuntimeStatus },
    };

    const outcome = parseReply(getHealthContract, 200, body);

    expect(outcome.ok).toBe(true);
  });

  it('rejects a runtime status outside the enum', () => {
    const body = {
      code: 200,
      pid: 42,
      defaultFactory: null,
      cells: { total: 1, byRuntimeStatus: { sleeping: 1 } },
    };

    const outcome = parseReply(getHealthContract, 200, body);

    expect(outcome.ok).toBe(false);
  });
});

describe('settings reply', () => {
  it('accepts every known default runner', () => {
    for (const runner of RUNNERS) {
      const body = {
        code: 200,
        settings: { ...settings, default_runner: runner },
      };

      expect(parseReply(getSettingsContract, 200, body).ok).toBe(true);
    }
  });

  it('rejects a default runner that is not listed', () => {
    const body = {
      code: 200,
      settings: { ...settings, default_runner: 'gemini' },
    };

    const outcome = parseReply(getSettingsContract, 200, body);

    expect(outcome.ok).toBe(false);
  });
});

describe('cells reply', () => {
  it('reports an undeclared status when the contract has no such answer', () => {
    const outcome = parseReply(listCellsContract, 500, {});

    expect(outcome).toEqual({
      ok: false,
      reason: 'undeclared-status',
      status: 500,
    });
  });
});
