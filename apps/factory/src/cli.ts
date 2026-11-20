#!/usr/bin/env bun
import { defineCommand, runCommand, showUsage } from 'citty';
import { dispatchInternal } from './bootstrap/server-dispatch';
import { cellCommand } from './adapters/cli/cell.command';
import { incidentCommand } from './adapters/cli/incident.command';
import { initCommand } from './adapters/cli/init.command';
import { operatorCommand } from './adapters/cli/operator.command';
import { orderCommand } from './adapters/cli/order.command';
import { printError } from './adapters/cli/output';
import { projectCommand } from './adapters/cli/project.command';
import { queueCommand } from './adapters/cli/queue.command';
import { resolveCommand } from './adapters/cli/resolve-command';
import { serverCommand } from './adapters/cli/server.command';
import { todosCommand } from './adapters/cli/todos.command';
import { tokenCommand } from './adapters/cli/token.command';
import { watchCommand } from './adapters/cli/watch.command';
import { webCommand } from './adapters/cli/web.command';
import { Refused, Unreachable } from './application/core/errors';
import { EXIT } from './domain/exit-codes';

const HELP_FLAGS = ['--help', '-h'];

const main = defineCommand({
  meta: {
    name: 'sf',
    version: '0.0.0',
    description: 'Software factory CLI (v2 flow)',
  },
  subCommands: {
    server: serverCommand,
    todos: todosCommand,
    queue: queueCommand,
    incident: incidentCommand,
    order: orderCommand,
    watch: watchCommand,
    operator: operatorCommand,
    cell: cellCommand,
    web: webCommand,
    init: initCommand,
    project: projectCommand,
    token: tokenCommand,
  },
});

const rawArgs = process.argv.slice(2);

const helpRequested = (args: readonly string[]): boolean => {
  const end = args.indexOf('--');
  const head = end === -1 ? args : args.slice(0, end);
  return head.some((arg) => HELP_FLAGS.includes(arg));
};

const fail = async (error: unknown): Promise<number> => {
  if (error instanceof Error && error.name === 'CLIError') {
    const { cmd, parent } = resolveCommand(main, rawArgs);
    await showUsage(cmd, parent);
    printError(error.message);
    return EXIT.argument;
  }
  printError(error instanceof Error ? error.message : String(error));
  if (error instanceof Refused) {
    return EXIT.refused;
  }
  if (error instanceof Unreachable) {
    return EXIT.unreachable;
  }
  return EXIT.argument;
};

try {
  if (!(await dispatchInternal(rawArgs))) {
    if (rawArgs.length === 0) {
      await showUsage(main);
      process.exit(EXIT.ok);
    }
    const { cmd, parent, unknownToken } = resolveCommand(main, rawArgs);
    if (helpRequested(rawArgs) && !unknownToken) {
      await showUsage(cmd, parent);
      process.exit(EXIT.ok);
    }
    await runCommand(main, { rawArgs });
    process.exit(process.exitCode ?? EXIT.ok);
  }
} catch (error) {
  process.exit(await fail(error));
}
