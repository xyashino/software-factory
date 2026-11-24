export interface SeenRequest {
  path: string;
  authorization: string | null;
  cellId: string | null;
}

export interface FakeHq {
  url: string;
  seen: SeenRequest[];
  stop: () => void;
}

const HEARTBEAT_PATH = '/api/v1/factories/heartbeat';
const CLAIMS_PATH = '/api/v1/cells/claims';
const UNAUTHORIZED = 401;

export const startFakeHq = (options: { accepts: boolean }): FakeHq => {
  const seen: SeenRequest[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => {
      const { pathname } = new URL(request.url);
      seen.push({
        path: pathname,
        authorization: request.headers.get('authorization'),
        cellId: request.headers.get('x-cell-id'),
      });
      if (!options.accepts) {
        return Response.json({ code: UNAUTHORIZED }, { status: UNAUTHORIZED });
      }
      if (pathname === HEARTBEAT_PATH) {
        return Response.json({ factoryId: 'factory-1' });
      }
      if (pathname === CLAIMS_PATH) {
        return Response.json({ code: 200, job: null });
      }
      return Response.json({ code: 404 }, { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    seen,
    stop: () => {
      server.stop(true);
    },
  };
};
