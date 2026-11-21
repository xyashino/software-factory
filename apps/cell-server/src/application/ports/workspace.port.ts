export type WorkspacePort = {
  ensure(projectId: string, repoUrl: string): Promise<string>;
};
