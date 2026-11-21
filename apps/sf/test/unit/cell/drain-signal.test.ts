import { describe, expect, it } from 'vitest';
import { drainStateOf, observeDrain } from '../../../src/cell/drain-signal';

describe('drain signal', () => {
  it('stays running when no drain signal arrives', () => {
    // Arrange
    const state = drainStateOf();

    // Act
    observeDrain(state, ['abort']);

    // Assert
    expect(state).toMatchObject({ draining: false, force: false, left: false });
  });

  it('marks the cell draining on a drain signal without force', () => {
    // Arrange
    const state = drainStateOf();

    // Act
    observeDrain(state, ['drain']);

    // Assert
    expect(state).toMatchObject({ draining: true, force: false });
  });

  it('marks the cell draining with force when both signals arrive', () => {
    // Arrange
    const state = drainStateOf();

    // Act
    observeDrain(state, ['drain', 'force']);

    // Assert
    expect(state).toMatchObject({ draining: true, force: true });
  });
});
