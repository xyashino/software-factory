// The BlobStore contract (STORAGE §5). The in-memory fake and the SQLite store run this same suite.
// It takes `describe` and `it` from the caller, like `store-contract.ts`. The caller passes the content
// address function (sha256 in the adapters) because core cannot hash.
import { LOG_MAX_BYTES, TEXT_MAX_BYTES, fitBlob } from '../blob-rules';
import type { BlobRef } from '../ids';
import type { BlobStore } from '../ports/blob-store';
import { assertSame } from './harness';
import { type FakeClock, fakeClock } from './fakes';
import type { ContractRunner } from './store-contract';

/** A blob store under test, whose `created_at` clock is the one the suite moves. */
export interface BlobUnderTest {
  store: BlobStore;
  close(): Promise<void>;
}

export type BlobFactory = (clock: FakeClock) => Promise<BlobUnderTest>;

const HOUR = 60 * 60 * 1000;

/** A text of `size` bytes that compresses well, so it is over the gzip threshold. */
const repetitive = (size: number, fill = 'a'): Uint8Array =>
  new Uint8Array(size).fill(fill.charCodeAt(0));

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

const withBlobs = async (
  create: BlobFactory,
  body: (under: BlobUnderTest, clock: FakeClock) => Promise<void>,
): Promise<void> => {
  const clock = fakeClock(0);
  const under = await create(clock);
  try {
    await body(under, clock);
  } finally {
    await under.close();
  }
};

const expectReject = async (
  action: () => Promise<unknown>,
  label: string,
  match?: RegExp,
): Promise<void> => {
  try {
    await action();
  } catch (error) {
    if (match && !match.test(String(error))) {
      throw new Error(`${label}: unexpected error ${String(error)}`);
    }
    return;
  }
  throw new Error(`${label}: expected a rejection, none happened`);
};

export const defineBlobStoreContract = (
  runner: ContractRunner,
  label: string,
  refOf: (bytes: Uint8Array) => BlobRef,
  create: BlobFactory,
): void => {
  runner.describe(`BlobStore contract: ${label}`, () => {
    runner.it('returns the bytes put under their ref, unchanged', () =>
      withBlobs(create, async ({ store }) => {
        const bytes = bytesOf('plan body');
        const ref = refOf(bytes);
        await store.put(ref, bytes, 'text/plain');

        assertSame(await store.get(ref), bytes, 'the bytes read back');
      }),
    );

    runner.it(
      'returns large compressible blobs unchanged, sized uncompressed',
      () =>
        withBlobs(create, async ({ store }) => {
          const bytes = repetitive(64 * 1024);
          const ref = refOf(bytes);
          await store.put(ref, bytes, 'text/plain');

          assertSame(await store.get(ref), bytes, 'the bytes read back');
          assertSame(
            (await store.stat([ref])).get(ref),
            bytes.byteLength,
            'stat reports the uncompressed size',
          );
        }),
    );

    runner.it('refuses bytes that do not hash to the ref', () =>
      withBlobs(create, async ({ store }) => {
        const wrong = refOf(bytesOf('one'));
        await expectReject(
          () => store.put(wrong, bytesOf('two')),
          'a hash mismatch',
          /does not hash/,
        );
      }),
    );

    runner.it(
      'reports the size of stored blobs and leaves missing refs out',
      () =>
        withBlobs(create, async ({ store }) => {
          const bytes = bytesOf('12345');
          const ref = refOf(bytes);
          const missing = refOf(bytesOf('never stored'));
          await store.put(ref, bytes);

          const sizes = await store.stat([ref, missing]);

          assertSame(
            [...sizes.entries()],
            [[ref, 5]],
            'only the stored blob has a size',
          );
        }),
    );

    runner.it('treats a repeated put of the same ref as a no-op', () =>
      withBlobs(create, async ({ store }) => {
        const bytes = bytesOf('same');
        const ref = refOf(bytes);
        await store.put(ref, bytes);
        await store.put(ref, bytes);

        assertSame(await store.get(ref), bytes, 'the blob is unchanged');
      }),
    );

    runner.it('refuses a text blob over 2 MiB with BlobTooLargeError', () =>
      withBlobs(create, async ({ store }) => {
        const bytes = repetitive(TEXT_MAX_BYTES + 1);
        await expectReject(
          () => store.put(refOf(bytes), bytes, 'text/plain', 'text'),
          'a text over its limit',
          /^BlobTooLargeError: text blob/,
        );
      }),
    );

    runner.it('stores a 2 MiB text blob at its limit', () =>
      withBlobs(create, async ({ store }) => {
        const bytes = repetitive(TEXT_MAX_BYTES);
        await store.put(refOf(bytes), bytes, 'text/plain', 'text');

        assertSame(
          (await store.stat([refOf(bytes)])).get(refOf(bytes)),
          TEXT_MAX_BYTES,
          'the text at the limit is stored',
        );
      }),
    );

    runner.it('truncates an oversized log to head and tail with a marker', () =>
      withBlobs(create, async ({ store }) => {
        const head = bytesOf('HEAD:');
        const tail = bytesOf(':TAIL');
        const bytes = new Uint8Array(LOG_MAX_BYTES + 1024);
        bytes.set(head, 0);
        bytes.set(tail, bytes.byteLength - tail.byteLength);

        const ref = refOf(fitBlob(bytes, 'log'));
        await store.put(ref, bytes, 'text/plain', 'log');

        const back = (await store.get(ref)) ?? new Uint8Array();
        const text = new TextDecoder().decode(back);
        assertSame(
          back.byteLength,
          LOG_MAX_BYTES,
          'the log is cut to its limit',
        );
        assertSame(text.startsWith('HEAD:'), true, 'the head is kept');
        assertSame(text.endsWith(':TAIL'), true, 'the tail is kept');
        assertSame(
          text.includes('truncated'),
          true,
          'a marker sits between them',
        );
      }),
    );

    runner.it(
      'refuses an oversized log whose ref is not its truncated hash',
      () =>
        withBlobs(create, async ({ store }) => {
          const bytes = repetitive(LOG_MAX_BYTES + 1);
          await expectReject(
            () => store.put(refOf(bytes), bytes, 'text/plain', 'log'),
            'a ref of the untruncated log',
            /does not hash/,
          );
        }),
    );

    runner.it(
      'sweeps unreferenced blobs older than 24 h and keeps the referenced and the fresh',
      () =>
        withBlobs(create, async ({ store }, clock) => {
          const old = bytesOf('old, unreferenced');
          const kept = bytesOf('old, referenced');
          const fresh = bytesOf('fresh, unreferenced');
          await store.put(refOf(old), old);
          await store.put(refOf(kept), kept);
          clock.advance(23 * HOUR);
          await store.put(refOf(fresh), fresh);
          clock.advance(HOUR);

          const removed = await store.sweep(
            clock.now(),
            new Set([refOf(kept)]),
          );

          assertSame(
            removed,
            [refOf(old)],
            'only the old unreferenced blob goes',
          );
          assertSame(
            await store.get(refOf(old)),
            undefined,
            'the old blob is gone',
          );
          assertSame(
            await store.get(refOf(kept)),
            kept,
            'the referenced blob is kept',
          );
          assertSame(
            await store.get(refOf(fresh)),
            fresh,
            'the fresh blob is kept',
          );
        }),
    );
  });
};
