import type { z } from 'zod';
import {
  answerRequestSchema,
  boardResponseSchema,
  cancelRequestSchema,
  emptyRequestSchema,
  nudgeRequestSchema,
  orderDetailRequestSchema,
  orderDetailResponseSchema,
  reopenRequestSchema,
  reprioritiseRequestSchema,
  resumeRequestSchema,
  workerRevokeRequestSchema,
  workerRevokeResponseSchema,
  workersListResponseSchema,
} from './supervisor';
import {
  blobGetRequestSchema,
  blobGetResponseSchema,
  blobPutRequestSchema,
  blobPutResponseSchema,
  claimRequestSchema,
  claimResponseSchema,
  commandResultSchema,
  heartbeatRequestSchema,
  heartbeatResponseSchema,
  helloRequestSchema,
  helloResponseSchema,
  submitCommandRequestSchema,
} from './worker';

/**
 * The one route table (PROTOCOL §3). The server dispatches on it and the socket client calls it,
 * so each payload is written once. Every route is `POST /v1/<path>` with a JSON body.
 */
export const ROUTES = {
  hello: {
    path: 'worker/hello',
    request: helloRequestSchema,
    response: helloResponseSchema,
  },
  claim: {
    path: 'worker/claim',
    request: claimRequestSchema,
    response: claimResponseSchema,
  },
  heartbeat: {
    path: 'worker/heartbeat',
    request: heartbeatRequestSchema,
    response: heartbeatResponseSchema,
  },
  submitCommand: {
    path: 'worker/command',
    request: submitCommandRequestSchema,
    response: commandResultSchema,
  },
  blobPut: {
    path: 'blobs/put',
    request: blobPutRequestSchema,
    response: blobPutResponseSchema,
  },
  blobGet: {
    path: 'blobs/get',
    request: blobGetRequestSchema,
    response: blobGetResponseSchema,
  },
  board: {
    path: 'supervisor/board',
    request: emptyRequestSchema,
    response: boardResponseSchema,
  },
  orderDetail: {
    path: 'supervisor/order',
    request: orderDetailRequestSchema,
    response: orderDetailResponseSchema,
  },
  answer: {
    path: 'supervisor/answer',
    request: answerRequestSchema,
    response: commandResultSchema,
  },
  nudge: {
    path: 'supervisor/nudge',
    request: nudgeRequestSchema,
    response: commandResultSchema,
  },
  cancel: {
    path: 'supervisor/cancel',
    request: cancelRequestSchema,
    response: commandResultSchema,
  },
  reprioritise: {
    path: 'supervisor/reprioritise',
    request: reprioritiseRequestSchema,
    response: commandResultSchema,
  },
  resume: {
    path: 'supervisor/resume',
    request: resumeRequestSchema,
    response: commandResultSchema,
  },
  reopen: {
    path: 'supervisor/reopen',
    request: reopenRequestSchema,
    response: commandResultSchema,
  },
  workersList: {
    path: 'supervisor/workers',
    request: emptyRequestSchema,
    response: workersListResponseSchema,
  },
  workerRevoke: {
    path: 'supervisor/workers/revoke',
    request: workerRevokeRequestSchema,
    response: workerRevokeResponseSchema,
  },
} as const;

export type RouteName = keyof typeof ROUTES;
export type RouteRequest<K extends RouteName> = z.input<
  (typeof ROUTES)[K]['request']
>;
export type RouteResponse<K extends RouteName> = z.output<
  (typeof ROUTES)[K]['response']
>;

/** The parsed form of a request body: what the handler receives after validation. */
export type ParsedRequest<K extends RouteName> = z.output<
  (typeof ROUTES)[K]['request']
>;

/** Looks a route up by its path, or undefined for an unknown path. */
export const routeByPath = (path: string): RouteName | undefined =>
  (Object.keys(ROUTES) as RouteName[]).find(
    (name) => ROUTES[name].path === path,
  );
