/**
 * Child process for the concurrency test: appends events to a shared database.
 * Usage: bun writer.fixture.ts <dbPath> <taskId> <count>
 */
import { systemClock } from '../../clock/system-clock';
import { SqliteStore } from '../sqlite-store';

const [dbPath, taskId, countArg] = process.argv.slice(2);
if (dbPath === undefined || taskId === undefined || countArg === undefined) {
  throw new Error('usage: writer.fixture.ts <dbPath> <taskId> <count>');
}

const store = new SqliteStore({ path: dbPath, clock: systemClock });
for (let index = 0; index < Number(countArg); index += 1) {
  store.append(taskId, {
    type: 'note',
    attemptId: 'writer-1',
    to: 'child',
    text: `child ${index}`,
  });
}
store.close();
