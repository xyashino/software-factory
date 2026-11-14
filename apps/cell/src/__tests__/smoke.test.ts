import { describe, expect, it } from 'vitest';
import { usage } from '../usage';

describe('factory-cell smoke', () => {
  it('prints usage naming the binary', () => {
    expect(usage).toContain('factory-cell');
  });
});
