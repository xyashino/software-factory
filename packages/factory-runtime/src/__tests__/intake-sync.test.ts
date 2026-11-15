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
  describe('from a local folder', () => {
    const local = (files: { file: string; text: string }[]) => ({
      files,
      replace: true,
    });

    it('creates Work orders from the given files without reading git', async () => {
      const w = world();
      w.git.setTodos([
        { file: 'todos/from-git.md', text: todo({ title: 'Git', v2: true }) },
      ]);

      const [report] = await w.runtime.sync(
        undefined,
        local([
          {
            file: 'todos/from-folder.md',
            text: todo({ title: 'Folder', v2: true }),
          },
        ]),
      );

      expect(report?.created).toEqual(['from-folder']);
      expect((await board(w)).map((row) => row.todoId)).toEqual([
        'from-folder',
      ]);
    });

    it('cancels every unfinished Work order not in the folder, claimed or not', async () => {
      const w = world();
      await w.runtime.sync(
        undefined,
        local([
          { file: 'todos/old-a.md', text: todo({ title: 'A', v2: true }) },
          { file: 'todos/old-b.md', text: todo({ title: 'B', v2: true }) },
        ]),
      );
      await createOrder(w, { todoId: 'untracked' });
      await helloCell(w, CELL);
      await w.runtime.call('claim', { cellId: CELL, waitMs: 0 });

      const [report] = await w.runtime.sync(
        undefined,
        local([
          { file: 'todos/new.md', text: todo({ title: 'New', v2: true }) },
        ]),
      );

      expect(report?.created).toEqual(['new']);
      expect([...(report?.cancelled ?? [])].sort()).toEqual([
        'old-a',
        'old-b',
        'untracked',
      ]);
      const statuses = Object.fromEntries(
        (await board(w)).map((row) => [row.todoId, row.status]),
      );
      expect(statuses).toMatchObject({
        'old-a': 'cancelled',
        'old-b': 'cancelled',
        untracked: 'cancelled',
      });
      expect(statuses.new).not.toBe('cancelled');
    });

    it('changes nothing when the same folder is synced again', async () => {
      const w = world();
      const files = [
        { file: 'todos/a.md', text: todo({ title: 'A', v2: true }) },
      ];
      await w.runtime.sync(undefined, local(files));

      const [again] = await w.runtime.sync(undefined, local(files));

      expect(again).toMatchObject({ created: [], updated: [], cancelled: [] });
    });

    it('needs one project to sync a folder into', async () => {
      const w = world();
      await w.runtime.call('projectAdd', {
        projectId: 'second' as typeof PROJECT,
        repoUrl: 'https://example.test/second.git',
        baseBranch: 'main',
        maxRunning: 2,
        depPolicy: 'delivered',
      });

      await expect(w.runtime.sync(undefined, local([]))).rejects.toMatchObject({
        wire: { code: 'precondition' },
      });
    });
  });

  describe('intake writes', () => {
    /** Records the todo id of every intake row written from now on. */
    const watchWrites = (w: World): string[] => {
      const written: string[] = [];
      const upsert = w.intake.upsert;
      w.intake.upsert = async (row) => {
        written.push(row.todoId);
        await upsert(row);
      };
      return written;
    };

    const files = () => [
      { file: 'todos/active.md', text: todo({ title: 'Active', v2: true }) },
      {
        file: 'todos/finished.md',
        text: todo({ title: 'Finished', status: 'done', v2: true }),
      },
      { file: 'todos/broken.md', text: '# no frontmatter\n' },
    ];

    it('writes nothing when the same commit is synced again', async () => {
      const w = world();
      w.git.setTodos(files());
      await w.runtime.sync();
      const written = watchWrites(w);

      const [again] = await w.runtime.sync();

      expect(written).toEqual([]);
      expect(again).toMatchObject({ created: [], updated: [], cancelled: [] });
    });

    it('writes the row of a todo whose file changed', async () => {
      const w = world();
      w.git.setTodos(files());
      await w.runtime.sync();
      const written = watchWrites(w);
      w.git.setTodos([
        {
          file: 'todos/active.md',
          text: todo({ title: 'Active', body: 'Now larger.', v2: true }),
        },
        ...files().slice(1),
      ]);

      await w.runtime.sync();

      expect(written).toContain('active');
    });

    it('writes every row again when a new commit reads the same todos', async () => {
      const w = world();
      w.git.setTodos(files());
      await w.runtime.sync();
      const written = watchWrites(w);
      w.git.setTodos(files());

      await w.runtime.sync();

      expect([...written].sort()).toEqual(['active', 'broken', 'finished']);
    });
  });
});
