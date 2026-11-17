import { ROUTES } from '@repo/factory-core/contracts/routes';
import {
  cellProcedure,
  callRoute,
  replyOf,
  routeInput,
  supervisorOrCellProcedure,
  type Handler,
  type Procedure,
} from '../core/procedure';

/** `blobGet`: the blob's bytes, raw, as `application/octet-stream` (PROTOCOL §3.4). */
const blobGet: Handler = async (call, transport) => {
  const { base64 } = ROUTES.blobGet.response.parse(
    await callRoute('blobGet', routeInput(call), transport, call.signal),
  );
  return {
    kind: 'bytes',
    bytes: Buffer.from(base64, 'base64'),
    mediaType: 'application/octet-stream',
  };
};

/** `blobPut`: the raw request bytes, with the request's content type as the media type. */
const blobPut: Handler = async (call, transport) => {
  if (call.body.kind !== 'bytes') {
    throw new Error('blobPut expects the raw request bytes');
  }
  const input = routeInput(call);
  input.base64 = Buffer.from(call.body.bytes).toString('base64');
  input.mediaType = call.headers.get('content-type') ?? undefined;
  return replyOf(
    'blobPut',
    await callRoute('blobPut', input, transport, call.signal),
  );
};

export const blobProcedures: readonly Procedure[] = [
  supervisorOrCellProcedure('blobGet', blobGet),
  cellProcedure('blobPut', blobPut, 'bytes'),
];
