#!/usr/bin/env bun
import { defineCommand, runCommand, showUsage } from 'citty';
import { EXIT } from './domain/exit-codes';

const HELP_FLAGS = ['--help', '-h'];

const main = defineCommand({
  meta: {
    name: 'factory',
    version: '0.0.0',
    description: 'Software factory CLI (v2 flow)',
  },
});

const rawArgs = process.argv.slice(2);

try {
  if (rawArgs.some((arg) => HELP_FLAGS.includes(arg))) {
    await showUsage(main);
    process.exit(EXIT.ok);
  }
  await runCommand(main, { rawArgs });
  process.exit(EXIT.ok);
} catch (error) {
  console.error(error);
  process.exit(EXIT.argument);
}
