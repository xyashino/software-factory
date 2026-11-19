import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { type AddressInfo } from 'node:net';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CLI_PATH = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));
const WATCH_TIMEOUT_MS = 20_000;

const transition = (seq: number): string =>
  JSON.stringify({
    seq,
    projectId: 'software-factory',
    entityType: 'work_order',
    entityId: 'wo-1',
    fromState: 'queued',
    toState: 'running',
    actorKind: 'system',
    actorId: null,
    commandId: null,
    meta: null,
    at: 1_700_000_000_000,
  });

const frame = (seq: number): string =>
  `event: transition\nid: ${seq}\ndata: ${transition(seq)}\n\n`;

interface Streams {
  afterSeqs: string[];
  openConnections: ServerResponse[];
}

interface Fixture {
  cwd: string;
  env: Record<string, string>;
  server: Server;
  streams: Streams;
}

const fixture: { current?: Fixture } = {};

const serveStream = (streams: Streams): Promise<Server> =>
  new Promise((resolve) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://fake');
      if (url.pathname !== '/api/v1/stream') {
        response.statusCode = 404;
        response.end();
        return;
      }
      const afterSeq = url.searchParams.get('afterSeq') ?? '';
      streams.afterSeqs.push(afterSeq);
      response.statusCode = 200;
      response.setHeader('content-type', 'text/event-stream');
      if (streams.afterSeqs.length === 1) {
        response.write(frame(1) + frame(2));
        response.end();
        return;
      }
      response.write(frame(2) + frame(3));
      streams.openConnections.push(response);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });

const createFixture = async (): Promise<Fixture> => {
  const streams: Streams = { afterSeqs: [], openConnections: [] };
  const server = await serveStream(streams);
  const port = (server.address() as AddressInfo).port;
  const cwd = mkdtempSync(join(tmpdir(), 'factory-watch-cli-'));
  mkdirSync(join(cwd, '.factory'));
  writeFileSync(
    join(cwd, '.factory', 'config.json'),
    JSON.stringify({ project: 'software-factory' }),
  );
  return {
    cwd,
    server,
    streams,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: cwd,
      FACTORY_TOKEN: 'test-token',
      FACTORY_URL: `http://127.0.0.1:${port}`,
    },
  };
};

const seqsOf = (stdout: string): string[] =>
  stdout
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split('  ')[0] ?? '');

const watchUntilSeq = (
  lastSeq: string,
): Promise<{ code: number | null; stdout: string }> =>
  new Promise((resolve) => {
    const { cwd, env } = fixture.current as Fixture;
    const child = spawn(process.execPath, [CLI_PATH, 'watch'], { cwd, env });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (seqsOf(stdout).includes(lastSeq)) {
        child.kill('SIGINT');
      }
    });
    child.on('close', (code) => resolve({ code, stdout }));
  });

beforeAll(async () => {
  fixture.current = await createFixture();
});

afterAll(() => {
  fixture.current?.streams.openConnections.forEach((response) =>
    response.end(),
  );
  fixture.current?.server.close();
});

describe('watch command', () => {
  it(
    'reconnects after a dropped stream and prints each seq once',
    async () => {
      // Arrange
      const expectedSeqs = ['1', '2', '3'];

      // Act
      const result = await watchUntilSeq('3');

      // Assert
      expect(seqsOf(result.stdout)).toEqual(expectedSeqs);
      expect(fixture.current?.streams.afterSeqs).toEqual(['0', '2']);
    },
    WATCH_TIMEOUT_MS,
  );

  it(
    'exits 0 on Ctrl-C',
    async () => {
      // Arrange
      const before = fixture.current?.streams.afterSeqs.length ?? 0;

      // Act
      const result = await watchUntilSeq('3');

      // Assert
      expect(result.code).toBe(0);
      expect(fixture.current?.streams.afterSeqs.length).toBeGreaterThan(before);
    },
    WATCH_TIMEOUT_MS,
  );
});
