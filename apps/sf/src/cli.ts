#!/usr/bin/env bun
import { defineCommand, runCommand, showUsage } from 'citty';
import { dispatchInternal } from './bootstrap/server-dispatch';
import { cellCommand } from './adapters/cli/cell.command';
import { connectCommand } from './adapters/cli/connection.command';
import { doctorCommand } from './adapters/cli/doctor.command';
import { factoryCommand } from './adapters/cli/factory.command';
import { incidentCommand } from './adapters/cli/incident.command';
import { initCommand } from './adapters/cli/init.command';
import { operatorCommand } from './adapters/cli/operator.command';
import { orderCommand } from './adapters/cli/order.command';
import { printError } from './adapters/cli/output';
import { projectCommand } from './adapters/cli/project.command';
import { queueCommand } from './adapters/cli/queue.command';
import { argsOf, resolveCommand } from './adapters/cli/resolve-command';
import { serverCommand } from './adapters/cli/server.command';
import { serviceCommand } from './adapters/cli/service.command';
import { setupCommand } from './adapters/cli/setup.command';
import { targetCommand } from './adapters/cli/target.command';
import { todosCommand } from './adapters/cli/todos.command';
import { tokenCommand } from './adapters/cli/token.command';
import { assertValidArgs } from './adapters/cli/validate';
import { watchCommand } from './adapters/cli/watch.command';
import { webCommand } from './adapters/cli/web.command';
import { Refused, Unreachable } from './application/core/errors';
import { EXIT } from './domain/exit-codes';

const HELP_FLAGS = ['--help', '-h'];
const REMOVED_CELL_COMMANDS = ['create', 'stop', 'rm'];
const REMOVED_CELL_HINT = 'use "sf cell scale N"';

const main = defineCommand({
  meta: {
    name: 'sf',
    version: '0.0.0',
    description: 'Software factory CLI (v2 flow)',
  },
  subCommands: {
    server: serverCommand,
    service: serviceCommand,
    setup: setupCommand,
    connect: connectCommand,
    doctor: doctorCommand,
    factory: factoryCommand,
    target: targetCommand,
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

const removedCellCommand = (args: readonly string[]): boolean =>
  args[0] === 'cell' && REMOVED_CELL_COMMANDS.includes(args[1] ?? '');

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
  if (removedCellCommand(rawArgs)) {
    printError(REMOVED_CELL_HINT);
    process.exit(EXIT.argument);
  }
  if (!(await dispatchInternal(rawArgs))) {
    if (rawArgs.length === 0) {
      await showUsage(main);
      process.exit(EXIT.ok);
    }
    const { cmd, parent, unknownToken, rest } = resolveCommand(main, rawArgs);
    if (helpRequested(rawArgs) && !unknownToken) {
      await showUsage(cmd, parent);
      process.exit(EXIT.ok);
    }
    assertValidArgs(argsOf(cmd), rest, !unknownToken);
    await runCommand(main, { rawArgs });
    process.exit(process.exitCode ?? EXIT.ok);
  }
} catch (error) {
  process.exit(await fail(error));
}
