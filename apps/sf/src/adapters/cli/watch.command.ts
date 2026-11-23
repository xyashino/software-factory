import { resolve } from 'node:path';
import { defineCommand } from 'citty';
import { run } from '../../bootstrap/run';
import { REPO_CONFIG_PATH } from '../../config';
import { streamTransitions } from '../../application/procedures/watch/stream.procedure';
import { printLine, reportFailure } from './output';
import { parseWholeNumber } from './validate';

interface TransitionLine {
  seq: number;
  at: number;
  entityType: string;
  entityId: string;
  fromState: string | null;
  toState: string;
  actorKind: string;
  meta: Record<string, unknown> | null;
}

const orderOf = (line: TransitionLine): string => {
  if (line.entityType === 'work_order') {
    return line.entityId;
  }
  const orderId = line.meta?.orderId;
  return typeof orderId === 'string' ? orderId : '-';
};

const printTransition = (line: TransitionLine): void => {
  printLine(
    [
      String(line.seq),
      new Date(line.at).toISOString(),
      orderOf(line),
      line.entityType,
      `${line.fromState ?? '-'} -> ${line.toState} by ${line.actorKind}`,
    ].join('  '),
  );
};

const runWatch = async (
  options: { project?: string; afterSeq: number },
  signal: AbortSignal,
): Promise<number> => {
  const result = await run(
    streamTransitions,
    {
      configPath: resolve(process.cwd(), REPO_CONFIG_PATH),
      project: options.project,
      afterSeq: options.afterSeq,
      signal,
      onTransition: printTransition,
    },
    'operator',
  );
  return reportFailure(result);
};

export const watchCommand = defineCommand({
  meta: {
    name: 'watch',
    description:
      'Watch live state transitions; Ctrl-C exits. Needs scope operator:read',
  },
  args: {
    project: {
      type: 'string',
      description: 'Project id (default: repo config)',
    },
    after: {
      type: 'string',
      description: 'Start after this seq (default: 0, the whole backlog)',
    },
  },
  run: async ({ args }) => {
    const controller = new AbortController();
    const stop = (): void => controller.abort();
    process.once('SIGINT', stop);
    try {
      process.exitCode = await runWatch(
        {
          project: args.project,
          afterSeq: parseWholeNumber(args.after ?? 0, '--after', { min: 0 }),
        },
        controller.signal,
      );
    } finally {
      process.off('SIGINT', stop);
    }
  },
});
