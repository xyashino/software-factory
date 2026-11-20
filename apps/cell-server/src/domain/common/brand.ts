export type Brand<K extends string, T> = T & { readonly __brand: K };

export type FactoryId = Brand<'FactoryId', string>;
export type SlotId = Brand<'SlotId', string>;

const requireNonEmpty = <K extends string>(
  kind: K,
  value: string,
): Brand<K, string> => {
  if (value.trim().length === 0)
    throw new RangeError(`${kind} must not be empty`);
  return value as Brand<K, string>;
};

export const asFactoryId = (value: string): FactoryId =>
  requireNonEmpty('FactoryId', value);

export const asSlotId = (value: string): SlotId =>
  requireNonEmpty('SlotId', value);
