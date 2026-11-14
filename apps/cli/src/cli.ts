#!/usr/bin/env bun
import { defineCommand, runMain } from 'citty';
import { adminCommand } from './commands/admin';
import { cancelCommand } from './commands/cancel';
import { cellsCommand } from './commands/cells';
import { checkCommand } from './commands/check';
import { answerCommand } from './commands/answer';
import { logCommand } from './commands/log';
import { nudgeCommand } from './commands/nudge';
import { prioCommand } from './commands/prio';
import { reopenCommand } from './commands/reopen';
import { resumeCommand } from './commands/resume';
import { runCommand } from './commands/run';
import { showCommand } from './commands/show';
import { statusCommand } from './commands/status';
import { syncCommand } from './commands/sync';
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
    sync: syncCommand,
    cells: cellsCommand,
    check: checkCommand,
    admin: adminCommand,
  },
});

if (process.argv.length <= 2) {
  console.log(usage);
} else {
  await runMain(main);
}
