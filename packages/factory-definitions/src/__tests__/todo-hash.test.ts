import { describe, expect, it } from 'vitest';
import { todoContentHash } from '../todo-hash';

describe('todo content hash', () => {
  it('keeps the hash when only line endings or trailing spaces change', () => {
    const lf = '---\nstatus: todo\n---\nBody\n';
    const crlf = '---\r\nstatus: todo   \r\n---\r\nBody  \r\n\r\n';
    expect(todoContentHash(crlf)).toBe(todoContentHash(lf));
  });

  it('changes the hash when the spec text changes', () => {
    const before = '---\nstatus: todo\n---\nBody\n';
    const after = '---\nstatus: todo\n---\nBody, reworded\n';
    expect(todoContentHash(after)).not.toBe(todoContentHash(before));
  });

  it('returns a sha256 ref', () => {
    expect(todoContentHash('x')).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
