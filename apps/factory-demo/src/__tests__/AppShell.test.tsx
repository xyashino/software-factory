import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AppShell from '../core/AppShell';

const SECTION_LABELS = [
  'Board',
  'Plans',
  'Intake',
  'Cells',
  'Projects',
  'Admin',
];

describe('AppShell', () => {
  afterEach(() => {
    cleanup();
  });

  it('offers a skip link to the main content', () => {
    // Arrange
    render(<AppShell />);

    // Act
    const skipLink = screen.getByRole('link', { name: 'Skip to main content' });

    // Assert
    expect(skipLink.getAttribute('href')).toBe('#main');
  });

  it('shows header, primary navigation and main regions', () => {
    // Arrange
    render(<AppShell />);

    // Act
    const banner = screen.getByRole('banner');
    const navigation = screen.getByRole('navigation', { name: 'Primary' });
    const main = screen.getByRole('main');

    // Assert
    expect(banner).toBeTruthy();
    expect(navigation).toBeTruthy();
    expect(main.getAttribute('id')).toBe('main');
  });

  it('lists the six sections in the navigation', () => {
    // Arrange
    render(<AppShell />);

    // Act
    const navigation = screen.getByRole('navigation', { name: 'Primary' });
    const labels = Array.from(navigation.querySelectorAll('button')).map(
      (button) => button.textContent,
    );

    // Assert
    expect(labels).toEqual(SECTION_LABELS);
  });

  it('moves focus between sections with arrow keys', () => {
    // Arrange
    render(<AppShell />);
    const board = screen.getByRole('button', { name: 'Board' });
    const plans = screen.getByRole('button', { name: 'Plans' });
    board.focus();

    // Act
    fireEvent.keyDown(board, { key: 'ArrowDown' });

    // Assert
    expect(document.activeElement).toBe(plans);
  });

  it('opens the section the user selects', () => {
    // Arrange
    render(<AppShell />);
    const cells = screen.getByRole('button', { name: 'Cells' });

    // Act
    fireEvent.click(cells);

    // Assert
    expect(cells.getAttribute('aria-current')).toBe('page');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Cells' }),
    ).toBeTruthy();
  });
});
