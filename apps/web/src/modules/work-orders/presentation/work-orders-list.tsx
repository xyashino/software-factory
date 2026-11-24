import { WORK_ORDER_STATES } from '@repo/hq-contracts/enums/orders';
import {
  AlertTriangle,
  GitBranch,
  Inbox,
  Layers,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select';
import { Skeleton } from '@/shared/ui/skeleton';
import {
  FILTER_ALL,
  WORK_ORDER_STATE_LABELS,
} from '../configuration/constraints';
import type {
  WorkOrder,
  WorkOrderAction,
  WorkOrderError,
  WorkOrderFilterState,
} from '../domain/models';
import { availableActions } from '../domain/transitions';
import { ActionIcon, StateBadge } from './state-badge';

const ACTION_LABELS: Record<WorkOrderAction, string> = {
  resume: 'Resume',
  unpause: 'Unpause',
  pause: 'Pause',
  cancel: 'Cancel',
};

const SKELETON_ROWS = [1, 2, 3];

export type WorkOrdersListProps = {
  filter: WorkOrderFilterState;
  items: WorkOrder[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  refreshing: boolean;
  error: WorkOrderError | null;
  pendingActions: Record<string, WorkOrderAction>;
  onFilterChange: (next: WorkOrderFilterState) => void;
  onRefresh: () => void;
  onSelect: (orderId: string) => void;
  onAction: (order: WorkOrder, action: WorkOrderAction) => void;
};

export const WorkOrdersList = ({
  filter,
  items,
  status,
  refreshing,
  error,
  pendingActions,
  onFilterChange,
  onRefresh,
  onSelect,
  onAction,
}: WorkOrdersListProps) => {
  const handleSelectChange = (value: string) => {
    onFilterChange(value as WorkOrderFilterState);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Work Orders</h1>
          <p className="text-sm text-muted-foreground">
            Monitor queued, active, and blocked orders in real time.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-48">
            <Select value={filter} onValueChange={handleSelectChange}>
              <SelectTrigger aria-label="Filter by state">
                <SelectValue placeholder="All states" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={FILTER_ALL}>All states</SelectItem>
                {WORK_ORDER_STATES.map((state) => (
                  <SelectItem key={state} value={state}>
                    {WORK_ORDER_STATE_LABELS[state]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
          >
            <RefreshCw
              className={refreshing ? 'size-4 animate-spin' : 'size-4'}
              aria-hidden="true"
            />
            Refresh
          </Button>
        </div>
      </div>

      {refreshing ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
        >
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          <span>Updating work orders...</span>
        </div>
      ) : null}

      {status === 'loading' && items.length === 0 ? (
        <div
          aria-busy="true"
          aria-label="Loading work orders"
          className="space-y-3"
        >
          {SKELETON_ROWS.map((row) => (
            <Card key={row}>
              <CardHeader className="gap-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/3" />
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : null}

      {status === 'error' && error !== null ? (
        <Card role="alert">
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" aria-hidden="true" />
              <h2 className="text-base font-semibold">
                Unable to load work orders
              </h2>
            </div>
            <Badge variant="outline">{error.code}</Badge>
            <p className="text-sm text-muted-foreground">{error.message}</p>
            <Button size="sm" onClick={onRefresh}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {status === 'ready' && items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Inbox
              className="size-10 text-muted-foreground"
              aria-hidden="true"
            />
            <div className="space-y-1">
              <h2 className="text-base font-semibold">
                {filter === FILTER_ALL
                  ? 'No work orders yet'
                  : `No results for "${WORK_ORDER_STATE_LABELS[filter]}"`}
              </h2>
              <p className="text-sm text-muted-foreground">
                {filter === FILTER_ALL
                  ? 'Import todos with `sf todos import` to queue work.'
                  : 'Try clearing the state filter to see all work orders.'}
              </p>
            </div>
            {filter === FILTER_ALL ? (
              <Button size="sm" variant="outline" onClick={onRefresh}>
                <RefreshCw className="size-4" aria-hidden="true" />
                Refresh queue
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onFilterChange(FILTER_ALL)}
              >
                Show all work orders
              </Button>
            )}
          </CardContent>
        </Card>
      ) : null}

      {items.length > 0 ? (
        <ul className="space-y-3" aria-label="Work orders">
          {items.map((order) => {
            const actions = availableActions(order.state);
            const pendingAction = pendingActions[order.orderId];
            return (
              <li key={order.orderId}>
                <Card className="transition-colors hover:border-foreground/25">
                  <CardHeader className="gap-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <StateBadge state={order.state} />
                          <Badge variant="outline">{order.type}</Badge>
                          <Badge variant="secondary">{order.priority}</Badge>
                        </div>
                        <CardTitle>
                          <button
                            type="button"
                            onClick={() => onSelect(order.orderId)}
                            className="text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {order.title}
                          </button>
                        </CardTitle>
                        <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                          <span className="inline-flex items-center gap-1">
                            <Layers className="size-3" aria-hidden="true" />
                            {order.lineName}
                          </span>
                          <span className="inline-flex items-center gap-1 font-mono">
                            <GitBranch className="size-3" aria-hidden="true" />
                            {order.branch}
                          </span>
                        </CardDescription>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {actions.map((action) => {
                          const isPending = pendingAction === action;
                          return (
                            <Button
                              key={action}
                              size="sm"
                              variant={
                                action === 'cancel' ? 'destructive' : 'outline'
                              }
                              disabled={pendingAction !== undefined}
                              onClick={() => onAction(order, action)}
                            >
                              {isPending ? (
                                <Loader2
                                  className="size-4 animate-spin"
                                  aria-hidden="true"
                                />
                              ) : (
                                <ActionIcon action={action} />
                              )}
                              {ACTION_LABELS[action]}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
};
