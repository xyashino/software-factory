import type { ClockPort } from '../application/ports/clock.port';
import type { HqLinkPort } from '../application/ports/hq-link.port';
import type { FactoryCredential } from '../domain/factory/factory-credential';
import type { HqState } from '../domain/factory/hq-state';
import { HEARTBEAT_INTERVAL_MS, SELF_FENCE_MS } from '../config';
import type { ProjectReport } from './supervisor';

export const HQ_TICK_MS = 1_000;

const NOT_CONNECTED: HqState = { kind: 'not_connected' };

export interface HqLinkDeps {
  credential: FactoryCredential | null;
  hqLink: HqLinkPort;
  clock: ClockPort;
  projects: () => ProjectReport[];
  killAll: () => Promise<void>;
}

export interface HqLink {
  state(): HqState;
  tick(): Promise<void>;
  stopped(): boolean;
}

export const createHqLink = ({
  credential,
  hqLink,
  clock,
  projects,
  killAll,
}: HqLinkDeps): HqLink => {
  let state: HqState =
    credential === null
      ? NOT_CONNECTED
      : { kind: 'unreachable', since: clock.now() };
  let lastOkAt: number | null = null;
  let lastAttemptAt: number | null = null;
  let halted = false;
  let busy = false;

  const killCells = async (): Promise<void> => {
    try {
      await killAll();
    } catch {
      // A Cell that survives SIGKILL stays in the supervisor; the next tick retries.
    }
  };

  const beat = async (current: FactoryCredential): Promise<void> => {
    const attemptedAt = clock.now();
    lastAttemptAt = attemptedAt;
    const reply = await hqLink.heartbeat({
      url: current.url,
      sessionToken: current.sessionToken,
      projects: projects(),
    });
    if (reply.kind === 'ok') {
      lastOkAt = clock.now();
      state = { kind: 'ok' };
      return;
    }
    if (reply.kind === 'rejected') {
      state = { kind: 'rejected' };
      halted = true;
      await killCells();
      return;
    }
    if (state.kind !== 'unreachable') {
      state = { kind: 'unreachable', since: attemptedAt };
    }
  };

  const tick = async (): Promise<void> => {
    if (credential === null || halted || busy) return;
    busy = true;
    try {
      const now = clock.now();
      if (
        lastAttemptAt === null ||
        now - lastAttemptAt >= HEARTBEAT_INTERVAL_MS
      ) {
        await beat(credential);
      }
      if (
        state.kind === 'unreachable' &&
        lastOkAt !== null &&
        clock.now() - lastOkAt >= SELF_FENCE_MS
      ) {
        await killCells();
      }
    } finally {
      busy = false;
    }
  };

  return {
    state: () => state,
    tick,
    stopped: () => halted,
  };
};
