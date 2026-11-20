import { drainStateOf } from '../../../cell/drain-signal';
import { JOIN_TOKEN_ENV, LINES_DIR, REPO_CONFIG_PATH } from '../../../config';
import type { Access } from '../../../domain/access';
import { cellNameOf } from '../../../domain/cell/cell-name';
import { joinPath } from '../../../domain/common/path';
import { ArgumentError, Refused } from '../../core/errors';
import type { Ports } from '../../core/procedure';
import { readProjectId } from '../../core/repo-access';
import { createToken } from '../tokens/token-create.procedure';
import { claimLoop } from './claim-loop.procedure';
import type { CellRuntime } from './cell-runtime';
import { enrollCell } from './enroll.procedure';
import { helloCell } from './hello.procedure';

const LINE_SUFFIX = '.yml';
const SUPERVISOR: Access = { kind: 'supervisor' };

export interface StartInput {
  repoRoot: string;
  cellName: string;
  logPath: string;
  joinToken: string | undefined;
  signal: AbortSignal;
}

export type StartOutcome = 'superseded' | 'stopped';

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

const mintJoinToken = async (
  ports: Ports,
  name: string,
): Promise<string | undefined> => {
  if ((await ports.tokens.secret()) === null) {
    return undefined;
  }
  const minted = await createToken.execute(
    { kind: 'cell_join', name },
    { ...ports, token: SUPERVISOR, principal: SUPERVISOR },
  );
  return minted.token;
};

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
    const name = cellNameOf(input.cellName);
    const joinToken =
      input.joinToken === undefined || input.joinToken === ''
        ? await mintJoinToken(ports, name)
        : input.joinToken;
    if (joinToken === undefined) {
      throw new Refused(`no cell session, set ${JOIN_TOKEN_ENV} to enroll`);
    }
    session = await enrollCell(ports, {
      projectId,
      name,
      allowedLines,
      runners,
      joinToken,
    });
  }
  await helloCell(ports, session, {
    projectId,
    allowedLines,
    runners,
    localWorktrees: [],
  });
  await ports.runner.prepare();
  const runtime: CellRuntime = {
    ports,
    session,
    projectId,
    repoRoot: input.repoRoot,
    logPath: input.logPath,
    signal: input.signal,
    drain: drainStateOf(),
  };
  await claimLoop(runtime, null);
  return runtime.drain.superseded ? 'superseded' : 'stopped';
};
