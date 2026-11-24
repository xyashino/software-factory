import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Main as WorkOrdersMain } from '@/modules/work-orders/presentation/main';
import { ToastViewport } from '@/shared/ui/toast';

const BASE_ORDER = {
  orderId: 'ord-1',
  projectId: 'proj-1',
  planId: null,
  parentOrderId: null,
  slug: 'add-dark-mode',
  title: 'Add dark mode toggle',
  type: 'feat' as const,
  description: 'Support light and dark themes across the dashboard.',
  lineName: 'standard',
  priority: 'high' as const,
  state: 'blocked' as const,
  baseBranch: 'main',
  baseCommitSha: 'abc123',
  branch: 'factory/add-dark-mode',
  headCommitSha: null,
  staleBase: false,
  currentStepIndex: 1,
  pinnedFactoryId: null,
  activeCellId: null,
  activeJobId: null,
  epoch: 1,
  unavailableLineFactoryIds: [],
  version: 1,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const QUEUED_ORDER = {
  ...BASE_ORDER,
  orderId: 'ord-2',
  slug: 'fix-sse-retry',
  title: 'Fix SSE reconnect backoff',
  type: 'fix' as const,
  state: 'queued' as const,
  branch: 'factory/fix-sse-retry',
};

const server = setupServer(
  http.get('/api/work-orders', ({ request }) => {
    const state = new URL(request.url).searchParams.get('state');
    const all = [BASE_ORDER, QUEUED_ORDER];
    const items =
      state === null ? all : all.filter((order) => order.state === state);
    return HttpResponse.json({ code: 200, items });
  }),
  http.get('/api/work-orders/:id', ({ params }) => {
    const order = params.id === 'ord-1' ? BASE_ORDER : QUEUED_ORDER;
    return HttpResponse.json({
      code: 200,
      order,
      steps: [
        {
          stepId: 'step-1',
          stepIndex: 0,
          stationId: 'planner',
          kind: 'operator',
          state: 'completed',
        },
      ],
      jobs: [
        {
          jobId: 'job-1',
          kind: 'step',
          status: 'blocked',
          cellId: 'cell-1',
          epoch: 1,
        },
      ],
      incidents: [
        {
          incidentId: 'inc-1',
          reason: 'operator_blocked',
          status: 'open',
        },
      ],
    });
  }),
  http.post('/api/work-orders/:id/transitions', async ({ params, request }) => {
    const body = (await request.json()) as { action: string };
    const nextState =
      body.action === 'resume'
        ? 'queued'
        : body.action === 'cancel'
          ? 'cancelled'
          : 'paused';
    const base = params.id === 'ord-1' ? BASE_ORDER : QUEUED_ORDER;
    return HttpResponse.json({
      code: 200,
      order: { ...base, state: nextState },
    });
  }),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const renderWorkOrders = () =>
  render(
    <>
      <WorkOrdersMain />
      <ToastViewport />
    </>,
  );

describe('work orders supervisor module', () => {
  it('loads and displays work orders from the BFF', async () => {
    renderWorkOrders();

    expect(await screen.findByText('Add dark mode toggle')).toBeInTheDocument();
    expect(screen.getByText('Fix SSE reconnect backoff')).toBeInTheDocument();
  }, 15_000);

  it('opens the work order detail view with steps, jobs, and incidents', async () => {
    const user = userEvent.setup();
    renderWorkOrders();

    await user.click(await screen.findByText('Add dark mode toggle'));

    expect(
      await screen.findByText(
        'Support light and dark themes across the dashboard.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/1\. planner/)).toBeInTheDocument();
    expect(screen.getByText('operator_blocked')).toBeInTheDocument();
  });

  it('resumes a blocked work order and notifies the user with a toast', async () => {
    const user = userEvent.setup();
    renderWorkOrders();

    await screen.findByText('Add dark mode toggle');
    await user.click(screen.getByRole('button', { name: 'Resume' }));

    expect(await screen.findByText('Work order resumed')).toBeInTheDocument();
  });

  it('asks for confirmation before cancelling a work order', async () => {
    const user = userEvent.setup();
    renderWorkOrders();

    await screen.findByText('Add dark mode toggle');
    const cancelButtons = screen.getAllByRole('button', { name: 'Cancel' });
    await user.click(cancelButtons[0]!);

    expect(await screen.findByText('Cancel work order')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm cancel' }));

    expect(await screen.findByText('Work order cancelled')).toBeInTheDocument();
  });

  it('shows a structured error with retry and recovers when HQ responds', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(
        '/api/work-orders',
        () =>
          HttpResponse.json(
            { code: 502, type: 'FactoryUnavailable', message: 'HQ offline' },
            { status: 502 },
          ),
        { once: true },
      ),
    );

    renderWorkOrders();

    expect(
      await screen.findByText('Unable to load work orders'),
    ).toBeInTheDocument();
    expect(screen.getByText('FactoryUnavailable')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.getByText('Add dark mode toggle')).toBeInTheDocument();
    });
  });

  it('shows empty state with clear-filter action when no orders exist', async () => {
    server.use(
      http.get('/api/work-orders', () =>
        HttpResponse.json({ code: 200, items: [] }),
      ),
    );

    renderWorkOrders();

    expect(await screen.findByText('No work orders yet')).toBeInTheDocument();
  });
});
