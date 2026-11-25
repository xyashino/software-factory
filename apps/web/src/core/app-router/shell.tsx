import { Outlet } from '@tanstack/react-router';
import { Factory, Moon, Radio, Sun } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { AppUpdateBanner } from '@/shared/app-update/app-update-banner';
import {
  getStreamStatus,
  watchStreamStatus,
  type StreamStatus,
} from '@/shared/data-sync/integration/data-sync';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { ToastViewport } from '@/shared/ui/toast';

const STREAM_LABELS: Record<StreamStatus, string> = {
  live: 'Live',
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
};

const readInitialDark = (): boolean =>
  typeof document !== 'undefined' &&
  document.documentElement.dataset.theme === 'dark';

export const AppShell = () => {
  const [dark, setDark] = useState(readInitialDark);
  const streamStatus = useSyncExternalStore(
    watchStreamStatus,
    getStreamStatus,
    getStreamStatus,
  );

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur-xs">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <Factory className="size-5" aria-hidden="true" />
            <span className="text-sm font-semibold tracking-tight">
              Software Factory
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Badge
              variant={streamStatus === 'live' ? 'success' : 'secondary'}
              aria-label={`Live stream status: ${STREAM_LABELS[streamStatus]}`}
            >
              <Radio className="size-3" aria-hidden="true" />
              <span>{STREAM_LABELS[streamStatus]}</span>
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              onClick={toggleTheme}
            >
              {dark ? (
                <Sun className="size-4" aria-hidden="true" />
              ) : (
                <Moon className="size-4" aria-hidden="true" />
              )}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <Outlet />
      </main>

      <AppUpdateBanner />
      <ToastViewport />
    </div>
  );
};
