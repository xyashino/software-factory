import { describe, expect, it } from 'vitest';
import { usage } from '../usage';

describe('factory-operator-cli smoke', () => {
  it('prints usage naming the binary', () => {
    expect(usage).toContain('factory-operator');
  });
});
