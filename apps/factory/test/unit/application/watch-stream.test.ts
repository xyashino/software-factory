import { describe, expect, it } from 'vitest';
import { Unreachable } from '../../../src/application/core/errors';
import type { SseFrame } from '../../../src/application/ports/server.port';
import { streamTransitions } from '../../../src/application/procedures/watch/stream.procedure';
import { createFakePorts } from '../../support/fake-ports';

const SUPERVISOR = { kind: 'supervisor' } as const;

const frameFor = (seq: number): SseFrame => ({
  event: 'transition',
  id: String(seq),
  data: JSON.stringify({
    seq,
    projectId: 'software-factory',
    entityType: 'work_order',
    entityId: 'wo-1',
    fromState: 'queued',
    toState: 'running',
    actorKind: 'system',
    actorId: null,
    commandId: null,
    meta: null,
    at: 1_700_000_000_000,
  }),
});

describe('watch stream', () => {
  it('reconnects after the last printed seq and prints each seq once', async () => {
    // Arrange
    const controller = new AbortController();
    const queries: string[] = [];
    const printed: number[] = [];
    const script: (() => AsyncIterable<SseFrame>)[] = [
      async function* () {
        yield frameFor(1);
        yield frameFor(2);
        throw new Unreachable('dropped');
      },
      async function* () {
        yield frameFor(2);
        yield frameFor(3);
        throw new Unreachable('dropped');
      },
    ];
    const fake = createFakePorts();
    fake.ports.server.stream = (_route, query) => {
      queries.push(query.afterSeq ?? '');
      const next = script.shift();
      if (next === undefined) {
        controller.abort();
        return (async function* () {})();
      }
      return next();
    };
    fake.ports.clock.sleep = async () => undefined;

    // Act
    await streamTransitions.execute(
      {
        configPath: 'unused',
        afterSeq: 0,
        signal: controller.signal,
        onTransition: (transition: { seq: number }) => {
          printed.push(transition.seq);
        },
      },
      { ...fake.ports, token: SUPERVISOR, principal: SUPERVISOR },
    );

    // Assert
    expect(queries).toEqual(['0', '2', '3']);
    expect(printed).toEqual([1, 2, 3]);
  });

  it('waits 1s, 2s, 4s, 8s, then 10s while no event arrives', async () => {
    // Arrange
    const controller = new AbortController();
    const delays: number[] = [];
    const fake = createFakePorts();
    fake.ports.server.stream = () => {
      throw new Unreachable('server down');
    };
    fake.ports.clock.sleep = async (ms) => {
      delays.push(ms);
      if (delays.length === 5) {
        controller.abort();
      }
    };

    // Act
    await streamTransitions.execute(
      {
        configPath: 'unused',
        afterSeq: 0,
        signal: controller.signal,
        onTransition: () => undefined,
      },
      { ...fake.ports, token: SUPERVISOR, principal: SUPERVISOR },
    );

    // Assert
    expect(delays).toEqual([1000, 2000, 4000, 8000, 10000]);
  });
});
