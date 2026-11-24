import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from '@repo/hq/src/app';
import { createClaimWaiters } from '@repo/hq/src/adapters/memory/claim-waiters.adapter';
import { createSystemClock } from '@repo/hq/src/adapters/memory/system-clock.adapter';
import { createTransitionBus } from '@repo/hq/src/adapters/memory/transition-bus.adapter';
import type {
  AuthPort,
  TokenScope,
} from '@repo/hq/src/application/ports/auth.port';
import { createTransport } from '@repo/hq/src/bootstrap/transport';
import { createDb } from '@repo/hq/src/db/client';
import { factories } from '@repo/hq/src/db/schema/factories';
import { asFactoryId, asTokenId } from '@repo/hq/src/domain/common/brand';
import { queueReplyOf } from './queue-reply';
import type { QueueImportBody, QueueImportReply } from './ports';

const LOCAL_FACTORY_ID = 'fac_local';
const LOCAL_FACTORY_NAME = 'local';
const LOCAL_TOKEN_ID = 'tok_local';
const LOCAL_SCOPES: readonly TokenScope[] = [
  'supervisor:read',
  'supervisor:write',
  'factory:worker',
];
const LOCAL_ORIGIN = 'http://local';
const TOKEN_BYTES = 32;
const JSON_TYPE = 'application/json';

export interface LocalProject {
  projectId: string;
  repoUrl: string;
  defaultBaseBranch: string;
  maxRunning?: number;
}

export interface LocalEngine {
  readonly localToken: string;
  fetch(request: Request): Promise<Response>;
  ensureProject(input: LocalProject): Promise<void>;
  importQueue(body: QueueImportBody): Promise<QueueImportReply>;
  goneCell(cellId: string): Promise<void>;
}

const loopbackAuthOf = (localToken: string): AuthPort => ({
  verify: (bearer) =>
    Promise.resolve(
      bearer === localToken
        ? {
            tokenId: asTokenId(LOCAL_TOKEN_ID),
            factoryId: asFactoryId(LOCAL_FACTORY_ID),
            scopes: LOCAL_SCOPES,
          }
        : null,
    ),
});

export const createLocalEngine = (options: { dbPath: string }): LocalEngine => {
  mkdirSync(dirname(options.dbPath), { recursive: true });
  const db = createDb(options.dbPath);
  const clock = createSystemClock();
  const localToken = randomBytes(TOKEN_BYTES).toString('hex');
  const app = createApp(
    createTransport({
      db,
      clock,
      auth: loopbackAuthOf(localToken),
      claimWaiters: createClaimWaiters(),
      transitionBus: createTransitionBus(),
    }),
  );
  const now = clock.now();
  db.insert(factories)
    .values({
      factoryId: asFactoryId(LOCAL_FACTORY_ID),
      name: LOCAL_FACTORY_NAME,
      lastSeenAt: now,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: factories.factoryId,
      set: { lastSeenAt: now },
    })
    .run();

  const call = async (
    method: string,
    path: string,
    body: unknown = undefined,
  ): Promise<Response> =>
    app.fetch(
      new Request(`${LOCAL_ORIGIN}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${localToken}`,
          'content-type': JSON_TYPE,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );

  return {
    localToken,
    fetch: async (request) => app.fetch(request),
    ensureProject: async (input) => {
      const reply = await call('POST', '/api/v1/projects', input);
      if (!reply.ok) {
        throw new Error(`local project upsert failed with ${reply.status}`);
      }
    },
    importQueue: async (body) =>
      queueReplyOf(await call('POST', '/api/v1/queue/import', body)),
    goneCell: async (cellId) => {
      await call(
        'POST',
        `/api/v1/factories/cells/${encodeURIComponent(cellId)}/gone`,
      );
    },
  };
};
