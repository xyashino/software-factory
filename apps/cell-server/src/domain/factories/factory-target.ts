import type { FactoryId } from '../common/brand';

export type FactoryTarget = {
  factoryId: FactoryId;
  url: string;
  isDefault: boolean;
};

const isAbsoluteUrl = (value: string): boolean => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

export const validateFactoryUrl = (value: string): string => {
  if (!isAbsoluteUrl(value))
    throw new RangeError(`factory url must be an absolute URL: ${value}`);
  return value;
};
