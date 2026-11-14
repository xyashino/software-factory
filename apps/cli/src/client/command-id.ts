/** Crockford base32, the ULID alphabet (no I, L, O, U). */
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

/**
 * A ULID for one CLI invocation (PROTOCOL §6). It is made once, before the first call, and every
 * retry of that call sends the same value, so the server answers a repeat with the stored response.
 */
export const newCommandId = (now: () => number = Date.now): string => {
  const random = new Uint8Array(10);
  crypto.getRandomValues(random);
  return encodeTime(now()) + encodeRandom(random);
};
