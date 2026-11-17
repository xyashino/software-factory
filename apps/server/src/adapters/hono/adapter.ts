import type { Context, Hono } from 'hono';
import { invalidWire } from '@repo/factory-core/contracts/errors';
import { RefusalError } from '../../application/core/error-handling';
import type {
  BodyMode,
  Procedure,
  ProcedureOutput,
  RequestBody,
  TransportContext,
} from '../../application/core/procedure';
import { jsonResponse } from './wire';

/** A bearer token: the base64url alphabet, bounded in length. Anything else is no token. */
const BEARER = /^Bearer ([A-Za-z0-9_-]{1,512})$/;

/** The bearer token of a request, or undefined when it carries none. */
export const bearerOf = (request: Request): string | undefined =>
  BEARER.exec(request.headers.get('authorization') ?? '')?.[1];

/** The body of a request, read in the form its procedure takes (PROTOCOL §3). */
const readBody = async (
  mode: BodyMode,
  request: Request,
): Promise<RequestBody> => {
  switch (mode) {
    case 'none':
      return { kind: 'none' };
    case 'text':
      return { kind: 'text', text: await request.text() };
    case 'bytes':
      return {
        kind: 'bytes',
        bytes: new Uint8Array(await request.arrayBuffer()),
      };
    case 'json': {
      const text = await request.text();
      if (text === '') return { kind: 'json', value: {} };
      try {
        const value: unknown = JSON.parse(text);
        return { kind: 'json', value };
      } catch {
        throw new RefusalError(
          invalidWire([{ path: [], message: 'the body is not JSON' }]),
        );
      }
    }
  }
};

/** The HTTP answer of a procedure's output. */
export const responseOf = (output: ProcedureOutput): Response => {
  switch (output.kind) {
    case 'empty':
      return new Response(null, { status: 204 });
    case 'json':
      return jsonResponse(200, output.body);
    case 'bytes':
      return new Response(Buffer.from(output.bytes), {
        status: 200,
        headers: { 'content-type': output.mediaType },
      });
  }
};

/**
 * Serves one procedure over HTTP: the credential is checked first (PROTOCOL §1), then the body is read
 * in the procedure's form, then the procedure runs. Failures are left to the app's error handler.
 */
export const honoAdapter =
  (procedure: Procedure, transport: TransportContext) =>
  async (c: Context): Promise<Response> => {
    const request = c.req.raw;
    const authenticated =
      procedure.auth !== 'join' && procedure.auth !== 'webhook';
    const caller = authenticated
      ? await transport.auth.authenticate(procedure.auth, bearerOf(request))
      : undefined;
    const body = await readBody(procedure.body, request);
    const output = await procedure.run(
      {
        params: c.req.param(),
        body,
        headers: request.headers,
        caller,
        signal: request.signal,
      },
      transport,
    );
    return responseOf(output);
  };

/** Mounts each procedure on its route. The route table is `HTTP_ROUTES`, read by each procedure. */
export const mountProcedures = (
  app: Hono,
  procedures: readonly Procedure[],
  transport: TransportContext,
): void => {
  for (const procedure of procedures) {
    app.on(procedure.method, procedure.path, honoAdapter(procedure, transport));
  }
};
