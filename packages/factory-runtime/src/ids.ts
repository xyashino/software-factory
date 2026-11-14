import {
  cycleIdSchema,
  jobIdSchema,
  questionIdSchema,
  resumeIdSchema,
} from '@repo/factory-core/ids';
import type { Clock } from '@repo/factory-core/ports/clock';
import type { Ids } from '@repo/factory-core/ports/ids';

/** Crockford base32, the ULID alphabet (no I, L, O, U). */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** The 10-character time part of a ULID: 48 bits of milliseconds. */
const encodeTime = (ms: number): string => {
  let text = '';
  let rest = ms;
  for (let index = 0; index < 10; index += 1) {
    text = ALPHABET[rest % 32] + text;
    rest = Math.floor(rest / 32);
  }
  return text;
};

/** The 16-character random part of a ULID: 80 bits. */
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

/** One fresh ULID at the clock's time. Ids are unique, not strictly ordered within one millisecond. */
export const newUlid = (clock: Clock): string => {
  const random = new Uint8Array(10);
  crypto.getRandomValues(random);
  return encodeTime(clock.now()) + encodeRandom(random);
};

/** The ids the runtime issues: the core's typed ids plus the signal ids and the generic `next()`. */
export interface RuntimeIds extends Ids {
  next(): string;
  signalId(): string;
  commandId(): string;
}

/** ULIDs from the Factory clock and the system's randomness (the real `Ids` port). */
export const ulidIds = (clock: Clock): RuntimeIds => {
  const fresh = (): string => newUlid(clock);
  return {
    next: fresh,
    jobId: () => jobIdSchema.parse(fresh()),
    cycleId: () => cycleIdSchema.parse(fresh()),
    resumeId: () => resumeIdSchema.parse(fresh()),
    questionId: () => questionIdSchema.parse(fresh()),
    signalId: fresh,
    commandId: fresh,
  };
};
