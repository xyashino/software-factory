import type { EnvToken, EnvUrl } from '../domain/connection/connection-config';

export type HqSetting = 'PORT' | 'HOST' | 'DB_PATH' | 'DATA_DIR';

const valueOf = (name: string): string | undefined => {
  const raw = process.env[name];
  return raw !== undefined && raw.trim() !== '' ? raw : undefined;
};

export const hqSettingOf = (setting: HqSetting): string | undefined =>
  valueOf(`HQ_${setting}`) ?? valueOf(`FACTORY_${setting}`);

export const hqUrlEnv = (): EnvUrl | undefined => {
  const hq = valueOf('HQ_URL');
  if (hq !== undefined) {
    return { name: 'HQ_URL', value: hq };
  }
  const legacy = valueOf('FACTORY_URL');
  if (legacy === undefined) {
    return undefined;
  }
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
  return { name: 'FACTORY_TOKEN', value: legacy };
};
