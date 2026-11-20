import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app';
import { createEventBus } from './adapters/memory/event-bus.adapter';
import { createSystemClock } from './adapters/memory/system-clock.adapter';
import { createTransport } from './bootstrap/transport';
import { DEFAULT_DB_PATH, readMachineSettings } from './config';
import { createDb } from './db/client';

const { host, port } = readMachineSettings(process.env);
mkdirSync(dirname(DEFAULT_DB_PATH), { recursive: true });
const db = createDb(DEFAULT_DB_PATH);
const app = createApp(
  createTransport({
    db,
    clock: createSystemClock(),
    eventBus: createEventBus(),
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
