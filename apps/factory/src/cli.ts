#!/usr/bin/env bun
import { defineCommand, runCommand, showUsage } from 'citty';
import { dispatchInternal } from './bootstrap/server-dispatch';
import { cellCommand } from './adapters/cli/cell.command';
import { incidentCommand } from './adapters/cli/incident.command';
import { initCommand } from './adapters/cli/init.command';
import { operatorCommand } from './adapters/cli/operator.command';
import { orderCommand } from './adapters/cli/order.command';
import { projectCommand } from './adapters/cli/project.command';
import { queueCommand } from './adapters/cli/queue.command';
import { serverCommand } from './adapters/cli/server.command';
import { todosCommand } from './adapters/cli/todos.command';
import { tokenCommand } from './adapters/cli/token.command';
import { watchCommand } from './adapters/cli/watch.command';
import { webCommand } from './adapters/cli/web.command';
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

if (!(await dispatchInternal(rawArgs))) {
  try {
    if (rawArgs.some((arg) => HELP_FLAGS.includes(arg))) {
      await showUsage(main);
      process.exit(EXIT.ok);
    }
    await runCommand(main, { rawArgs });
    process.exit(process.exitCode ?? EXIT.ok);
  } catch (error) {
    console.error(error);
    process.exit(EXIT.argument);
  }
}
