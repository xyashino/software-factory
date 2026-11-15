import { describe, expect, it } from 'vitest';
import { GET } from '../pages/api/health';

describe('health endpoint', () => {
  it('reports the app is ok', async () => {
    // Arrange
    const expectedBody = { ok: true };

    // Act
    const response = GET();

    // Assert
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual(expectedBody);
  });
});
