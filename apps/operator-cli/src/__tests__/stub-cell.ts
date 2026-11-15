/**
 * A stub Cell endpoint for the CLI tests, run as its own process so the test runner's event loop does
 * not sit between the CLI and the answer. Usage: `bun stub-cell.ts <dir> <replyJson> [status]`. It
 * listens on `127.0.0.1` on an OS-assigned port, writes its base URL to `<dir>/url`, appends each
 * request body to `<dir>/requests.log` (one JSON line each) and its Authorization header to
 * `<dir>/auth.log`, and answers every request with the reply.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir = '', reply = '{"ok":true}', status = '200'] = process.argv.slice(2);

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    const body = await request.text();
    appendFileSync(join(dir, 'requests.log'), `${body.replace(/\n/g, ' ')}\n`);
    appendFileSync(
      join(dir, 'auth.log'),
      `${request.headers.get('authorization') ?? ''}\n`,
    );
    return new Response(`${reply}\n`, {
      status: Number(status),
      headers: { 'content-type': 'application/json' },
    });
  },
});

writeFileSync(join(dir, 'url'), `http://127.0.0.1:${server.port}`);
