import type { RouteResponse } from '@repo/factory-core/contracts/routes';
import type { Paint } from './paint';

export type BoardRow = RouteResponse<'board'>['orders'][number];

/** Terminal board rows older than this are hidden unless `--all` (PROTOCOL §3.1). */
export const TERMINAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const TERMINAL = new Set(['merged', 'delivered', 'cancelled']);

/** Paints a board status (CORE §4.2, STORAGE §4). Unknown statuses stay plain. */
export const paintStatus = (paint: Paint, status: string): string => {
  switch (status) {
    case 'running':
      return paint.cyan(status);
    case 'waiting_answer':
      return paint.yellow(status);
    case 'andon':
      return paint.red(status);
    case 'delivering':
      return paint.blue(status);
    case 'delivered':
    case 'merged':
      return paint.green(status);
    case 'cancelled':
      return paint.gray(status);
    case 'deps_broken':
      return paint.red(status);
    case 'waiting_deps':
      return paint.magenta(status);
    case 'queued':
      return paint.dim(status);
    default:
      return status;
  }
};

/** Paints a holder: `cell` cyan, `supervisor` red (Andon), `queue` dim, `none` gray. */
export const paintHolder = (paint: Paint, holder: string): string => {
  if (holder.startsWith('cell')) return paint.cyan(holder);
  if (holder.startsWith('supervisor')) return paint.red(holder);
  if (holder === 'queue') return paint.dim(holder);
  return paint.gray(holder);
};

/** The age of a row since its last update, in the largest sensible unit. */
export const ageOf = (updatedAt: number, now: number): string => {
  const minutes = Math.max(0, Math.floor((now - updatedAt) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / (60 * 24))}d`;
};

/** Whether a row is hidden from the default board: terminal and last updated over a week ago. */
export const isHiddenByDefault = (row: BoardRow, now: number): boolean =>
  TERMINAL.has(row.status) && now - row.updatedAt > TERMINAL_WINDOW_MS;

const pad = (text: string, width: number): string => text.padEnd(width);

/**
 * The board as a table (PROTOCOL §10, `factory status`). Widths are computed on plain text and the
 * colour is applied after padding, so the columns line up with or without colour.
 */
export const renderBoard = (
  rows: BoardRow[],
  paint: Paint,
  now: number,
): string => {
  if (rows.length === 0) return 'no work orders';
  const header = [
    pad('ORDER', 24),
    pad('PRIO', 7),
    pad('STATUS', 16),
    pad('HOLDER', 22),
    pad('STATION', 12),
    pad('AGE', 5),
    'TITLE',
  ].join(' ');
  const lines = rows.map((row) => {
    const station = row.stationId ?? '-';
    const cells = [
      paint.bold(pad(row.orderId, 24)),
      pad(row.priority, 7),
      `${paintStatus(paint, row.status)}${' '.repeat(Math.max(0, 16 - row.status.length))}`,
      `${paintHolder(paint, row.holder)}${' '.repeat(Math.max(0, 22 - row.holder.length))}`,
      pad(station, 12),
      pad(ageOf(row.updatedAt, now), 5),
      row.title,
    ];
    return cells.join(' ').trimEnd();
  });
  return [paint.dim(header), ...lines].join('\n');
};
