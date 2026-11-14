import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FactoryClient } from '@repo/factory-core/contracts/client';
import type { CellId, ProjectId } from '@repo/factory-core/ids';
import { startCell } from '../../cell';
import { parseConfig } from '../../config';
import { createSystemAdapter } from '../../adapters/system/system.adapter';
import { systemClock } from '../../clock/system-clock';

const CELL = '01J0000000000000000000000W' as CellId;

describe('startCell leave()', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pauses claims, waits cleanly, stops heartbeats, and resolves slotsDone', async () => {
    const cellDataDir = mkdtempSync(join(tmpdir(), 'cell-leave-'));
    dirs.push(cellDataDir);
    let claimsAfterLeave = 0;
    let leavingStarted = false;
    let heartbeats = 0;

    const client = {
      call: async (route: string) => {
        if (route === 'hello') {
          return {
            cellId: CELL,
            config: { heartbeatMs: 15, selfFenceMs: 1_000, leaseTtlMs: 2_000 },
          };
        }
        if (route === 'claim') {
          if (leavingStarted) claimsAfterLeave += 1;
          return { job: null };
        }
        if (route === 'heartbeat') {
          heartbeats += 1;
          return { ok: true, jobs: [], signals: [] };
        }
        throw new Error(`unexpected route ${route}`);
      },
    } as unknown as FactoryClient;

    const running = await startCell({
      client,
      cellId: CELL,
      config: parseConfig(
        `slots = 1\nprojects = ["${'software-factory' as ProjectId}"]`,
      ),
      cellDataDir,
      system: createSystemAdapter(),
      clock: systemClock,
      version: 'test',
      timing: {
        heartbeatMs: 15,
        selfFenceMs: 1_000,
        claimWaitMs: 0,
        idlePauseMs: 5,
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(heartbeats).toBeGreaterThan(0);

    leavingStarted = true;
    const result = await running.leave(5);
    await running.slotsDone;

    expect(result).toEqual({ remaining: 0 });
    expect(claimsAfterLeave).toBe(0);
    const beatsAtStop = heartbeats;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(heartbeats).toBe(beatsAtStop);
  });
});
