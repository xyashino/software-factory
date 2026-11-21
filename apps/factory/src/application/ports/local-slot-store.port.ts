import type { LocalSlot } from '../../domain/cell/local-slot';

export interface LocalSlotStorePort {
  read(): Promise<LocalSlot[]>;
  write(slots: LocalSlot[]): Promise<void>;
  remove(slotId: string): Promise<void>;
  logPathOf(slotId: string): string;
}
