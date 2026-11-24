import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import type { WorkOrder } from '../domain/models';

export type CancelConfirmDialogProps = {
  order: WorkOrder | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (orderId: string) => void;
};

export const CancelConfirmDialog = ({
  order,
  pending,
  onOpenChange,
  onConfirm,
}: CancelConfirmDialogProps) => (
  <Dialog open={order !== null} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Cancel work order</DialogTitle>
        <DialogDescription>
          {order
            ? `Cancel "${order.title}" (${order.slug})? This stops execution and marks the work order as cancelled.`
            : ''}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => onOpenChange(false)}
        >
          Keep order
        </Button>
        <Button
          variant="destructive"
          disabled={pending || order === null}
          onClick={() => {
            if (order !== null) onConfirm(order.orderId);
          }}
        >
          {pending ? 'Cancelling...' : 'Confirm cancel'}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
