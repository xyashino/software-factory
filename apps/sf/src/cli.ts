#!/usr/bin/env bun
import { defineCommand, runCommand, showUsage } from 'citty';
import { dispatchInternal } from './bootstrap/server-dispatch';
import { cellCommand } from './adapters/cli/cell.command';
import { doctorCommand } from './adapters/cli/doctor.command';
import { factoryCommand } from './adapters/cli/factory.command';
import { incidentCommand } from './adapters/cli/incident.command';
import { hqCommand } from './adapters/cli/hq.command';
import { initCommand } from './adapters/cli/init.command';
import { legacyCommands } from './adapters/cli/legacy.command';
import { operatorCommand } from './adapters/cli/operator.command';
import { orderCommand } from './adapters/cli/order.command';
import { printError } from './adapters/cli/output';
import { projectCommand } from './adapters/cli/project.command';
import { queueCommand } from './adapters/cli/queue.command';
import { argsOf, resolveCommand } from './adapters/cli/resolve-command';
import { serviceCommand } from './adapters/cli/service.command';
import { setupCommand } from './adapters/cli/setup.command';
import { todosCommand } from './adapters/cli/todos.command';
import { assertValidArgs } from './adapters/cli/validate';
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
    hq: hqCommand,
    service: serviceCommand,
    setup: setupCommand,
    doctor: doctorCommand,
    factory: factoryCommand,
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
    ...legacyCommands,
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
