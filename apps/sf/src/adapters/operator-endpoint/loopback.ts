import type { OperatorEndpointPort } from '../../application/ports/operator-endpoint.port';

const HOST = '127.0.0.1';
const OK_STATUS = 200;
const BAD_REQUEST = 400;
const MAX_BODY_BYTES = 1024 * 1024;

type Server = ReturnType<typeof Bun.serve>;

const statusOf = (reply: unknown): number => {
  const code = (reply as { code?: unknown } | null)?.code;
  return typeof code === 'number' ? code : OK_STATUS;
};

const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

export const createLoopbackEndpoint = (): OperatorEndpointPort => {
  let server: Server | undefined;
  return {
    open: async (_jobId, handler) => {
      await server?.stop(true);
      server = Bun.serve({
        hostname: HOST,
        port: 0,
        maxRequestBodySize: MAX_BODY_BYTES,
        fetch: async (request) => {
          const body = await readJson(request);
          if (body === null) {
            return Response.json(
              {
                code: BAD_REQUEST,
                type: 'invalid',
                message: 'body is not JSON',
              },
              { status: BAD_REQUEST },
            );
          }
          const reply = await handler(body);
          return Response.json(reply, { status: statusOf(reply) });
        },
      });
      return { url: `http://${HOST}:${server.port}/` };
    },
    close: async () => {
      await server?.stop(true);
      server = undefined;
    },
  };
};
