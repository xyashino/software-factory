/**
 * A stub Cell endpoint for the CLI tests, run as its own process so the test runner's event loop does
 * not sit between the CLI and the answer. Usage: `bun stub-cell.ts <rootDir> <replyJson>`. It listens
 * on 127.0.0.1 with an ephemeral port, writes its base URL to `<rootDir>/url`, appends each request
 * body to `<rootDir>/requests.log`, and answers every request with the reply.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const [rootDir = '', reply = '{"ok":true}'] = process.argv.slice(2);

const server = createServer((req, res) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk: string) => {
    body += chunk;
  });
  req.on('end', () => {
    appendFileSync(join(rootDir, 'requests.log'), `${body}\n`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(`${reply}\n`);
  });
  req.on('error', () => res.destroy());
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (address === null || typeof address === 'string') return;
  writeFileSync(join(rootDir, 'url'), `http://127.0.0.1:${address.port}`);
});
