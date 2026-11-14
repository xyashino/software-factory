import type { z } from 'zod';
import {
  adminArchiveResponseSchema,
  adminExportResponseSchema,
  adminFileRequestSchema,
  adminRebuildResponseSchema,
  answerRequestSchema,
  boardResponseSchema,
  cancelRequestSchema,
  cellRevokeRequestSchema,
  cellRevokeResponseSchema,
  cellsListResponseSchema,
  emptyRequestSchema,
  intakeSyncRequestSchema,
  intakeSyncResponseSchema,
  joinTokenCreateRequestSchema,
  joinTokenCreateResponseSchema,
  joinTokenListResponseSchema,
  joinTokenRevokeRequestSchema,
  joinTokenRevokeResponseSchema,
  nudgeRequestSchema,
  orderDetailRequestSchema,
  orderDetailResponseSchema,
  reopenRequestSchema,
  reprioritiseRequestSchema,
  resumeRequestSchema,
  streamEventsRequestSchema,
  streamEventsResponseSchema,
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
} from './cell';

/**
 * The one route table (PROTOCOL §3). The server dispatches on it and the socket client calls it,
 * so each payload is written once. Every route is `POST /v1/<path>` with a JSON body.
 */
export const ROUTES = {
  hello: {
    path: 'cell/hello',
    request: helloRequestSchema,
    response: helloResponseSchema,
  },
  claim: {
    path: 'cell/claim',
    request: claimRequestSchema,
    response: claimResponseSchema,
  },
  heartbeat: {
    path: 'cell/heartbeat',
    request: heartbeatRequestSchema,
    response: heartbeatResponseSchema,
  },
  submitCommand: {
    path: 'cell/command',
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
  cellsList: {
    path: 'supervisor/cells',
    request: emptyRequestSchema,
    response: cellsListResponseSchema,
  },
  cellRevoke: {
    path: 'supervisor/cells/revoke',
    request: cellRevokeRequestSchema,
    response: cellRevokeResponseSchema,
  },
  supervisorEvents: {
    path: 'supervisor/events',
    request: streamEventsRequestSchema,
    response: streamEventsResponseSchema,
  },
  intakeSync: {
    path: 'supervisor/intake/sync',
    request: intakeSyncRequestSchema,
    response: intakeSyncResponseSchema,
  },
  joinTokenCreate: {
    path: 'supervisor/join-tokens/create',
    request: joinTokenCreateRequestSchema,
    response: joinTokenCreateResponseSchema,
  },
  joinTokenList: {
    path: 'supervisor/join-tokens',
    request: emptyRequestSchema,
    response: joinTokenListResponseSchema,
  },
  joinTokenRevoke: {
    path: 'supervisor/join-tokens/revoke',
    request: joinTokenRevokeRequestSchema,
    response: joinTokenRevokeResponseSchema,
  },
  adminExport: {
    path: 'supervisor/admin/export',
    request: emptyRequestSchema,
    response: adminExportResponseSchema,
  },
  adminBackup: {
    path: 'supervisor/admin/backup',
    request: adminFileRequestSchema,
    response: adminArchiveResponseSchema,
  },
  adminRebuildProjections: {
    path: 'supervisor/admin/rebuild-projections',
    request: emptyRequestSchema,
    response: adminRebuildResponseSchema,
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
