import { z } from 'zod';
import { defineVerb } from '../define-verb';

export const done = defineVerb({
  name: 'done',
  description: 'Mark the station finished',
  args: z.object({}),
  readFiles: {},
  toRequest: () => ({ verb: 'done' }),
});
