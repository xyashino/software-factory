import type { z } from 'zod';
import type { stepJobPayloadDto } from '../../contracts/cells.contract';
import type { WorkOrderRow } from './order-views';

export const stepJobPayload = (
  order: WorkOrderRow,
  stepIndex: number,
): z.infer<typeof stepJobPayloadDto> => ({
  stepIndex,
  lineName: order.lineName,
  task: {
    slug: order.slug,
    title: order.title,
    type: order.type,
    description: order.description,
  },
});
