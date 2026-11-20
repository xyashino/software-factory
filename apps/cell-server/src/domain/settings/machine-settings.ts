export type MachineSettings = {
  host: string;
  port: number;
};

export const DEFAULT_MACHINE_SETTINGS: MachineSettings = {
  host: '127.0.0.1',
  port: 7071,
};

const MAX_PORT = 65_535;

export const validateMachineSettings = (
  settings: MachineSettings,
): MachineSettings => {
  if (settings.host.trim().length === 0)
    throw new RangeError('host must not be empty');
  if (!Number.isInteger(settings.port) || settings.port < 1)
    throw new RangeError('port must be an integer from 1');
  if (settings.port > MAX_PORT)
    throw new RangeError(`port must not exceed ${MAX_PORT}`);
  return settings;
};
