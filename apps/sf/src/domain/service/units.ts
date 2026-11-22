export const SERVICE_MARKER = '# managed-by: sf service install';
export const SERVER_UNIT_NAME = 'sf-server.service';
export const CELL_UNIT_PREFIX = 'sf-cell-';
export const UNIT_SUFFIX = '.service';

const SAFE_WORD = /^[A-Za-z0-9_@+=:,./-]+$/;

export interface ServerUnitInput {
  execArgs: readonly string[];
  env: Readonly<Record<string, string>>;
}

export interface CellUnitInput {
  cellName: string;
  execArgs: readonly string[];
  workingDir: string;
  env: Readonly<Record<string, string>>;
  envFile?: string;
}

const wordOf = (value: string): string => {
  if (SAFE_WORD.test(value)) {
    return value;
  }
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('$', '$$$$')
    .replaceAll('%', '%%');
  return `"${escaped}"`;
};

const pathOf = (value: string): string => value.replaceAll('%', '%%');

const environmentLinesOf = (env: Readonly<Record<string, string>>): string[] =>
  Object.entries(env).map(
    ([key, value]) => `Environment=${wordOf(`${key}=${value}`)}`,
  );

const execLineOf = (args: readonly string[]): string =>
  `ExecStart=${args.map(wordOf).join(' ')}`;

export const cellUnitNameOf = (cellName: string): string =>
  `${CELL_UNIT_PREFIX}${cellName}${UNIT_SUFFIX}`;

export const cellNameOfUnit = (unitName: string): string | null => {
  if (
    !unitName.startsWith(CELL_UNIT_PREFIX) ||
    !unitName.endsWith(UNIT_SUFFIX)
  ) {
    return null;
  }
  const name = unitName.slice(CELL_UNIT_PREFIX.length, -UNIT_SUFFIX.length);
  return name.length > 0 ? name : null;
};

export const isManagedUnitText = (text: string): boolean =>
  text.split('\n')[0] === SERVICE_MARKER;

export const serverUnitOf = (input: ServerUnitInput): string =>
  [
    SERVICE_MARKER,
    '[Unit]',
    'Description=Software factory server',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    execLineOf(input.execArgs),
    ...environmentLinesOf(input.env),
    'Restart=on-failure',
    'RestartSec=5',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');

export const cellUnitOf = (input: CellUnitInput): string =>
  [
    SERVICE_MARKER,
    '[Unit]',
    `Description=Software factory Cell ${input.cellName}`,
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    `WorkingDirectory=${pathOf(input.workingDir)}`,
    execLineOf(input.execArgs),
    ...environmentLinesOf(input.env),
    ...(input.envFile === undefined
      ? []
      : [`EnvironmentFile=${pathOf(input.envFile)}`]),
    'Restart=on-failure',
    'RestartSec=5',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
