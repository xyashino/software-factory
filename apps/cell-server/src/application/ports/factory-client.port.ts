import type { FactoryTarget } from '../../domain/factories/factory-target';

export type EnrollRequest = {
  projectId: string;
  name: string;
  allowedLines: string[];
  runners: string[];
};

export type EnrolledCell = { cellId: string; sessionToken: string };

export type ProjectSummary = {
  projectId: string;
  repoUrl: string;
  defaultBaseBranch: string;
};

export type FactoryClientPort = {
  health(factory: FactoryTarget): Promise<boolean>;
  mintJoinToken(factoryUrl: string, supervisorToken: string): Promise<string>;
  listProjects(
    factoryUrl: string,
    supervisorToken: string,
  ): Promise<ProjectSummary[]>;
  enroll(
    factoryUrl: string,
    joinToken: string,
    request: EnrollRequest,
  ): Promise<EnrolledCell>;
};
