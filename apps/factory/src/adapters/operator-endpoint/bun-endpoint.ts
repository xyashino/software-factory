import type {
  OperatorEndpoint,
  OperatorEndpointPort,
} from '../../application/ports/operator-endpoint.port';

const LOOPBACK = '127.0.0.1';
const OK = 200;

const replyStatus = (reply: unknown): number => {
  if (typeof reply === 'object' && reply !== null && 'code' in reply) {
    const { code } = reply;
    if (typeof code === 'number') {
      return code;
    }
  }
  return OK;
};

export const createOperatorEndpoint = (): OperatorEndpointPort => {
  let server: ReturnType<typeof Bun.serve> | null = null;
  return {
    open: async (_jobId, handler): Promise<OperatorEndpoint> => {
      server?.stop(true);
      server = Bun.serve({
        hostname: LOOPBACK,
        port: 0,
        fetch: async (request) => {
          const reply = await handler(await request.json().catch(() => null));
          return Response.json(reply, { status: replyStatus(reply) });
        },
      });
      return { url: `http://${LOOPBACK}:${server.port}/` };
    },
    close: async () => {
      server?.stop(true);
      server = null;
    },
  };
};
