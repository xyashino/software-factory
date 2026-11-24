import { describe, expect, it } from 'vitest';
import { LEASE_TTL_MS, SELF_FENCE_MS } from '../../src/config';
import { createHqLink, HQ_TICK_MS } from '../../src/hq-link';
import type { HqReply } from '../../src/ports';

type Outcome = 'ok' | 'unreachable' | 'rejected';

const SESSION_TOKEN = 'sf_factory_secret-session';
const START_MS = 1_000_000;

const replyOf = (outcome: Outcome): HqReply<{ factoryId: string }> => {
  if (outcome === 'ok') return { kind: 'ok', value: { factoryId: 'f-1' } };
  if (outcome === 'rejected') return { kind: 'rejected' };
  return { kind: 'unreachable' };
};

const setup = (initial: Outcome = 'ok', connected = true) => {
  let now = START_MS;
  let outcome: Outcome = initial;
  const kills: number[] = [];
  const heartbeats: number[] = [];
  const link = createHqLink({
    credential: connected
      ? {
          url: 'http://hq.test',
          factoryId: 'f-1',
          sessionToken: SESSION_TOKEN,
        }
      : null,
    hqLink: {
      heartbeat: () => {
        heartbeats.push(now);
        return Promise.resolve(replyOf(outcome));
      },
      goneCell: () => Promise.reject(new Error('not used by the link')),
      importQueue: () => Promise.reject(new Error('not used by the link')),
    },
    clock: { now: () => now, sleep: () => Promise.resolve() },
    projects: () => [],
    killAll: () => {
      kills.push(now);
      return Promise.resolve();
    },
  });
  const advance = async (ms: number): Promise<void> => {
    for (let elapsed = 0; elapsed < ms; elapsed += HQ_TICK_MS) {
      now += HQ_TICK_MS;
      await link.tick();
    }
  };
  return {
    link,
    advance,
    kills,
    heartbeats,
    answer: (next: Outcome) => {
      outcome = next;
    },
    startedAt: START_MS,
  };
};

describe('factory HQ link', () => {
  it('Cells are killed when HQ is silent for 45 s, before the 60 s lease', async () => {
    // Arrange
    const { link, advance, kills, answer, startedAt } = setup();
    await link.tick();
    answer('unreachable');

    // Act
    await advance(SELF_FENCE_MS);

    // Assert
    expect(SELF_FENCE_MS).toBeLessThan(LEASE_TTL_MS);
    expect(kills).toEqual([startedAt + SELF_FENCE_MS]);
  });

  it('Cells keep running while HQ answers heartbeats', async () => {
    // Arrange
    const { link, advance, kills } = setup();

    // Act
    await advance(LEASE_TTL_MS * 2);

    // Assert
    expect(kills).toEqual([]);
    expect(link.state()).toEqual({ kind: 'ok' });
  });

  it('rejected credential kills Cells and stops heartbeats', async () => {
    // Arrange
    const { link, advance, kills, heartbeats, answer } = setup();
    await link.tick();
    answer('rejected');
    await advance(HQ_TICK_MS * 10);
    const beatsAfterRejection = heartbeats.length;

    // Act
    await advance(LEASE_TTL_MS);

    // Assert
    expect(kills).toHaveLength(1);
    expect(link.state()).toEqual({ kind: 'rejected' });
    expect(link.stopped()).toBe(true);
    expect(heartbeats).toHaveLength(beatsAfterRejection);
  });

  it('factory without a credential reports not connected and never calls HQ', async () => {
    // Arrange
    const { link, advance, heartbeats } = setup('ok', false);

    // Act
    await advance(LEASE_TTL_MS);

    // Assert
    expect(link.state()).toEqual({ kind: 'not_connected' });
    expect(heartbeats).toEqual([]);
  });

  it('link state never carries the session token', async () => {
    // Arrange
    const { link, answer } = setup();
    await link.tick();
    answer('unreachable');
    await link.tick();

    // Act
    const text = JSON.stringify(link.state());

    // Assert
    expect(text).not.toContain(SESSION_TOKEN);
  });
});
