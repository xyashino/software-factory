import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app';
import { createSafeTokenAuth } from './adapters/auth/safe-token-auth.adapter';
import { createClaimWaiters } from './adapters/memory/claim-waiters.adapter';
import { createSystemClock } from './adapters/memory/system-clock.adapter';
import { createTransitionBus } from './adapters/memory/transition-bus.adapter';
import { mintAdminToken } from './bootstrap/admin';
import { hqSettingOf } from './bootstrap/env';
import { createTransport } from './bootstrap/transport';
import { writeWebJoinFile } from './bootstrap/web-join';
import {
  DEFAULT_DATA_DIR,
  DEFAULT_HOST,
  DEFAULT_PORT,
  defaultDbPathOf,
} from './config';
import { createDb } from './db/client';

const ADMIN_TOKEN_CREATE = 'admin token create';

const dbPath =
  hqSettingOf(process.env, 'DB_PATH') ?? defaultDbPathOf(DEFAULT_DATA_DIR);
const dataDir = hqSettingOf(process.env, 'DATA_DIR') ?? dirname(dbPath);
mkdirSync(dataDir, { recursive: true });
const db = createDb(dbPath);
const clock = createSystemClock();

if (process.argv.slice(2).join(' ') === ADMIN_TOKEN_CREATE) {
  process.stdout.write(`${mintAdminToken(db, clock)}\n`);
} else {
  const port = Number(hqSettingOf(process.env, 'PORT') ?? DEFAULT_PORT);
  const hostname = hqSettingOf(process.env, 'HOST') ?? DEFAULT_HOST;
  const app = createApp(
    createTransport({
      db,
      clock,
      auth: createSafeTokenAuth(db, clock),
      claimWaiters: createClaimWaiters(),
      transitionBus: createTransitionBus(),
    }),
  );
  try {
    writeWebJoinFile(db, clock, dataDir);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    process.stderr.write(
      `factory-server: cannot write web-demo.join: ${reason}\n`,
    );
    process.exit(1);
  }
  Bun.serve({
    port,
    hostname,
    fetch: (request, server) =>
      app.fetch(request, {
        remoteAddress: server.requestIP(request)?.address ?? null,
      }),
  });
  process.stdout.write(
    `factory-server listening on http://${hostname}:${port} (db ${dbPath})\n`,
  );
}
