import { describe, expect, it } from 'vitest';
import { asFactoryId, asSlotId } from '../brand';

describe('branded ids', () => {
  it('keeps a non-empty factory id as given', () => {
    const factoryId = asFactoryId('factory-1');

    expect(factoryId).toBe('factory-1');
  });

  it('rejects an empty factory id', () => {
    expect(() => asFactoryId('')).toThrow(RangeError);
  });

  it('rejects a slot id made only of spaces', () => {
    expect(() => asSlotId('   ')).toThrow('SlotId must not be empty');
  });
});
