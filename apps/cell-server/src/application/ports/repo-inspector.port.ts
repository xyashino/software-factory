export type RepoProfile = { projectId: string; lines: string[] };

export type RepoInspectorPort = {
  inspect(repoRoot: string): RepoProfile | null;
};
