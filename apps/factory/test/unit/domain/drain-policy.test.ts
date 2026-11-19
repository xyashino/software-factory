import { describe, expect, it } from 'vitest';
import {
  drainPolicy,
  type DrainAction,
} from '../../../src/domain/cell/drain-policy';

describe('drain policy', () => {
  it.each<[boolean, boolean, boolean, DrainAction]>([
    [false, false, false, 'leave_now'],
    [false, false, true, 'leave_now'],
    [false, true, false, 'leave_now'],
    [false, true, true, 'leave_now'],
    [true, false, false, 'wait_for_station'],
    [true, false, true, 'leave_now'],
    [true, true, false, 'abort_then_leave'],
    [true, true, true, 'abort_then_leave'],
  ])(
    'with job %s, force %s, station finished %s it does %s',
    (jobHeld, force, stationFinished, action) => {
      // Arrange & Act
      const result = drainPolicy({ jobHeld, force, stationFinished });

      // Assert
      expect(result).toBe(action);
    },
  );
});
