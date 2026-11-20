import { resolve } from 'node:path';
import { defineCommand } from 'citty';
import { buildContext } from '../../bootstrap/context';
import { runWithoutToken, settle } from '../../bootstrap/run';
import {
  DEFAULT_DATA_DIR,
  DEFAULT_FACTORY_URL,
  DEFAULT_WEB_HOST,
  DEFAULT_WEB_PORT,
  REPO_CONFIG_PATH,
  webEntryPath,
} from '../../config';
import { readProjectId } from '../../application/core/repo-access';
import { startWeb } from '../../application/procedures/web/start.procedure';
import { statusWeb } from '../../application/procedures/web/status.procedure';
import { stopWeb } from '../../application/procedures/web/stop.procedure';
import { printJson, printLine, reportFailure } from './output';

const dataDirFromEnv = (): string =>
  process.env.FACTORY_DATA_DIR ?? DEFAULT_DATA_DIR;

const runStart = async (
  host: string,
  port: string,
  json: boolean,
): Promise<number> => {
  const ports = buildContext();
  const project = await settle(() =>
    readProjectId(ports, resolve(process.cwd(), REPO_CONFIG_PATH)),
  );
  if (project.kind === 'failed') {
    return reportFailure(project);
  }
  const result = await runWithoutToken(
    startWeb,
    {
      bin: process.execPath,
      webEntry: webEntryPath(),
      dataDir: dataDirFromEnv(),
      factoryUrl: process.env.FACTORY_URL ?? DEFAULT_FACTORY_URL,
      projectId: project.value,
      host,
      port: Number(port),
    },
    ports,
  );
  if (result.kind === 'ok') {
    if (json) {
      printJson(result.value);
    } else {
      printLine(
        `web started, pid ${result.value.pid}, url ${result.value.url}`,
      );
    }
  }
  return reportFailure(result);
};

const runStop = async (json: boolean): Promise<number> => {
  const result = await runWithoutToken(
    stopWeb,
    { dataDir: dataDirFromEnv() },
    buildContext(),
  );
  if (result.kind === 'ok') {
    if (json) {
      printJson(result.value);
    } else {
      printLine(
        result.value.outcome === 'stopped' ? 'web stopped' : 'web not running',
      );
    }
  }
  return reportFailure(result);
};

const runStatus = async (
  host: string,
  port: string,
  json: boolean,
): Promise<number> => {
  const result = await runWithoutToken(
    statusWeb,
    { dataDir: dataDirFromEnv(), host, port: Number(port) },
    buildContext(),
  );
  if (result.kind === 'ok') {
    if (json) {
      printJson(result.value);
    } else {
      printLine(
        result.value.running
          ? `web running, pid ${result.value.pid}, url ${result.value.url}`
          : 'web not running',
      );
    }
  }
  return reportFailure(result);
};

export const webCommand = defineCommand({
  meta: {
    name: 'web',
    description: 'Start, stop and check the factory web UI',
  },
  subCommands: {
    start: defineCommand({
      meta: { name: 'start', description: 'Start the factory web UI' },
      args: {
        host: {
          type: 'string',
          default: DEFAULT_WEB_HOST,
          description: 'Host to listen on',
        },
        port: {
          type: 'string',
          default: String(DEFAULT_WEB_PORT),
          description: 'Port to listen on',
        },
        json: { type: 'boolean', default: false },
      },
      run: async ({ args }) => {
        process.exitCode = await runStart(args.host, args.port, args.json);
      },
    }),
    stop: defineCommand({
      meta: { name: 'stop', description: 'Stop the factory web UI' },
      args: { json: { type: 'boolean', default: false } },
      run: async ({ args }) => {
        process.exitCode = await runStop(args.json);
      },
    }),
    status: defineCommand({
      meta: { name: 'status', description: 'Show whether the web UI runs' },
      args: {
        host: {
          type: 'string',
          default: DEFAULT_WEB_HOST,
          description: 'Host the web UI listens on',
        },
        port: {
          type: 'string',
          default: String(DEFAULT_WEB_PORT),
          description: 'Port the web UI listens on',
        },
        json: { type: 'boolean', default: false },
      },
      run: async ({ args }) => {
        process.exitCode = await runStatus(args.host, args.port, args.json);
      },
    }),
  },
});
