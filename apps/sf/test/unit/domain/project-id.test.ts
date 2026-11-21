import { describe, expect, it } from 'vitest';
import { defaultProjectId } from '../../../src/domain/init/project-id';

describe('default project id', () => {
  it('takes the repo name from an https origin url', () => {
    // Arrange
    const remote = 'https://github.com/Acme/Widget_Shop.git';

    // Act
    const id = defaultProjectId(remote, 'checkout');

    // Assert
    expect(id).toBe('widget-shop');
  });

  it('takes the repo name from an ssh origin url', () => {
    // Arrange
    const remote = 'git@github.com:acme/widgets.git';

    // Act
    const id = defaultProjectId(remote, 'checkout');

    // Assert
    expect(id).toBe('widgets');
  });

  it('falls back to the directory name without a remote', () => {
    // Arrange
    const remote = null;

    // Act
    const id = defaultProjectId(remote, 'My App');

    // Assert
    expect(id).toBe('my-app');
  });
});
