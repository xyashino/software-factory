import type { CellId } from '@repo/factory-core/ids';

// Crockford base32, the ULID alphabet (no I, L, O, U).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const encodeTime = (ms: number): string => {
  let text = '';
  let rest = ms;
  for (let index = 0; index < 10; index += 1) {
    text = ALPHABET[rest % 32] + text;
    rest = Math.floor(rest / 32);
  }
  return text;
};

const encodeRandom = (bytes: Uint8Array): string => {
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
  let text = '';
  for (let index = 0; index < 16; index += 1) {
    text = ALPHABET[Number(bits & 31n)] + text;
    bits >>= 5n;
  }
  return text;
};

/** A fresh ULID at `now` (milliseconds). Unique; not strictly ordered within one millisecond. */
export const newUlid = (now: number): string => {
  const random = new Uint8Array(10);
  crypto.getRandomValues(random);
  return encodeTime(now) + encodeRandom(random);
};

/** A new Cell identity: a ULID the Cell keeps. */
export const newCellId = (now: () => number = Date.now): CellId =>
  newUlid(now()) as CellId;
