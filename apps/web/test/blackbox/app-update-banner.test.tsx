import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppUpdateBanner } from '@/shared/app-update/app-update-banner';

let serverVersion = '1.0.0';

const server = setupServer(
  http.get('/api/version', () =>
    HttpResponse.json({ code: 200, version: serverVersion }),
  ),
);

const focusTab = async () => {
  await act(async () => {
    fireEvent(document, new Event('visibilitychange'));
  });
};

beforeAll(() => server.listen());
afterAll(() => server.close());
beforeEach(() => {
  serverVersion = '1.0.0';
});

describe('app update banner', () => {
  it('stays hidden while the server version is unchanged', async () => {
    // Arrange
    render(<AppUpdateBanner />);

    // Act
    await focusTab();

    // Assert
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('offers a refresh once the server version changes mid-session', async () => {
    // Arrange
    render(<AppUpdateBanner />);
    await focusTab();

    // Act
    serverVersion = '1.1.0';
    await focusTab();

    // Assert
    expect(await screen.findByRole('status')).toHaveTextContent(
      'A new version of the factory is available',
    );
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('hides the prompt when the user dismisses it', async () => {
    // Arrange
    const user = userEvent.setup();
    render(<AppUpdateBanner />);
    await focusTab();
    serverVersion = '1.1.0';
    await focusTab();
    await screen.findByRole('status');

    // Act
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    // Assert
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
