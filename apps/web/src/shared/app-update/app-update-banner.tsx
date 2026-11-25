import { useEffect, useState } from 'react';
import { z } from 'zod';
import { watchStreamStatus } from '@/shared/data-sync/integration/data-sync';
import { Button } from '@/shared/ui/button';

const VERSION_URL = '/api/version';

const versionReplySchema = z.object({ version: z.string() });

const readServerVersion = async (): Promise<string | null> => {
  try {
    const response = await fetch(VERSION_URL, { cache: 'no-store' });
    if (!response.ok) return null;
    const parsed = versionReplySchema.safeParse(await response.json());
    return parsed.success ? parsed.data.version : null;
  } catch {
    return null;
  }
};

export const AppUpdateBanner = () => {
  const [stale, setStale] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let baseline: string | null = null;
    const check = async () => {
      const version = await readServerVersion();
      if (version === null) return;
      if (baseline === null) baseline = version;
      else if (version !== baseline) setStale(true);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };

    void check();
    document.addEventListener('visibilitychange', onVisible);
    const unwatch = watchStreamStatus((status) => {
      if (status === 'live') void check();
    });
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      unwatch();
    };
  }, []);

  if (!stale || dismissed) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-md border bg-background p-3 text-sm shadow-lg"
    >
      <span>A new version of the factory is available.</span>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => window.location.reload()}>
          Refresh
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
          Dismiss
        </Button>
      </div>
    </div>
  );
};
