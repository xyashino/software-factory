import { createHmac, timingSafeEqual } from 'node:crypto';
import { invalidWire } from '@repo/factory-core/contracts/errors';
import type { PrState } from '@repo/factory-core/ports/pr-state';
import type { Runtime } from '@repo/factory-runtime/composition';
import { failureResponse, jsonResponse, refusedResponse } from '../wire';

// `POST /v1/webhooks/github`: GitHub reports a pull request's state here, so the server
// never calls `gh`. The route sits outside bearer auth; the HMAC of the raw body is its credential.

const MAX_DELIVERY_ID = 128;

/** The signature GitHub sends: `sha256=<hex HMAC-SHA256 of the raw body>` (X-Hub-Signature-256). */
export const signatureOf = (secret: string, body: string): string =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

// Compares two signatures in constant time; a missing or differently sized header never matches.
const sameSignature = (expected: string, actual: string | null): boolean => {
  if (actual === null) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
};

/** The state a `pull_request` event records, or undefined for an action that changes no state. */
export const pullRequestStateOf = (
  action: unknown,
  merged: unknown,
): PrState | undefined => {
  if (action === 'opened' || action === 'reopened') return 'open';
  if (action === 'closed') return merged === true ? 'merged' : 'closed';
  return undefined;
};

interface PullRequestPayload {
  action?: unknown;
  pull_request?: { html_url?: unknown; merged?: unknown };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Serves one GitHub delivery. Without a secret the route is `503 not_configured`; a bad or missing
 * signature is `401`. A `pull_request` `opened`, `reopened` or `closed` event records the pull request's
 * state on every Work order and Order Plan holding its URL, with the delivery id as the command id, so a
 * redelivery records nothing new. Every other event is acknowledged and ignored.
 */
export const serveGithubWebhook = async (
  runtime: Runtime,
  request: Request,
  secret: string | undefined,
): Promise<Response> => {
  if (secret === undefined) return refusedResponse({ code: 'not_configured' });
  const body = await request.text();
  const signature = request.headers.get('x-hub-signature-256');
  if (!sameSignature(signatureOf(secret, body), signature)) {
    return refusedResponse({ code: 'unauthorized' });
  }
  const deliveryId = request.headers.get('x-github-delivery') ?? '';
  if (deliveryId.length === 0 || deliveryId.length > MAX_DELIVERY_ID) {
    return refusedResponse(
      invalidWire([
        { path: ['x-github-delivery'], message: 'a delivery id is required' },
      ]),
    );
  }
  if (request.headers.get('x-github-event') !== 'pull_request') {
    return jsonResponse(200, { recorded: 0, ignored: 'event' });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body) as unknown;
  } catch {
    return refusedResponse(
      invalidWire([{ path: [], message: 'the body is not JSON' }]),
    );
  }
  const event: PullRequestPayload = isObject(payload) ? payload : {};
  const state = pullRequestStateOf(event.action, event.pull_request?.merged);
  const prUrl = event.pull_request?.html_url;
  if (state === undefined || typeof prUrl !== 'string') {
    return jsonResponse(200, { recorded: 0, ignored: 'action' });
  }
  try {
    const recorded = await runtime.recordPullRequest({
      deliveryId,
      prUrl,
      state,
    });
    return jsonResponse(200, { recorded });
  } catch (error) {
    return failureResponse(error, 'POST /v1/webhooks/github');
  }
};
