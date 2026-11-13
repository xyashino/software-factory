import { err } from '../result';
import type { DecideContext, OrderCommand } from './commands';
import {
  createOrder,
  expireLease,
  releaseJob,
  reportDelivery,
  recordPrState,
  reportWorkspaceFailed,
  cancel,
  claimJob,
  reprioritise,
  updateSpec,
} from './decide-lifecycle';
import type { Decision } from './decide-guards';
import {
  blockCycle,
  completeCycle,
  failCycle,
  handOverCycle,
  recordUsage,
  reportInspection,
  startCycle,
  submitVerdict,
} from './decide-cycle';
import {
  answer,
  askQuestion,
  leaveNote,
  nudge,
  reopen,
  resume,
} from './decide-control';
import type { WorkOrderState } from './state';

/**
 * Decides the events a command produces on a Work order (CORE §5.2). `state` is undefined before the
 * Work order exists. Pure: the runtime resolves blobs and ids through `ctx`, and the result is only
 * events, never stored. The first refusal wins: not_found, actor, epoch, liveness, then preconditions.
 */
export const decide = (
  state: WorkOrderState | undefined,
  command: OrderCommand,
  ctx: DecideContext,
): Decision => {
  if (command.type === 'CreateOrder') return createOrder(state, command, ctx);
  if (!state) return err({ code: 'not_found' });
  switch (command.type) {
    case 'UpdateSpec':
      return updateSpec(state, command, ctx);
    case 'Cancel':
      return cancel(state, command, ctx);
    case 'Reprioritise':
      return reprioritise(state, command, ctx);
    case 'ClaimJob':
      return claimJob(state, command, ctx);
    case 'StartCycle':
      return startCycle(state, command, ctx);
    case 'ReportWorkspaceFailed':
      return reportWorkspaceFailed(state, command, ctx);
    case 'CompleteCycle':
      return completeCycle(state, command, ctx);
    case 'SubmitVerdict':
      return submitVerdict(state, command, ctx);
    case 'ReportInspection':
      return reportInspection(state, command, ctx);
    case 'FailCycle':
      return failCycle(state, command, ctx);
    case 'BlockCycle':
      return blockCycle(state, command, ctx);
    case 'HandOverCycle':
      return handOverCycle(state, command, ctx);
    case 'AskQuestion':
      return askQuestion(state, command, ctx);
    case 'Answer':
      return answer(state, command, ctx);
    case 'LeaveNote':
      return leaveNote(state, command, ctx);
    case 'Nudge':
      return nudge(state, command, ctx);
    case 'RecordUsage':
      return recordUsage(state, command, ctx);
    case 'ExpireLease':
      return expireLease(state, ctx);
    case 'ReleaseJob':
      return releaseJob(state, ctx);
    case 'Resume':
      return resume(state, command, ctx);
    case 'Reopen':
      return reopen(state, command, ctx);
    case 'ReportDelivery':
      return reportDelivery(state, command, ctx);
    case 'RecordPrState':
      return recordPrState(state, command, ctx);
  }
};
