export interface SeenRequest {
  path: string;
  authorization: string | null;
  cellId: string | null;
}

export interface FakeHq {
  url: string;
  seen: SeenRequest[];
  imports: { authorization: string | null; body: FakeImportBody }[];
  stop: () => void;
}

export interface FakeImportBody {
  files: { filename: string; markdown: string }[];
}

interface FakeOptions {
  accepts: boolean;
  rejectImport?: boolean;
}

const HEARTBEAT_PATH = '/api/v1/factories/heartbeat';
const CLAIMS_PATH = '/api/v1/cells/claims';
const QUEUE_IMPORT_PATH = '/api/v1/queue/import';
const UNAUTHORIZED = 401;
const UNPROCESSABLE = 422;

export const startFakeHq = (options: FakeOptions): FakeHq => {
  const seen: SeenRequest[] = [];
  const imports: FakeHq['imports'] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
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
      if (pathname === QUEUE_IMPORT_PATH) {
        if (options.rejectImport === true) {
          return Response.json(
            {
              code: UNPROCESSABLE,
              type: 'validation',
              message: 'invalid import',
              errors: [{ filename: 'bad.md', message: 'depends_on unknown' }],
            },
            { status: UNPROCESSABLE },
          );
        }
        const body = (await request.json()) as FakeImportBody;
        imports.push({
          authorization: request.headers.get('authorization'),
          body,
        });
        return Response.json({
          code: 200,
          mode: 'apply',
          created: body.files.length,
          updated: 0,
          skipped: 0,
          errors: [],
        });
      }
      return Response.json({ code: 404 }, { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    seen,
    imports,
    stop: () => {
      server.stop(true);
    },
  };
};
