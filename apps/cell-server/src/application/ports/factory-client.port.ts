import type { SlotId } from '../../domain/common/brand';
import type { FactoryTarget } from '../../domain/factories/factory-target';

export type FactoryClientPort = {
  health(factory: FactoryTarget): Promise<boolean>;
  register(factory: FactoryTarget, slotId: SlotId): Promise<void>;
};
