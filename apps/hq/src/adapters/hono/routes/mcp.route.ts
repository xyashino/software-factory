import { Hono } from 'hono';
import {
  JSONRPC_ERRORS,
  jsonRpcRequestSchema,
} from '@repo/hq-contracts/mcp.contract';
import { MAX_BODY_BYTES } from '../../../config';
import {
  BadRequest,
  Forbidden,
  PayloadTooLarge,
} from '../../../application/core/error-handling';
import { authorize } from '../../../application/core/procedure';
import { dispatchMcp, jsonRpcError } from '../../../application/mcp/dispatch';
import type { AppEnv } from '../types';

export const mcpRoute = new Hono<AppEnv>().post('/', async (c) => {
  c.header('cache-control', 'private, no-store');
  const auth = await authorize(c.get('transport'), []);
  if (c.req.header('origin') !== undefined)
    throw new Forbidden('Browser Origin header is not accepted');
  if (!c.req.header('content-type')?.startsWith('application/json'))
    throw new BadRequest('Unsupported Content-Type, expected application/json');
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES)
    throw new PayloadTooLarge(`Body exceeds ${MAX_BODY_BYTES} bytes`);

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return c.json(jsonRpcError(null, JSONRPC_ERRORS.parse, 'Parse error'), 200);
  }
  const message = jsonRpcRequestSchema.safeParse(body);
  if (!message.success)
    return c.json(
      jsonRpcError(null, JSONRPC_ERRORS.invalidRequest, 'Invalid Request'),
      200,
    );
  const response = await dispatchMcp(message.data, auth);
  return response === null ? c.body(null, 202) : c.json(response, 200);
});
