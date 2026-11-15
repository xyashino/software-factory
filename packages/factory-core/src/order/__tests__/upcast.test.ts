import { describe, expect, it } from 'vitest';
import { upcastEvent } from '../upcast';
import { cancelled, created, history, LINE, workspaceFailed } from './builders';

/** A version 2 envelope as an older store wrote it: the same event, with the old schema version. */
const asV2 = (stored: object, event: Record<string, unknown>) => ({
  ...stored,
  schemaVersion: 2,
  event,
});

describe('upcastEvent', () => {
  it('returns a version 3 event unchanged', () => {
    const [stored] = history(created());
    expect(upcastEvent(stored)).toEqual({ ok: true, value: stored });
  });

  it('refuses a version 1 event, which has no upcaster', () => {
    const [stored] = history(created());
    const result = upcastEvent({ ...stored, schemaVersion: 1 });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain(
      'no upcaster for schemaVersion 1',
    );
  });

  it('upcasts a version 2 workspace failure of stage setup to changeover', () => {
    const [stored] = history(workspaceFailed());
    const legacy = asV2(stored!, { ...stored!.event, stage: 'setup' });
    const result = upcastEvent(legacy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.schemaVersion).toBe(3);
    expect(result.value.event).toMatchObject({
      type: 'workspace_failed',
      stage: 'changeover',
    });
  });

  it('keeps the other workspace stages of a version 2 event as they are', () => {
    const [stored] = history(workspaceFailed());
    for (const stage of ['fetch', 'sync', 'worktree'] as const) {
      const result = upcastEvent(asV2(stored!, { ...stored!.event, stage }));
      expect(result.ok && result.value.event).toMatchObject({ stage });
    }
  });

  it('upcasts the pinned snapshot of a version 2 order_created from version 1', () => {
    const order = created();
    const [stored] = history(order);
    const legacyLine = {
      ...LINE,
      snapshotVersion: 1,
      workspace: {
        sync: { timeoutMs: 120_000, exec: ['git fetch origin'] },
        setup: { timeoutMs: 600_000, exec: ['pnpm install --frozen-lockfile'] },
      },
    };
    const event = {
      ...order,
      line: { ...order.line, snapshot: legacyLine },
    };
    const result = upcastEvent(asV2(stored!, event));
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.event.type !== 'order_created') return;
    const snapshot = result.value.event.line.snapshot;
    expect(snapshot.snapshotVersion).toBe(2);
    expect(snapshot.workspace).toEqual({
      sync: { timeoutMs: 120_000, exec: ['git fetch origin'] },
      changeover: {
        timeoutMs: 600_000,
        exec: ['pnpm install --frozen-lockfile'],
      },
    });
  });

  it('refuses a version 2 event whose stage is not a workspace stage', () => {
    const [stored] = history(workspaceFailed());
    const result = upcastEvent(
      asV2(stored!, { ...stored!.event, stage: 'deploy' }),
    );
    expect(result.ok).toBe(false);
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
