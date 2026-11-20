import type { RuntimeStatus } from '../../domain/cells/cell-slot';
import type { SlotId } from '../../domain/common/brand';

export type SupervisorPort = {
  start(slotId: SlotId): Promise<void>;
  stop(slotId: SlotId): Promise<void>;
  status(slotId: SlotId): Promise<RuntimeStatus>;
};
