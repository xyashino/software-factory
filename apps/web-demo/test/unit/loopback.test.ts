import { describe, expect, it } from 'vitest';
import { isLoopbackUrl } from '../../src/lib/loopback';

describe('isLoopbackUrl', () => {
  it.each([
    'http://127.0.0.1:7070',
    'http://localhost:7070',
    'http://[::1]:7070',
  ])('treats %s as loopback', (url) => {
    // Arrange
    const input = url;

    // Act
    const result = isLoopbackUrl(input);

    // Assert
    expect(result).toBe(true);
  });

  it.each(['https://factory.example.com', 'http://10.0.0.5:7070', 'not a url'])(
    'does not treat %s as loopback',
    (url) => {
      // Arrange
      const input = url;

      // Act
      const result = isLoopbackUrl(input);

      // Assert
      expect(result).toBe(false);
    },
  );
});
