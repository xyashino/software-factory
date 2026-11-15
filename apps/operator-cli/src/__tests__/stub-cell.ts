/**
 * A stub Cell endpoint for the CLI tests, run as its own process so the test runner's event loop does
 * not sit between the CLI and the answer. Usage: `bun stub-cell.ts <dir> <replyJson>`. It listens on
 * `127.0.0.1` at an OS-assigned port, writes its base URL to `<dir>/url`, appends each request body to
 * `<dir>/requests.log`, and answers every `POST` with the reply.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const [dir = '', reply = '{"ok":true}'] = process.argv.slice(2);
const requestLog = join(dir, 'requests.log');

const server = createServer((req, res) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk: string) => (body += chunk));
  req.on('end', () => {
    appendFileSync(requestLog, `${body}\n`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(reply);
  });
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address === null || typeof address === 'string') return;
  writeFileSync(join(dir, 'url'), `http://127.0.0.1:${address.port}`);
});
