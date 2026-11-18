import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

export type Reply = { status: number; body: string } | 'hang';

export type RecordedRequest = { method: string; path: string; body: string };

export type StubCell = {
  url: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
};

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

export const startStubCell = (reply: Reply): Promise<StubCell> => {
  const requests: RecordedRequest[] = [];

  const server = createServer((req, res) => {
    void readBody(req).then((body) => {
      requests.push({ method: req.method ?? '', path: req.url ?? '', body });
      if (reply === 'hang') {
        return;
      }
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(reply.body);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
};
