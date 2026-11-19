import { z } from 'zod';
import { defineVerb } from '../define-verb';

export const read = defineVerb({
  name: 'read',
  description: 'Read the incident the Mechanic is working on',
  args: z.object({}),
  readFiles: {},
  toRequest: () => ({ verb: 'read' }),
});
