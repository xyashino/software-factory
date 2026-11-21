import pc from 'picocolors';

const ISO_TIME_START = 11;
const ISO_TIME_END = 19;
const ORDER_WIDTH = 24;
const STATION_WIDTH = 14;
const ACTION_WIDTH = 18;
const DETAIL_CHARS = 200;
const ANDON_ACTIONS = ['fail', 'block', 'line_unavailable', 'worktree_missing'];
const STEP_ACTIONS = ['start', 'complete', 'pane', 'headless'];
const DELIVER_STATION = 'deliver';
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

// The log is only ever read in a terminal (the Herdr `logs` tab), so colour is always on.
const paint = pc.createColors(true);

export interface LogEntry {
  at: number;
  order: string;
  station: string;
  action: string;
  detail?: string;
}

// Same families and colours as the legacy `factory log -f` Traveler.
const paintAction = (station: string, action: string): string => {
  const text = action.padEnd(ACTION_WIDTH);
  if (ANDON_ACTIONS.includes(action)) return paint.red(text);
  if (station === DELIVER_STATION) return paint.green(text);
  if (STEP_ACTIONS.includes(action)) return paint.blue(text);
  return paint.cyan(text);
};

export const renderLogLine = (entry: LogEntry): string => {
  const clock = paint.dim(
    new Date(entry.at).toISOString().slice(ISO_TIME_START, ISO_TIME_END),
  );
  // Command output carries its own colour codes; drop them so the line keeps ours.
  const detail = (entry.detail ?? '')
    .replace(ANSI, '')
    .replace(/\s+/g, ' ')
    .slice(0, DETAIL_CHARS);
  return [
    clock,
    paint.dim(entry.order.padEnd(ORDER_WIDTH)),
    paint.bold(entry.station.padEnd(STATION_WIDTH)),
    paintAction(entry.station, entry.action),
    detail,
  ]
    .join(' ')
    .trimEnd();
};
