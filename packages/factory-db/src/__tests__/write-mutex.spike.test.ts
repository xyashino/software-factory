// Spike for ROADMAP factory-m3-tx-spike (STORAGE §3.1). One connection, one async task per writer.
// bun:sqlite is synchronous, so a task that awaits inside an open BEGIN IMMEDIATE leaves the
// connection open for every other task. The control shows that risk; the guarded cases show the
// write mutex closes it. Result recorded in decisions/ (factory-sqlite-event-store).
import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'vitest';
import { writeMutex } from '../write-mutex';

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const openTable = (): Database => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE writes (name TEXT NOT NULL)');
  return db;
};

const namesOf = (db: Database): string[] =>
  db
    .query<{ name: string }, []>('SELECT name FROM writes ORDER BY rowid')
    .all()
    .map((row) => row.name);

const insert = (db: Database, name: string): void => {
  db.run('INSERT INTO writes (name) VALUES (?)', [name]);
};

describe('write-mutex spike: a foreign statement and an open write transaction', () => {
  it('control: without a mutex a foreign write joins the open transaction and is rolled back with it', async () => {
    const db = openTable();
    const outer = async (): Promise<void> => {
      db.exec('BEGIN IMMEDIATE');
      insert(db, 'outer');
      await pause(20);
      db.exec('ROLLBACK');
    };
    const foreign = async (): Promise<void> => {
      await pause(5);
      insert(db, 'foreign');
    };

    await Promise.all([outer(), foreign()]);

    expect(namesOf(db)).toEqual([]);
  });

  it('control: without a mutex a second BEGIN IMMEDIATE on the same connection fails', async () => {
    const db = openTable();
    const outer = async (): Promise<void> => {
      db.exec('BEGIN IMMEDIATE');
      await pause(20);
      db.exec('COMMIT');
    };
    const second = async (): Promise<string | undefined> => {
      await pause(5);
      try {
        db.exec('BEGIN IMMEDIATE');
        db.exec('COMMIT');
        return undefined;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };

    const [, failure] = await Promise.all([outer(), second()]);

    expect(failure).toContain(
      'cannot start a transaction within a transaction',
    );
  });

  it('with one mutex around the transaction, a foreign write waits and lands after the commit', async () => {
    const db = openTable();
    const mutex = writeMutex();
    const outer = (): Promise<void> =>
      mutex.run(async () => {
        db.exec('BEGIN IMMEDIATE');
        insert(db, 'outer');
        await pause(20);
        db.exec('COMMIT');
      });
    const foreign = (): Promise<void> =>
      mutex.run(async () => {
        insert(db, 'foreign');
      });

    await Promise.all([outer(), foreign()]);

    expect(namesOf(db)).toEqual(['outer', 'foreign']);
  });

  it('with the mutex, N concurrent writers with slow bodies never interleave or nest', async () => {
    const db = openTable();
    const mutex = writeMutex();
    const writer = (name: string): Promise<void> =>
      mutex.run(async () => {
        db.exec('BEGIN IMMEDIATE');
        insert(db, `${name}:open`);
        await pause(3);
        insert(db, `${name}:close`);
        db.exec('COMMIT');
      });

    await Promise.all(['a', 'b', 'c', 'd', 'e'].map(writer));

    const names = namesOf(db);
    expect(names).toHaveLength(10);
    for (let index = 0; index < names.length; index += 2) {
      const [open, close] = [names[index], names[index + 1]];
      expect(open?.endsWith(':open')).toBe(true);
      expect(close).toBe(open?.replace(':open', ':close'));
    }
  });

  it('with the mutex, a section that throws releases the lock for the next one', async () => {
    const db = openTable();
    const mutex = writeMutex();
    const failing = mutex.run(async () => {
      db.exec('BEGIN IMMEDIATE');
      insert(db, 'failing');
      db.exec('ROLLBACK');
      throw new Error('boom');
    });
    const next = mutex.run(async () => {
      db.exec('BEGIN IMMEDIATE');
      insert(db, 'next');
      db.exec('COMMIT');
    });

    await expect(failing).rejects.toThrow('boom');
    await next;

    expect(namesOf(db)).toEqual(['next']);
  });
});
