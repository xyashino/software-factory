import { supervisorProcedure, type Procedure } from '../core/procedure';

export const orderProcedures: readonly Procedure[] = [
  supervisorProcedure('board'),
  supervisorProcedure('orderDetail'),
  supervisorProcedure('createOrder'),
  supervisorProcedure('recordPrState'),
  supervisorProcedure('answer'),
  supervisorProcedure('resume'),
  supervisorProcedure('reopen'),
  supervisorProcedure('nudge'),
  supervisorProcedure('cancel'),
  supervisorProcedure('reprioritise'),
];
