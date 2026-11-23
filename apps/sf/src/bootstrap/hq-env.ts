import type { EnvToken, EnvUrl } from '../domain/connection/connection-config';

const warned = new Set<string>();

const warnOnce = (line: string): void => {
  if (warned.has(line)) {
    return;
  }
  warned.add(line);
  process.stderr.write(`${line}\n`);
};

const valueOf = (name: string): string | undefined => {
  const raw = process.env[name];
  return raw !== undefined && raw.trim() !== '' ? raw : undefined;
};

export const hqUrlEnv = (): EnvUrl | undefined => {
  const hq = valueOf('HQ_URL');
  if (hq !== undefined) {
    return { name: 'HQ_URL', value: hq };
  }
  const legacy = valueOf('FACTORY_URL');
  if (legacy === undefined) {
    return undefined;
  }
  warnOnce('deprecated: FACTORY_URL, use HQ_URL');
  return { name: 'FACTORY_URL', value: legacy };
};

export const hqTokenEnv = (): EnvToken | undefined => {
  const hq = valueOf('HQ_TOKEN');
  if (hq !== undefined) {
    return { name: 'HQ_TOKEN', value: hq };
  }
  const legacy = valueOf('FACTORY_TOKEN');
  if (legacy === undefined) {
    return undefined;
  }
  warnOnce('deprecated: FACTORY_TOKEN, use HQ_TOKEN');
  return { name: 'FACTORY_TOKEN', value: legacy };
};
