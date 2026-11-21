export interface DrainInput {
  jobHeld: boolean;
  force: boolean;
  stationFinished: boolean;
}

export type DrainAction = 'leave_now' | 'wait_for_station' | 'abort_then_leave';

export const drainPolicy = ({
  jobHeld,
  force,
  stationFinished,
}: DrainInput): DrainAction => {
  if (!jobHeld) return 'leave_now';
  if (force) return 'abort_then_leave';
  return stationFinished ? 'leave_now' : 'wait_for_station';
};
