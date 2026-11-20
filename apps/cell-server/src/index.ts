import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { eq } from 'drizzle-orm';
import { createApp } from './app';
import { createFactoryClient } from './adapters/http/factory-client.adapter';
import { createEventBus } from './adapters/memory/event-bus.adapter';
import { createSystemClock } from './adapters/memory/system-clock.adapter';
import { createRepoInspector } from './adapters/fs/repo-inspector.adapter';
import { createCellSupervisor } from './adapters/supervisor/cell-supervisor.adapter';
import { createTransport } from './bootstrap/transport';
import { DEFAULT_DB_PATH, readMachineSettings } from './config';
import { createDb } from './db/client';
import { cells } from './db/schema/cells';
import { reconcileRunningSlots } from './application/procedures/cells/reconcile-running-slots';
import { readSettings } from './application/procedures/cells/cell-views';

const { host, port } = readMachineSettings(process.env);
mkdirSync(dirname(DEFAULT_DB_PATH), { recursive: true });
const db = createDb(DEFAULT_DB_PATH);
const clock = createSystemClock();
const eventBus = createEventBus();

const supervisor = createCellSupervisor({
  command: ['factory-cell'],
  restartBackoffMs: () => readSettings(db).restart_backoff_ms,
  onStatus: (slotId, report) => {
    db.update(cells)
      .set({
        runtimeStatus: report.runtimeStatus,
        pid: report.pid,
        lastError: report.lastError ?? null,
        updatedAt: clock.now(),
      })
      .where(eq(cells.slotId, slotId))
      .run();
    eventBus.publish({
      kind: report.runtimeStatus === 'failed' ? 'cell.failed' : 'cell.started',
      at: clock.now(),
      slotId,
    });
  },
});

const app = createApp(
  createTransport({
    db,
    clock,
    eventBus,
    supervisor,
    factoryClient: createFactoryClient(),
    repoInspector: createRepoInspector(),
  }),
);

Bun.serve({
  port,
  hostname: host,
  fetch: (request, server) =>
    app.fetch(request, {
      remoteAddress: server.requestIP(request)?.address ?? null,
    }),
});
process.stdout.write(
  `cell-server listening on http://${host}:${port} (db ${DEFAULT_DB_PATH})\n`,
);

void reconcileRunningSlots({ db, clock, eventBus, supervisor });

const shutdown = async (): Promise<void> => {
  await supervisor.shutdown();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
