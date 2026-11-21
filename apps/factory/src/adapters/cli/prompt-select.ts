import { createInterface } from 'node:readline/promises';
import type {
  ProjectChooser,
  ProjectSummary,
} from '../../application/procedures/cell/resolve-project-target';
import { printLine } from './output';

const PROMPT = 'project number: ';

const listOf = (projects: readonly ProjectSummary[]): void => {
  projects.forEach((project, index) => {
    printLine(
      `${index + 1}. ${project.projectId}  ${project.repoUrl}  (${project.defaultBaseBranch})`,
    );
  });
};

export const promptSelect: ProjectChooser = async (projects) => {
  listOf(projects);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const index = Number((await rl.question(PROMPT)).trim());
      const chosen = projects[index - 1];
      if (Number.isInteger(index) && chosen !== undefined) {
        return chosen;
      }
      printLine(`enter a number from 1 to ${projects.length}`);
    }
  } finally {
    rl.close();
  }
};
