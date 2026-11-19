import { drainStateOf } from '../../../cell/drain-signal';
import { JOIN_TOKEN_ENV, LINES_DIR, REPO_CONFIG_PATH } from '../../../config';
import { joinPath } from '../../../domain/common/path';
import { ArgumentError, Refused } from '../../core/errors';
import type { Ports } from '../../core/procedure';
import { readProjectId } from '../../core/repo-access';
import { claimLoop } from './claim-loop.procedure';
import type { CellRuntime } from './cell-runtime';
import { enrollCell } from './enroll.procedure';
import { helloCell } from './hello.procedure';

const LINE_SUFFIX = '.yml';
const FALLBACK_CELL_NAME = 'cell';

export interface StartInput {
  repoRoot: string;
  cellName: string;
  joinToken: string | undefined;
  signal: AbortSignal;
}

export type StartOutcome = 'superseded' | 'stopped';

const cellNameOf = (raw: string): string => {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : FALLBACK_CELL_NAME;
};

const installedRunnersOf = async (ports: Ports): Promise<string[]> => {
  const installed: string[] = [];
  for (const name of ports.runners.names()) {
    if (await ports.runners.isInstalled(name)) {
      installed.push(name);
    }
  }
  return installed;
};

const lineNamesOf = async (ports: Ports, dir: string): Promise<string[]> =>
  (await ports.fs.list(dir))
    .filter((name) => name.endsWith(LINE_SUFFIX))
    .map((name) => name.slice(0, -LINE_SUFFIX.length))
    .sort();

export const startCell = async (
  ports: Ports,
  input: StartInput,
): Promise<StartOutcome> => {
  const runners = await installedRunnersOf(ports);
  if (runners.length === 0) {
    throw new Refused('no runner installed on this machine');
  }
  const projectId = await readProjectId(
    ports,
    joinPath(input.repoRoot, REPO_CONFIG_PATH),
  );
  const allowedLines = await lineNamesOf(
    ports,
    joinPath(input.repoRoot, LINES_DIR),
  );
  if (allowedLines.length === 0) {
    throw new ArgumentError(`no line files in ${LINES_DIR}`);
  }
  let session = await ports.cellState.read();
  if (session === null) {
    if (input.joinToken === undefined || input.joinToken === '') {
      throw new Refused(`no cell session, set ${JOIN_TOKEN_ENV} to enroll`);
    }
    session = await enrollCell(ports, {
      projectId,
      name: cellNameOf(input.cellName),
      allowedLines,
      runners,
      joinToken: input.joinToken,
    });
  }
  await helloCell(ports, session, {
    projectId,
    allowedLines,
    runners,
    localWorktrees: [],
  });
  const runtime: CellRuntime = {
    ports,
    session,
    projectId,
    repoRoot: input.repoRoot,
    signal: input.signal,
    drain: drainStateOf(),
  };
  await claimLoop(runtime, null);
  return runtime.drain.superseded ? 'superseded' : 'stopped';
};
