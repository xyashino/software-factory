import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectId } from '@repo/factory-core/ids';
import {
  openRuntime,
  type OpenedRuntime,
} from '@repo/factory-runtime/open-runtime';
import { seedProject } from '@repo/factory-runtime/seed';
import { createHttpApp } from '../http/app';
import { pullRequestStateOf, signatureOf } from '../http/github-webhook';

const PROJECT = 'software-factory' as ProjectId;
const SECRET = 'webhook-secret';
const PATH = '/v1/webhooks/github';
const PR_URL = 'https://github.test/fake/software-factory/pull/7';

let root: string;
let opened: OpenedRuntime;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'factory-webhook-'));
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  seedProject(dataDir, {
    projectId: PROJECT,
    repoUrl: 'https://example.test/software-factory.git',
  });
  opened = openRuntime({ dataDir });
});

afterEach(() => {
  opened.close();
  rmSync(root, { recursive: true, force: true });
});

interface Delivery {
  event?: string | null;
  deliveryId?: string | null;
  signature?: string | null;
  secret?: string;
  payload?: unknown;
}

/** One GitHub delivery as the webhook receives it: headers and the raw body, signed unless told not to. */
const deliver = async (
  app: ReturnType<typeof createHttpApp>,
  options: Delivery = {},
): Promise<Response> => {
  const text = JSON.stringify(
    options.payload ?? {
      action: 'opened',
      pull_request: { html_url: PR_URL, merged: false },
    },
  );
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  const event = options.event === undefined ? 'pull_request' : options.event;
  if (event !== null) headers['x-github-event'] = event;
  const deliveryId =
    options.deliveryId === undefined ? 'delivery-1' : options.deliveryId;
  if (deliveryId !== null) headers['x-github-delivery'] = deliveryId;
  const signature =
    options.signature === undefined
      ? signatureOf(options.secret ?? SECRET, text)
      : options.signature;
  if (signature !== null) headers['x-hub-signature-256'] = signature;
  return app.request(PATH, { method: 'POST', headers, body: text });
};

describe('the GitHub webhook refusals (PROTOCOL §3.6)', () => {
  it('answers 503 not_configured when the server has no webhook secret', async () => {
    const app = createHttpApp(opened.runtime);

    const response = await deliver(app);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: 'not_configured' });
  });

  it('answers 401 when the signature was made with another secret', async () => {
    const app = createHttpApp(opened.runtime, { githubWebhookSecret: SECRET });

    const response = await deliver(app, { secret: 'someone-else' });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: 'unauthorized' });
  });

  it('answers 401 when the signature header is missing', async () => {
    const app = createHttpApp(opened.runtime, { githubWebhookSecret: SECRET });

    const response = await deliver(app, { signature: null });

    expect(response.status).toBe(401);
  });

  it('answers 422 for a signed delivery that names no delivery id', async () => {
    const app = createHttpApp(opened.runtime, { githubWebhookSecret: SECRET });

    const response = await deliver(app, { deliveryId: null });

    expect(response.status).toBe(422);
    expect((await response.json()) as { code: string }).toMatchObject({
      code: 'invalid',
    });
  });
});

describe('the GitHub webhook events (PROTOCOL §3.6)', () => {
  it('acknowledges an event that is not a pull request and records nothing', async () => {
    const app = createHttpApp(opened.runtime, { githubWebhookSecret: SECRET });

    const response = await deliver(app, { event: 'push' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recorded: 0, ignored: 'event' });
  });

  it('acknowledges a pull request action that changes no state', async () => {
    const app = createHttpApp(opened.runtime, { githubWebhookSecret: SECRET });

    const response = await deliver(app, {
      payload: {
        action: 'synchronize',
        pull_request: { html_url: PR_URL, merged: false },
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recorded: 0, ignored: 'action' });
  });

  it('records nothing for an opened pull request that no Work order or plan holds', async () => {
    const app = createHttpApp(opened.runtime, { githubWebhookSecret: SECRET });

    const response = await deliver(app);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recorded: 0 });
  });
});

describe('the pull request action to state mapping', () => {
  it('reads opened and reopened as open, closed as merged or closed by its merged flag', () => {
    expect(pullRequestStateOf('opened', false)).toBe('open');
    expect(pullRequestStateOf('reopened', false)).toBe('open');
    expect(pullRequestStateOf('closed', true)).toBe('merged');
    expect(pullRequestStateOf('closed', false)).toBe('closed');
  });

  it('reads any other action as no state change', () => {
    expect(pullRequestStateOf('edited', false)).toBeUndefined();
    expect(pullRequestStateOf('synchronize', false)).toBeUndefined();
  });
});
