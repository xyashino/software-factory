import { supervisorProcedure, type Procedure } from '../core/procedure';

export const planProcedures: readonly Procedure[] = [
  supervisorProcedure('plans'),
  supervisorProcedure('planDetail'),
  supervisorProcedure('createPlan'),
  supervisorProcedure('recordPlanPrState'),
];
