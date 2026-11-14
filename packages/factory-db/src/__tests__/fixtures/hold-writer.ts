// Child process for the writer-lock tests: takes the writer lock of the directory given as argv[2],
// prints `held` once it has it, then sleeps until it is killed. Exits 3 when the lock is refused.
import { acquireWriter, WriterHeldError } from '../../writer-lock';

const dir = process.argv[2];
if (!dir) throw new Error('usage: hold-writer.ts <dataDir>');

try {
  acquireWriter(dir);
  console.log('held');
  setInterval(() => undefined, 1_000);
} catch (error) {
  if (error instanceof WriterHeldError) {
    console.log('refused');
    process.exit(3);
  }
  throw error;
}
