/**
 * A stub Cell endpoint for the CLI tests, run as its own process so the test runner's event loop does
 * not sit between the CLI and the answer. Usage: `bun stub-cell.ts <dir> <replyJson>`. It listens on
 * `127.0.0.1` at an OS-assigned port, writes its URL to `<dir>/url`, appends each request body to
 * `<dir>/requests.log`, and answers every `POST` with the reply.
 */
import { appendFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const [dir = '', reply = '{"ok":true}'] = process.argv.slice(2);
const requestsLog = join(dir, 'requests.log');

const server = createServer((req, res) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk: string) => {
    body += chunk;
  });
  req.on('end', () => {
    appendFileSync(requestsLog, `${body}\n`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(reply);
  });
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  // Written under a temporary name, then renamed, so the test never reads a half-written URL.
  const urlFile = join(dir, 'url');
  writeFileSync(`${urlFile}.tmp`, `http://127.0.0.1:${port}`);
  renameSync(`${urlFile}.tmp`, urlFile);
});
