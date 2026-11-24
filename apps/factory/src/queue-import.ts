import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type {
  FactoryImportReply,
  FactoryImportRequest,
} from '@repo/factory-contracts/queue.contract';
import { LOCAL_BASE_BRANCH, TODOS_DIR } from './config';
import { Refused, Unauthorized, Unreachable } from './errors';
import type { HqLink } from './hq-link';
import type { LocalEngine } from './local-engine';
import type {
  CredentialStorePort,
  HqLinkPort,
  QueueImportBody,
  QueueImportError,
  QueueImportReply,
  RepoConfigPort,
  TodoFilesPort,
} from './ports';
import { parseTodo, renderTodo, type Todo } from './todo/todo-markdown';

const PAUSED = 'paused';
const CANCELLED = 'cancelled';
const NO_LINE = 'no line';
const CONNECTED_REFUSAL =
  'factory is connected to HQ; disconnect or omit --local';
const STANDALONE_REFUSAL =
  'factory not connected to HQ: pass --local or run "sf factory connect"';
const HQ_UNREACHABLE = 'HQ unreachable';
const HQ_REJECTED = 'HQ rejected credential';
const HQ_BEARER_REJECTED = 'HQ rejected the Authorization bearer token';
const MISSING_BEARER = 'HQ import needs an Authorization bearer token';

type Skipped = FactoryImportReply['skipped'][number];

interface SentFile {
  filename: string;
  markdown: string;
}

interface Prepared {
  sent: SentFile[];
  skipped: Skipped[];
  paused: number;
}

interface HqTarget {
  url: string;
  bearer: string;
}

interface Outcome {
  created: number;
  updated: number;
  unchanged: number;
  errors: QueueImportError[];
}

export interface QueueImportDeps {
  repoConfig: RepoConfigPort;
  todoFiles: TodoFilesPort;
  credentials: CredentialStorePort;
  hqLink: HqLinkPort;
  hq: Pick<HqLink, 'state'>;
  local: Pick<LocalEngine, 'ensureProject' | 'importQueue'>;
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const hasLine = (frontmatter: Record<string, unknown>): boolean =>
  typeof frontmatter.line === 'string' && frontmatter.line.trim() !== '';

const isPausable = (todo: Todo): boolean =>
  todo.frontmatter.status !== CANCELLED;

const sentMarkdown = (text: string, todo: Todo, paused: boolean): string =>
  paused && isPausable(todo)
    ? renderTodo({
        ...todo,
        frontmatter: { ...todo.frontmatter, status: PAUSED },
      })
    : text;

const prepare = async (
  todoFiles: TodoFilesPort,
  dir: string,
  paused: boolean,
): Promise<Prepared> => {
  const sent: SentFile[] = [];
  const skipped: Skipped[] = [];
  let pausedCount = 0;
  for (const file of await todoFiles.list(dir)) {
    try {
      const todo = parseTodo(file.text);
      if (!hasLine(todo.frontmatter)) {
        skipped.push({ filename: file.filename, reason: NO_LINE });
        continue;
      }
      if (paused && isPausable(todo)) {
        pausedCount += 1;
      }
      sent.push({
        filename: file.filename,
        markdown: sentMarkdown(file.text, todo, paused),
      });
    } catch (error) {
      skipped.push({ filename: file.filename, reason: errorText(error) });
    }
  }
  return { sent, skipped, paused: pausedCount };
};

const targetOf = (
  deps: QueueImportDeps,
  input: FactoryImportRequest,
  bearer: string | null,
): HqTarget | null => {
  const credential = deps.credentials.read();
  if (input.local) {
    if (credential !== null) throw new Refused(CONNECTED_REFUSAL);
    return null;
  }
  if (credential === null) throw new Refused(STANDALONE_REFUSAL);
  const kind = deps.hq.state().kind;
  if (kind === 'unreachable') throw new Unreachable(HQ_UNREACHABLE);
  if (kind === 'rejected') throw new Refused(HQ_REJECTED);
  if (bearer === null) throw new Unauthorized(MISSING_BEARER);
  return { url: credential.url, bearer };
};

const outcomeOf = (reply: QueueImportReply): Outcome => {
  switch (reply.kind) {
    case 'ok':
      return {
        created: reply.value.created,
        updated: reply.value.updated,
        unchanged: reply.value.skipped,
        errors: [],
      };
    case 'invalid':
      return { created: 0, updated: 0, unchanged: 0, errors: reply.errors };
    case 'unauthorized':
      throw new Unauthorized(HQ_BEARER_REJECTED);
    case 'unreachable':
      throw new Unreachable(HQ_UNREACHABLE);
  }
};

const applyLocal = async (
  deps: QueueImportDeps,
  repoRoot: string,
  body: QueueImportBody,
): Promise<QueueImportReply> => {
  await deps.local.ensureProject({
    projectId: body.projectId,
    repoUrl: await deps.repoConfig.repoUrlOf(repoRoot),
    defaultBaseBranch: LOCAL_BASE_BRANCH,
  });
  return deps.local.importQueue(body);
};

export const createQueueImport =
  (deps: QueueImportDeps) =>
  async (
    input: FactoryImportRequest,
    bearer: string | null,
  ): Promise<FactoryImportReply> => {
    const target = targetOf(deps, input, bearer);
    const projectId = await deps.repoConfig.projectIdOf(input.repoRoot);
    const dir = resolve(input.repoRoot, input.dir ?? TODOS_DIR);
    const prepared = await prepare(deps.todoFiles, dir, input.paused);
    const preview = {
      projectId,
      sent: prepared.sent.map((file) => file.filename),
      skipped: prepared.skipped,
      paused: prepared.paused,
    };
    if (input.dryRun) {
      return {
        ...preview,
        mode: 'dry_run',
        created: 0,
        updated: 0,
        unchanged: 0,
        errors: [],
      };
    }
    const body: QueueImportBody = {
      commandId: randomUUID(),
      projectId,
      mode: 'apply',
      files: prepared.sent,
    };
    const outcome =
      target === null
        ? outcomeOf(await applyLocal(deps, input.repoRoot, body))
        : outcomeOf(await deps.hqLink.importQueue({ ...target, body }));
    return { ...preview, mode: 'apply', ...outcome };
  };
