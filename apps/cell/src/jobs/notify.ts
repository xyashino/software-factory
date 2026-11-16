import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { HerdrNotificationOptions } from '../ports/herdr.port';

/** The file, in the Cell's data directory, where a refused toast is written down. */
export const NOTIFY_LOG = 'notify.log';

/** A toast that has not returned by then is given up on: a stuck Herdr never holds a job. */
export const NOTIFY_TIMEOUT_MS = 5_000;

/** The longest body a toast carries. Question text is cut to fit. */
export const NOTIFY_BODY_CHARS = 200;

/** Shows a desktop toast. Herdr's `notification show` is the only implementation. */
export type NotifyFn = (
  title: string,
  options?: HerdrNotificationOptions,
) => Promise<void>;

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
};

/** `text` cut to `max` characters, with an ellipsis when it was cut. */
export const truncateBody = (
  text: string,
  max: number = NOTIFY_BODY_CHARS,
): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
};

/**
 * Shows a toast, best-effort. With no `notify` (headless or notifications off) it does nothing. A refusal
 * or a timeout is written to `notify.log` in `cellDataDir` and never thrown: no Cycle, Andon or Delivery
 * fails or waits for a toast.
 */
export const notifyQuietly = async (
  notify: NotifyFn | undefined,
  cellDataDir: string,
  title: string,
  options?: HerdrNotificationOptions,
): Promise<void> => {
  if (notify === undefined) return;
  try {
    await withTimeout(notify(title, options), NOTIFY_TIMEOUT_MS);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try {
      mkdirSync(cellDataDir, { recursive: true });
      appendFileSync(
        join(cellDataDir, NOTIFY_LOG),
        `${new Date().toISOString()} notify "${title}" failed: ${reason}\n`,
      );
    } catch {
      // The log is best-effort too: a toast must never fail a job.
    }
  }
};
