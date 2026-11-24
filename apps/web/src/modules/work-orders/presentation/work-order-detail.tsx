import {
  AlertTriangle,
  ArrowLeft,
  GitBranch,
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
import { Skeleton } from '@/shared/ui/skeleton';
import type {
  WorkOrder,
  WorkOrderAction,
  WorkOrderDetail,
  WorkOrderError,
} from '../domain/models';
import { availableActions } from '../domain/transitions';
import { ActionIcon, StateBadge } from './state-badge';

const ACTION_LABELS: Record<WorkOrderAction, string> = {
  resume: 'Resume',
  unpause: 'Unpause',
  pause: 'Pause',
  cancel: 'Cancel',
};

export type WorkOrderDetailPanelProps = {
  detail: WorkOrderDetail | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: WorkOrderError | null;
  pendingAction?: WorkOrderAction;
  onBack: () => void;
  onRetry: () => void;
  onAction: (order: WorkOrder, action: WorkOrderAction) => void;
};

export const WorkOrderDetailPanel = ({
  detail,
  status,
  error,
  pendingAction,
  onBack,
  onRetry,
  onAction,
}: WorkOrderDetailPanelProps) => {
  if (status === 'loading' && detail === null) {
    return (
      <Card aria-busy="true" aria-label="Loading work order detail">
        <CardHeader className="gap-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (status === 'error' && error !== null) {
    return (
      <Card role="alert">
        <CardContent className="flex flex-col items-start gap-3 p-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5" aria-hidden="true" />
            <h2 className="text-base font-semibold">
              Failed to load work order
            </h2>
          </div>
          <Badge variant="outline">{error.code}</Badge>
          <p className="text-sm text-muted-foreground">{error.message}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onRetry}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Retry
            </Button>
            <Button size="sm" variant="outline" onClick={onBack}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to list
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (detail === null) return null;

  const { order, steps, jobs, incidents } = detail;
  const actions = availableActions(order.state);

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to work orders
      </Button>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <StateBadge state={order.state} />
                <Badge variant="outline">{order.type}</Badge>
                <Badge variant="secondary">{order.priority}</Badge>
                {order.staleBase ? (
                  <Badge variant="warning">Stale base</Badge>
                ) : null}
              </div>
              <CardTitle className="pt-1 text-xl">{order.title}</CardTitle>
              <CardDescription>{order.slug}</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {actions.map((action) => {
                const isPending = pendingAction === action;
                return (
                  <Button
                    key={action}
                    size="sm"
                    variant={action === 'cancel' ? 'destructive' : 'outline'}
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
        <CardContent className="space-y-6">
          {order.description ? (
            <p className="text-sm text-foreground">{order.description}</p>
          ) : null}

          <dl className="grid grid-cols-1 gap-3 rounded-md border bg-muted/40 p-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Line</dt>
              <dd className="mt-1 flex items-center gap-1.5 font-medium">
                <Layers className="size-3.5" aria-hidden="true" />
                {order.lineName}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Branch</dt>
              <dd className="mt-1 flex items-center gap-1.5 font-mono text-xs">
                <GitBranch className="size-3.5" aria-hidden="true" />
                {order.branch}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Base branch</dt>
              <dd className="mt-1 font-mono text-xs">{order.baseBranch}</dd>
            </div>
          </dl>

          <section aria-label="Pipeline steps" className="space-y-2">
            <h3 className="text-sm font-semibold">Steps ({steps.length})</h3>
            {steps.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No pipeline steps recorded yet.
              </p>
            ) : (
              <ol className="space-y-2">
                {steps.map((step) => (
                  <li
                    key={step.stepId}
                    className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                  >
                    <span className="font-medium">
                      {step.stepIndex + 1}. {step.stationId}{' '}
                      <span className="text-xs font-normal text-muted-foreground">
                        ({step.kind})
                      </span>
                    </span>
                    <Badge variant="outline">{step.state}</Badge>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <section aria-label="Recent jobs" className="space-y-2">
              <h3 className="text-sm font-semibold">Jobs ({jobs.length})</h3>
              {jobs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No jobs executed yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {jobs.map((job) => (
                    <li
                      key={job.jobId}
                      className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs"
                    >
                      <span className="font-mono">
                        {job.kind} · epoch {job.epoch}
                      </span>
                      <Badge variant="secondary">{job.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-label="Incidents" className="space-y-2">
              <h3 className="text-sm font-semibold">
                Incidents ({incidents.length})
              </h3>
              {incidents.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No incidents on this work order.
                </p>
              ) : (
                <ul className="space-y-2">
                  {incidents.map((incident) => (
                    <li
                      key={incident.incidentId}
                      className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs"
                    >
                      <span className="font-medium">{incident.reason}</span>
                      <Badge variant="destructive">{incident.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
