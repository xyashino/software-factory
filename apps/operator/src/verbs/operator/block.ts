import { z } from 'zod';
import { defineVerb } from '../define-verb';

export const block = defineVerb({
  name: 'block',
  description: 'Stop the job and open an operator_blocked incident',
  args: z.object({ reason: z.string().min(1) }),
  readFiles: { handover: { required: true } },
  toRequest: ({ reason }, { handover }) => ({
    verb: 'block',
    reason,
    handover,
  }),
});
