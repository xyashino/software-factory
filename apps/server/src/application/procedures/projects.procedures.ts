import { supervisorProcedure, type Procedure } from '../core/procedure';

export const projectProcedures: readonly Procedure[] = [
  supervisorProcedure('projectList'),
  supervisorProcedure('projectAdd'),
  supervisorProcedure('projectSet'),
  supervisorProcedure('projectRemove'),
];
