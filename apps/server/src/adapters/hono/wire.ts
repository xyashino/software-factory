import {
  WIRE_STATUS,
  type WireError,
} from '@repo/factory-core/contracts/errors';

/**
 * The HTTP answers (PROTOCOL §3.5): a JSON body with a status, and a refusal in its wire form. The
 * status of a refusal is the one its code names, so an error reads the same whichever route carried it.
 */

export const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** A refusal in its wire form: the status of its code, and the wire body. */
export const refusedResponse = (error: WireError): Response =>
  jsonResponse(WIRE_STATUS[error.code], error);
