import type { FactoryId } from '../common/brand';

export type FactoryTarget = {
  factoryId: FactoryId;
  url: string;
  isDefault: boolean;
};

const HTTP_PROTOCOLS: readonly string[] = ['http:', 'https:'];

const parseHttpUrl = (value: string): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RangeError(`factory url must be an absolute URL: ${value}`);
  }
  if (!HTTP_PROTOCOLS.includes(url.protocol))
    throw new RangeError(`factory url must use http or https: ${value}`);
  return url;
};

export const validateFactoryUrl = (value: string): string =>
  parseHttpUrl(value).href.replace(/\/+$/, '');

export const validateFactoryName = (value: string): string => {
  const name = value.trim();
  if (name.length === 0) throw new RangeError('factory name must not be empty');
  return name;
};
