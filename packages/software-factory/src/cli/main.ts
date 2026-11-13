import { defineCommand, runMain } from 'citty';

export const mainCommand = defineCommand({
  meta: {
    name: 'sf',
    description: 'Software factory CLI',
  },
  subCommands: {
    check: () =>
      import('./commands/check').then((module) => module.checkCommand),
    run: () => import('./commands/run').then((module) => module.runCommand),
    done: () => import('./commands/done').then((module) => module.doneCommand),
    verdict: () =>
      import('./commands/verdict').then((module) => module.verdictCommand),
    ask: () => import('./commands/ask').then((module) => module.askCommand),
    tell: () => import('./commands/tell').then((module) => module.tellCommand),
    answer: () =>
      import('./commands/answer').then((module) => module.answerCommand),
    escalate: () =>
      import('./commands/escalate').then((module) => module.escalateCommand),
    unblock: () =>
      import('./commands/unblock').then((module) => module.unblockCommand),
    status: () =>
      import('./commands/status').then((module) => module.statusCommand),
    log: () => import('./commands/log').then((module) => module.logCommand),
    reset: () =>
      import('./commands/reset').then((module) => module.resetCommand),
  },
});

export const run = (): Promise<void> => {
  return runMain(mainCommand);
};
