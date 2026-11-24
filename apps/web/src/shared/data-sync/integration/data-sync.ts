import { transitionDto } from '@repo/hq-contracts/stream.contract';
import type { z } from 'zod';

const STREAM_URL = '/api/stream';
const RETRY_MS = 3_000;

export type TransitionNotice = z.infer<typeof transitionDto>;
export type SyncEntityType = TransitionNotice['entityType'];
export type StreamStatus = 'connecting' | 'live' | 'reconnecting';

type EntityListener = (notice?: TransitionNotice) => void;
type StatusListener = (status: StreamStatus) => void;

const entityListeners = new Map<SyncEntityType, Set<EntityListener>>();
const statusListeners = new Set<StatusListener>();
let currentStatus: StreamStatus = 'connecting';
let leave: (() => void) | undefined;

const setStatus = (next: StreamStatus) => {
  if (currentStatus === next) return;
  currentStatus = next;
  for (const listener of statusListeners) listener(next);
};

const dispatchEntity = (
  entityType: SyncEntityType,
  notice?: TransitionNotice,
) => {
  entityListeners.get(entityType)?.forEach((listener) => listener(notice));
};

const reloadAll = () => {
  entityListeners.forEach((_set, entityType) => dispatchEntity(entityType));
};

const connect = (): (() => void) => {
  if (typeof EventSource === 'undefined') return () => {};

  let source: EventSource | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let connected = false;
  let lastSeq = 0;

  const open = () => {
    source?.close();
    setStatus(connected ? 'reconnecting' : 'connecting');
    const url =
      lastSeq > 0 ? `${STREAM_URL}?afterSeq=${String(lastSeq)}` : STREAM_URL;
    const next = new EventSource(url);
    source = next;

    next.onopen = () => {
      setStatus('live');
      if (connected) reloadAll();
      connected = true;
    };

    const onTransition = (event: MessageEvent<string>) => {
      const parsed = transitionDto.safeParse(JSON.parse(event.data));
      if (!parsed.success) return;
      if (parsed.data.seq > lastSeq) lastSeq = parsed.data.seq;
      dispatchEntity(parsed.data.entityType, parsed.data);
    };

    next.addEventListener('transition', onTransition);

    next.onerror = () => {
      setStatus('reconnecting');
      if (next.readyState !== EventSource.CLOSED) return;
      clearTimeout(retry);
      retry = setTimeout(open, RETRY_MS);
    };
  };

  const resume = () => {
    if (document.visibilityState === 'hidden') return;
    open();
    if (connected) reloadAll();
  };

  const onPageShow = ({ persisted }: PageTransitionEvent) => {
    if (persisted) resume();
  };

  open();
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('online', resume);

  return () => {
    clearTimeout(retry);
    source?.close();
    document.removeEventListener('visibilitychange', resume);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('online', resume);
  };
};

export const getStreamStatus = (): StreamStatus => currentStatus;

export const watchStreamStatus = (listener: StatusListener): (() => void) => {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
};

export const watchDataChanges = (
  entityType: SyncEntityType,
  listener: EntityListener,
): (() => void) => {
  const set = entityListeners.get(entityType) ?? new Set<EntityListener>();
  set.add(listener);
  entityListeners.set(entityType, set);
  leave ??= connect();

  return () => {
    set.delete(listener);
    if (set.size === 0) entityListeners.delete(entityType);
    if (entityListeners.size === 0) {
      leave?.();
      leave = undefined;
    }
  };
};
