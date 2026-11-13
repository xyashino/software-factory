import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { HerdrNotificationOptions } from '../ports/herdr.port';
import type { SupervisorPorts } from './ports';

/**
 * Shows a Herdr toast. A refusal is written to `.evidences/<task>/notify.log`
 * and never thrown: a toast must not fail a delivery.
 */
export const notifyQuietly = async (
  ports: SupervisorPorts,
  taskId: string,
  title: string,
  options: HerdrNotificationOptions,
): Promise<void> => {
  try {
    await ports.herdr.notify(title, options);
  } catch (error) {
    const log = join(ports.root, '.evidences', taskId, 'notify.log');
    mkdirSync(dirname(log), { recursive: true });
    writeFileSync(log, error instanceof Error ? error.message : String(error));
  }
};
