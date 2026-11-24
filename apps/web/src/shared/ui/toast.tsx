import { X } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { cn } from './cn';

const TOAST_TTL_MS = 4_000;

export type ToastTone = 'default' | 'success' | 'destructive';

export type ToastItem = {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
};

type Listener = () => void;

const listeners = new Set<Listener>();
let items: ToastItem[] = [];

const notify = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: Listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => items;

export const dismissToast = (id: string) => {
  items = items.filter((item) => item.id !== id);
  notify();
};

export const pushToast = (toast: Omit<ToastItem, 'id'>) => {
  const id = crypto.randomUUID();
  items = [...items, { ...toast, id }];
  notify();
  setTimeout(() => dismissToast(id), TOAST_TTL_MS);
};

export const clearToasts = () => {
  items = [];
  notify();
};

export const ToastViewport = () => {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (current.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0"
    >
      {current.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={cn(
            'flex items-start justify-between gap-3 rounded-lg border bg-card p-4 text-card-foreground shadow-lg',
            toast.tone === 'success' && 'border-success/40',
            toast.tone === 'destructive' && 'border-destructive/40',
          )}
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{toast.title}</p>
            {toast.description ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {toast.description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => dismissToast(toast.id)}
            className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
