/**
 * A stub Cell endpoint for the CLI tests, run as its own process so the test runner's event loop does
 * not sit between the CLI and the answer. Usage: `bun stub-cell.ts <outDir> <replyJson>`. It listens
 * on `127.0.0.1` at an ephemeral port, writes its URL to `<outDir>/url`, appends each request body to
 * `<outDir>/requests.log` and answers every request with the reply.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const [outDir = '', reply = '{"ok":true}'] = process.argv.slice(2);

const server = createServer((request, response) => {
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk: string) => {
    body += chunk;
  });
  request.on('end', () => {
    appendFileSync(join(outDir, 'requests.log'), `${body}\n`);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(reply);
  });
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address === null || typeof address === 'string') return;
  writeFileSync(join(outDir, 'url'), `http://127.0.0.1:${address.port}`);
});
