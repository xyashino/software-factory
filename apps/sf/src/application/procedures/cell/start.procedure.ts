import { drainStateOf } from '../../../cell/drain-signal';
import { JOIN_TOKEN_ENV, LINES_DIR } from '../../../config';
import type { Access } from '../../../domain/access';
import { cellNameOf } from '../../../domain/cell/cell-name';
import { joinPath } from '../../../domain/common/path';
import { ArgumentError, Refused } from '../../core/errors';
import type { Ports } from '../../core/procedure';
import { createToken } from '../tokens/token-create.procedure';
import { claimLoop } from './claim-loop.procedure';
import type { CellRuntime } from './cell-runtime';
import { enrollCell } from './enroll.procedure';
import { helloCell } from './hello.procedure';
import {
  resolveCellTarget,
  type ProjectChooser,
} from './resolve-project-target';

const LINE_SUFFIX = '.yml';
const SUPERVISOR: Access = { kind: 'supervisor' };

export interface StartInput {
  repoRoot: string;
  cellName: string;
  logPath: string;
  joinToken: string | undefined;
  lines: readonly string[] | undefined;
  relayed: boolean;
  project?: string;
  choose?: ProjectChooser;
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

// A relayed Cell's bearer is its local token; the Factory relay swaps it for the HQ session.
const enrollTokenOf = async (
  ports: Ports,
  input: StartInput,
  name: string,
): Promise<string | undefined> => {
  if (input.relayed) {
    return ports.connection.token ?? undefined;
  }
  if (input.joinToken === undefined || input.joinToken === '') {
    return mintJoinToken(ports, name);
  }
  return input.joinToken;
};

export const startCell = async (
  ports: Ports,
  input: StartInput,
): Promise<StartOutcome> => {
  const target = await resolveCellTarget(ports, {
    repoRoot: input.repoRoot,
    requested: input.project,
    choose: input.choose,
    relayed: input.relayed,
  });
  const { projectId, repoRoot } = target;
  const runners = await installedRunnersOf(ports);
  if (runners.length === 0) {
    throw new Refused('no runner installed on this machine');
  }
  const allowedLines = (
    await lineNamesOf(ports, joinPath(repoRoot, LINES_DIR))
  ).filter((name) => input.lines === undefined || input.lines.includes(name));
  if (allowedLines.length === 0) {
    throw new ArgumentError(`no line files in ${LINES_DIR}`);
  }
  let session = await ports.cellState.read();
  if (session === null) {
    const name = cellNameOf(input.cellName);
    const joinToken = await enrollTokenOf(ports, input, name);
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
    repoRoot,
    logPath: input.logPath,
    signal: input.signal,
    drain: drainStateOf(),
  };
  await claimLoop(runtime, null);
  return runtime.drain.superseded ? 'superseded' : 'stopped';
};
