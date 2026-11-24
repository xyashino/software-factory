import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  PauseCircle,
  PlayCircle,
  XCircle,
} from 'lucide-react';
import { Badge, type BadgeProps } from '@/shared/ui/badge';
import { WORK_ORDER_STATE_LABELS } from '../configuration/constraints';
import type { WorkOrderState } from '../domain/models';

const STATE_VARIANT: Record<WorkOrderState, BadgeProps['variant']> = {
  waiting_parent: 'secondary',
  queued: 'secondary',
  paused: 'warning',
  running: 'info',
  delivering: 'info',
  delivered: 'success',
  completed: 'success',
  line_unavailable: 'warning',
  blocked: 'destructive',
  cancelled: 'outline',
};

export type StateBadgeProps = {
  state: WorkOrderState;
};

const renderIcon = (state: WorkOrderState) => {
  switch (state) {
    case 'running':
    case 'delivering':
      return <Loader2 className="size-3 animate-spin" aria-hidden="true" />;
    case 'delivered':
    case 'completed':
      return <CheckCircle2 className="size-3" aria-hidden="true" />;
    case 'blocked':
    case 'line_unavailable':
      return <AlertTriangle className="size-3" aria-hidden="true" />;
    case 'paused':
      return <PauseCircle className="size-3" aria-hidden="true" />;
    case 'cancelled':
      return <XCircle className="size-3" aria-hidden="true" />;
    case 'queued':
    case 'waiting_parent':
      return <Clock className="size-3" aria-hidden="true" />;
  }
};

export const StateBadge = ({ state }: StateBadgeProps) => (
  <Badge variant={STATE_VARIANT[state]}>
    {renderIcon(state)}
    <span>{WORK_ORDER_STATE_LABELS[state]}</span>
  </Badge>
);

export const ActionIcon = ({ action }: { action: string }) => {
  switch (action) {
    case 'pause':
      return <PauseCircle className="size-4" aria-hidden="true" />;
    case 'unpause':
    case 'resume':
      return <PlayCircle className="size-4" aria-hidden="true" />;
    default:
      return <XCircle className="size-4" aria-hidden="true" />;
  }
};
