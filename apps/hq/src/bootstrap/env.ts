export type HqSetting =
  'PORT' | 'HOST' | 'DB_PATH' | 'DATA_DIR' | 'DATABASE_URL';

type Env = Readonly<Record<string, string | undefined>>;

const valueOf = (env: Env, name: string): string | undefined => {
  const raw = env[name];
  return raw === undefined || raw === '' ? undefined : raw;
};

export const hqSettingOf = (env: Env, setting: HqSetting): string | undefined =>
  valueOf(env, `HQ_${setting}`) ?? valueOf(env, `FACTORY_${setting}`);
