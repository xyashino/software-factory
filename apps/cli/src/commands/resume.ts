import { defineCommand } from 'citty';
import type { OrderId, StationId } from '@repo/factory-core/ids';
import { putNote } from '../client/blobs';
import {
  createContext,
  flagsOf,
  globalArgs,
  printJson,
  withErrors,
} from '../context';

export const resumeCommand = defineCommand({
  meta: {
    name: 'resume',
    description:
      'Resume an Andon: retry the station, or restart from another one',
  },
  args: {
    ...globalArgs,
    order: {
      type: 'positional',
      required: true,
      description: 'The Work order id',
    },
    note: {
      type: 'string',
      description: 'A note the Operator reads when it resumes',
    },
    from: {
      type: 'string',
      description:
        'Restart from this station instead of retrying the current one',
    },
    grant: {
      type: 'string',
      description: 'Grant this many extra retries (0 to 10)',
    },
  },
  run: ({ args }) =>
    withErrors(async () => {
      const ctx = createContext(flagsOf(args));
      const orderId = String(args.order) as OrderId;
      const grant = args.grant === undefined ? undefined : Number(args.grant);
      if (
        grant !== undefined &&
        !(Number.isInteger(grant) && grant >= 0 && grant <= 10)
      ) {
        throw new Error('--grant must be a whole number from 0 to 10');
      }
      const noteBlob =
        args.note === undefined
          ? undefined
          : await putNote(ctx.client, String(args.note));
      const result = await ctx.client.call('resume', {
        orderId,
        commandId: ctx.commandId(),
        mode:
          args.from === undefined
            ? { kind: 'retry_station' }
            : {
                kind: 'restart_from',
                stationId: String(args.from) as StationId,
              },
        ...(noteBlob !== undefined ? { noteBlob } : {}),
        ...(grant !== undefined ? { grantRetries: grant } : {}),
      });
      if (ctx.json) printJson(result);
      else console.log(`resumed ${orderId}`);
    }),
});
