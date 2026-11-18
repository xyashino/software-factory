import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app';
import { createSafeTokenAuth } from './adapters/auth/safe-token-auth.adapter';
import { createClaimWaiters } from './adapters/memory/claim-waiters.adapter';
import { createSystemClock } from './adapters/memory/system-clock.adapter';
import { createTransitionBus } from './adapters/memory/transition-bus.adapter';
import { mintAdminToken } from './bootstrap/admin';
import { createTransport } from './bootstrap/transport';
import { DEFAULT_DB_PATH, DEFAULT_HOST, DEFAULT_PORT } from './config';
import { createDb } from './db/client';

const ADMIN_TOKEN_CREATE = 'admin token create';

const dbPath = process.env.FACTORY_DB_PATH ?? DEFAULT_DB_PATH;
mkdirSync(dirname(dbPath), { recursive: true });
const db = createDb(dbPath);
const clock = createSystemClock();

if (process.argv.slice(2).join(' ') === ADMIN_TOKEN_CREATE) {
  process.stdout.write(`${mintAdminToken(db, clock)}\n`);
} else {
  const port = Number(process.env.FACTORY_PORT ?? DEFAULT_PORT);
  const hostname = process.env.FACTORY_HOST ?? DEFAULT_HOST;
  const app = createApp(
    createTransport({
      db,
      clock,
      auth: createSafeTokenAuth(db, clock),
      claimWaiters: createClaimWaiters(),
      transitionBus: createTransitionBus(),
    }),
  );
  Bun.serve({ port, hostname, fetch: app.fetch });
  process.stdout.write(
    `factory-server listening on http://${hostname}:${port} (db ${dbPath})\n`,
  );
}
