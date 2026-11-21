import { describe, expect, it } from 'vitest';
import {
  Refused,
  Unauthorized,
  Unreachable,
} from '../../../../src/application/core/errors';
import { mapReply } from '../../../../src/adapters/http/map-reply';

const errorBody = (code: number, message: string): string =>
  JSON.stringify({ code, type: 'error', message });

describe('unauthorized reply mapping', () => {
  it('refuses a 401 reply as unauthorized with the server message', () => {
    // Arrange
    const body = errorBody(401, 'Missing or invalid bearer token');

    // Act
    const attempt = () => mapReply(401, body);

    // Assert
    expect(attempt).toThrow(Unauthorized);
    expect(attempt).toThrow('401: Missing or invalid bearer token');
  });
});

describe('reply mapping', () => {
  it('returns the parsed body for a 200 reply', () => {
    // Arrange
    const body = JSON.stringify({ ok: true });

    // Act
    const value = mapReply(200, body);

    // Assert
    expect(value).toEqual({ ok: true });
  });

  it('returns the parsed body for a 201 reply', () => {
    // Arrange
    const body = JSON.stringify({ id: 'x' });

    // Act
    const value = mapReply(201, body);

    // Assert
    expect(value).toEqual({ id: 'x' });
  });

  it.each([400, 401, 403, 409, 500])(
    'refuses with code and message for a %i reply',
    (status) => {
      // Arrange
      const body = errorBody(status, 'Unauthorized');

      // Act
      const attempt = () => mapReply(status, body);

      // Assert
      expect(attempt).toThrow(Refused);
      expect(attempt).toThrow(`${status}: Unauthorized`);
    },
  );

  it('reports Unreachable when the reply body is not JSON', () => {
    // Arrange
    const body = '<html>gateway</html>';

    // Act
    const attempt = () => mapReply(502, body);

    // Assert
    expect(attempt).toThrow(Unreachable);
  });
});
