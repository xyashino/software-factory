import { defineCommand } from 'citty';
import { connectCommand } from './connection.command';
import {
  hqStartCommand,
  hqStopCommand,
  hqTokenAdminCreateCommand,
} from './server.command';
import {
  hqTargetLsCommand,
  hqTargetRmCommand,
  hqTargetUseCommand,
} from './target.command';
import { hqTokenCreateCommand } from './token.command';

const hqTargetCommand = defineCommand({
  meta: {
    name: 'target',
    description: 'List, select and remove saved HQ targets',
  },
  subCommands: {
    ls: hqTargetLsCommand,
    use: hqTargetUseCommand,
    rm: hqTargetRmCommand,
  },
});

const hqTokenCommand = defineCommand({
  meta: {
    name: 'token',
    description: 'Mint tokens on HQ, manage the admin token',
  },
  subCommands: {
    create: hqTokenCreateCommand,
    admin: defineCommand({
      meta: {
        name: 'admin',
        description: 'Admin token of the local HQ server',
      },
      subCommands: { create: hqTokenAdminCreateCommand },
    }),
  },
});

export const hqCommand = defineCommand({
  meta: {
    name: 'hq',
    description: 'Start, stop and reach the HQ server',
  },
  subCommands: {
    start: hqStartCommand,
    stop: hqStopCommand,
    connect: connectCommand,
    target: hqTargetCommand,
    token: hqTokenCommand,
  },
});
