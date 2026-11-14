import type { ProjectId } from '../ids';

/** One registered project: where its repository is and how many Work orders it runs at once. */
export interface ProjectRecord {
  projectId: ProjectId;
  repoUrl: string;
  baseBranch: string;
  maxRunning: number;
  /** When a dependency counts as done: its PR delivered, or merged (STORAGE §4). */
  depPolicy: 'delivered' | 'merged';
}

export interface ProjectStore {
  list(): Promise<ProjectRecord[]>;
}
