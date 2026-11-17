import { describe, expect, it } from 'vitest';
import { upcastEvent } from '../upcast';
import { cancelled, created, history } from './builders';

describe('upcastEvent', () => {
  it('returns a version 2 event unchanged', () => {
    const [stored] = history(created());
    expect(upcastEvent(stored)).toEqual({ ok: true, value: stored });
  });

  it('drops the retired requires key from stored Line stations', () => {
    const [stored] = history(created());
    if (stored === undefined) throw new Error('the history has no event');
    const event = stored.event as {
      line: { snapshot: { stations: Record<string, unknown>[] } };
    };
    const legacy = {
      ...stored,
      event: {
        ...event,
        line: {
          ...event.line,
          snapshot: {
            ...event.line.snapshot,
            stations: event.line.snapshot.stations.map((station) => ({
              ...station,
              requires: ['docker'],
            })),
          },
        },
      },
    };
    const result = upcastEvent(legacy);
    expect(result).toEqual({ ok: true, value: stored });
  });

  it('refuses a version 1 event, which has no upcaster', () => {
    const [stored] = history(created());
    const result = upcastEvent({ ...stored, schemaVersion: 1 });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain(
      'no upcaster for schemaVersion 1',
    );
  });

  it('refuses an event with no schema version', () => {
    const [stored] = history(created());
    const unversioned: Record<string, unknown> = { ...stored };
    delete unversioned.schemaVersion;
    expect(upcastEvent(unversioned).ok).toBe(false);
  });

  it('refuses a value that is not an object', () => {
    expect(upcastEvent('not an event').ok).toBe(false);
  });

  it('refuses an event whose payload is invalid, never skipping it', () => {
    const [stored] = history(cancelled());
    const broken = { ...stored, event: { type: 'cancelled' } };
    const result = upcastEvent(broken);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('invalid stored event');
  });
});
