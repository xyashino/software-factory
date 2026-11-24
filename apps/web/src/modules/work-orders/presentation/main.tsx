import { useState } from 'react';
import { withEda } from '@/libs/eda/with-eda';
import { workOrdersMediator } from '../core/mediator';
import type { WorkOrder, WorkOrderAction } from '../domain/models';
import { CancelConfirmDialog } from './cancel-confirm-dialog';
import { WorkOrderDetailPanel } from './work-order-detail';
import { WorkOrdersList } from './work-orders-list';

const WorkOrdersView = () => {
  const state = workOrdersMediator.useState();
  const [cancelTarget, setCancelTarget] = useState<WorkOrder | null>(null);

  const handleAction = (order: WorkOrder, action: WorkOrderAction) => {
    if (action === 'cancel') {
      setCancelTarget(order);
      return;
    }
    workOrdersMediator.facade.transitionOrder(order.orderId, action);
  };

  const handleConfirmCancel = (orderId: string) => {
    workOrdersMediator.facade.transitionOrder(orderId, 'cancel');
    setCancelTarget(null);
  };

  return (
    <>
      {state.selectedOrderId !== null ? (
        <WorkOrderDetailPanel
          detail={state.detail}
          status={state.detailStatus}
          error={state.detailError}
          pendingAction={state.pendingActions[state.selectedOrderId]}
          onBack={() => workOrdersMediator.facade.selectOrder(null)}
          onRetry={() =>
            workOrdersMediator.facade.selectOrder(state.selectedOrderId)
          }
          onAction={handleAction}
        />
      ) : (
        <WorkOrdersList
          filter={state.filter}
          items={state.items}
          status={state.status}
          refreshing={state.refreshing}
          error={state.error}
          pendingActions={state.pendingActions}
          onFilterChange={(next) => workOrdersMediator.facade.loadList(next)}
          onRefresh={() => workOrdersMediator.facade.refreshList()}
          onSelect={(orderId) => workOrdersMediator.facade.selectOrder(orderId)}
          onAction={handleAction}
        />
      )}

      <CancelConfirmDialog
        order={cancelTarget}
        pending={
          cancelTarget !== null &&
          state.pendingActions[cancelTarget.orderId] === 'cancel'
        }
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        onConfirm={handleConfirmCancel}
      />
    </>
  );
};

export const Main = withEda(WorkOrdersView, workOrdersMediator.register, () =>
  workOrdersMediator.facade.loadList('all'),
);
