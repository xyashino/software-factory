import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** The Supervisor CLI entry point, run as a real process (its own data directory, its own socket). */
const CLI = fileURLToPath(new URL('../cli.ts', import.meta.url));
/** The server entry point, run directly for the listener checks. */
const SERVER = fileURLToPath(
  new URL('../../../server/src/main.ts', import.meta.url),
);
/** Seeds a data directory with two Work orders, and a Cell with an open question on one of them. */
const SEED = fileURLToPath(
  new URL(
    '../../../../packages/factory-runtime/src/__tests__/fixtures/seed-order.ts',
    import.meta.url,
  ),
);

const CELL = '01J0000000000000000000000W';
const ANSWERABLE = 'software-factory:todo-a';
const PLAIN = 'software-factory:todo-b';

const scratch = (): string => mkdtempSync(join(tmpdir(), 'factory-cli-'));

/** A config file that does not exist, so the developer's own settings never reach a test. */
const noConfig = (dataDir: string): string => join(dataDir, 'no-config.json');

const env = (dataDir: string): Record<string, string> => {
  const base: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) base[key] = value;
  }
  base.FACTORY_CONFIG = noConfig(dataDir);
  delete base.FACTORY_DATA_DIR;
  return base;
};

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs one `factory` command against a data directory and waits for it to finish. */
const factory = async (dataDir: string, args: string[]): Promise<Run> => {
  const child = Bun.spawn(
    [process.execPath, CLI, ...args, '--data-dir', dataDir, '--no-color'],
    { stdout: 'pipe', stderr: 'pipe', env: env(dataDir) },
  );
  const code = await child.exited;
  return {
    code,
    stdout: await new Response(child.stdout).text(),
    stderr: await new Response(child.stderr).text(),
  };
};

const waitFor = async (condition: () => boolean, ms: number): Promise<void> => {
  for (let waited = 0; waited < ms; waited += 50) {
    if (condition()) return;
    await Bun.sleep(50);
  }
  throw new Error('the condition did not come true in time');
};

/** Starts `factory run` (the real server, as the CLI starts it) and waits until its socket answers. */
const startRun = async (dataDir: string): Promise<Bun.Subprocess> => {
  const child = Bun.spawn(
    [process.execPath, CLI, 'run', '--data-dir', dataDir, '--no-color'],
    { stdout: 'pipe', stderr: 'pipe', env: env(dataDir) },
  );
  await waitFor(() => existsSync(join(dataDir, 'factory.sock')), 10_000);
  return child;
};

const stop = async (child: Bun.Subprocess): Promise<number> => {
  child.kill('SIGTERM');
  return child.exited;
};

/** Seeds a data directory before a server starts (the runtime is opened by the fixture, not the CLI). */
const seed = async (dataDir: string, plain: boolean): Promise<void> => {
  const child = Bun.spawn(
    [process.execPath, SEED, dataDir, ...(plain ? ['--plain'] : [])],
    { stdout: 'pipe', stderr: 'pipe', env: env(dataDir) },
  );
  const code = await child.exited;
  if (code !== 0) {
    throw new Error(
      `seeding failed: ${await new Response(child.stderr).text()}`,
    );
  }
};

describe('factory against a running server', () => {
  let dataDir: string;
  let server: Bun.Subprocess;

  beforeAll(async () => {
    dataDir = scratch();
    await seed(dataDir, false);
    server = await startRun(dataDir);
  });

  afterAll(async () => {
    await stop(server);
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('status prints the board: both Work orders and their states', async () => {
    const result = await factory(dataDir, ['status']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(ANSWERABLE);
    expect(result.stdout).toContain('waiting_answer');
    expect(result.stdout).toContain(PLAIN);
    expect(result.stdout).toContain('queued');
  });

  it('status --json prints the board rows as JSON, with no colour codes', async () => {
    const result = await factory(dataDir, ['status', '--json']);

    const body = JSON.parse(result.stdout) as { orders: { orderId: string }[] };
    expect(body.orders.map((order) => order.orderId).sort()).toEqual([
      ANSWERABLE,
      PLAIN,
    ]);
    expect(result.stdout).not.toContain('\u001b');
  });

  it('status --watch --frames 1 prints one board and stops', async () => {
    const result = await factory(dataDir, [
      'status',
      '--watch',
      '--frames',
      '1',
    ]);

    expect(result.stdout.match(/^ORDER/gm)).toHaveLength(1);
  });

  it('show prints the open question and the Cycle of a Work order', async () => {
    const result = await factory(dataDir, ['show', ANSWERABLE]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('question');
    expect(result.stdout).toContain('Which branch?');
    expect(result.stdout).toContain('cycles');
  });

  it('show --json prints the order and its full Traveler', async () => {
    const result = await factory(dataDir, ['show', ANSWERABLE, '--json']);

    const body = JSON.parse(result.stdout) as {
      order: { orderId: string };
      events: { event: { type: string } }[];
    };
    expect(body.order.orderId).toBe(ANSWERABLE);
    expect(body.events.map((stored) => stored.event.type)).toContain(
      'question_asked',
    );
  });

  it('log prints the Traveler in order, from creation to the question', async () => {
    const result = await factory(dataDir, ['log', ANSWERABLE]);

    const types = result.stdout
      .split('\n')
      .map((line) => line.trim().split(/\s+/)[2]);
    expect(types.indexOf('order_created')).toBeLessThan(
      types.indexOf('cycle_started'),
    );
    expect(types.indexOf('cycle_started')).toBeLessThan(
      types.indexOf('question_asked'),
    );
  });

  it('log -f prints an event that is appended after the follower started', async () => {
    const out = join(dataDir, 'follow.txt');
    const follower = Bun.spawn(
      [
        process.execPath,
        CLI,
        'log',
        PLAIN,
        '-f',
        '--data-dir',
        dataDir,
        '--no-color',
      ],
      { stdout: Bun.file(out), stderr: 'pipe', env: env(dataDir) },
    );
    try {
      await Bun.sleep(1_500);

      await factory(dataDir, ['prio', PLAIN, 'low']);

      await waitFor(
        () =>
          existsSync(out) &&
          readFileSync(out, 'utf8').includes('priority_changed'),
        10_000,
      );
    } finally {
      follower.kill('SIGTERM');
      await follower.exited;
    }
    expect(readFileSync(out, 'utf8')).toContain('priority_changed');
  });

  it('answer records the answer to the open question, once', async () => {
    const answered = await factory(dataDir, ['answer', ANSWERABLE, 'main']);
    const again = await factory(dataDir, ['answer', ANSWERABLE, 'main']);
    const detail = await factory(dataDir, ['show', ANSWERABLE]);

    expect(answered.code).toBe(0);
    expect(answered.stdout).toContain(`answered ${ANSWERABLE}`);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain('no open question');
    expect(detail.stdout).not.toContain('question  ');
  });

  it('prio sets the priority, and refuses a level it does not know', async () => {
    const set = await factory(dataDir, ['prio', PLAIN, 'high']);
    const board = await factory(dataDir, ['status']);
    const wrong = await factory(dataDir, ['prio', PLAIN, 'urgent']);

    expect(set.code).toBe(0);
    expect(set.stdout).toContain('priority high');
    expect(board.stdout).toContain('high');
    expect(wrong.code).toBe(1);
    expect(wrong.stderr).toContain('must be one of: high, medium, low');
  });

  it('nudge types into a live Operator pane when the Work order has one', async () => {
    const result = await factory(dataDir, ['nudge', ANSWERABLE, 'keep going']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`nudged ${ANSWERABLE}`);
  });

  it('resume is refused with the reason when there is no Andon', async () => {
    const result = await factory(dataDir, ['resume', ANSWERABLE]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('refused: no Andon is raised');
  });

  it('reopen is refused with the reason when the Work order is not delivered', async () => {
    const result = await factory(dataDir, [
      'reopen',
      ANSWERABLE,
      '--from',
      'plan',
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'only a delivered Work order can be reopened',
    );
  });

  it('cancel ends a Work order, and the board shows it cancelled', async () => {
    const result = await factory(dataDir, [
      'cancel',
      PLAIN,
      '--reason',
      'not needed',
    ]);
    const detail = await factory(dataDir, ['show', PLAIN, '--json']);

    expect(result.code).toBe(0);
    expect(JSON.parse(detail.stdout).order.status).toBe('cancelled');
  });

  it('cells lists the enrolled Cell, and cells rm revokes it', async () => {
    const before = await factory(dataDir, ['cells']);
    const revoked = await factory(dataDir, ['cells', 'rm', CELL]);
    const after = await factory(dataDir, ['cells']);

    expect(before.stdout).toContain(CELL);
    expect(before.stdout).toContain('active');
    expect(revoked.stdout).toContain(`revoked ${CELL}`);
    expect(after.stdout).toContain('revoked');
  });

  it('cells token create prints the token once; ls shows it without the value; rm revokes it', async () => {
    const created = await factory(dataDir, [
      'cells',
      'token',
      'create',
      '--ttl',
      '1h',
      '--name',
      'pool',
    ]);
    const token = created.stdout.trim();
    const id = /join token (\S+) \(pool\)/.exec(created.stderr)?.[1];
    const listed = await factory(dataDir, ['cells', 'token', 'ls']);
    const removed = await factory(dataDir, ['cells', 'token', 'rm', id ?? '']);

    expect(created.code).toBe(0);
    expect(token.length).toBeGreaterThan(20);
    expect(created.stderr).toContain('shown once');
    expect(listed.stdout).toContain(id ?? '~');
    expect(listed.stdout).not.toContain(token);
    expect(removed.stdout).toContain(`revoked join token ${id}`);
  });

  it('cells token ttl must read like 30s, 20m or 1h', async () => {
    const result = await factory(dataDir, [
      'cells',
      'token',
      'create',
      '--ttl',
      'soon',
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--ttl must look like 30s, 20m or 1h');
  });

  it('admin export writes the Factory archive to the file it names', async () => {
    const file = join(dataDir, 'export.tar');

    const result = await factory(dataDir, ['admin', 'export', file]);
    const listing = Bun.spawnSync(['tar', '-tf', file]);

    expect(result.code).toBe(0);
    expect(existsSync(file)).toBe(true);
    expect(listing.stdout.toString()).toContain('manifest.json');
    expect(listing.stdout.toString()).toContain('events.jsonl');
  });

  it('sync asks the server to run intake, and says so when intake is not wired (v2-10)', async () => {
    const result = await factory(dataDir, ['sync']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('intake is not built yet (v2-10)');
    expect(result.stderr).toContain('nothing was synced');
  });

  it('check validates the definitions offline', async () => {
    const result = await factory(dataDir, ['check']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('definitions pass');
  });
});

describe('factory with no server running', () => {
  let dataDir: string;

  beforeAll(async () => {
    dataDir = scratch();
    await seed(dataDir, true);
  });

  afterAll(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('a read runs one command under the lock, and leaves no socket behind', async () => {
    const result = await factory(dataDir, ['status']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(ANSWERABLE);
    expect(existsSync(join(dataDir, 'factory.sock'))).toBe(false);
  });

  it('a write runs one command as a subprocess that exits, and the lock is free after it', async () => {
    const started = performance.now();

    const write = await factory(dataDir, ['prio', ANSWERABLE, 'high']);
    const elapsed = performance.now() - started;
    const board = await factory(dataDir, ['status']);

    expect(write.code).toBe(0);
    expect(write.stdout).toContain('priority high');
    expect(board.stdout).toContain('high');
    expect(elapsed).toBeLessThan(10_000);
    expect(existsSync(join(dataDir, 'factory.sock'))).toBe(false);
  });
});

describe('a second server', () => {
  let dataDir: string;
  let server: Bun.Subprocess;

  beforeAll(async () => {
    dataDir = scratch();
    await seed(dataDir, true);
    server = await startRun(dataDir);
  });

  afterAll(async () => {
    await stop(server);
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('is refused by the writer lock while the first server runs, and reads still succeed', async () => {
    const second = await factory(dataDir, ['run']);
    const read = await factory(dataDir, ['status']);

    expect(second.code).toBe(1);
    expect(second.stderr).toContain('another factory-server holds');
    expect(read.code).toBe(0);
    expect(read.stdout).toContain(PLAIN);
  });
});

/** Socket inodes a process holds, from its file descriptors. */
const socketInodes = (pid: number): Set<string> => {
  const inodes = new Set<string>();
  for (const fd of readdirSync(`/proc/${pid}/fd`)) {
    try {
      const match = /^socket:\[(\d+)\]$/.exec(
        readlinkSync(`/proc/${pid}/fd/${fd}`),
      );
      if (match?.[1]) inodes.add(match[1]);
    } catch {
      // The descriptor closed while we looked.
    }
  }
  return inodes;
};

/** Inodes of TCP sockets in LISTEN state, from the kernel's tables. */
const listeningTcpInodes = (): Set<string> => {
  const inodes = new Set<string>();
  for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
    const rows = readFileSync(table, 'utf8').split('\n').slice(1);
    for (const row of rows) {
      const fields = row.trim().split(/\s+/);
      if (fields[3] === '0A' && fields[9]) inodes.add(fields[9]);
    }
  }
  return inodes;
};

describe('no network listener', () => {
  it('the server holds a Unix socket and no TCP listening socket, while commands run', async () => {
    const dataDir = scratch();
    await seed(dataDir, true);
    const server = Bun.spawn(
      [process.execPath, SERVER, '--data-dir', dataDir],
      { stdout: 'pipe', stderr: 'pipe', env: env(dataDir) },
    );
    try {
      await waitFor(() => existsSync(join(dataDir, 'factory.sock')), 10_000);
      await factory(dataDir, ['status']);
      await factory(dataDir, ['prio', ANSWERABLE, 'low']);

      const listening = listeningTcpInodes();
      const owned = [...socketInodes(server.pid)];

      expect(owned.some((inode) => listening.has(inode))).toBe(false);
      expect(owned.length).toBeGreaterThan(0);
    } finally {
      await stop(server);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('a one-shot run holds no listening socket either', async () => {
    const dataDir = scratch();
    await seed(dataDir, true);
    const oneShot = Bun.spawn(
      [process.execPath, SERVER, '--once', '--data-dir', dataDir],
      { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: env(dataDir) },
    );
    try {
      await Bun.sleep(1_000);

      const listening = listeningTcpInodes();
      const owned = [...socketInodes(oneShot.pid)];

      expect(owned.some((inode) => listening.has(inode))).toBe(false);
    } finally {
      oneShot.stdin?.end();
      await oneShot.exited;
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
