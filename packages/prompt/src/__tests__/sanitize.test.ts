import { describe, expect, it } from 'vitest';
import { sanitizeUntrustedText } from '../sanitize';

const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202e);
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
const ZERO_WIDTH_JOINER = String.fromCodePoint(0x200d);
const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff);
const NULL_BYTE = String.fromCodePoint(0x0000);

describe('sanitizing untrusted text', () => {
  it('strips bidi override characters', () => {
    const text = `safe${RIGHT_TO_LEFT_OVERRIDE}evil`;

    expect(sanitizeUntrustedText(text)).toBe('safeevil');
  });

  it('strips null bytes and zero-width characters', () => {
    const text = `a${NULL_BYTE}b${ZERO_WIDTH_SPACE}c${ZERO_WIDTH_JOINER}d${BYTE_ORDER_MARK}e`;

    expect(sanitizeUntrustedText(text)).toBe('abcde');
  });

  it('keeps ASCII, Polish text, markdown and newlines', () => {
    const text = '# Zażółć gęślą jaźń\n\n- **bold** `code`\r\n\tindented';

    expect(sanitizeUntrustedText(text)).toBe(text);
  });
});
