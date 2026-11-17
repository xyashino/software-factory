import {
  localSupervisorProcedure,
  supervisorProcedure,
  type Procedure,
} from '../core/procedure';

export const adminProcedures: readonly Procedure[] = [
  supervisorProcedure('adminExport'),
  localSupervisorProcedure('adminBackup'),
  supervisorProcedure('adminRebuildProjections'),
];
