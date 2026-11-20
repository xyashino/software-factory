import type { SlotId } from '../../domain/common/brand';
import type { RuntimeStatus } from '../../domain/cells/cell-slot';

export type SlotLaunch = {
  slotId: SlotId;
  name: string;
  factoryUrl: string;
  sessionToken: string;
  repoRoot: string;
  logPath: string;
  herdrEnabled: boolean;
};

export type SupervisorPort = {
  start(launch: SlotLaunch): Promise<{ pid: number | null }>;
  stop(slotId: SlotId, options: { force: boolean }): Promise<void>;
  status(slotId: SlotId): Promise<RuntimeStatus>;
};
