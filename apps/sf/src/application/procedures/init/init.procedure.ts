import { z } from 'zod';
import {
  BUILDER_PROFILE,
  DOCTOR_PROFILE,
  LINE_FAST,
  LINE_STANDARD,
  PR_BODY_TEMPLATE,
  repoConfigText,
} from '../../../domain/init/templates';
import { defaultProjectId } from '../../../domain/init/project-id';
import { repoPath } from '../../../domain/init/repo-path';
import {
  LINES_DIR,
  OPERATORS_DIR,
  PR_TEMPLATE_PATH,
  REPO_CONFIG_PATH,
} from '../../../config';
import { slugSchema } from '../../../contracts/common';
import { ArgumentError } from '../../core/errors';
import { define, type Ports } from '../../core/procedure';

const GITIGNORE = '.gitignore';
const GITIGNORE_ENTRIES = ['.factory-local/', '.worktrees/'] as const;

const InitSchema = z
  .object({
    root: z.string().min(1),
    dirName: z.string(),
    projectId: slugSchema.nullable(),
    force: z.boolean(),
  })
  .strict();

export interface InitResult {
  projectId: string;
  written: string[];
  skipped: string[];
  gitignoreUpdated: string[];
}

interface TemplateFile {
  path: string;
  text: string;
}

const templateFiles = (projectId: string): TemplateFile[] => [
  { path: REPO_CONFIG_PATH, text: repoConfigText(projectId) },
  { path: `${LINES_DIR}/standard.yml`, text: LINE_STANDARD },
  { path: `${LINES_DIR}/fast.yml`, text: LINE_FAST },
  { path: `${OPERATORS_DIR}/builder.md`, text: BUILDER_PROFILE },
  { path: `${OPERATORS_DIR}/doctor.md`, text: DOCTOR_PROFILE },
  { path: PR_TEMPLATE_PATH, text: PR_BODY_TEMPLATE },
];

const deriveProjectId = async (
  ports: Ports,
  root: string,
  dirName: string,
): Promise<string> => {
  const remote = await ports.process.run(
    'git',
    ['remote', 'get-url', 'origin'],
    root,
  );
  const projectId = defaultProjectId(
    remote.exitCode === 0 ? remote.stdout.trim() : null,
    dirName,
  );
  if (projectId === '') {
    throw new ArgumentError('cannot derive a project id, pass --project <id>');
  }
  return projectId;
};

const ensureGitignore = async (
  ports: Ports,
  path: string,
): Promise<string[]> => {
  const current = (await ports.fs.exists(path))
    ? await ports.fs.readText(path)
    : '';
  const lines = new Set(current.split('\n'));
  const missing = GITIGNORE_ENTRIES.filter((entry) => !lines.has(entry));
  if (missing.length === 0) {
    return [];
  }
  const separator = current === '' || current.endsWith('\n') ? '' : '\n';
  await ports.fs.appendText(path, `${separator}${missing.join('\n')}\n`);
  return [...missing];
};

export const initProject = define({ kind: 'supervisor' })(
  InitSchema,
)<InitResult>(async (input, ctx) => {
  const projectId =
    input.projectId ?? (await deriveProjectId(ctx, input.root, input.dirName));
  const written: string[] = [];
  const skipped: string[] = [];
  for (const file of templateFiles(projectId)) {
    const target = repoPath(input.root, file.path);
    if (!input.force && (await ctx.fs.exists(target))) {
      skipped.push(file.path);
      continue;
    }
    await ctx.fs.writeText(target, file.text);
    written.push(file.path);
  }
  const gitignoreUpdated = await ensureGitignore(
    ctx,
    repoPath(input.root, GITIGNORE),
  );
  return { projectId, written, skipped, gitignoreUpdated };
});
