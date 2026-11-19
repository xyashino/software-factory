#!/usr/bin/env bun
import { defineCommand, runCommand, showUsage } from 'citty';
import { incidentCommand } from './adapters/cli/incident.command';
import { operatorCommand } from './adapters/cli/operator.command';
import { orderCommand } from './adapters/cli/order.command';
import { queueCommand } from './adapters/cli/queue.command';
import { serverCommand } from './adapters/cli/server.command';
import { todosCommand } from './adapters/cli/todos.command';
import { watchCommand } from './adapters/cli/watch.command';
import { EXIT } from './domain/exit-codes';

const HELP_FLAGS = ['--help', '-h'];

const main = defineCommand({
  meta: {
    name: 'factory',
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
  },
});

const rawArgs = process.argv.slice(2);

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
