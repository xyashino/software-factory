import { drainStateOf } from '../../../cell/drain-signal';
import { LINES_DIR } from '../../../config';
import { ArgumentError, Refused } from '../../core/errors';
import type { Ports } from '../../core/procedure';
import { joinPath } from '../../../domain/common/path';
import { claimLoop } from './claim-loop.procedure';
import type { CellRuntime } from './cell-runtime';
import {
  resolveCellTarget,
  type ProjectChooser,
} from './resolve-project-target';

const LINE_SUFFIX = '.yml';

export interface StartInput {
  repoRoot: string;
  cellId: string | undefined;
  logPath: string;
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

export const startCell = async (
  ports: Ports,
  input: StartInput,
): Promise<StartOutcome> => {
  const { cellId } = input;
  const bearer = ports.connection.token;
  if (!input.relayed || cellId === undefined || bearer === null) {
    throw new Refused(
      'a Cell starts through its Factory daemon: run "sf cell create" in a project repo',
    );
  }
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
  await ports.runner.prepare();
  const runtime: CellRuntime = {
    ports,
    session: { cellId, sessionToken: bearer },
    projectId,
    allowedLines,
    runners,
    repoRoot,
    logPath: input.logPath,
    signal: input.signal,
    drain: drainStateOf(),
  };
  await claimLoop(runtime, null);
  return runtime.drain.superseded ? 'superseded' : 'stopped';
};
