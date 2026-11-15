#!/usr/bin/env bun
import { defineCommand, runMain } from 'citty';
import { adminCommand } from './commands/admin';
import { cancelCommand } from './commands/cancel';
import { cellsCommand } from './commands/cells';
import { checkCommand } from './commands/check';
import { orderCommand } from './commands/order';
import { todosCommand } from './commands/todos';
import { initCommand } from './commands/init';
import { answerCommand } from './commands/answer';
import { logCommand } from './commands/log';
import { projectCommand } from './commands/project';
import { nudgeCommand } from './commands/nudge';
import { planCommand } from './commands/plan';
import { prioCommand } from './commands/prio';
import { reopenCommand } from './commands/reopen';
import { resumeCommand } from './commands/resume';
import { runCommand } from './commands/run';
import { showCommand } from './commands/show';
import { statusCommand } from './commands/status';
import { usage } from './usage';

/** The Supervisor command line (PROTOCOL §10). Every subcommand is a client of `factory-server`. */
const main = defineCommand({
  meta: {
    name: 'factory',
    description: 'The Software Factory Supervisor command line',
  },
  subCommands: {
    run: runCommand,
    status: statusCommand,
    show: showCommand,
    log: logCommand,
    answer: answerCommand,
    resume: resumeCommand,
    reopen: reopenCommand,
    nudge: nudgeCommand,
    cancel: cancelCommand,
    prio: prioCommand,
    cells: cellsCommand,
    project: projectCommand,
    plan: planCommand,
    init: initCommand,
    order: orderCommand,
    todos: todosCommand,
    check: checkCommand,
    admin: adminCommand,
  },
});

if (process.argv.length <= 2) {
  console.log(usage);
} else {
  await runMain(main);
}
