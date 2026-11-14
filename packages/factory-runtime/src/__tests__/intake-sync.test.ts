import { describe, expect, it } from 'vitest';
import type { CellId, OrderId } from '@repo/factory-core/ids';
import { createOrder, helloCell, PROJECT, world, type World } from './test-kit';

const CELL = '01J0000000000000000000000W' as CellId;

/** A todo file: frontmatter, then a title and a body. `factory: v2` is the cut-over marker. */
const todo = (options: {
  title: string;
  body?: string;
  status?: string;
  v2?: boolean;
}): string =>
  `---\nstatus: ${options.status ?? 'todo'}\n${options.v2 ? 'factory: v2\n' : ''}---\n\n# ${options.title}\n\n${options.body ?? 'Body.'}\n`;

const board = async (w: World) => (await w.runtime.call('board', {})).orders;

const eventTypesOf = async (w: World, orderId: string) =>
  (
    await w.runtime.call('orderDetail', { orderId: orderId as OrderId })
  ).events.map((stored) => stored.event.type);

describe('intake sync', () => {
  it('creates a Work order from a new v2 todo', async () => {
    const w = world();
    w.git.setTodos([
      {
        file: 'todos/add-login.md',
        text: todo({ title: 'Add login', v2: true }),
      },
    ]);

    const [report] = await w.runtime.sync();

    expect(report?.created).toEqual(['add-login']);
    const rows = await board(w);
    expect(rows.map((row) => row.todoId)).toEqual(['add-login']);
    expect(rows[0]?.title).toBe('Add login');
  });

  it('leaves a v1 todo alone while the cut-over flag is on', async () => {
    const w = world();
    w.git.setTodos([{ file: 'todos/old.md', text: todo({ title: 'Old' }) }]);

    const [report] = await w.runtime.sync();

    expect(report?.created).toEqual([]);
    expect(await board(w)).toEqual([]);
  });

  it('takes every todo when the cut-over flag is off', async () => {
    const w = world({ v2Only: false });
    w.git.setTodos([{ file: 'todos/old.md', text: todo({ title: 'Old' }) }]);

    const [report] = await w.runtime.sync();

    expect(report?.created).toEqual(['old']);
  });

  it('updates the spec of a todo that no one has claimed', async () => {
    const w = world();
    w.git.setTodos([
      {
        file: 'todos/add-login.md',
        text: todo({ title: 'Add login', v2: true }),
      },
    ]);
    await w.runtime.sync();
    w.git.setTodos([
      {
        file: 'todos/add-login.md',
        text: todo({ title: 'Add login', body: 'Now with SSO.', v2: true }),
      },
    ]);

    const [report] = await w.runtime.sync();

    expect(report?.updated).toEqual(['add-login']);
    const [row] = await board(w);
    expect(await eventTypesOf(w, row!.orderId)).toContain('spec_updated');
  });

  it('cancels the Work order of a todo marked cancelled before any claim', async () => {
    const w = world();
    w.git.setTodos([
      {
        file: 'todos/add-login.md',
        text: todo({ title: 'Add login', v2: true }),
      },
    ]);
    await w.runtime.sync();
    w.git.setTodos([
      {
        file: 'todos/add-login.md',
        text: todo({ title: 'Add login', status: 'cancelled', v2: true }),
      },
    ]);

    const [report] = await w.runtime.sync();

    expect(report?.cancelled).toEqual(['add-login']);
    expect((await board(w))[0]?.status).toBe('cancelled');
  });

  it('cancels the Work order of a todo whose file is removed', async () => {
    const w = world();
    w.git.setTodos([
      {
        file: 'todos/add-login.md',
        text: todo({ title: 'Add login', v2: true }),
      },
    ]);
    await w.runtime.sync();
    w.git.setTodos([]);

    const [report] = await w.runtime.sync();

    expect(report?.cancelled).toEqual(['add-login']);
    expect((await board(w))[0]?.status).toBe('cancelled');
  });

  it('records spec drift and keeps the spec once a job was claimed', async () => {
    const w = world();
    w.git.setTodos([
      {
        file: 'todos/add-login.md',
        text: todo({ title: 'Add login', v2: true }),
      },
    ]);
    await w.runtime.sync();
    await helloCell(w, CELL);
    await w.runtime.call('claim', { cellId: CELL, waitMs: 0 });
    w.git.setTodos([
      {
        file: 'todos/add-login.md',
        text: todo({ title: 'Add login', body: 'Changed late.', v2: true }),
      },
    ]);

    const [report] = await w.runtime.sync();

    expect(report?.specDrift).toEqual(['add-login']);
    expect(report?.diagnostics.map((item) => item.kind)).toContain(
      'spec_drift',
    );
    const [row] = await board(w);
    expect(await eventTypesOf(w, row!.orderId)).not.toContain('spec_updated');
  });

  it('cancels a claimed Work order only through the Supervisor, so it is a diagnostic', async () => {
    const w = world();
    w.git.setTodos([
      {
        file: 'todos/add-login.md',
        text: todo({ title: 'Add login', v2: true }),
      },
    ]);
    await w.runtime.sync();
    await helloCell(w, CELL);
    await w.runtime.call('claim', { cellId: CELL, waitMs: 0 });
    w.git.setTodos([
      {
        file: 'todos/add-login.md',
        text: todo({ title: 'Add login', status: 'cancelled', v2: true }),
      },
    ]);

    const [report] = await w.runtime.sync();

    expect(report?.cancelled).toEqual([]);
    expect(report?.diagnostics.map((item) => item.kind)).toContain(
      'cancel_after_claim',
    );
    expect((await board(w))[0]?.status).not.toBe('cancelled');
  });

  it('reports an unparseable todo and creates nothing until it is fixed', async () => {
    const w = world();
    w.git.setTodos([
      { file: 'todos/broken.md', text: 'no frontmatter here\n' },
    ]);

    const [broken] = await w.runtime.sync();

    expect(broken?.created).toEqual([]);
    expect(broken?.diagnostics.map((item) => item.kind)).toEqual([
      'unparseable',
    ]);
    expect(await board(w)).toEqual([]);

    w.git.setTodos([
      { file: 'todos/broken.md', text: todo({ title: 'Broken', v2: true }) },
    ]);
    const [fixed] = await w.runtime.sync();

    expect(fixed?.created).toEqual(['broken']);
  });

  it('does not take over an id that another Work order already uses', async () => {
    const w = world();
    await createOrder(w, { todoId: 'legacy' });
    w.git.setTodos([
      { file: 'todos/legacy.md', text: todo({ title: 'Legacy', v2: true }) },
    ]);

    const [report] = await w.runtime.sync();

    expect(report?.created).toEqual([]);
    expect(report?.diagnostics.map((item) => item.kind)).toEqual(['reused_id']);
  });

  it('changes nothing when the same files are synced again', async () => {
    const w = world();
    w.git.setTodos([
      {
        file: 'todos/add-login.md',
        text: todo({ title: 'Add login', v2: true }),
      },
    ]);
    await w.runtime.sync();

    const [again] = await w.runtime.sync();

    expect(again?.created).toEqual([]);
    expect(again?.updated).toEqual([]);
    expect(again?.cancelled).toEqual([]);
    expect(await board(w)).toHaveLength(1);
  });

  it('refuses a sync for a project that is not registered', async () => {
    const w = world();

    await expect(
      w.runtime.sync('no-such-project' as typeof PROJECT),
    ).rejects.toMatchObject({ wire: { code: 'not_found' } });
  });
});
