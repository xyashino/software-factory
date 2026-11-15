import {
  DEFAULT_CONFIG,
  type RuntimeConfig,
} from '@repo/factory-runtime/ports';

/**
 * The timing knobs an operator may set from the environment (PROTOCOL §5). They exist so the
 * distributed tests can run with short timings; production leaves them unset and keeps the defaults.
 */
const KNOBS = [
  ['FACTORY_LEASE_TTL_MS', 'leaseTtlMs'],
  ['FACTORY_HEARTBEAT_MS', 'heartbeatMs'],
  ['FACTORY_SELF_FENCE_MS', 'selfFenceMs'],
  ['FACTORY_CLAIM_TICK_MS', 'claimTickMs'],
] as const satisfies readonly (readonly [string, keyof RuntimeConfig])[];

/** One knob's value: a positive whole number of milliseconds, or nothing when it is unset. */
const millisecondsOf = (
  name: string,
  text: string | undefined,
): number | undefined => {
  if (text === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(text)) {
    throw new Error(`${name} must be a positive whole number of milliseconds`);
  }
  return Number(text);
};

/**
 * Reads the timing knobs from the environment. Only the knobs that are set are returned, so the
 * runtime keeps its defaults for the rest. A self-fence must stay shorter than the lease TTL
 * (PROTOCOL §5.1), with the default of either one used when it is not set.
 */
export const runtimeConfigFrom = (
  env: NodeJS.ProcessEnv,
): Partial<RuntimeConfig> => {
  const config: Partial<RuntimeConfig> = {};
  for (const [name, key] of KNOBS) {
    const value = millisecondsOf(name, env[name]);
    if (value !== undefined) config[key] = value;
  }
  const ttl = config.leaseTtlMs ?? DEFAULT_CONFIG.leaseTtlMs;
  const fence = config.selfFenceMs ?? DEFAULT_CONFIG.selfFenceMs;
  const v2Only = env.FACTORY_V2_ONLY;
  if (v2Only !== undefined) {
    if (v2Only !== '0' && v2Only !== '1') {
      throw new Error('FACTORY_V2_ONLY must be 1 or 0');
    }
    config.v2Only = v2Only === '1';
  }
  if (fence >= ttl) {
    throw new Error(
      `FACTORY_SELF_FENCE_MS (${fence}) must be below FACTORY_LEASE_TTL_MS (${ttl}) (PROTOCOL §5.1)`,
    );
  }
  return config;
};
