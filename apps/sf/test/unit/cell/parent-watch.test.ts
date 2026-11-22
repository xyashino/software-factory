import { describe, expect, it } from 'vitest';
import { parentGoneOf } from '../../../src/domain/cell/parent-gone';

const DAEMON_PID = 4321;
const OTHER_PID = 1;

describe('cell parent watch', () => {
  it('Cell exits when its daemon is gone', () => {
    // Arrange
    const reparentedTo = OTHER_PID;

    // Act
    const gone = parentGoneOf(DAEMON_PID, reparentedTo);

    // Assert
    expect(gone).toBe(true);
  });

  it('Cell keeps running while its daemon is its parent', () => {
    // Arrange
    const currentParent = DAEMON_PID;

    // Act
    const gone = parentGoneOf(DAEMON_PID, currentParent);

    // Assert
    expect(gone).toBe(false);
  });
});
