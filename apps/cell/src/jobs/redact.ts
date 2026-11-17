import { isMachineIndependentText } from '@repo/factory-core/machine-local';

const REDACTED = '<redacted>';
// What a text becomes when redaction cannot make it pass the guard.
const WITHHELD = 'output withheld: machine-local values';
const ROUNDS = 4;

const encoder = new TextEncoder();

// The machine-local shapes of `isMachineIndependentText`, widened: any token that starts a path, host,
// pane or process id is replaced whole. A `$1` keeps the character before a path.
const TOKENS: readonly (readonly [RegExp, string])[] = [
  [/(^|\W)\/\S*/g, `$1${REDACTED}`],
  [/(^|\W)~\/\S*/g, `$1${REDACTED}`],
  [/\b[A-Za-z]:\\\S*/g, REDACTED],
  [/\b[a-z][a-z0-9-]*:\d{2,5}\b/gi, REDACTED],
  [/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g, REDACTED],
  [/\b[a-z0-9-]+\.(local|lan|internal|localdomain)\b/gi, REDACTED],
  [/\blocalhost\b/gi, REDACTED],
  [/\bw-?\d+-\d+\b/g, REDACTED],
  [/\bpane[-_:]\w+/gi, REDACTED],
  [/%\d+\b/g, REDACTED],
  [/\bpid[=: ]\d+/gi, REDACTED],
];

const redactAll = (text: string): string => {
  let out = text;
  for (let round = 0; round < ROUNDS; round += 1) {
    const next = TOKENS.reduce(
      (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
      out,
    );
    if (next === out) break;
    out = next;
  }
  return out;
};

const lastBytes = (text: string, maxBytes: number): string => {
  let tail = '';
  let bytes = 0;
  for (const character of Array.from(text).reverse()) {
    const size = encoder.encode(character).length;
    if (bytes + size > maxBytes) break;
    tail = character + tail;
    bytes += size;
  }
  return tail;
};

const sanitize = (text: string, cut: (text: string) => string): string => {
  const once = cut(redactAll(text));
  const twice = cut(redactAll(once));
  return isMachineIndependentText(twice) ? twice : WITHHELD;
};

/**
 * The end of a text, at most `maxBytes` UTF-8 bytes, with machine-local values redacted. For a `tail`
 * (`tailText`). The full text stays in the log blob.
 */
export const redactTail = (text: string, maxBytes: number): string =>
  sanitize(text, (value) => lastBytes(value, maxBytes));

/**
 * A failure detail of at most `maxChars` characters, with machine-local values redacted. `from` picks the
 * end of a command's output (its last characters matter) or the start of a message.
 */
export const redactDetail = (
  text: string,
  maxChars: number,
  from: 'start' | 'end' = 'start',
): string =>
  sanitize(text, (value) =>
    from === 'end' ? value.slice(-maxChars) : value.slice(0, maxChars),
  );
