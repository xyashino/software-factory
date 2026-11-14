import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** One line of the runtime journal: a pane ready, a reminder, a typed answer (CORE §9.3). */
export interface JournalEntry {
  at: number;
  kind: string;
  [field: string]: unknown;
}

/**
 * Appends entries to the Cell-local journal of one Cycle. Never an order event; a debugging record.
 * Text in an entry is kept as the caller gives it, so the caller keeps secrets out of it.
 */
export const openJournal = (path: string): ((entry: JournalEntry) => void) => {
  mkdirSync(dirname(path), { recursive: true });
  return (entry) => appendFileSync(path, `${JSON.stringify(entry)}\n`);
};
