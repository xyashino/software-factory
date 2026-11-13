import { describe, expect, it } from 'vitest';
import { tick } from '../run';
import { harness, scratchRoot, todoText } from './fixtures';

describe('heartbeat while an agent works', () => {
  it('prints at most one heartbeat per minute for a running attempt', async () => {
    const h = harness(scratchRoot({ 'hello.md': todoText('todo') }));
    h.herdr.observations = Array.from({ length: 200 }, () => 'working');
    const logs: string[] = [];
    const log = (line: string): void => {
      logs.push(line);
    };
    const heartbeats = (): string[] =>
      logs.filter((line) => line.includes('heartbeat:'));

    // setup, then the build agent starts
    for (let i = 0; i < 4; i++) await tick(h.ports, log);
    expect(heartbeats()).toEqual([]);

    // many ticks inside one minute stay silent
    for (let i = 0; i < 5; i++) {
      h.clock.advance(5_000);
      await tick(h.ports, log);
    }
    expect(heartbeats()).toEqual([]);

    h.clock.advance(60_000);
    await tick(h.ports, log);
    await tick(h.ports, log);
    expect(heartbeats()).toHaveLength(1);
    expect(heartbeats()[0]).toMatch(
      /^\[feature\] heartbeat: plan working 1m\d\ds, last output 1m\d\ds ago$/,
    );

    h.clock.advance(60_000);
    await tick(h.ports, log);
    expect(heartbeats()).toHaveLength(2);
  });
});
