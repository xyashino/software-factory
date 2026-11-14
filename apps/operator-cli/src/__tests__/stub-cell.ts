/**
 * A stub Cell socket for the CLI tests, run as its own process so the test runner's event loop does
 * not sit between the CLI and the answer. Usage: `bun stub-cell.ts <socketPath> <replyJson>`. It
 * appends each request line to `<socketPath>.log` and answers every request with the reply.
 */
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:net';

const [socketPath = '', reply = '{"ok":true}'] = process.argv.slice(2);

createServer((socket) => {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    if (!buffer.includes('\n')) return;
    appendFileSync(`${socketPath}.log`, buffer);
    socket.end(`${reply}\n`);
  });
  socket.on('error', () => socket.destroy());
}).listen(socketPath);
