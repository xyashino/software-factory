import { afterEach, describe, expect, it, vi } from 'vitest';
import { transitionDto } from '@repo/hq-contracts/stream.contract';
import { projects } from '../../src/db/schema/projects';
import { stateTransitions } from '../../src/db/schema/transitions';
import { createTransitionBus } from '../../src/adapters/memory/transition-bus.adapter';
import { mintAdminToken } from '../../src/bootstrap/admin';
import { hashToken } from '../../src/application/tokens/token-hash';
import type { TransitionBusPort } from '../../src/application/ports/transition-bus.port';
import { asProjectId, type ProjectId } from '../../src/domain/common/brand';
import type { StateTransitionRecord } from '../../src/domain/common/events';
import type { Db } from '../../src/db/client';
import {
  createTestApp,
  grantingAuth,
  postJson,
  VALID_TOKEN,
  type TestApp,
} from '../support/test-app';
import { seedBaseline } from '../support/test-db';

const PROJECT_ID = 'proj-1';
const OTHER_PROJECT_ID = 'proj-2';
const SEED_AT = 1_700_000_000_000;
const AUTH_HEADERS = { authorization: `Bearer ${VALID_TOKEN}` };

type SseEvent = { event: string; id: string; data: string };

type ErrorBody = { code: number; type: string };

const controllers: AbortController[] = [];

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.abort();
});

const transitionFields = (
  projectId: ProjectId,
  toState: string,
): Omit<StateTransitionRecord, 'seq'> => ({
  projectId,
  entityType: 'work_order',
  entityId: 'order-1',
  fromState: 'queued',
  toState,
  actorKind: 'system',
  actorId: null,
  actorLabel: null,
  commandId: null,
  meta: null,
  at: SEED_AT,
});

const commitTransition = (
  db: Db,
  bus: TransitionBusPort,
  projectId: string,
  toState: string,
): void => {
  const fields = transitionFields(asProjectId(projectId), toState);
  const { seq } = db
    .insert(stateTransitions)
    .values({
      projectId: fields.projectId,
      entityType: fields.entityType,
      entityId: fields.entityId,
      fromState: fields.fromState,
      toState: fields.toState,
      actorKind: fields.actorKind,
      actorId: fields.actorId,
      actorLabel: fields.actorLabel,
      commandId: fields.commandId,
      metaJson: fields.meta,
      at: fields.at,
    })
    .returning({ seq: stateTransitions.seq })
    .get();
  bus.publish([{ ...fields, seq }]);
};

const seedOtherProject = (db: Db): void => {
  db.insert(projects)
    .values({
      projectId: asProjectId(OTHER_PROJECT_ID),
      repoUrl: 'git@example.test:acme/other.git',
      defaultBaseBranch: 'main',
      maxRunning: 1,
      createdAt: SEED_AT,
      updatedAt: SEED_AT,
    })
    .run();
};

const parseEvents = (text: string): SseEvent[] =>
  text
    .split('\n\n')
    .filter((block) => block.includes('event: '))
    .map((block) => {
      const field = (name: string): string =>
        block
          .split('\n')
          .find((line) => line.startsWith(`${name}: `))
          ?.slice(name.length + 2) ?? '';
      return { event: field('event'), id: field('id'), data: field('data') };
    });

const openSse = (response: Response) => {
  if (response.body === null) throw new Error('Expected a streaming body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let consumed = 0;
  return {
    async take(count: number): Promise<SseEvent[]> {
      while (parseEvents(text).length < consumed + count) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
      }
      const events = parseEvents(text).slice(consumed, consumed + count);
      consumed += events.length;
      return events;
    },
  };
};

const openStream = (app: TestApp, query = '', headers = AUTH_HEADERS) => {
  const controller = new AbortController();
  controllers.push(controller);
  return Promise.resolve(
    app.request(`/api/v1/stream${query}`, {
      headers,
      signal: controller.signal,
    }),
  ).then((response) => ({ response, sse: openSse(response) }));
};

const seqsOf = (events: SseEvent[]): string[] => events.map((e) => e.id);

describe('GET /api/v1/stream', () => {
  it('replays the backlog after afterSeq in seq order, then streams live events', async () => {
    const { app, db, transitionBus } = createTestApp({
      auth: grantingAuth(['supervisor:read']),
    });
    seedBaseline(db);
    commitTransition(db, transitionBus, PROJECT_ID, 'step-1');
    commitTransition(db, transitionBus, PROJECT_ID, 'step-2');
    commitTransition(db, transitionBus, PROJECT_ID, 'step-3');
    const { sse } = await openStream(app, '?afterSeq=1');

    const backlog = await sse.take(2);
    commitTransition(db, transitionBus, PROJECT_ID, 'step-4');
    const live = await sse.take(1);

    expect(seqsOf(backlog)).toEqual(['2', '3']);
    expect(seqsOf(live)).toEqual(['4']);
  });

  it('replays the full backlog from the start when afterSeq is omitted', async () => {
    const { app, db, transitionBus } = createTestApp({
      auth: grantingAuth(['supervisor:read']),
    });
    seedBaseline(db);
    commitTransition(db, transitionBus, PROJECT_ID, 'step-1');
    commitTransition(db, transitionBus, PROJECT_ID, 'step-2');
    const { sse } = await openStream(app);

    const events = await sse.take(2);

    expect(seqsOf(events)).toEqual(['1', '2']);
  });

  it('excludes other projects from backlog and live events when projectId is given', async () => {
    const { app, db, transitionBus } = createTestApp({
      auth: grantingAuth(['supervisor:read']),
    });
    seedBaseline(db);
    seedOtherProject(db);
    commitTransition(db, transitionBus, PROJECT_ID, 'step-1');
    commitTransition(db, transitionBus, OTHER_PROJECT_ID, 'step-2');
    commitTransition(db, transitionBus, PROJECT_ID, 'step-3');
    const { sse } = await openStream(app, `?projectId=${PROJECT_ID}`);

    const backlog = await sse.take(2);
    commitTransition(db, transitionBus, OTHER_PROJECT_ID, 'step-4');
    commitTransition(db, transitionBus, PROJECT_ID, 'step-5');
    const live = await sse.take(1);

    expect(seqsOf(backlog)).toEqual(['1', '3']);
    expect(seqsOf(live)).toEqual(['5']);
  });

  it('sends each transition as a transition event with seq id and matching JSON data', async () => {
    const { app, db, transitionBus } = createTestApp({
      auth: grantingAuth(['supervisor:read']),
    });
    seedBaseline(db);
    commitTransition(db, transitionBus, PROJECT_ID, 'step-1');
    const { sse } = await openStream(app);

    const [event] = await sse.take(1);
    const record = transitionDto.parse(JSON.parse(event?.data ?? 'null'));

    expect(event?.event).toBe('transition');
    expect(event?.id).toBe('1');
    expect(record).toMatchObject({
      seq: 1,
      projectId: PROJECT_ID,
      entityType: 'work_order',
      entityId: 'order-1',
      fromState: 'queued',
      toState: 'step-1',
      actorKind: 'system',
    });
  });

  it('labels a transition with the name of the token that caused it, never the secret', async () => {
    const { app, db, storage, clock } = createTestApp({ safeTokenAuth: true });
    seedBaseline(db);
    const token = await mintAdminToken(storage, clock);
    const headers = { authorization: `Bearer ${token}` };
    const markdown = [
      '---',
      'line: feature',
      '---',
      '',
      '# pay-schema: Add schema',
      '',
    ].join('\n');
    const imported = await postJson(
      app,
      '/api/v1/queue/import',
      {
        commandId: 'import-1',
        projectId: PROJECT_ID,
        mode: 'apply',
        files: [{ filename: 'pay-schema.md', markdown }],
      },
      headers,
    );
    expect(await imported.json()).toMatchObject({ code: 200 });

    const { sse } = await openStream(app, '', headers);
    const [event] = await sse.take(1);
    const record = transitionDto.parse(JSON.parse(event?.data ?? 'null'));

    expect(record).toMatchObject({
      actorKind: 'supervisor',
      actorLabel: 'admin',
    });
    expect(event?.data).not.toContain(token);
    expect(event?.data).not.toContain(hashToken(token));
  });

  it('rejects a request without a bearer token before the stream opens', async () => {
    const { app } = createTestApp();

    const response = await app.request('/api/v1/stream');
    const body = (await response.json()) as ErrorBody;

    expect(response.status).toBe(401);
    expect(body.type).toBe('unauthorized');
  });

  it('rejects a token without supervisor:read before the stream opens', async () => {
    const { app, db } = createTestApp({ auth: grantingAuth([]) });
    seedBaseline(db);

    const response = await app.request('/api/v1/stream', {
      headers: AUTH_HEADERS,
    });
    const body = (await response.json()) as ErrorBody;

    expect(response.status).toBe(403);
    expect(body.type).toBe('forbidden');
  });

  it('rejects a non-numeric afterSeq with a bad request', async () => {
    const { app, db } = createTestApp({
      auth: grantingAuth(['supervisor:read']),
    });
    seedBaseline(db);

    const response = await app.request('/api/v1/stream?afterSeq=abc', {
      headers: AUTH_HEADERS,
    });
    const body = (await response.json()) as ErrorBody;

    expect(response.status).toBe(400);
    expect(body.type).toBe('bad-request');
  });

  it('unsubscribes from the transition bus when the client aborts', async () => {
    const inner = createTransitionBus();
    const unsubscribed = vi.fn();
    const transitionBus: TransitionBusPort = {
      publish: (transitions) => inner.publish(transitions),
      subscribe: (listener) => {
        const unsubscribe = inner.subscribe(listener);
        return () => {
          unsubscribed();
          unsubscribe();
        };
      },
    };
    const { app, db } = createTestApp({
      auth: grantingAuth(['supervisor:read']),
      transitionBus,
    });
    seedBaseline(db);
    commitTransition(db, transitionBus, PROJECT_ID, 'step-1');
    const controller = new AbortController();
    const response = await app.request('/api/v1/stream', {
      headers: AUTH_HEADERS,
      signal: controller.signal,
    });
    const sse = openSse(response);
    await sse.take(1);

    controller.abort();

    await vi.waitFor(() => expect(unsubscribed).toHaveBeenCalledTimes(1));
  });
});
