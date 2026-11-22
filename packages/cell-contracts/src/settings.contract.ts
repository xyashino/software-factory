import { z } from 'zod';
import { errorResponse } from '@repo/zod-contract-kit/reply';
import { RUNNERS } from './enums/settings';

const settingsDto = z.object({
  herdr_enabled: z.boolean(),
  default_runner: z.enum(RUNNERS),
  restart_backoff_ms: z.number().int(),
  max_local_cells: z.number().int(),
  git_fetch_on_worktree: z.boolean(),
});

const settingsOut = z.object({
  code: z.literal(200),
  settings: settingsDto,
});

export const getSettingsContract = {
  out: { 200: settingsOut },
};

export const patchSettingsContract = {
  in: { body: z.record(z.string(), z.unknown()) },
  out: {
    200: settingsOut,
    400: errorResponse(400, 'bad-request'),
  },
};
