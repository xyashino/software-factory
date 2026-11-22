import { patchSettingsContract } from '@repo/cell-contracts/settings.contract';
import { immediateTx } from '../../../db/client';
import { settings } from '../../../db/schema/settings';
import { validateSettingsPatch } from '../../../domain/settings/preferences';
import { asBadRequest } from '../../core/error-handling';
import { publicProcedure } from '../../core/procedure';
import { resolveSettings } from './resolve-settings';

export const patchSettingsProcedure = publicProcedure(patchSettingsContract)((
  input,
  ctx,
) => {
  const patch = asBadRequest(() => validateSettingsPatch(input.body));
  const now = ctx.clock.now();

  return immediateTx(ctx.db, (tx) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      tx.insert(settings)
        .values({ key, valueJson: value, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: settings.key,
          set: { valueJson: value, updatedAt: now },
        })
        .run();
    }
    return {
      code: 200 as const,
      settings: resolveSettings(tx.select().from(settings).all()),
    };
  });
});
