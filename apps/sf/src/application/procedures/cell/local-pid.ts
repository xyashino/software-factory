import type { LocalSlot } from '../../../domain/cell/local-slot';
import type { Ports } from '../../core/procedure';

export const livePidOf = (
  ports: Pick<Ports, 'process'>,
  slot: LocalSlot,
): number | null =>
  slot.pid !== null && ports.process.isAlive(slot.pid) ? slot.pid : null;
